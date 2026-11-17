import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Descriptions, Divider, Flexbox, Statistic, Tag, Text } from '@lobehub/ui';
import { api, date, Empty, Feedback, Field, Loading, money, options, PageTitle, Panel, products, rails, SignIn, State, useAction, useLoad } from './shared';
import { PaymentLimits, Statement } from './Statements';

const minecraftStatus = {
  profile_scope_missing: 'Portal 授权未返回用户名，请联系平台管理员检查 OAuth profile 权限。',
  profile_unavailable: 'Portal 未提供该用户的公开 Minecraft 档案。若要同步，请检查公开个人资料和显示 Minecraft 档案两项设置，再重新登录。',
  unverified: 'Portal 暂无已验证的 Minecraft 绑定，请在 Portal 检查绑定验证状态。',
  primary_required: 'Portal 有多个已验证档案，请选定唯一的主档案后重新登录。',
  uuid_missing: 'Portal 已验证绑定，但绑定记录缺少可用的 UUID。请联系 Portal 管理员检查该玩家的绑定记录。',
  uuid_in_use: '该 Minecraft UUID 已关联其他清算账号，请联系清算管理员核对。',
};

export function Account({ user, online, section = 'account' }) {
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
  const agreements = section === 'agreements';
  const title = { account: '账户概览', orders: '交易记录', agreements: '免密签约', limits: '支付限额', statement: '付款对账' }[section];
  const orders = accountData?.orders.filter(order => (order.kind === 'agreement') === agreements);
  const displayName = user.name || user.hydroline_id;
  return <>
    <PageTitle title={title} description={section === 'account' ? displayName : undefined}
      action={section === 'account' && <Badge status={online ? 'success' : 'default'} text={online ? '游戏端在线' : '游戏端未连接'} />} />
    {section === 'account' && <Flexbox className="service-grid account-grid">
      <Panel title="Minecraft 玩家">
        <Descriptions column={1} colon={false} items={[
          { label: '游戏名称', children: user.minecraft_name || '尚未同步' },
          { label: '清算账号 ID', children: user.id },
        ]} />
        {!user.uuid && <Text as="p" className="muted">{minecraftStatus[user.minecraft_status] ?? '尚无同步状态，请重新登录以检查 Portal 档案。'}</Text>}
      </Panel>
      <Panel title="游戏内余额" action={<Button disabled={!user.uuid} loading={action.busy}
        onClick={() => action.run(async () => { await api('balance', {}); account.reload(); })}>查询</Button>}>
        <Flexbox className="balances">
          {Object.entries(rails).map(([method, label]) => <Statistic key={method} title={label}
            value={money(accountData?.balance?.values?.[method])} />)}
        </Flexbox>
        {accountData?.balance?.requested && <Text className="muted">请求时间 {date(accountData.balance.requested)}</Text>}
      </Panel>
    </Flexbox>}
    <Feedback error={action.error ?? account.error} />
    {section === 'limits' && <PaymentLimits />}
    {section === 'statement' && <Statement />}
    {(section === 'orders' || agreements) && <Panel title={agreements ? '签约记录' : '订单与预授权'}>
      {!accountData && !account.error && <Loading />}
      {orders?.length === 0 && <Empty>{agreements ? '暂无签约记录。' : '暂无交易记录。'}</Empty>}
      {orders?.map(order => <OrderRow key={order.id} order={order} action={order.kind === 'agreement' && order.status === 'active' &&
        <Button danger loading={action.busy} onClick={() => action.run(async () => {
          await api('checkout', { id: order.id, action: 'revoke' });
          account.reload();
        })}>解约</Button>} />)}
    </Panel>}
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
  const [fallbacks, setFallbacks] = useState([]);
  const [nextMethod, setNextMethod] = useState('none');
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
  const primaryCard = selected?.startsWith('card:');
  const allowFallbacks = order.kind !== 'pay' || primaryCard;
  const eligibleFallbacks = Object.entries(methods).filter(([key]) =>
    key !== selected && (order.kind !== 'pay' || !key.startsWith('card:')));
  const availableKeys = new Set(eligibleFallbacks.map(([key]) => key));
  const backup = allowFallbacks ? fallbacks.filter(key => availableKeys.has(key)) : [];
  const unused = eligibleFallbacks.filter(([key]) => !backup.includes(key));

  function moveBackup(index, change) {
    const updated = [...backup];
    [updated[index], updated[index + change]] = [updated[index + change], updated[index]];
    setFallbacks(updated);
  }
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
          value={selected ?? ''} onChange={value => {
            setMethod(value);
            setFallbacks(backup.filter(key => key !== value));
            setNextMethod('none');
          }} choices={options(methods)} />
        {allowFallbacks && <>
          {backup.map((key, index) => <Flexbox key={key} horizontal gap={8} align="center" wrap="wrap" className="record">
            <Text>{index + 2}. {methods[key]}</Text>
            <Button size="small" disabled={index === 0} onClick={() => moveBackup(index, -1)}>上移</Button>
            <Button size="small" disabled={index === backup.length - 1} onClick={() => moveBackup(index, 1)}>下移</Button>
            <Button size="small" onClick={() => setFallbacks(backup.filter(value => value !== key))}>移除</Button>
          </Flexbox>)}
          {unused.length > 0 && backup.length < 7 && <Flexbox horizontal gap={8} align="end" wrap="wrap">
            <Field name="backup-method" label="备用支付方式"
              value={unused.some(([key]) => key === nextMethod) ? nextMethod : 'none'}
              onChange={setNextMethod} choices={[{ value: 'none', label: '选择备用方式' }, ...options(Object.fromEntries(unused))]} />
            <Button disabled={!unused.some(([key]) => key === nextMethod)} onClick={() => {
              setFallbacks([...backup, nextMethod]);
              setNextMethod('none');
            }}>添加</Button>
          </Flexbox>}
        </>}
        <Text as="p" className="muted">{isAgreement ? '商户可按所选顺序发起免密扣款。签约后可在玩家面板解约。'
          : isHold ? '确认后会冻结对应金额。商户解除预授权时，未结算余额退回原支付方式。'
          : '按所选支付方式扣款。支持组合的预付卡可使用游戏钱包补足差额。'}</Text>
        {needsLink && <Alert type="warning" title="当前没有可用方式，请激活适用的预付卡或在 Portal 公开已验证的 Minecraft 档案" />}
        <Button size="large" type="primary" className="primary" disabled={needsLink} loading={action.busy}
          onClick={() => action.run(async () => {
            await api('checkout', { action: 'confirm', id, methods: [selected, ...backup] });
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
