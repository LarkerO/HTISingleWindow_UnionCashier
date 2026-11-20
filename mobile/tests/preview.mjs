// Local UI acceptance fixture. Never imported by the application or deployed to Webman.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../backend/public/mobile/', import.meta.url));
const id = 'a'.repeat(32);
const number = 'b'.repeat(32);
const terms = { name: '氢气交通卡', combine: false };
let order;
let wallet;
let posts = 0;
let scenario = 'success';
function reset(value = 'success') {
  scenario = value;
  posts = 0;
  order = { id, kind: 'pay', env: 'sandbox', status: 'pending', title: '市域轨道交通 · 单程车票', merchant_name: '氢气城市交通',
    out_trade_no: 'TRANSIT-20261121-001', amount: 128, created: Date.now() / 1000, expires: Date.now() / 1000 + 1800, return_url: 'http://127.0.0.1:48004/mobile/' };
  wallet = { environment: 'sandbox', available: true, complete: true, requested: null, balances: { vault: 12860, scoreboard: 32 },
    cards: [{ number, env: 'sandbox', balance: 560, state: 'active', terms }] };
}
reset();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:48004');
  const json = body => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/__test/reset') { reset(url.searchParams.get('scenario') ?? 'success'); return json({ ok: true }); }
  if (url.pathname === '/__test/state') return json({ posts, order, scenario });
  if (url.pathname === '/api/status') return json({ installed: true, csrf: 'test-only', user: { id: 'fixture-player', name: 'Larker', minecraft_name: 'Larker' }, plugin_online: true });
  if (url.pathname === '/api/player-wallet') return json(wallet);
  if (url.pathname === '/api/account') return json({ orders: [order, { ...order, id: 'c'.repeat(32), title: '城市公交 · 2 路', amount: 8, status: 'paid', created: order.created - 7200 }] });
  if (url.pathname === '/api/checkout/' + id) return json({ order, cards: wallet.cards, payment_order: ['vault', 'scoreboard'] });
  if (url.pathname === '/api/checkout' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { methods } = JSON.parse(body);
    posts++;
    if (order.status !== 'pending' || methods[0] === 'scoreboard') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '所选方式余额不足或订单已处理' }));
    }
    order = { ...order, status: 'processing' };
    setTimeout(() => {
      order = { ...order, status: scenario === 'failure' ? 'failed' : 'paid', ...(scenario === 'failure' ? { failure: 'declined' } : {}) };
      if (scenario !== 'failure' && methods[0] === 'vault') wallet.balances.vault -= order.amount;
    }, 2500);
    return json({ order });
  }
  if (url.pathname === '/api/balance') return json(wallet);
  if (url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }
  const relative = url.pathname.startsWith('/mobile/assets/') || url.pathname === '/mobile/logo.png'
    ? url.pathname.slice('/mobile/'.length) : 'index.html';
  const file = resolve(root, relative);
  if (!file.startsWith(resolve(root))) { res.writeHead(403); return res.end(); }
  try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('Build mobile before starting this fixture.'); }
});
server.listen(48004, '127.0.0.1', () => console.log('UI acceptance fixture: http://127.0.0.1:48004/mobile/checkout/' + id));
