import { lazy, Suspense, useEffect, useState } from 'react';
import { A, Button, Drawer, Flexbox, Icon, SideNav, Tabs, Text } from '@lobehub/ui';
import {
  BookOpen, ClipboardCheck, Coins, CreditCard, FileSpreadsheet, Handshake, History,
  Link2, PanelLeft, Plug, ReceiptText, ShieldCheck, ShoppingBag, SlidersHorizontal,
  Store, UserRound, WalletCards,
} from 'lucide-react';
import { Account } from './Player';
import { Admin, Merchants } from './Merchant';
import { PlayerCards } from './Cards';
import { Loading, PageTitle } from './shared';

const Docs = lazy(() => import('./Docs'));
const cardPages = [
  ['cards', '预付卡商城'], ['activate', '激活预付卡'], ['wallet', '我的预付卡'], ['card-events', '预付卡使用记录'],
];
const playerPages = [
  ['账户', [['account', '账户概览'], ['orders', '交易记录'], ['agreements', '免密签约'], ['limits', '支付限额'], ['statement', '付款对账']]],
  ['预付卡', cardPages],
  ['商户服务', [['merchant', '我的商户'], ['docs', '接口文档']]],
];
const adminPages = [
  ['商户', [['admin/merchant', '商户审核与管理']]],
  ['平台预付卡', [['admin/cards', '发行管理'], ['admin/bind', '代玩家绑卡'], ['admin/card-events', '发行卡片使用记录'], ['admin/fund', '折扣补贴金']]],
  ['系统', [['admin/plugin', 'Bukkit 插件连接'], ['admin/review', '资金操作复核']]],
];
const playerKeys = playerPages.flatMap(([, pages]) => pages.map(([key]) => key));
const adminKeys = adminPages.flatMap(([, pages]) => pages.map(([key]) => key));

const pageIcons = {
  account: UserRound, orders: ReceiptText, agreements: Handshake, limits: SlidersHorizontal,
  statement: FileSpreadsheet, cards: ShoppingBag, activate: CreditCard, wallet: WalletCards,
  'card-events': History, merchant: Store, docs: BookOpen,
  'admin/merchant': Store, 'admin/cards': CreditCard, 'admin/bind': Link2,
  'admin/card-events': History, 'admin/fund': Coins, 'admin/plugin': Plug, 'admin/review': ClipboardCheck,
};

function WorkspacePage({ children, groups, page }) {
  const [open, setOpen] = useState(false);
  const currentLabel = groups.flatMap(([, links]) => links).find(([key]) => key === page)?.[1];
  const navigation = <SideNav as="nav" aria-label="工作台栏目" className="workspace-nav" bottomActions={null}
    topActions={groups.map(([label, links]) => <Flexbox key={label} gap={3} className="workspace-nav-group">
      {label && <Text as="h2" className="workspace-nav-label">{label}</Text>}
      {links.map(([key, title]) => <A key={key} className="workspace-link" href={'#' + key}
        aria-current={page === key ? 'page' : undefined} onClick={() => setOpen(false)}>
        <Icon icon={pageIcons[key]} size={16} aria-hidden="true" />{title}
      </A>)}
    </Flexbox>)} />;
  return <Flexbox className="workspace">
    <Flexbox className="workspace-sidebar">{navigation}</Flexbox>
    <Flexbox gap={18} className="workspace-content">
      <Button className="workspace-menu" icon={<Icon icon={PanelLeft} aria-hidden="true" />} aria-expanded={open} onClick={() => setOpen(true)}>栏目 · {currentLabel}</Button>
      <Drawer title="工作台栏目" placement="left" width="min(300px, 90vw)" open={open} onClose={() => setOpen(false)}>
        {open && navigation}
      </Drawer>
      {children}
    </Flexbox>
  </Flexbox>;
}

export default function Workspace({ user, online, publicKey }) {
  const [route, setRoute] = useState(() => location.hash);
  useEffect(() => {
    const update = () => setRoute(location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const path = route === '#admin' ? 'admin/plugin' : route.slice(1);
  const admin = Boolean(user?.admin && adminKeys.some(key => path === key || path.startsWith(key + '/')));
  const segments = path.split('/');
  const candidate = segments.slice(0, admin ? 2 : 1).join('/');
  const page = admin ? candidate : playerKeys.includes(candidate) ? candidate : 'account';
  const group = admin ? adminPages : user ? playerPages : [['', [['account', '首页'], ['docs', '接口文档']]]];
  const cardPage = cardPages.find(([key]) => key === page);
  let content;
  if (page === 'docs') content = <Suspense fallback={<Loading />}><Docs publicKey={publicKey} /></Suspense>;
  else if (!user) content = <Account />;
  else if (page === 'merchant' || page === 'admin/merchant') {
    content = <Merchants key={page} user={user} admin={admin} section={segments[admin ? 2 : 1]} route={page} />;
  } else if (admin) content = <Admin user={user} online={online} section={segments[1]} />;
  else if (cardPage) {
    content = <><PageTitle title={cardPage[1]} /><PlayerCards user={user} section={page} /></>;
  } else content = <Account user={user} online={online} section={page} />;

  const workspace = <WorkspacePage groups={group} page={page}>{content}</WorkspacePage>;
  if (!user?.admin) return workspace;
  return <Tabs className="app-tabs" variant="square" activeKey={admin ? 'admin' : 'player'}
    onChange={key => { location.hash = key === 'admin' ? 'admin/merchant' : 'account'; }}
    items={[
      { key: 'player', label: '普通玩家', icon: <Icon icon={UserRound} size={16} aria-hidden="true" />, children: admin ? undefined : workspace },
      { key: 'admin', label: '管理员模式', icon: <Icon icon={ShieldCheck} size={16} aria-hidden="true" />, children: admin ? workspace : undefined },
    ]} />;
}
