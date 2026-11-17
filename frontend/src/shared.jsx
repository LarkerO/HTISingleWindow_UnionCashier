import { useEffect, useState } from 'react';
import { Alert, Block, Button, Flexbox, Input, InputPassword, Select, Spin, Tag, Text, TextArea } from '@lobehub/ui';

let token;

export async function api(path, body) {
  const response = await fetch('/api/' + path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token ?? '' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? '清算服务暂不可用');
  if (data.csrf) token = data.csrf;
  return data;
}

export const rails = { vault: 'Vault', scoreboard: '计分板' };
export const products = { pay: '收银台支付', hold: '预授权', agreement: '免密签约', refund: '退款', split: '分账', payout: '提现' };
export const states = {
  pending: '待处理', processing: '清算中', held: '已冻结', paid: '已支付', released: '已解除',
  active: '已签约', revoked: '已解约', failed: '失败', approved: '已通过', rejected: '已拒绝',
  completed: '已完成', applied: '确认已执行', not_applied: '确认未执行',
};
export const options = labels => Object.entries(labels).map(([value, label]) => ({ value, label }));
export const money = amount => amount == null ? '—' : new Intl.NumberFormat('zh-CN').format(amount);
export const date = value => value ? new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai',
}).format(new Date(value * 1000)) : '—';

export function State({ value }) {
  const color = ['paid', 'active', 'approved', 'held', 'completed'].includes(value) ? 'success'
    : ['failed', 'rejected'].includes(value) ? 'error' : value === 'processing' ? 'processing' : 'gray';
  return <Tag color={color}>{states[value] ?? value}</Tag>;
}

export function Panel({ title, subtitle, action, children, className = '' }) {
  return <Block className={'panel ' + className}>
    {(title || action) && <Flexbox horizontal justify="space-between" align="start" gap={12} className="panel-heading">
      <Flexbox gap={4}>
        {title && <Text as="h2" className="panel-title">{title}</Text>}
        {subtitle && <Text as="p" className="muted">{subtitle}</Text>}
      </Flexbox>
      {action}
    </Flexbox>}
    {children}
  </Block>;
}

export function Field({ label, name, value, onChange, type = 'text', required = false, choices, ...attributes }) {
  const id = name;
  let node;
  if (choices) {
    node = <Select aria-label={label} options={choices} value={value} onChange={onChange} className="select" {...attributes} />;
  } else {
    const Component = type === 'area' ? TextArea : type === 'password' ? InputPassword : Input;
    node = <Component id={id} aria-label={label} type={type === 'area' || type === 'password' ? undefined : type}
      value={value ?? ''} onChange={e => onChange(e.target.value)} required={required} {...attributes} />;
  }
  return <Flexbox gap={6} className="field">
    <Text as="label" htmlFor={choices ? undefined : id}>{label}</Text>
    {node}
  </Flexbox>;
}

export function Feedback({ error, success }) {
  return error ? <Alert type="error" title={error} /> : success ? <Alert type="success" title={success} /> : null;
}

export function useLoad(path, interval = 0) {
  const [result, setResult] = useState({ path: null, data: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    let fetching = false;
    async function request() {
      if (fetching) return;
      fetching = true;
      try {
        const data = await api(path);
        if (alive) setResult({ path, data, error: null });
      } catch (error) {
        if (alive) setResult(previous => ({ path, data: previous.path === path ? previous.data : null, error: error.message }));
      } finally {
        fetching = false;
      }
    }
    request();
    const timer = interval ? setInterval(request, interval) : null;
    return () => { alive = false; clearInterval(timer); };
  }, [path, interval, revision]);
  const current = result.path === path ? result : { data: null, error: null };
  return { ...current, reload: () => setRevision(previous => previous + 1) };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  async function run(action, message) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await action();
      if (message) setSuccess(message);
      return result;
    } catch (error) {
      setError(error.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, success, run };
}

export function Loading() {
  return <Flexbox align="center" className="loading"><Spin /><Text className="muted">正在加载</Text></Flexbox>;
}

export function Empty({ children }) {
  return <Text as="p" className="empty muted">{children}</Text>;
}

export function SignIn({ checkout }) {
  return <Button type="primary" size="large" className="primary" href={'/oauth/login' +
    (checkout ? '?next=' + encodeURIComponent('/checkout/' + checkout) : '')}>使用 HydCraft Portal 登录</Button>;
}

export function PageTitle({ title, description, action }) {
  return <Flexbox horizontal justify="space-between" align="center" gap={16} className="page-title">
    <Flexbox gap={6}>
      <Text as="h1">{title}</Text>
      {description && <Text as="p" className="muted">{description}</Text>}
    </Flexbox>
    {action}
  </Flexbox>;
}
