import { useState } from 'react';
import { A, Alert, Badge, Button, Descriptions, Flexbox, Select, Statistic, Tag, Text } from '@lobehub/ui';
import { api, date, Empty, Feedback, Field, Loading, money, options, PageTitle, Panel, products, rails, randomId, State, useAction, useLoad } from './shared';
import { OrderRow } from './Player';
import { CardIssuer } from './Cards';
import { MerchantSettlement, Statement } from './Statements';

function BusinessForm({ label, value, setValue, name, ...rest }) {
  return <Field name={name} label={label} value={value[name]} onChange={next => setValue({ ...value, [name]: next })} {...rest} />;
}

const lines = content => content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

export function Merchants({ user, admin, section, route }) {
  const list = useLoad('merchants');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const flow = useAction();
  const merchants = list.data?.merchants.filter(merchant => admin || merchant.members[user.id]) ?? [];
  const current = merchants.find(merchant => merchant.id === selected) ?? merchants[0];
  const merchantId = current?.id;
  const detail = useLoad(merchantId ? 'merchants/' + merchantId : null, 4000);
  const merchant = detail.data?.merchant;
  const canEdit = admin || current?.members[user.id] === 'admin';
  const pages = [
    ['overview', '概览'],
    ['orders', '订单'],
    ['statement', '对账'],
    ['console', '交易调试'],
    ...(admin ? [['review', '审核与产品'], ['settlement', '限额与清算']] : []),
    ...(canEdit ? [['keys', '接口密钥'], ['members', '成员']] : []),
    ...(canEdit && current?.state === 'approved'
      ? [['cards', '发行预付卡'], ['bind', '代玩家绑卡'], ['card-events', '预付卡记录']] : []),
  ];
  const active = section === 'onboard' || pages.some(([key]) => section === key) ? section : 'overview';
  return <>
    <PageTitle title={admin ? '商户审核与管理' : '我的商户'} />
    <Feedback error={list.error ?? detail.error ?? flow.error} success={flow.success} />
    <Panel>
      <Flexbox horizontal gap={12} align="center" wrap="wrap">
        {merchants.length > 0 && <Select aria-label="当前商户" className="merchant-picker" value={merchantId}
          onChange={setSelected} options={merchants.map(item => ({
            value: item.id, label: <Flexbox horizontal align="center" gap={8}><Text>{item.name}</Text><State value={item.state} /></Flexbox>,
          }))} />}
        <A className="workspace-link" href={'#' + route + '/onboard'}
          aria-current={active === 'onboard' ? 'page' : undefined}>{admin ? '商户进件' : '申请进件'}</A>
      </Flexbox>
      {merchantId && <Flexbox as="nav" aria-label="商户栏目" horizontal gap={4} wrap="wrap">
        {pages.map(([key, label]) => <A key={key} className="workspace-link" href={'#' + route + '/' + key}
          aria-current={active === key ? 'page' : undefined}>{label}</A>)}
      </Flexbox>}
    </Panel>
    {active === 'onboard' ? <Panel title={admin ? '商户进件' : '申请进件'}>
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        flow.run(async () => {
          const result = await api('merchant', { ...form, action: 'onboard' });
          setSelected(result.merchant.id);
          setForm({});
          list.reload();
        }, '已提交进件');
      }}>
        <BusinessForm name="name" label="商户名称" value={form} setValue={setForm} required />
        {admin && <BusinessForm name="owner" label="管理员清算账号 ID（留空使用当前账号）" value={form} setValue={setForm} />}
        <Flexbox horizontal><Button type="primary" className="primary" htmlType="submit" loading={flow.busy}>提交进件</Button></Flexbox>
      </form>
    </Panel> : <>
      {(!list.data && !list.error || merchantId && !merchant && !detail.error) && <Loading />}
      {list.data && !merchants.length && <Empty>暂无关联商户。</Empty>}
    </>}
    {merchant && <MerchantDetail key={merchant.id} data={detail.data} section={active} canEdit={canEdit} admin={admin}
      refresh={() => { detail.reload(); list.reload(); }} />}
  </>;
}

