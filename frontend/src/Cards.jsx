import { useState } from 'react';
import { Button, Flexbox, Image, Tag, Text, Upload } from '@lobehub/ui';
import { api, date, Empty, Feedback, Field, Loading, money, options, Panel, products, rails, randomId, State, useAction, useLoad } from './shared';

const cardEvents = {
  activation: '激活', payment_reserved: '资金冻结', payment_released: '资金解除',
  payment: '支付结算', refund: '商户退款', card_return: '退卡退款', transfer_out: '已转出', transfer_in: '已接收',
};

function refundAmount(card) {
  const proportional = BigInt(card.balance) * BigInt(card.terms.price) / BigInt(card.terms.face);
  return Math.max(0, Number(proportional * BigInt(card.terms.refund_bps) / 10000n) - card.terms.refund_fee);
}

function Artwork({ type }) {
  return <div className="card-art">
    {type.front ? <Image src={'/api/card-art/' + type.front} alt={type.name + '卡面正面'} />
      : <div className="text-card"><Text as="strong">{type.name}</Text><Text>{money(type.face)} 游戏单位</Text></div>}
    {type.back && <Image src={'/api/card-art/' + type.back} alt={type.name + '卡面反面'} />}
  </div>;
}

export function PlayerCards({ user }) {
  const resource = useLoad('cards', 2500);
  const flow = useAction();
  const [rail, setRail] = useState('vault');
  const [env, setEnv] = useState('live');
  const [redeem, setRedeem] = useState({});
  const [targets, setTargets] = useState({});
  const [eventCard, setEventCard] = useState('');
  const [returnCard, setReturnCard] = useState('');
  const [requests, setRequests] = useState({});
  const submit = (action, input, key, message) => {
    const id = requests[key] ?? randomId();
    setRequests(previous => ({ ...previous, [key]: id }));
    return flow.run(async () => {
      await api('cards', { ...input, action, request_id: id });
      setRequests(previous => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
      resource.reload();
    }, message);
  };
  return <>
    <Panel title="预付卡商城" subtitle="购卡后可立即激活，也可将未激活的卡号和卡密赠予他人。">
      <div className="form-grid">
        <Field name="card-env" label="环境" choices={options({ live: '正式', sandbox: '沙箱' })} value={env} onChange={setEnv} />
        <Field name="card-rail" label="购卡支付方式" choices={options(rails)} value={rail} onChange={setRail} />
      </div>
      {!resource.data && !resource.error && <Loading />}
      {resource.data?.catalog.length === 0 && <Empty>暂无可购买的卡种。</Empty>}
      <div className="service-grid">
        {resource.data?.catalog.map(type => <div className="card-product stack" key={type.id}>
          <Artwork type={type} />
          <Text as="strong">{type.name} · 面值 {money(type.face)}</Text>
          <Text className="muted">{type.issuer ? '商户专用' : '平台发行'} · {type.kinds.map(kind => products[kind]).join('、')}</Text>
          <Text className="muted">{type.transfer ? '可转让' : '不可转让'} · {type.refund_bps ? '支持退卡' : '不予退卡'}</Text>
          <Button type="primary" className="primary" disabled={env === 'live' && !user.uuid} loading={flow.busy}
            onClick={() => submit('buy', { type: type.id, rail, environment: env }, 'buy:' + type.id + ':' + env + ':' + rail, '购卡请求已提交')}>
            {money(type.price)} 购买
          </Button>
        </div>)}
      </div>
    </Panel>
    <Feedback error={flow.error ?? resource.error} success={flow.success} />
    <Panel title="激活预付卡">
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        flow.run(async () => { await api('cards', { ...redeem, action: 'redeem' }); setRedeem({}); resource.reload(); }, '预付卡已激活');
      }}>
        <div className="form-grid">
          <Field name="redeem-number" label="卡号" value={redeem.number} onChange={number => setRedeem({ ...redeem, number })} required />
          <Field name="redeem-secret" label="卡密" type="password" value={redeem.secret} onChange={secret => setRedeem({ ...redeem, secret })} required />
        </div>
        <Flexbox horizontal><Button htmlType="submit" loading={flow.busy}>激活</Button></Flexbox>
      </form>
      {resource.data?.operations.map(operation => <div key={operation.id} className="record stack">
        <Flexbox horizontal align="center" gap={10}>
          <Text>{ { buy: '购卡', return: '退卡', fund: '平台补贴金充值' }[operation.action] } · {money(operation.amount)} · {operation.env === 'live' ? '正式' : '沙箱'}</Text>
          <State value={operation.status} />
        </Flexbox>
        {operation.secret && <>
          <Field name={'number-' + operation.id} label="卡号" value={operation.number} readOnly onChange={() => {}} />
          <Field name={'secret-' + operation.id} label="卡密" value={operation.secret} readOnly onChange={() => {}} />
          <Flexbox horizontal><Button loading={flow.busy} onClick={() => flow.run(async () => {
            await api('cards', { action: 'redeem', number: operation.number, secret: operation.secret }); resource.reload();
          }, '预付卡已激活')}>立即兑换</Button></Flexbox>
        </>}
      </div>)}
    </Panel>
    <Panel title="我的预付卡">
      {resource.data?.cards.length === 0 && <Empty>暂无已激活的预付卡。</Empty>}
      {resource.data?.cards.map(card => <div key={card.number} className="record stack">
        <Flexbox horizontal gap={10} wrap="wrap"><Text as="strong">{card.terms.name}</Text>
          <Tag>{card.env === 'live' ? '正式' : '沙箱'}</Tag><Tag>{ { active: '有效', returning: '退卡中', closed: '已退卡' }[card.state] }</Tag>
        </Flexbox>
        <Text>余额 {money(card.balance)} · {rails[card.rail]} · {card.number}</Text>
        {card.state === 'active' && <Flexbox horizontal gap={8} wrap="wrap" align="end">
          {card.terms.transfer && <>
            <Field name={'transfer-' + card.number} label="接收方清算账号 ID" value={targets[card.number]}
              onChange={value => setTargets(previous => ({ ...previous, [card.number]: value }))} />
            <Button disabled={!targets[card.number] || !!card.locks} loading={flow.busy}
              onClick={() => flow.run(async () => {
                await api('cards', { action: 'transfer', number: card.number, user: targets[card.number] }); resource.reload();
              }, '预付卡已转让')}>转让 · 手续费 {money(card.terms.transfer_fee)}</Button>
          </>}
          {returnCard === card.number ? <>
            <Button danger disabled={!!card.locks} loading={flow.busy}
              onClick={async () => {
                await submit('return', { number: card.number }, 'return:' + card.number, '退卡请求已提交');
                setReturnCard('');
              }}>确认退卡 · 退回 {money(refundAmount(card))}</Button>
            <Button onClick={() => setReturnCard('')}>取消</Button>
          </> : <Button danger disabled={!!card.locks} onClick={() => setReturnCard(card.number)}>退卡</Button>}
        </Flexbox>}
      </div>)}
    </Panel>
    <Panel title="预付卡使用记录">
      <Field name="card-event-filter" label="卡片" choices={[{ value: '', label: '全部卡片' }, ...Array.from(new Set((resource.data?.events ?? []).map(event => event.number)),
        number => ({ value: number, label: number }))]} value={eventCard} onChange={setEventCard} />
      {resource.data?.events.filter(event => !eventCard || event.number === eventCard).map(event => <Flexbox key={event.id} className="record" gap={4}>
        <Text as="strong">{cardEvents[event.event]} · {money(event.amount)}</Text>
        <Text className="muted">{date(event.time)} · {event.number}{event.order_id ? ' · ' + event.order_id : ''}</Text>
      </Flexbox>)}
      {resource.data?.events.length === 0 && <Empty>暂无记录。</Empty>}
    </Panel>
  </>;
}

