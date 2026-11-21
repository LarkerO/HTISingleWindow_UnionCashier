import type { Checkout, Order, PaymentCard, Wallet } from './types.ts';
import { minecraftIssue } from '../../frontend/src/portal-profile.mjs';

export const SUCCESS = new Set(['paid', 'held', 'active', 'released']);
export const labels: Record<string, string> = {
  pending: '待付款', processing: '处理中', paid: '已付款', held: '已冻结', active: '已签约',
  released: '已解除', revoked: '已解约', failed: '付款失败',
};
export const failures: Record<string, string> = {
  insufficient: '余额不足，请返回商家重新下单', unavailable: '支付方式暂不可用',
  range: '金额超出支付方式范围', declined: '经济服务拒绝了付款',
};

export function preserveTerminal(previous: Order | undefined, incoming: Order): Order {
  return previous && !['pending', 'processing'].includes(previous.status) && ['pending', 'processing'].includes(incoming.status)
    ? previous : incoming;
}

export function walletCards(wallet: Wallet, minecraftStatus?: string): PaymentCard[] {
  return [
    ...(['vault', 'scoreboard'] as const).map(type => ({
      key: type, type, name: type === 'vault' ? 'Vault 钱包' : '计分板钱包',
      balance: wallet.balances[type] ?? null,
      detail: !wallet.available ? minecraftIssue(minecraftStatus).title : wallet.balances[type] == null ? '余额暂不可用' : '游戏内可用余额',
    })),
    ...wallet.cards.map(card => ({
      key: 'card:' + card.number, type: 'prepaid' as const, name: card.terms.name,
      balance: card.balance, detail: '预付卡 · 尾号 ' + card.number.slice(-6),
      art: card.terms.front, combine: card.terms.combine,
    })),
  ];
}

// The displayed card is the first funding source. Any fallback is disclosed before consent.
export function paymentPlan(card: PaymentCard, checkout: Checkout, wallet: Wallet, now = Date.now()) {
  const order = checkout.order;
  if (order.status !== 'pending') return { methods: [], reason: '订单已处理' };
  if (order.expires * 1000 <= now) return { methods: [], reason: '订单已过期，请返回商家重新下单' };
  const ordered = order.kind !== 'pay';
  const methods = [card.key];
  const available = new Set([
    ...(wallet.available ? ['vault', 'scoreboard'] : []),
    ...checkout.cards.map(value => 'card:' + value.number),
  ]);
  if (card.type !== 'prepaid' && !wallet.available) return { methods: [], reason: '请先通过 Portal 同步 Minecraft 档案' };
  if (card.type !== 'prepaid' && card.balance == null && order.kind !== 'agreement') return { methods: [], reason: '余额暂不可用，请刷新后重试' };
  if (ordered) {
    methods.push(...checkout.payment_order.filter(key => key !== card.key && available.has(key)));
  } else if (card.combine && card.type === 'prepaid') {
    const fallback = checkout.payment_order.find(key => ['vault', 'scoreboard'].includes(key) && available.has(key));
    if (fallback) methods.push(fallback);
  }
  if (order.kind !== 'agreement' && card.balance != null && card.balance < order.amount) {
    const fallbackBalances = methods.slice(1).map(key => wallet.balances[key]).filter((value): value is number => value != null);
    if (!ordered && (!card.combine || !fallbackBalances.some(value => value >= order.amount - card.balance!))) {
      return { methods: [], reason: '余额不足，请换一张卡片' };
    }
    // Ordered holds may fall back to another complete source, or combine a prepaid card with a game wallet.
    if (ordered && !methods.slice(1).some(key => {
      const balance = wallet.balances[key] ?? wallet.cards.find(value => 'card:' + value.number === key)?.balance;
      const required = card.type === 'prepaid' && card.combine && ['vault', 'scoreboard'].includes(key) ? order.amount - card.balance! : order.amount;
      return balance != null && balance >= required;
    })) return { methods: [], reason: '余额不足，请换一张卡片' };
  }
  if (card.type === 'prepaid' && !available.has(card.key)) return { methods: [], reason: '此卡不适用于当前商家、金额或场景' };
  return { methods: methods.slice(0, 8), reason: '' };
}

export function gestureIntent(x: number, y: number, paying: boolean): 'next' | 'previous' | 'pay' | 'reset' {
  if (Math.abs(x) > Math.abs(y) * 1.2 && Math.abs(x) >= 48) return x < 0 ? 'next' : 'previous';
  if (paying && y <= -84 && Math.abs(y) > Math.abs(x) * 1.2) return 'pay';
  return 'reset';
}

/** Locks a single order across gestures; an uncertain POST is reconciled by GET, never retried automatically. */
export class PaymentAttempt {
  busy = false;
  private confirm: (methods: string[]) => Promise<Order>;
  private read: () => Promise<Order>;
  constructor(confirm: (methods: string[]) => Promise<Order>, read: () => Promise<Order>) {
    this.confirm = confirm;
    this.read = read;
  }
  async submit(methods: string[]): Promise<{ order?: Order; error?: unknown; uncertain?: boolean } | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const order = await this.confirm(methods);
      this.reconcile(order);
      return { order };
    } catch (error) {
      try {
        const order = await this.read();
        this.reconcile(order);
        return { order, error: order.status === 'pending' ? error : undefined };
      } catch {
        return { error, uncertain: true };
      }
    }
  }
  reconcile(order: Order) { this.busy = order.status === 'processing'; }
}
