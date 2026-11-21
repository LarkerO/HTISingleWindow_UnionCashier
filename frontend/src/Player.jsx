import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Descriptions, Divider, Flexbox, Icon, Modal, Statistic, Tag, Text } from '@lobehub/ui';
import { api, date, Empty, Feedback, Loading, money, PageTitle, Panel, products, rails, SignIn, State, useAction, useLoad } from './shared';
import { PaymentLimits, Statement } from './Statements';

import { Check, ChevronRight, CreditCard, Fingerprint, ListOrdered, LockKeyhole, ReceiptText } from 'lucide-react';
import { MethodLabel, paymentOptions, PaymentOrderEditor, PaymentOrderPage, PaymentRadioList } from './PaymentOrder';
import { minecraftIssue, portalSyncUrl } from './portal-profile.mjs';

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
  const title = { account: '账户概览', orders: '交易记录', agreements: '免密签约', limits: '支付限额', 'payment-order': '支付顺序调整', statement: '付款对账' }[section];
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
          { label: '绑定方式', children: user.minecraft_status === 'linked_manual' ? '管理员手工绑定'
            : user.uuid ? 'Portal 主展示账号' : '尚未同步' },
        ]} />
        {!user.uuid && <>
          <Text as="p" className="muted">{minecraftIssue(user.minecraft_status).description}</Text>
          <Button href={portalSyncUrl()}>同步 Portal 资料</Button>
        </>}
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
    {section === 'payment-order' && <PaymentOrderPage />}
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
  const [method, setMethod] = useState(null);
  const [popup, setPopup] = useState(null);
  const [draft, setDraft] = useState(null);
  const [savedPreference, setSavedPreference] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const action = useAction();
  const order = resource.data?.order;
  const loadedPreference = resource.data?.payment_order;
  useEffect(() => {
    if (savedPreference && loadedPreference && savedPreference.previous !== loadedPreference) setSavedPreference(null);
  }, [loadedPreference, savedPreference]);
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
  const ordered = isAgreement || isHold;
  const methods = paymentOptions(order.env !== 'live' || user.uuid, resource.data.cards ?? []);
  const available = new Map(methods.map(method => [method.key, method]));
  const preference = (savedPreference?.methods ?? loadedPreference ?? Object.keys(rails)).filter(key => available.has(key));
  const defaultMethod = available.get(preference[0]) ?? methods[0];
  const selected = available.get(method) ?? defaultMethod;
  const pendingMethod = available.get(draft) ?? selected;
  const supplement = selected?.combine ? preference.find(key => Object.hasOwn(rails, key)) : undefined;
  const chosen = selected ? [
    selected.key,
    ...(ordered ? preference.filter(key => key !== selected.key) : supplement ? [supplement] : []),
  ].slice(0, 8) : [];
  const checkoutIcon = isAgreement ? Fingerprint : isHold ? LockKeyhole : CreditCard;

  const expired = order.status === 'pending' && order.expires * 1000 < Date.now();
  return <Flexbox className="checkout-layout">
    <PageTitle title={products[order.kind]} action={order.env === 'sandbox' && <Tag color="warning">沙箱</Tag>} />
    <Panel className="checkout-summary" title={<Flexbox horizontal align="center" gap={8}><Icon icon={ReceiptText} aria-hidden="true" />{order.merchant_name}</Flexbox>}>
      <Text as="p" className="checkout-order-title">{order.title}</Text>
      {!isAgreement && <Text as="p" className="checkout-amount">{money(order.amount)} <Text as="span">游戏单位</Text></Text>}
      <Divider />
      <Flexbox horizontal align="center" justify="space-between" gap={10} className="checkout-meta">
        <Text className="muted">商户订单号 {order.out_trade_no}</Text><State value={order.status} />
      </Flexbox>
    </Panel>
    <Panel title={order.status === 'pending' ? ordered ? '扣款方式' : '支付方式' : '处理进度'}>
      {order.status === 'pending' && !expired && <>
        {ordered && selected && <>
          <Button block className="payment-order-trigger" aria-haspopup="dialog" disabled={action.busy}
            icon={<Icon icon={ListOrdered} aria-hidden="true" />} onClick={() => {
              setDraft(selected.key);
              setPopup('choose');
            }}>
            <Text>{selected.key === defaultMethod.key ? '默认扣款顺序' : '本次扣款顺序'}（优先使用 {selected.name}）</Text>
            <Icon icon={ChevronRight} size={16} aria-hidden="true" />
          </Button>
          <Modal open={popup !== null} title={popup === 'edit' ? '修改扣款顺序' : '扣款方式'}
            onCancel={() => setPopup(null)}
            footer={popup === 'choose' ? <Flexbox horizontal justify="space-between" gap={8} wrap="wrap">
              <Button icon={<Icon icon={ListOrdered} aria-hidden="true" />} onClick={() => setPopup('edit')}>修改扣款顺序</Button>
              <Button type="primary" className="primary" icon={<Icon icon={Check} aria-hidden="true" />} disabled={!pendingMethod}
                onClick={() => {
                  setMethod(pendingMethod.key === defaultMethod.key ? null : pendingMethod.key);
                  setPopup(null);
                }}>确认</Button>
            </Flexbox> : false}>
            {popup === 'edit' ? <PaymentOrderEditor onSaved={methods => {
              setSavedPreference({ methods, previous: loadedPreference });
              setMethod(null);
              setDraft(null);
              resource.reload();
              setPopup('choose');
            }} /> : <PaymentRadioList methods={methods} selected={pendingMethod} onChange={setDraft} />}
          </Modal>
        </>}
        {!ordered && methods.length > 0 && <PaymentRadioList methods={methods} selected={selected} onChange={setMethod} disabled={action.busy} />}
        {isAgreement && <Text as="p" className="muted">商户可按确认的顺序发起免密扣款。签约后可在玩家面板解约。</Text>}
        {isHold && <Text as="p" className="muted">确认后会冻结对应金额。未结算余额在解除时退回原支付方式。</Text>}
        {!ordered && supplement && <Text as="p" className="muted">此预付卡支持组合支付，余额不足时由 {rails[supplement]} 补足差额。</Text>}
        {!selected && <Alert type="warning" title={minecraftIssue(user.minecraft_status).title}
          description={<>{minecraftIssue(user.minecraft_status).description} 已激活且适用的预付卡仍可付款。
            <Button type="text" href={portalSyncUrl('/checkout/' + id)}>同步 Portal 资料</Button></>} />}
        <Button size="large" type="primary" className="primary" disabled={!selected || popup !== null} loading={action.busy}
          icon={<Icon icon={checkoutIcon} aria-hidden="true" />}
          onClick={() => action.run(async () => {
            await api('checkout', { action: 'confirm', id, methods: chosen });
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
    </Panel>
  </Flexbox>;
}
