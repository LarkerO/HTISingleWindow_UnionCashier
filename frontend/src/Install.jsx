import { useState } from 'react';
import { Button, Flexbox, Steps, Text } from '@lobehub/ui';
import { api, Feedback, Field, options, PageTitle, Panel, useAction } from './shared';

const drivers = { sqlite: 'SQLite', mysql: 'MySQL', pgsql: 'PostgreSQL' };

export default function Install({ installed, canRetry }) {
  const [form, setForm] = useState({ driver: 'sqlite', mode: 'development', origin: location.origin, db_host: '127.0.0.1' });
  const [step, setStep] = useState(0);
  const action = useAction();
  const field = (name, label, attributes = {}) => <Field label={label} name={'setup-' + name} value={form[name]}
    onChange={value => setForm(previous => ({ ...previous, [name]: value }))} {...attributes} />;
  const updateDriver = driver => setForm(previous => ({ ...previous, driver, db_port: driver === 'mysql' ? '3306' : '5432' }));

  function submit(event) {
    event.preventDefault();
    if (step === 0) {
      setStep(1);
      return;
    }
    action.run(async () => {
      const result = await api('install', form);
      location.assign(result.authorize_url);
    });
  }

  if (installed) return <>
    <PageTitle title="安装向导" />
    <Panel title="安装已完成"><Button type="primary" className="primary" href="/">进入统一支付清算</Button></Panel>
  </>;

  return <>
    <PageTitle title="安装向导" description="配置清算数据库并用 HydCraft Portal 验证首位超级管理员。" />
    {canRetry && <Flexbox horizontal><Button href="/oauth/login">使用刚才的配置重新授权</Button></Flexbox>}
    <div className="install-grid">
      <Panel className="installation-steps" title="安装进度">
        <Steps orientation="vertical" current={step} items={[
          { title: '运行环境与数据库' },
          { title: 'Portal 登录配置' },
          { title: '验证登录与生成密钥' },
        ]} />
      </Panel>
      <Panel title={step === 0 ? '运行环境与数据库' : 'HydCraft Portal'}>
        <form onSubmit={submit} className="stack">
          {step === 0 ? <>
            {field('token', '安装口令', { type: 'password', required: true })}
            <Text as="p" className="muted">在后台目录执行 php start.php setup-token 获取安装口令。</Text>
            <div className="form-grid">
              <Field label="数据库" name="setup-driver" value={form.driver} onChange={updateDriver} choices={options(drivers)} />
              {field('mode', '部署环境', { choices: options({ development: '开发环境', production: '正式环境' }) })}
              {form.driver !== 'sqlite' && <>
                {field('db_host', '数据库主机', { required: true })}
                {field('db_port', '端口', { required: true, inputMode: 'numeric' })}
                {field('db_name', '数据库名称', { required: true })}
                {field('db_user', '数据库用户名', { required: true })}
                {field('db_password', '数据库密码', { type: 'password' })}
              </>}
            </div>
            {field('redis', 'Redis 会话地址（可选）', { type: 'password', placeholder: 'redis://127.0.0.1:6379' })}
          </> : <>
            {field('origin', '本系统公开地址', { type: 'url', required: true })}
            {field('portal', 'HydCraft Portal 地址', { type: 'url', required: true })}
            {field('client_id', 'OAuth Client ID', { required: true })}
            {field('client_secret', 'OAuth Client Secret', { type: 'password', required: true })}
            <Text as="p" className="muted">将 {String(form.origin ?? '').replace(/\/$/, '')}/oauth/callback 登记到 Portal 客户端，并开通 profile 权限。首次通过登录测试的账号将成为超级管理员。</Text>
          </>}
          <Feedback {...action} />
          <Flexbox horizontal gap={10}>
            {step > 0 && <Button onClick={() => setStep(0)}>上一步</Button>}
            <Button type="primary" htmlType="submit" loading={action.busy} className="primary">
              {step === 0 ? '下一步' : '测试 Portal 登录并安装'}
            </Button>
          </Flexbox>
        </form>
      </Panel>
    </div>
  </>;
}