function MerchantDetail({ data, section, canEdit, admin, refresh }) {
  const { merchant, orders, balances } = data;
  return <>
    {section === 'overview' && <Panel title={merchant.name} action={<State value={merchant.state} />}>
      <Descriptions column={1} colon={false} items={[
        { label: '商户号', children: merchant.id },
        { label: '正式清算周期', children: merchant.cycle ?? 'D+0' },
        { label: '已开通产品', children: <Flexbox horizontal gap={8} wrap="wrap">
          {merchant.products.length ? merchant.products.map(product => <Tag key={product}>{products[product]}</Tag>) : '尚未开通'}
        </Flexbox> },
      ]} />
      <Flexbox className="balance-grid">
        {['live', 'sandbox'].flatMap(env => Object.entries(rails).map(([rail, label]) => {
          const ledger = balances.find(row => row.env === env && row.rail === rail);
          return <Flexbox key={env + rail} gap={4}>
            <Statistic title={(env === 'live' ? '正式' : '沙箱') + ' · ' + label} value={money(ledger?.balance ?? 0)} />
            <Text className="muted">可提现 {money(ledger?.available ?? 0)}</Text>
          </Flexbox>;
        }))}
      </Flexbox>
    </Panel>}
    {admin && section === 'review' && <MerchantReview merchant={merchant} refresh={refresh} />}
    {admin && section === 'settlement' && <MerchantSettlement merchant={merchant} refresh={refresh} />}
    {canEdit && section === 'keys' && <MerchantKeys merchant={merchant} refresh={refresh} />}
    {canEdit && section === 'members' && <MerchantMembers merchant={merchant} refresh={refresh} />}
    <Flexbox className="merchant-console" hidden={section !== 'console'}><Console merchant={merchant} refresh={refresh} /></Flexbox>
    {section === 'statement' && <Statement merchantId={merchant.id} />}
    {canEdit && merchant.state === 'approved' && <CardIssuer issuer={merchant.id} section={section} />}
    {section === 'orders' && <Panel title="商户订单">
      {!orders.length && <Empty>暂无订单。</Empty>}
      {orders.map(order => <Flexbox key={order.id}>
        <OrderRow order={order} action={order.checkout_url ? <Button href={order.checkout_url} size="small">收银台</Button> : null} />
        <Text as="p" code>{order.out_trade_no} · {order.id}</Text>
      </Flexbox>)}
    </Panel>}
  </>;
}

function MerchantReview({ merchant, refresh }) {
  const [state, setState] = useState(merchant.state);
  const [enabled, setEnabled] = useState(merchant.products);
  const flow = useAction();
  return <Panel title="审核与产品配置">
    <form className="stack" onSubmit={event => {
      event.preventDefault();
      flow.run(async () => { await api('merchant', { action: 'review', merchant: merchant.id, state, products: enabled }); refresh(); }, '审核已保存');
    }}>
      <Field name="review-state" label="审核状态" value={state} onChange={setState}
        choices={options({ pending: '待审核', approved: '通过', rejected: '拒绝' })} />
      <Flexbox horizontal wrap="wrap" gap={8}>
        {Object.entries(products).map(([id, label]) => <Button key={id}
          className={enabled.includes(id) ? 'selected' : ''} aria-pressed={enabled.includes(id)}
          onClick={() => setEnabled(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])}>{label}</Button>)}
      </Flexbox>
      <Feedback {...flow} />
      <Flexbox horizontal><Button htmlType="submit" loading={flow.busy}>保存审核</Button></Flexbox>
    </form>
  </Panel>;
}

function MerchantKeys({ merchant, refresh }) {
  const [form, setForm] = useState({ origins: merchant.origins.join('\n'), public_key: '' });
  const flow = useAction();
  return <Panel title="开放接口设置" subtitle="提交新的 SM2 公钥会一起轮换 API Key。">
    <form className="stack" onSubmit={event => {
      event.preventDefault();
      flow.run(async () => {
        await api('merchant', { action: 'settings', merchant: merchant.id, origins: lines(form.origins), public_key: form.public_key });
        setForm(previous => ({ ...previous, public_key: '' }));
        refresh();
      }, '接口配置已保存');
    }}>
      <Text className="muted">API Key {merchant.key_id ?? '未配置'}</Text>
      <BusinessForm name="origins" label="返回地址来源，每行一个" value={form} setValue={setForm} type="area" placeholder="https://merchant.example" />
      <BusinessForm name="public_key" label="SM2 公钥 PEM" value={form} setValue={setForm} type="area" placeholder="-----BEGIN PUBLIC KEY-----" />
      <Feedback {...flow} />
      <Flexbox horizontal><Button htmlType="submit" loading={flow.busy}>保存设置</Button></Flexbox>
    </form>
  </Panel>;
}

