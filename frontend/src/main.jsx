import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { A, ConfigProvider, Flexbox, Image, Tag, Text } from '@lobehub/ui';
import { motion } from 'motion/react';
import '@lobehub/ui/theme.css';
import '@lobehub/ui/style.css';
import './styles.css';
import { api, Feedback, Loading, useAction, useLoad } from './shared';
import Install from './Install';
import { Checkout } from './Player';
import Workspace, { workspaceRoute } from './Workspace';
import AccountMenu from './AccountMenu';
import { mobileCheckout } from './mobile-route.mjs';

const mobileTarget = mobileCheckout(location.pathname, location.search, navigator.userAgent, navigator.maxTouchPoints);
if (mobileTarget) location.replace(mobileTarget);

function App() {
  const status = useLoad('status', 5000);
  const action = useAction();
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    function update() {
      if (location.hash === '#docs' && location.pathname === '/') location.replace('/docs');
      else setHash(location.hash);
    }
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const data = status.data;
  const user = data?.user;
  const route = workspaceRoute(user, hash);
  const checkoutId = /^\/checkout\/([0-9a-f]{32})$/.exec(location.pathname)?.[1];
  const installation = location.pathname === '/install' || (data && !data.installed);

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
          {user && <AccountMenu user={user} role={route.role} busy={action.busy}
            onLogout={() => action.run(async () => {
              await api('logout', {});
              location.assign('/');
            })} />}
        </Flexbox>
      </div>
    </header>
    <main className="shell content">
      <Feedback error={action.error ?? status.error ?? (installation ? null : data?.oauth_error)} />
      {!data && !status.error && <Loading />}
      {data && (installation ? <Install installed={data.installed} canRetry={data.oauth_setup_retry} verified={data.oauth_setup_verified} error={data.oauth_error} />
        : checkoutId ? <Checkout id={checkoutId} user={user} />
          : <Workspace user={user} online={data.plugin_online} route={route} />)}
    </main>
    <footer className="shell footer">
      <Text>氢气工艺服务器 · 统一支付清算</Text>
      <A href="/docs">开放接口文档</A>
    </footer>
  </>;
}

if (!mobileTarget) createRoot(document.getElementById('root')).render(
  <ConfigProvider motion={motion} locale="zh-CN" enableCustomFonts={false}><App /></ConfigProvider>,
);
