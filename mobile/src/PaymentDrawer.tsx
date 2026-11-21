import { useEffect, useMemo, useRef, useState } from 'react';
import { LockKeyhole, Store } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, message, money } from './api';
import CardDeck from './CardDeck';
import PaymentFeedback from './PaymentFeedback';
import { failures, PaymentAttempt, paymentPlan, SUCCESS, walletCards } from './payment';
import type { Checkout, Order, Wallet } from './types';
import { portalSyncUrl } from '../../frontend/src/portal-profile.mjs';

type Props = {
  checkout: Checkout; wallet: Wallet; holder: string; open: boolean;
  minecraftStatus?: string;
  readOrder: () => Promise<Order>; acceptOrder: (order: Order) => void;
  refresh: () => Promise<void>;
};

export default function PaymentDrawer({ checkout, wallet, holder, minecraftStatus, open, readOrder, acceptOrder, refresh }: Props) {
  const order = checkout.order;
  const cards = walletCards(wallet, minecraftStatus);
  const [selected, setSelected] = useState('vault');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const submitting = useRef(false);
  const attempt = useMemo(() => new PaymentAttempt(async methods => {
    const result = await api<{ order: Order }>('checkout', { id: order.id, action: 'confirm', methods });
    return result.order;
  }, readOrder), [order.id, readOrder]);
  const card = cards.find(value => value.key === selected) ?? cards[0];
  const plan = paymentPlan(card, checkout, wallet, now);
  const success = SUCCESS.has(order.status);
  const expired = order.status === 'pending' && order.expires * 1000 <= now;
  const terminal = !['pending', 'processing'].includes(order.status);
  const busy = checking || order.status === 'processing';
  const feedback = success ? 'success' : busy ? 'processing' : error || expired || terminal ? 'failed' : 'ready';
  const text = success ? ({ held: '预授权冻结成功', active: '免密签约成功', released: '预授权已解除' }[order.status] ?? '付款成功')
    : busy ? '正在核对付款结果，请稍候'
      : expired ? '订单已过期，请返回商家重新下单'
        : terminal ? failures[order.failure ?? ''] ?? '此订单已结束，请返回商家核对'
          : error ? '付款失败 · ' + error : order.kind === 'agreement' ? '上滑卡片，确认免密签约' : order.kind === 'hold' ? '上滑卡片，确认冻结' : '上滑卡片以支付';
  const names = new Map(cards.map(value => [value.key, value.name]));
  const home = '/mobile/' + (wallet.environment === 'sandbox' ? '?environment=sandbox' : '');
  let returnUrl: string | undefined;
  try { if (order.return_url && ['http:', 'https:'].includes(new URL(order.return_url).protocol)) returnUrl = order.return_url; } catch { /* no merchant return */ }

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (submitting.current) return;
    attempt.reconcile(order);
    setChecking(order.status === 'processing');
  }, [order, attempt]);
  useEffect(() => {
    if (SUCCESS.has(order.status)) void refresh();
  }, [order.status]);

  async function pay() {
    if (submitting.current || attempt.busy || busy || terminal || expired) return;
    if (plan.reason) { setError(plan.reason); return; }
    submitting.current = true;
    setError('');
    setChecking(true);
    try {
      const result = await attempt.submit(plan.methods);
      if (!result) return;
      if (result.order) acceptOrder(result.order);
      if (result.error) setError(result.uncertain ? '结果尚未确认，正在继续查询' : message(result.error));
      setChecking(Boolean(result.uncertain || result.order?.status === 'processing'));
    } finally { submitting.current = false; }
  }

  return <Drawer open={open} dismissible={false} handleOnly showHandle={false} showClose={false}
    desktop="sheet" direction="bottom" size="sm" radius="lg" title="确认付款" hideTitle
    className="checkout-drawer" classNames={{ body: 'checkout-drawer-body', header: 'sr-only', overlay: 'checkout-overlay', footer: 'checkout-drawer-footer' }}
    footer={<>
      {success ? <div className="result-actions">
        <Button tone="brand" size="lg" fullWidth asChild={Boolean(returnUrl)} disabled={!returnUrl}>
          {returnUrl ? <a href={returnUrl}>返回商家</a> : '返回商家'}
        </Button>
        <Button variant="soft" size="lg" fullWidth asChild><a href={home}>回首页</a></Button>
      </div> : <>
        {!wallet.available && !busy && !terminal && !expired && <Button variant="soft" fullWidth asChild>
          <a href={portalSyncUrl('/mobile/checkout/' + order.id)}>同步 Portal 资料</a>
        </Button>}
        {!busy && !terminal && !expired && <Button variant="ghost" tone="brand" fullWidth disabled={Boolean(plan.reason)} onClick={() => void pay()}>
          {order.kind === 'agreement' ? '或点此确认签约' : order.kind === 'hold' ? '或点此确认冻结' : '或点此确认付款'}
        </Button>}
        {!busy && <Button variant="ghost" fullWidth asChild><a href={home}>{terminal || expired ? '回首页' : '暂不付款，回首页'}</a></Button>}
        {busy && <p className="payment-note">订单正在处理，结果将自动更新</p>}
      </>}
    </>}>
    <div className="merchant-summary">
      <span className="merchant-avatar"><Store size={22} aria-hidden="true" /></span>
      <p className="merchant-name">{order.merchant_name}</p>
      <p className="payment-title">{order.title}</p>
      <div className="payment-amount">{order.kind === 'agreement' ? '免密签约' : money(order.amount)}{order.kind !== 'agreement' && <span>游戏单位</span>}</div>
      <div className="checkout-badges">{order.env === 'sandbox' && <Badge tone="warning">沙箱交易</Badge>}{order.kind === 'hold' && <Badge tone="info">预授权冻结</Badge>}</div>
    </div>
    <CardDeck cards={cards} selected={selected} onSelect={key => { setSelected(key); setError(''); }} holder={holder}
      environment={wallet.environment} paying locked={busy || terminal || expired} rejection={plan.reason} onPay={() => void pay()} onReject={setError} />
    {plan.methods.length > 1 && !terminal && <p className="funding-note">{order.kind === 'pay' ? '余额不足时补扣：' : '本次扣款顺序：'}{plan.methods.map(key => names.get(key) ?? key).join(' → ')}</p>}
    {order.kind === 'agreement' && !terminal && <p className="funding-note">确认后允许该商家按上述顺序免密扣款。可在原玩家面板管理或解约。</p>}
    {order.kind === 'hold' && !terminal && <p className="funding-note">确认后冻结款项，未结算余额将沿原支付来源释放。</p>}
    <PaymentFeedback state={feedback} text={text} />
    <p className="payment-note"><LockKeyhole size={13} aria-hidden="true" />统一支付清算 · {order.out_trade_no}</p>
  </Drawer>;
}
