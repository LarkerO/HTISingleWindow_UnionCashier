import assert from 'node:assert/strict';
import test from 'node:test';
import { gestureIntent, PaymentAttempt, paymentPlan, preserveTerminal, walletCards } from '../src/payment.ts';
import { mobileCheckout } from '../../frontend/src/mobile-route.mjs';
import { minecraftIssue, portalSyncUrl } from '../../frontend/src/portal-profile.mjs';

const id = 'a'.repeat(32);
const order = { id, status: 'pending', kind: 'pay', env: 'sandbox', amount: 80, expires: 5000 };
const prepaid = { number: id, env: 'sandbox', state: 'active', balance: 30, terms: { name: '交通卡', combine: false } };
const wallet = { environment: 'sandbox', available: true, complete: true, balances: { vault: 100, scoreboard: 20 }, cards: [prepaid] };
const checkout = { order, payment_order: ['scoreboard', 'vault'], cards: [prepaid] };
const plan = (key, data = checkout, funds = wallet) => paymentPlan(walletCards(funds).find(card => card.key === key), data, funds, 1000);

test('Portal binding problems remain distinct from privacy settings in both wallet cards', () => {
  const unavailable = { ...wallet, available: false, complete: false, balances: {} };
  for (const status of ['uuid_missing', 'uuid_observed_only', 'uuid_conflict', 'primary_required', 'uuid_in_use']) {
    const issue = minecraftIssue(status);
    assert.doesNotMatch(issue.description, /公开个人资料/);
    assert.ok(walletCards(unavailable, status).slice(0, 2).every(card => card.detail === issue.title));
  }
  assert.match(minecraftIssue('profile_unavailable').description, /公开个人资料/);
  assert.match(minecraftIssue(undefined).description, /同步 Portal 资料/);
});

test('Portal profile sync returns to the same checkout and rejects external targets', () => {
  for (const next of ['/', '/mobile/', '/checkout/' + id, '/mobile/checkout/' + id]) {
    assert.equal(new URL(portalSyncUrl(next), 'https://cashier.test').searchParams.get('next'), next);
  }
  for (const next of ['//attacker.test', 'https://attacker.test', '/unknown']) {
    assert.equal(new URL(portalSyncUrl(next), 'https://cashier.test').searchParams.get('next'), '/');
  }
});

test('mobile UA redirects only checkout; desktop override and iPadOS work', () => {
  assert.equal(mobileCheckout('/checkout/' + id, '', 'Mozilla iPhone Mobile'), '/mobile/checkout/' + id);
  assert.equal(mobileCheckout('/checkout/' + id, '', 'Mozilla Macintosh', 5), '/mobile/checkout/' + id);
  assert.equal(mobileCheckout('/checkout/' + id, '?desktop=1', 'Android Mobile'), null);
  assert.equal(mobileCheckout('/checkout/' + id, '', 'Windows NT'), null);
  assert.equal(mobileCheckout('/', '', 'iPhone Mobile'), null);
  assert.equal(mobileCheckout('/checkout/invalid', '', 'iPhone'), null);
});

test('horizontal and diagonal movements cannot confirm payment', () => {
  assert.equal(gestureIntent(-90, -30, true), 'next');
  assert.equal(gestureIntent(90, -30, true), 'previous');
  assert.equal(gestureIntent(80, -90, true), 'reset');
  assert.equal(gestureIntent(0, -40, true), 'reset');
  assert.equal(gestureIntent(4, -90, true), 'pay');
  assert.equal(gestureIntent(4, -90, false), 'reset');
  assert.equal(gestureIntent(0, 100, true), 'reset');
});

test('insufficient and unknown balances never submit; zero remains zero', () => {
  assert.deepEqual(plan('vault').methods, ['vault']);
  assert.match(plan('scoreboard').reason, /余额不足/);
  assert.match(plan('card:' + id).reason, /余额不足/);
  assert.match(plan('vault', checkout, { ...wallet, balances: {} }).reason, /余额暂不可用/);
  assert.equal(walletCards({ ...wallet, balances: { vault: 0 } })[0].balance, 0);
});

test('combination follows saved wallet order and checks the remaining amount', () => {
  const combined = { ...wallet, cards: [{ ...prepaid, terms: { ...prepaid.terms, combine: true } }] };
  assert.match(plan('card:' + id, checkout, combined).reason, /余额不足/);
  const preferred = { ...checkout, payment_order: ['vault', 'scoreboard'] };
  assert.deepEqual(plan('card:' + id, preferred, combined).methods, ['card:' + id, 'vault']);
});

test('expired, completed, ineligible cards and missing UUID are blocked', () => {
  assert.match(plan('vault', { ...checkout, order: { ...order, expires: 0 } }).reason, /过期/);
  assert.match(plan('vault', { ...checkout, order: { ...order, status: 'paid' } }).reason, /已处理/);
  assert.match(plan('vault', checkout, { ...wallet, available: false }).reason, /Portal/);
  const funded = { ...wallet, cards: [{ ...prepaid, balance: 100 }] };
  assert.match(plan('card:' + id, { ...checkout, cards: [] }, funded).reason, /不适用/);
});

test('hold and agreement preserve the selected first source and disclosed fallback order', () => {
  assert.deepEqual(plan('scoreboard', { ...checkout, order: { ...order, kind: 'hold' } }).methods, ['scoreboard', 'vault']);
  assert.deepEqual(plan('scoreboard', { ...checkout, order: { ...order, kind: 'agreement', amount: 0 } }).methods, ['scoreboard', 'vault']);
});

test('repeated gestures submit one request until a terminal receipt arrives', async () => {
  let calls = 0;
  let resolve;
  const attempt = new PaymentAttempt(() => { calls++; return new Promise(done => { resolve = done; }); }, async () => order);
  const first = attempt.submit(['vault']);
  assert.equal(await attempt.submit(['vault']), null);
  resolve({ ...order, status: 'processing' });
  assert.equal((await first).order.status, 'processing');
  assert.equal(await attempt.submit(['scoreboard']), null);
  assert.equal(calls, 1);
  attempt.reconcile({ ...order, status: 'paid' });
  assert.equal(attempt.busy, false);
});

test('lost POST receipt queries status and never resends the payment', async () => {
  let posts = 0;
  const attempt = new PaymentAttempt(async () => { posts++; throw new Error('timeout'); }, async () => ({ ...order, status: 'paid' }));
  const result = await attempt.submit(['vault']);
  assert.equal(result.order.status, 'paid');
  assert.equal(result.error, undefined);
  assert.equal(posts, 1);
});

test('unreachable status holds the submission lock until reconciliation', async () => {
  const attempt = new PaymentAttempt(async () => { throw new Error('offline'); }, async () => { throw new Error('offline'); });
  assert.equal((await attempt.submit(['vault'])).uncertain, true);
  assert.equal(await attempt.submit(['vault']), null);
  assert.equal(attempt.busy, true);
  attempt.reconcile(order);
  assert.equal(attempt.busy, false);
});

test('late pending or processing responses cannot overwrite a confirmed receipt', () => {
  const paid = { ...order, status: 'paid' };
  assert.equal(preserveTerminal(paid, order), paid);
  assert.equal(preserveTerminal(paid, { ...order, status: 'processing' }), paid);
  assert.equal(preserveTerminal(order, paid), paid);
});
