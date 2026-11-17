import { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { A, Button, ConfigProvider, Flexbox, Image, Tabs, Tag, Text } from '@lobehub/ui';
import { motion } from 'motion/react';
import '@lobehub/ui/theme.css';
import '@lobehub/ui/style.css';
import './styles.css';
import { api, Feedback, Loading, useAction, useLoad } from './shared';
import Install from './Install';
import { Account, Checkout } from './Player';
import { Admin, Merchants } from './Merchant';

import { PlayerCards } from './Cards';
import { PageTitle, Panel, SignIn } from './shared';

const Docs = lazy(() => import('./Docs'));

function App() {
  const status = useLoad('status', 5000);
  const action = useAction();
  const initialTab = ['merchant', 'docs', 'admin', 'cards'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'account';
  const [tab, setTab] = useState(initialTab);
  const data = status.data;
  const user = data?.user;
  const checkoutId = /^\/checkout\/([0-9a-f]{32})$/.exec(location.pathname)?.[1];
  const installation = location.pathname === '/install' || (data && !data.installed);

  function setSection(key) {
    setTab(key);
    history.replaceState(null, '', key === 'account' ? '/' : '/#' + key);
  }

  return <>
    <header className="masthead">
      <div className="shell masthead-inner">
        <A className="brand" href="/" aria-label="氢气工艺服务器交通信息单一窗口首页">
          <Image className="brand-logo" preview={false} src="/logo.png" alt="" width={380} height={48} />
        </A>
        <Flexbox horizontal align="center" gap={12} className="header-actions">
          {data?.installed && <Tag className="environment" color={data.mode === 'production' ? 'success' : 'gray'}>
            {data.mode === 'production' ? '正式环境' : '开发环境'}
          </Tag>}
          {user && <Button loading={action.busy} size="small" onClick={() => action.run(async () => {
            await api('logout', {});
            location.assign('/');
          })}>退出登录</Button>}
        </Flexbox>
      </div>
    </header>
    <main className="shell content">
      <Feedback error={action.error ?? status.error ?? (installation ? null : data?.oauth_error)} />
      {!data && !status.error && <Loading />}
      {data && (installation ? <Install installed={data.installed} canRetry={data.oauth_setup_retry} verified={data.oauth_setup_verified} error={data.oauth_error} />
        : checkoutId ? <Checkout id={checkoutId} user={user} />
          : <Tabs className="app-tabs" variant="square" activeKey={tab === 'admin' && !user?.admin ? 'account' : tab}
            onChange={setSection} items={[
              { key: 'account', label: '玩家面板', children: <Account user={user} online={data.plugin_online} /> },
              { key: 'cards', label: '预付卡', children: <><PageTitle title="预付卡" />{user ? <PlayerCards user={user} /> : <Panel title="登录管理预付卡"><SignIn /></Panel>}</> },
              { key: 'merchant', label: '商户管理', children: <Merchants user={user} /> },
              { key: 'docs', label: '接口文档', children: <Suspense fallback={<Loading />}><Docs publicKey={data.public_key} /></Suspense> },
              ...(user?.admin ? [{ key: 'admin', label: '系统管理', children: <Admin user={user} online={data.plugin_online} /> }] : []),
            ]} />)}
    </main>
    <footer className="shell footer">
      <Text>氢气工艺服务器 · 统一支付清算</Text>
    </footer>
  </>;
}

createRoot(document.getElementById('root')).render(
  <ConfigProvider motion={motion} locale="zh-CN" enableCustomFonts={false}><App /></ConfigProvider>,
);