function MerchantMembers({ merchant, refresh }) {
  const [form, setForm] = useState({ role: 'operator' });
  const flow = useAction();
  return <Panel title="成员管理">
    <form className="stack" onSubmit={event => {
      event.preventDefault();
      flow.run(async () => { await api('merchant', { ...form, action: 'member', merchant: merchant.id }); refresh(); }, '成员已更新');
    }}>
      {Object.entries(merchant.members).map(([id, role]) => <Flexbox horizontal gap={10} key={id}>
        <Text className="muted">{id}</Text><Tag>{role === 'admin' ? '管理员' : '操作员'}</Tag>
      </Flexbox>)}
      <BusinessForm name="user" label="成员清算账号 ID" value={form} setValue={setForm} required />
      <BusinessForm name="role" label="角色" value={form} setValue={setForm}
        choices={options({ operator: '操作员', admin: '管理员', remove: '移除成员' })} />
      <Feedback {...flow} />
      <Flexbox horizontal><Button htmlType="submit" loading={flow.busy}>更新成员</Button></Flexbox>
    </form>
  </Panel>;
}

const actions = { create: '创建订单', query: '查询', capture: '解除／结算预授权', debit: '免密扣款', revoke: '商户解约', refund: '退款', split: '分账给玩家', payout: '提现至玩家' };
const defaultForm = () => ({ environment: 'sandbox', action: 'create', kind: 'pay', rail: 'vault', request_id: randomId() });

function Console({ merchant, refresh }) {
  const [form, setForm] = useState(defaultForm);
  const [result, setResult] = useState(null);
  const flow = useAction();
  const field = (name, label, props = {}) => <BusinessForm name={name} label={label} value={form} setValue={setForm} {...props} />;
  const a = form.action;
  const query = a === 'query';
  const create = a === 'create';
  const hasAmount = !query && a !== 'revoke' && (!create || form.kind !== 'agreement');
  const hasOrder = ['capture', 'debit', 'revoke', 'refund'].includes(a);
  const hasRail = ['split', 'payout'].includes(a);

  async function submit(event) {
    event.preventDefault();
    await flow.run(async () => {
      const input = { action: a };
      if (!query || form.query_request) input.request_id = query ? form.query_request : form.request_id;
      if (hasAmount) input.amount = Number(form.amount);
      if (hasOrder || (query && !form.query_request)) input.order_id = form.order_id;
      if (hasRail) input.rail = form.rail;
      if ((create || a === 'split' || a === 'payout') && form.target) input.user = form.target;
      if (create) Object.assign(input, { kind: form.kind, out_trade_no: form.out_trade_no, title: form.title, return_url: form.return_url ?? '' });
      setResult(await api('merchant', { action: 'command', merchant: merchant.id, environment: form.environment, input }));
      refresh();
    });
  }
  const last = result?.request;
  async function poll() {
    await flow.run(async () => {
      setResult(await api('merchant', { action: 'command', merchant: merchant.id, environment: last.env,
        input: { action: 'query', request_id: last.request_id } }));
      refresh();
    });
  }

  return <Panel title="交易调试" subtitle="沙箱提供独立的模拟余额。正式请求会实际变更游戏或商户余额。">
    {form.environment === 'live' && <Alert type="warning" title="当前为正式环境，提交前请核对账号与金额。" />}
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        {field('environment', '交易环境', { choices: options({ sandbox: '沙箱', live: '正式' }) })}
        {field('action', '接口操作', { choices: options(actions) })}
        {!query && field('request_id', '幂等请求编号', { required: true, tip: '同一操作遇到超时或结果未知时，重试请使用原编号。' })}
        {query && field('query_request', '请求编号（或填写清算订单 ID）')}
        {(hasOrder || query) && field('order_id', '清算订单 ID', { required: hasOrder })}
        {create && <>
          {field('kind', '订单类型', { choices: options({ pay: products.pay, hold: products.hold, agreement: products.agreement }) })}
          {field('out_trade_no', '商户订单号', { required: true })}
          {field('title', '订单标题', { required: true })}
          {field('return_url', '完成后返回地址', { type: 'url' })}
        </>}
        {(create || a === 'split' || a === 'payout') && field('target', create ? '指定玩家清算账号 ID（可选）' : a === 'payout' ? '收款玩家 ID（留空使用超级管理员）' : '收款玩家清算账号 ID', { required: a === 'split' })}
        {hasAmount && field('amount', a === 'capture' ? '实扣金额（0 为全额解除）' : '金额', { required: true,
          type: 'number', min: a === 'capture' ? 0 : 1, step: 1, max: 2000000000 })}
        {hasRail && field('rail', '清算支付方式', { choices: options(rails) })}
      </div>
      {form.environment === 'live' && !query && <Alert type="warning" title="当前是正式交易，提交前请核对参数" />}
      <Feedback {...flow} />
      <Flexbox horizontal wrap="wrap" gap={8}>
        <Button type="primary" className="primary" htmlType="submit" loading={flow.busy}>{query ? '查询' : '执行请求'}</Button>
        {!query && <Button onClick={() => setForm(previous => ({ ...previous, request_id: randomId() }))}>生成新请求编号</Button>}
      </Flexbox>
    </form>
    {result && <div className="console-result stack">
      <Flexbox horizontal gap={8} wrap="wrap" align="center">
        <Text as="strong">响应</Text>
        {(last || result.order?.status || result.status) && <State value={last?.status ?? result.order?.status ?? result.status} />}
        {last && <Button size="small" loading={flow.busy} onClick={poll}>刷新该请求</Button>}
        {result.order?.checkout_url && <Button size="small" href={result.order.checkout_url}>打开收银台</Button>}
      </Flexbox>
      <Text as="pre" code className="code">{JSON.stringify(result, null, 2)}</Text>
    </div>}
  </Panel>;
}

