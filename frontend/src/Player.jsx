import { useEffect, useState } from 'react';
import { Alert, Button, Divider, Flexbox, Tag, Text } from '@lobehub/ui';
import { api, date, Empty, Feedback, Field, Loading, money, options, PageTitle, Panel, products, rails, SignIn, State, useAction, useLoad } from './shared';

import { PaymentLimits, Statement } from './Statements';

export function Account({ user, online }) {
  const account = useLoad(user ? 'account' : null, 4000);
  const action = useAction();
  if (!user) {
    return <>
      <Panel className="home-hero">
        <Text as="p" className="hero-eyebrow">交通信息单一窗口</Text>
        <Text as="h1">统一支付清算</Text>
        <Text as="p" className="hero-copy">管理 Minecraft 交通消费、预授权和免密签约，并查询游戏内余额。</Text>
        <Flexbox horizontal><SignIn /></Flexbox>
      </Panel>
      <div className="service-grid">
        {[
          ['交通支付', '通过商户收银台选择 Vault 或计分板，确认当次消费。'],
          ['预授权', '冻结预约金额，商户结算后退回未扣部分。'],
          ['免密签约', '为指定商户设置扣款顺序，可在玩家面板解约。'],
        ].map(([title, info]) => <Panel key={title} title={title}><Text as="p" className="muted">{info}</Text></Panel>)}
      </div>
    </>;
  }
  const accountData = account.data;
  const displayName = user.name || user.hydroline_id;
  return <>
    <PageTitle title="玩家面板" description={'已通过 HydCraft Portal 登录 · ' + displayName}
      action={<Tag color={online ? 'success' : 'gray'}>{online ? '游戏端在线' : '游戏端未连接'}</Tag>} />
    <div className="service-grid account-grid">
      <Panel title="Minecraft 玩家">
        <Text as="p">{user.minecraft_name ?? '尚未绑定'}</Text>
        {!user.uuid && <Text as="p" className="muted">请在 Portal 绑定 Minecraft 玩家、公开玩家档案后重新登录。</Text>}
        <Text as="p" className="muted">清算账号 ID {user.id}</Text>
      </Panel>
      <Panel title="游戏内余额" action={<Button disabled={!user.uuid} loading={action.busy}
        onClick={() => action.run(async () => { await api('balance', {}); account.reload(); })}>查询</Button>}>
        <div className="balances">
          {Object.entries(rails).map(([method, label]) => <div key={method}>
            <Text as="p" className="muted">{label}</Text>
            <Text className="amount">{money(accountData?.balance?.values?.[method])}</Text>
          </div>)}
        </div>
        {accountData?.balance?.requested && <Text className="muted">请求时间 {date(accountData.balance.requested)}</Text>}
      </Panel>
    </div>
    <Feedback error={action.error ?? account.error} />
    <PaymentLimits />
    <Statement />
    <Panel title="交易与协议" subtitle="查看本账号提交的订单、预授权和签约">
      {!accountData && !account.error && <Loading />}
      {accountData?.orders.length === 0 && <Empty>目前没有交易或签约记录。</Empty>}
      {accountData?.orders.map(order => <OrderRow key={order.id} order={order} action={order.kind === 'agreement' && order.status === 'active' &&
        <Button danger loading={action.busy} onClick={() => action.run(async () => {
          await api('checkout', { id: order.id, action: 'revoke' });
          account.reload();
        })}>解约</Button>} />)}
    </Panel>
  </>;
}

export function OrderRow({ order, action }) {
  return <Flexbox horizontal justify="space-between" align="center" gap={12} className="record">
    <Flexbox gap={4} className="record-main">
      <Text as="strong">{order.title}</Text>
      <Text className="muted">{order.merchant_name} · {products[order.kind]} · {date(order.created)}</Text>
      <Text className="muted">商户订单号 {order.out_trade_no}{order.env === 'sandbox' ? ' · 沙箱' : ''}</Text>
    </Flexbox>
    <Flexbox horizontal align="center" gap={8} wrap="wrap">
      {order.kind !== 'agreement' && <Text as="strong">{money(order.amount)}</Text>}
      <State value={order.status} />
      {action}
    </Flexbox>
  </Flexbox>;
}

