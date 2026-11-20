import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CreditCard, ExternalLink, LogOut, ReceiptText, RefreshCw, ShieldCheck, Wallet as WalletIcon } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs } from '@/components/ui/tabs';
import { presets } from '@/lib/motion';
import { api, date, message, money } from './api';
import CardDeck from './CardDeck';
import PaymentDrawer from './PaymentDrawer';
import { labels, SUCCESS, walletCards } from './payment';
import { useWallet } from './use-wallet';

export default function App() {
  const id = /^\/mobile\/checkout\/([a-f0-9]{32})$/.exec(location.pathname)?.[1];
  const data = useWallet(id);
  const [selected, setSelected] = useState('vault');
  const [filter, setFilter] = useState('all');
  const [accountOpen, setAccountOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const user = data.status?.user;
  const holder = user?.minecraft_name || user?.name || user?.id || 'Minecraft 玩家';
  const next = id ? '/mobile/checkout/' + id : '/mobile/';
  const environment = data.wallet?.environment ?? 'live';
  const orders = data.orders.filter(order => order.env === environment && (filter === 'all' || order.kind === filter));

  useEffect(() => {
    if (!id || !data.checkout || !data.wallet || data.balancePending) return;
    // Let the wallet and rolling balance finish painting before the payment sheet enters.
    const timer = setTimeout(() => setDrawerOpen(true), 800);
    return () => clearTimeout(timer);
  }, [id, Boolean(data.checkout), Boolean(data.wallet), data.balancePending]);

  return <div className="mobile-app">
    <header className="app-header">
      <a href="/mobile/" className="brand" aria-label="氢气工艺服务器交通信息单一窗口首页"><img src="/mobile/logo.png" alt="交通信息单一窗口" width="285" height="36" /></a>
      {user && <Button variant="ghost" size="icon-lg" radius="full" aria-label="账户" onClick={() => setAccountOpen(true)}><Avatar name={holder} src={user.avatar_url} size="sm" /></Button>}
    </header>
    <main>
      {(data.error || data.status?.oauth_error) && <Alert tone="danger" title={data.error || data.status?.oauth_error} actions={<Button variant="ghost" onClick={data.retry}>重新加载</Button>} />}
      {!data.status ? <div className="loading-wallet"><Skeleton className="wallet-skeleton" /><Spinner tone="brand" label="正在加载钱包" showLabel /></div>
        : !data.status.installed ? <EmptyState icon={<ShieldCheck />} title="清算服务尚未安装" description="请先由管理员完成平台安装。" actions={<Button asChild><a href="/install">安装向导</a></Button>} />
          : !user ? <motion.div {...presets.fade} className="sign-in">
            <div className="section-heading"><div><p className="eyebrow">PLAYER WALLET</p><h1>每一程，轻松支付。</h1></div></div>
            <Card variant="elevated" radius="lg" className="welcome-card" title="你的游戏钱包，随行。" description="使用 Vault、计分板和预付卡，查看余额与每一笔交通消费。">
              <span className="welcome-icon"><WalletIcon size={46} strokeWidth={1.5} /></span>
              <Button tone="brand" size="lg" fullWidth asChild><a href={'/oauth/login?next=' + encodeURIComponent(next)}>通过 HydCraft Portal 登录</a></Button>
              <p className="payment-note">使用已验证的 Minecraft 玩家身份</p>
            </Card>
          </motion.div> : <>
            <div className="section-heading"><div><p className="eyebrow">PLAYER WALLET</p><h1>我的钱包<span className="greeting">{holder}</span></h1></div>
              <Button variant="soft" radius="full" size="icon" aria-label="刷新余额" loading={data.refreshing} onClick={() => void data.refresh()}><RefreshCw size={18} /></Button>
            </div>
            <div className="wallet-environment"><Badge tone={environment === 'sandbox' ? 'warning' : 'brand'} variant="soft">{environment === 'sandbox' ? '沙箱钱包' : '正式钱包'}</Badge><span>氢气工艺 · 统一支付清算</span></div>
            {!data.wallet ? <Skeleton className="wallet-skeleton" /> : <CardDeck cards={walletCards(data.wallet)} selected={selected} onSelect={setSelected} holder={holder} environment={environment} />}
            {data.balancePending && <div className="balance-status"><Spinner size="sm" tone="brand" /><span>正在同步游戏余额…</span></div>}
            {data.wallet && !data.balancePending && !data.wallet.complete && <Alert tone="warning" title={data.wallet.available ? '游戏余额暂不可用，可刷新后重试' : '请在 Portal 公开已验证的 Minecraft 档案'} description="已激活且适用的预付卡仍可付款。" />}
            <section className="transactions" aria-labelledby="transactions-heading">
              <div className="section-heading"><h2 id="transactions-heading">交易记录</h2><ReceiptText size={19} aria-hidden="true" /></div>
              <Tabs value={filter} onValueChange={setFilter} variant="pill" size="sm" aria-label="交易类型" options={[{ value: 'all', label: '全部' }, { value: 'pay', label: '支付' }, { value: 'hold', label: '预授权' }, { value: 'agreement', label: '签约' }]} />
              {!orders.length ? <EmptyState icon={<ReceiptText />} title="还没有交易记录" description="付款后，可以在这里找到每一笔消费。" size="sm" /> : <div className="transaction-list">
                {orders.map(order => <Card key={order.id} variant="ghost" size="sm" radius="md" className="transaction-row" asChild>
                  <a href={'/mobile/checkout/' + order.id}>
                    <span className={'transaction-icon ' + (SUCCESS.has(order.status) ? 'transaction-success' : '')}><CreditCard size={20} aria-hidden="true" /></span>
                    <span className="transaction-info"><strong>{order.merchant_name}</strong><span>{order.title}</span><time dateTime={new Date(order.created * 1000).toISOString()}>{date(order.created)}</time></span>
                    <span className="transaction-value"><strong>{order.kind === 'agreement' ? '免密签约' : money(order.amount)}</strong><Badge size="sm" tone={SUCCESS.has(order.status) ? 'success' : order.status === 'failed' ? 'danger' : 'neutral'} variant="soft">{labels[order.status] ?? order.status}</Badge></span>
                  </a>
                </Card>)}
              </div>}
            </section>
          </>}
    </main>
    <footer className="app-footer"><ShieldCheck size={14} aria-hidden="true" /><span>氢气工艺服务器 · 统一支付清算</span></footer>
    <Drawer open={accountOpen} onOpenChange={setAccountOpen} title="我的账户" description={holder} showClose closeLabel="关闭账户" size="sm">
      <div className="account-actions">
        <Button variant="soft" leftIcon={<ExternalLink size={18} />} fullWidth asChild><a href="/">打开完整玩家面板</a></Button>
        <Button variant="ghost" fullWidth asChild><a href={environment === 'sandbox' ? '/mobile/' : '/mobile/?environment=sandbox'}>{environment === 'sandbox' ? '查看正式钱包' : '查看沙箱钱包'}</a></Button>
        <Button variant="ghost" tone="danger" fullWidth leftIcon={<LogOut size={18} />} loading={loggingOut} onClick={async () => {
          setLoggingOut(true);
          try { await api('logout', {}); location.assign('/mobile/'); } catch (failure) { setLogoutError(message(failure)); setLoggingOut(false); }
        }}>退出登录</Button>
        {logoutError && <Alert tone="danger" title={logoutError} />}
      </div>
    </Drawer>
    {data.checkout && data.wallet && <PaymentDrawer checkout={data.checkout} wallet={data.wallet} holder={holder} open={drawerOpen}
      readOrder={data.readOrder} acceptOrder={data.acceptOrder} refresh={data.refresh} />}
  </div>;
}