const defaults = issuer => ({
  issuer, name: '', face: 100, discount: 0, single: 0, kinds: ['pay'], merchant_policy: 'blacklist',
  merchants: [], combine: false, transfer: false, transfer_fee: 0, refund: 100, refund_fee: 0, active: true,
});

export function CardIssuer({ issuer }) {
  const resource = useLoad('card-types?issuer=' + encodeURIComponent(issuer), 6000);
  const [lookup, setLookup] = useState('');
  const [form, setForm] = useState(() => defaults(issuer));
  const [binding, setBinding] = useState({});
  const [fund, setFund] = useState({ rail: 'vault', environment: 'live', request_id: randomId() });
  const flow = useAction();
  const field = (name, label, attributes = {}) => <Field label={label} name={'issue-' + name} value={form[name]}
    onChange={value => setForm(previous => ({ ...previous, [name]: value }))} {...attributes} />;
  const bool = (key, label) => <Button aria-pressed={form[key]} className={form[key] ? 'selected' : ''}
    onClick={() => setForm(previous => ({ ...previous, [key]: !previous[key] }))}>{label}</Button>;
  const numeric = (name, label, attributes = {}) => field(name, label, { type: 'number', min: 0, step: 1, required: true, ...attributes });
  function upload(file, side) {
    flow.run(async () => {
      if (file.size > 450 * 1024) throw new Error('卡面文件需小于 450 KiB');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const response = await api('card-art', {data});
      setForm(previous => ({ ...previous, [side]: response.id }));
    }, '卡面已上传');
    return false;
  }
  return <>
    <Panel title={issuer ? '商户预付卡发行' : '平台预付卡发行'} subtitle={issuer ? '该系列仅可在本商户使用。' : '平台卡可按商户白名单或黑名单限制使用。'}>
      <Flexbox horizontal gap={8} wrap="wrap">
        <Button onClick={() => setForm(defaults(issuer))}>新建卡种</Button>
        {resource.data?.types.map(type => <Button key={type.id} onClick={() => setForm({
          ...type, discount: type.discount_bps / 100, refund: type.refund_bps / 100,
        })}>{type.name}</Button>)}
      </Flexbox>
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        flow.run(async () => {
          const result = await api('cards', { ...form, action: 'save', face: Number(form.face), single: Number(form.single),
            transfer_fee: Number(form.transfer_fee), refund_fee: Number(form.refund_fee),
            discount_bps: Math.round(Number(form.discount) * 100), refund_bps: Math.round(Number(form.refund) * 100) });
          setForm({ ...result, discount: result.discount_bps / 100, refund: result.refund_bps / 100 });
          resource.reload();
        }, '卡种已保存');
      }}>
        <div className="form-grid">
          {field('name', '卡种名称', { required: true })}
          {numeric('face', '卡片面值', {min: 1})}
          {numeric('discount', '购买优惠百分比', {max: 99.99, step: 0.01})}
          {numeric('single', '每单支付限额（0 为不限）')}
          {numeric('refund', '退卡比例百分比（0 为不予退款）', {max: 100, step: 0.01})}
          {numeric('refund_fee', '退卡手续费')}
          {numeric('transfer_fee', '转让手续费')}
          {!issuer && field('merchant_policy', '平台卡商户规则', {choices: options({ whitelist: '白名单', blacklist: '黑名单' })})}
        </div>
        {!issuer && <Field name="issue-list" label="商户号，每行一个" type="area" value={form.merchants_text ?? form.merchants.join('\n')}
          onChange={value => setForm(previous => ({ ...previous, merchants_text: value, merchants: value.split(/\s+/).filter(Boolean) }))} />}
        <Flexbox horizontal gap={8} wrap="wrap">
          {['pay','hold','agreement'].map(kind => <Button key={kind} aria-pressed={form.kinds.includes(kind)}
            className={form.kinds.includes(kind) ? 'selected' : ''} onClick={() => setForm(previous => ({ ...previous,
              kinds: previous.kinds.includes(kind) ? previous.kinds.filter(x => x !== kind) : [...previous.kinds, kind],
            }))}>{products[kind]}</Button>)}
        </Flexbox>
        <Flexbox horizontal gap={8} wrap="wrap">
          {bool('active', '开放购买')}{bool('combine', '余额不足时允许组合支付')}{bool('transfer', '允许激活后转让')}
        </Flexbox>
        <Flexbox horizontal gap={8} wrap="wrap">
          {['front','back'].map(side => <Flexbox key={side} horizontal gap={8}>
            <Upload accept="image/png,image/jpeg,image/webp" beforeUpload={file => upload(file, side)}>
              <Button>{side === 'front' ? '上传卡面正面' : '上传卡面反面'}</Button>
            </Upload>
            {form[side] && <Button onClick={() => setForm(previous => ({ ...previous, [side]: '' }))}>移除{side === 'front' ? '正面' : '反面'}</Button>}
          </Flexbox>)}
        </Flexbox>
        {(form.front || form.back) && <Artwork type={form} />}
        <Feedback error={flow.error ?? resource.error} success={flow.success} />
        <Flexbox horizontal><Button type="primary" className="primary" htmlType="submit" loading={flow.busy}>保存卡种</Button></Flexbox>
      </form>
    </Panel>
    <Panel title="代玩家绑定卡片">
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        flow.run(async () => { await api('cards', { ...binding, action: 'bind', issuer }); setBinding({}); }, '预付卡已绑定');
      }}>
        <div className="form-grid">
          {Object.entries({ user: '接收方清算账号 ID', number: '卡号', secret: '卡密' }).map(([key,label]) =>
            <Field key={key} name={'binding-' + key} label={label} type={key === 'secret' ? 'password' : 'text'}
              value={binding[key]} onChange={value => setBinding({ ...binding, [key]: value })} required />)}
        </div>
        <Flexbox horizontal><Button htmlType="submit" loading={flow.busy}>绑定卡片</Button></Flexbox>
      </form>
    </Panel>
    <Panel title="发行卡片使用记录">
      <Field name="issuer-card-event" label="输入卡号筛选" value={lookup} onChange={setLookup} />
      {resource.data?.events.filter(event => lookup ? event.number === lookup.trim() : true).slice(0, 50).map(event =>
        <Flexbox key={event.id} className="record" gap={4}><Text as="strong">{cardEvents[event.event]} · {money(event.amount)}</Text>
          <Text className="muted">{date(event.time)} · {event.number}{event.order_id ? ' · ' + event.order_id : ''}</Text>
        </Flexbox>)}
      {resource.data?.events.filter(event => !lookup || event.number === lookup.trim()).length === 0 && <Empty>暂无记录。</Empty>}
    </Panel>
    {!issuer && <Panel title="平台卡折扣补贴金" subtitle="通过管理员游戏钱包充值后，可按支付方式承担平台卡折扣差额。">
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        flow.run(async () => {
          await api('cards', {...fund, action: 'fund', amount: Number(fund.amount)});
          setFund(previous => ({ ...previous, request_id: randomId(), amount: '' }));
        }, '充值已提交，可在玩家面板查看状态');
      }}>
        <div className="form-grid">
          <Field name="fund-rail" label="支付方式" choices={options(rails)} value={fund.rail} onChange={rail => setFund({ ...fund, rail })} />
          <Field name="fund-env" label="环境" choices={options({ live: '正式', sandbox: '沙箱' })} value={fund.environment} onChange={environment => setFund({ ...fund, environment })} />
          <Field name="fund-amount" label="充值金额" type="number" min={1} value={fund.amount} onChange={amount => setFund({ ...fund, amount })} required />
        </div>
        <Flexbox horizontal><Button htmlType="submit" loading={flow.busy}>充值补贴金</Button></Flexbox>
      </form>
    </Panel>}
  </>;
}
