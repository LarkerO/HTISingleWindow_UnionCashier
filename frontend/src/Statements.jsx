import { useState } from 'react';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { api, date, Empty, Feedback, Field, Loading, money, options, Panel, rails, useAction, useLoad } from './shared';

const environments = { live: '正式', sandbox: '沙箱' };

export function Statement({ merchantId }) {
  const [month, setMonth] = useState('');
  const [env, setEnv] = useState('live');
  const [merchant, setMerchant] = useState('');
  const [page, setPage] = useState(1);
  const filters = new URLSearchParams({ environment: env, month, merchant: merchantId ?? merchant,
    ...(merchantId ? { scope: 'merchant' } : {}), page: String(page) });
  const data = useLoad('statement?' + filters);
  return <Panel title={merchantId ? '商户收款对账单' : '付款对账单'} action={<Button href={'/api/statement.xlsx?' + filters}>下载 XLSX</Button>}>
    <div className="form-grid">
      <Field name="statement-env" label="环境" choices={options(environments)} value={env} onChange={value => { setPage(1); setEnv(value); }} />
      <Field name="statement-month" label="月份（留空为全部）" type="month" value={month} onChange={value => { setPage(1); setMonth(value); }} />
      {!merchantId && <Field name="statement-merchant" label="按商户号筛选" value={merchant} onChange={value => { setPage(1); setMerchant(value.trim()); }} />}
    </div>
    <Feedback error={data.error} />
    {!data.data && !data.error && <Loading />}
    {data.data?.items.length === 0 && <Empty>没有符合条件的交易。</Empty>}
    {data.data?.items.map(row => <Flexbox key={row.id} horizontal align="center" justify="space-between" gap={10} className="record">
      <Flexbox gap={4}><Text as="strong">{row.merchant_name} · {row.out_trade_no}</Text>
        <Text className="muted">{date(row.time)} · {row.event === 'payment' ? '付款' : '退款'} · {row.rail}</Text>
      </Flexbox>
      <Text as="strong">{money(row.amount)}</Text>
    </Flexbox>)}
    {!!data.data?.total && <Flexbox horizontal align="center" gap={10}>
      <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
      <Text>第 {page} 页 · 共 {data.data.total} 条</Text>
      <Button disabled={page * 50 >= data.data.total} onClick={() => setPage(page + 1)}>下一页</Button>
    </Flexbox>}
  </Panel>;
}

export function PaymentLimits() {
  const data = useLoad('payment-limits');
  const [method, setMethod] = useState('vault');
  const [draft, setDraft] = useState({});
  const flow = useAction();
  const current = draft[method] ?? data.data?.limits.find(row => row.method === method) ?? { single: 0, count: 0 };
  const update = key => value => setDraft(previous => ({ ...previous, [method]: { ...current, [key]: value } }));
  return <Panel title="支付方式限额" subtitle="按支付方式设定每单金额和每月笔数。0 表示不限。">
    <form className="stack" onSubmit={event => {
      event.preventDefault();
      flow.run(async () => {
        await api('payment-limits', { method, single: Number(current.single), count: Number(current.count) });
        data.reload();
      }, '限额已保存');
    }}>
      <div className="form-grid">
        <Field name="limit-method" label="支付方式" choices={options({...rails, card: '预付卡'})} value={method} onChange={setMethod} />
        <Field name="limit-single" label="单笔金额" type="number" min={0} value={current.single} onChange={update('single')} required />
        <Field name="limit-count" label="每月笔数" type="number" min={0} value={current.count} onChange={update('count')} required />
      </div>
      <Feedback error={flow.error ?? data.error} success={flow.success} />
      <Flexbox horizontal><Button htmlType="submit" loading={flow.busy}>保存限额</Button></Flexbox>
    </form>
  </Panel>;
}

export function MerchantSettlement({ merchant, refresh }) {
  const [draft, setDraft] = useState({ cycle: merchant.cycle ?? 'D+0', single: 0, monthly: 0, count: 0, ...merchant.limits });
  const flow = useAction();
  const update = key => value => setDraft(previous => ({ ...previous, [key]: value }));
  return <Panel title="收款限额和清算周期" subtitle="0 为不限。T 使用北京时间的周一至周五。">
    <form className="stack" onSubmit={event => {
      event.preventDefault();
      flow.run(async () => {
        await api('merchant', {action: 'settlement', merchant: merchant.id, cycle: draft.cycle,
          single: Number(draft.single), monthly: Number(draft.monthly), count: Number(draft.count)});
        refresh();
      }, '规则已保存');
    }}>
      <div className="form-grid">
        <Field name="settlement-cycle" label="清算周期" choices={options({ 'D+0':'D+0', 'T+0':'T+0', 'T+1':'T+1', 'T+2':'T+2' })}
          value={draft.cycle} onChange={update('cycle')} />
        {Object.entries({ single: '单笔最高金额', monthly: '每月最高金额', count: '每月笔数上限' }).map(([key,label]) =>
          <Field key={key} name={'settlement-' + key} label={label} type="number" min={0} value={draft[key]} onChange={update(key)} required />)}
      </div>
      <Feedback {...flow} />
      <Flexbox horizontal><Button htmlType="submit" loading={flow.busy}>保存规则</Button></Flexbox>
    </form>
  </Panel>;
}