export function Checkout({ id, user }) {
  const resource = useLoad(user ? 'checkout/' + id : null, 2000);
  const [method, setMethod] = useState('vault');
  const [fallback, setFallback] = useState('none');
  const [confirmed, setConfirmed] = useState(false);
  const action = useAction();
  const order = resource.data?.order;
  const completed = order && ['paid', 'held', 'active', 'released'].includes(order.status);
  useEffect(() => {
    if (confirmed && completed && order.return_url) {
      const timer = setTimeout(() => location.assign(order.return_url), 2000);
      return () => clearTimeout(timer);
    }
  }, [confirmed, completed, order?.return_url]);

  if (!user) return <>
    <PageTitle title="收银台" />
    <Panel title="登录以查看订单"><SignIn checkout={id} /></Panel>
  </>;
  if (!order) return resource.error ? <Feedback error={resource.error} /> : <Loading />;

  const isAgreement = order.kind === 'agreement';
  const isHold = order.kind === 'hold';
  const methods = {
    ...(order.env === 'live' && !user.uuid ? {} : rails),
    ...Object.fromEntries((resource.data.cards ?? []).map(card =>
      ['card:' + card.number, card.terms.name + ' · 余额 ' + money(card.balance) + ' · ' + card.number.slice(-6)])),
  };
  const selected = methods[method] ? method : Object.keys(methods)[0];
  const backup = fallback !== selected && methods[fallback] ? fallback : 'none';
  const primaryCard = selected?.startsWith('card:');
  const needsLink = !selected;
  const expired = order.status === 'pending' && order.expires * 1000 < Date.now();
  return <div className="checkout-layout">
    <PageTitle title={products[order.kind]} action={order.env === 'sandbox' && <Tag color="warning">沙箱</Tag>} />
    <Panel className="checkout-summary" title={order.merchant_name}>
      <Text as="p" className="checkout-order-title">{order.title}</Text>
      {!isAgreement && <Text as="p" className="checkout-amount">{money(order.amount)} <Text as="span">游戏单位</Text></Text>}
      <Divider />
      <Flexbox horizontal align="center" justify="space-between" gap={10} className="checkout-meta">
        <Text className="muted">商户订单号 {order.out_trade_no}</Text><State value={order.status} />
      </Flexbox>
    </Panel>
    <Panel title={order.status === 'pending' ? '支付方式' : '处理进度'}>
      {order.status === 'pending' && !expired && <>
        <Field name="payment-method" label={order.kind === 'pay' ? '支付方式' : '优先支付方式'}
          value={selected ?? ''} onChange={value => { setMethod(value); if (value === fallback) setFallback('none'); }}
          choices={options(methods)} />
        {(order.kind !== 'pay' || primaryCard) && <Field name="backup-method" label="备用支付方式"
          value={backup} onChange={setFallback} choices={options({ none: '不使用备用方式',
            ...Object.fromEntries(Object.entries(methods).filter(([key]) => key !== selected)) })} />}
        <Text as="p" className="muted">{isAgreement ? '商户可按所选顺序发起免密扣款。签约后可在玩家面板解约。'
          : isHold ? '确认后会冻结对应金额。商户解除预授权时，未结算余额退回原支付方式。'
          : '确认后从所选游戏余额扣款。'}</Text>
        {needsLink && <Alert type="warning" title="当前没有可用方式，请激活适用的预付卡或在 Portal 公开已验证的 Minecraft 档案" />}
        <Button size="large" type="primary" className="primary" disabled={needsLink} loading={action.busy}
          onClick={() => action.run(async () => {
            await api('checkout', { action: 'confirm', id, methods: backup === 'none' ? [selected] : [selected, backup] });
            setConfirmed(true);
            resource.reload();
          })}>{isAgreement ? '确认签约' : isHold ? '确认冻结' : '确认支付'}</Button>
      </>}
      {expired && <Alert type="warning" title="该订单已过期，请返回商户重新下单" />}
      {order.status === 'processing' && <Alert title="正在等待清算结果" />}
      {order.status === 'failed' && <Alert type="error" title="交易失败" description={
        { insufficient: '游戏内余额不足', unavailable: '支付方式暂不可用', range: '金额超出支付方式范围', declined: '经济服务拒绝了操作' }[order.failure]
          ?? '请联系商户或管理员核对该订单'
      } />}
      {completed && order.return_url && <Button type="primary" className="primary" href={order.return_url}>返回商户</Button>}
      <Feedback error={action.error ?? resource.error} />
      <Button type="text" href="/">返回玩家面板</Button>
    </Panel>
  </div>;
}