export function Admin({ user, online, section }) {
  const system = section === 'plugin' || section === 'review';
  const info = useLoad(user?.admin && system ? 'admin' : null, 5000);
  const [key, setKey] = useState('');
  const [decision, setDecision] = useState({});
  const flow = useAction();
  if (!user?.admin) return <Panel title="需要超级管理员权限" />;
  return <>
    <PageTitle title={{
      plugin: 'Bukkit 插件连接', review: '资金操作复核', cards: '平台预付卡发行',
      bind: '代玩家绑卡', 'card-events': '发行卡片使用记录', fund: '平台卡折扣补贴金',
    }[section]} />
    {system && <Feedback error={flow.error ?? info.error} success={flow.success} />}
    {section === 'plugin' && <Panel title="插件公钥" action={<Badge status={online ? 'success' : 'default'} text={online ? '在线' : '未连接'} />}>
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        flow.run(async () => { await api('plugin', { public_key: key }); setKey(''); info.reload(); }, '插件公钥已保存');
      }}>
        <Text className="muted">{info.data?.plugin_set ? '已登记插件公钥' : '尚未登记插件公钥'}</Text>
        <Field name="plugin-key" label="插件 SM2 公钥 PEM" tip="粘贴游戏端插件的 PEM 公钥，包含开头和结尾标记。" type="area" value={key} onChange={setKey} required />
        <Flexbox horizontal><Button type="primary" className="primary" htmlType="submit" loading={flow.busy}>登记游戏端</Button></Flexbox>
      </form>
    </Panel>}
    <CardIssuer issuer="" section={section} />
    {section === 'review' && <Panel title="复核记录">
      {!info.data && !info.error && <Loading />}
      {info.data?.reviews.length === 0 && <Empty>暂无需要复核的资金操作。</Empty>}
      {info.data?.reviews.map(row => <div key={row.id} className="record review">
        <Text as="strong">{rails[row.rail]} · {row.action === 'debit' ? '扣款' : '增款'} · {money(row.amount)}</Text>
        <Text className="muted">{date(row.created)} · {row.uuid}</Text>
        <Text code className="code">{row.id}</Text>
        <State value={row.review_status} />
        {row.review_status === 'pending' && <form className="stack" onSubmit={event => {
          event.preventDefault();
          flow.run(async () => { await api('review', { id: row.id, applied: decision[row.id] === 'applied' }); info.reload(); }, '复核已保存');
        }}>
          <Field name={'review-' + row.id} label="根据游戏端凭证确认资金结果" value={decision[row.id] ?? ''}
            onChange={value => setDecision({ ...decision, [row.id]: value })}
            choices={options({ applied: '资金操作已执行', not_applied: '资金操作未执行' })} />
          <Flexbox horizontal><Button htmlType="submit" disabled={!decision[row.id]} loading={flow.busy}>确认复核</Button></Flexbox>
        </form>}
      </div>)}
    </Panel>}
  </>;
}
