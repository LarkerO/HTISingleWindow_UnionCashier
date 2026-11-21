import { useState } from 'react';
import { ActionIcon, Button, Flexbox, Icon, RadioGroup, Tag, Text } from '@lobehub/ui';
import { ArrowDown, ArrowUp, Check, CreditCard, ListOrdered, Plus, Trash2, Trophy, Wallet } from 'lucide-react';
import { api, Feedback, Loading, money, Panel, rails, useAction, useLoad } from './shared';

const railIcons = { vault: Wallet, scoreboard: Trophy };

export function paymentOptions(includeWallets, cards) {
  return [
    ...(includeWallets ? Object.entries(rails).map(([key, name]) => ({ key, name })) : []),
    ...cards.map(card => ({
      key: 'card:' + card.number,
      name: card.name ?? card.terms.name,
      detail: card.balance == null ? '尾号 ' + card.number.slice(-6) : '余额 ' + money(card.balance) + ' · 尾号 ' + card.number.slice(-6),
      env: card.env,
      combine: card.terms?.combine,
    })),
  ];
}

export function MethodLabel({ method }) {
  return <Flexbox as="span" horizontal align="center" gap={10} className="method-label">
    <Icon icon={railIcons[method.key] ?? CreditCard} size={18} aria-hidden="true" />
    <Flexbox as="span" gap={2}>
      <Text as="span">{method.name}</Text>
      {method.detail && <Text as="span" className="muted method-detail">{method.detail}</Text>}
    </Flexbox>
  </Flexbox>;
}

export function PaymentRadioList({ methods, selected, onChange, disabled }) {
  return <RadioGroup aria-label="选择支付方式" className="payment-radio-list" horizontal={false} gap={8}
    value={selected?.key ?? ''} onChange={onChange} disabled={disabled}
    options={methods.map(method => ({ value: method.key, label: <MethodLabel method={method} /> }))} />;
}

function OrderForm({ config, onSaved }) {
  const [ordered, setOrdered] = useState(config.methods);
  const action = useAction();
  const methods = paymentOptions(true, config.cards);
  const available = new Map(methods.map(method => [method.key, method]));

  function move(index, offset) {
    const updated = [...ordered];
    [updated[index], updated[index + offset]] = [updated[index + offset], updated[index]];
    setOrdered(updated);
  }

  return <Flexbox gap={12}>
    <Text as="p" className="muted">免密签约和预授权默认从上到下尝试当前订单可用的方式。新的顺序适用于之后确认的订单或签约。</Text>
    {ordered.map((key, index) => {
      const method = available.get(key);
      return <Flexbox horizontal align="center" justify="space-between" gap={12} className="record" key={key}>
        <Flexbox horizontal align="center" gap={8}>
          <Text className="muted">{index + 1}.</Text>
          <MethodLabel method={method} />
          {method.env && <Tag>{method.env === 'live' ? '正式' : '沙箱'}</Tag>}
        </Flexbox>
        <Flexbox horizontal gap={4}>
          <ActionIcon icon={ArrowUp} title="上移" aria-label={'上移 ' + method.name} disabled={index === 0 || action.busy} onClick={() => move(index, -1)} />
          <ActionIcon icon={ArrowDown} title="下移" aria-label={'下移 ' + method.name} disabled={index === ordered.length - 1 || action.busy} onClick={() => move(index, 1)} />
          {method.env && <ActionIcon icon={Trash2} title="移除" aria-label={'移除 ' + method.name} disabled={action.busy}
            onClick={() => setOrdered(ordered.filter(item => item !== key))} />}
        </Flexbox>
      </Flexbox>;
    })}
    {methods.filter(method => !ordered.includes(method.key)).map(method =>
      <Button key={method.key} icon={<Icon icon={Plus} aria-hidden="true" />} disabled={ordered.length >= 8 || action.busy}
        onClick={() => setOrdered([...ordered, method.key])}>
        添加 {method.name} · {method.env === 'live' ? '正式' : '沙箱'} · {method.detail}
      </Button>
    )}
    <Feedback error={action.error} success={action.success} />
    <Flexbox horizontal>
      <Button type="primary" className="primary" icon={<Icon icon={Check} aria-hidden="true" />} loading={action.busy}
        onClick={() => action.run(async () => {
          const saved = await api('payment-order', { methods: ordered });
          onSaved?.(saved.methods);
        }, '默认扣款顺序已保存')}>保存扣款顺序</Button>
    </Flexbox>
  </Flexbox>;
}

export function PaymentOrderEditor({ onSaved }) {
  const resource = useLoad('payment-order');
  if (resource.error) return <Feedback error={resource.error} />;
  if (!resource.data) return <Loading />;
  return <OrderForm config={resource.data} onSaved={onSaved} />;
}

export function PaymentOrderPage() {
  return <Panel title={<Flexbox horizontal align="center" gap={8}><Icon icon={ListOrdered} aria-hidden="true" />默认扣款顺序</Flexbox>}>
    <PaymentOrderEditor />
  </Panel>;
}
