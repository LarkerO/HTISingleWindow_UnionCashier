import {
  BookOpen, ClipboardCheck, Coins, CreditCard, FileSpreadsheet, Handshake, History,
  Link2, Plug, ReceiptText, ShoppingBag, SlidersHorizontal,
  Store, UserRound, WalletCards,
} from 'lucide-react';
import { Account } from './Player';
import { Admin, Merchants } from './Merchant';
import { PlayerCards } from './Cards';
import { PageTitle } from './shared';
import WorkspacePage from './WorkspacePage';

const cardPages = [
  ['cards', '预付卡商城'], ['activate', '激活预付卡'], ['wallet', '我的预付卡'], ['card-events', '预付卡使用记录'],
];
const playerPages = [
  ['账户', [['account', '账户概览'], ['orders', '交易记录'], ['agreements', '免密签约'], ['limits', '支付限额'], ['statement', '付款对账']]],
  ['预付卡', cardPages],
];
const merchantPages = [['商户工作台', [['merchant', '我的商户']]], ['开发者', [['docs', '开放接口文档']]]];
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

export function workspaceRoute(user, hash) {
  const path = hash === '#admin' ? 'admin/plugin' : hash.slice(1);
  const segments = path.split('/');
  const adminPage = segments.slice(0, 2).join('/');
  if (user?.admin && adminKeys.includes(adminPage)) {
    return { role: 'admin', page: adminPage, section: segments[2] };
  }
  if (user && segments[0] === 'merchant') {
    return { role: 'merchant', page: 'merchant', section: segments[1] };
  }
  return { role: 'player', page: user && playerKeys.includes(segments[0]) ? segments[0] : 'account' };
}

export default function Workspace({ user, online, route }) {
  const { role, page, section } = route;
  if (!user) return <Account />;
  const groups = { player: playerPages, merchant: merchantPages, admin: adminPages }[role];
  const navigation = groups.map(([label, links]) => [label, links.map(([key, title]) => [
    key, title, key === 'docs' ? '/docs' : '#' + key, pageIcons[key],
  ])]);

  const cardPage = cardPages.find(([key]) => key === page);
  let content;
  if (role === 'merchant' || page === 'admin/merchant') {
    content = <Merchants key={role} user={user} admin={role === 'admin'} section={section} route={page} />;
  } else if (role === 'admin') {
    content = <Admin user={user} online={online} section={page.split('/')[1]} />;
  } else if (cardPage) {
    content = <><PageTitle title={cardPage[1]} /><PlayerCards user={user} section={page} /></>;
  } else {
    content = <Account user={user} online={online} section={page} />;
  }

  return <WorkspacePage groups={navigation} page={page}>{content}</WorkspacePage>;
}
