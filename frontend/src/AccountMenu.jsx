import { Avatar, Button, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { Check, ChevronDown, LogOut, ShieldCheck, Store, UserRound } from 'lucide-react';

const roles = [
  ['player', '玩家', '/#account', UserRound],
  ['merchant', '商户', '/#merchant', Store],
  ['admin', '管理员', '/#admin/merchant', ShieldCheck],
];

export default function AccountMenu({ user, role, busy, onLogout }) {
  const name = user.name || user.hydroline_id || user.id;
  const roleLabel = roles.find(([key]) => key === role)?.[1];
  const avatar = size => <Avatar avatar={user.avatar_url || name} title={name} size={size} />;
  const items = [
    {
      key: 'identity', type: 'group', label: '切换身份',
      children: roles.filter(([key]) => key !== 'admin' || user.admin).map(([key, label, href, icon]) => ({
        key,
        label: <Flexbox horizontal align="center" justify="space-between" gap={12}>
          <Text>{label}</Text>
          {key === role && <Icon icon={Check} size={16} aria-label="当前身份" />}
        </Flexbox>,
        icon,
        onClick: () => {
          if (location.pathname !== '/') location.assign(href);
          else if (key !== role) location.hash = href.slice(1);
        },
      })),
    },
    { type: 'divider' },
    { key: 'logout', label: '退出登录', icon: LogOut, danger: true, disabled: busy, onClick: onLogout },
  ];

  return <DropdownMenu placement="bottomRight" items={items} header={
    <Flexbox horizontal align="center" gap={12} padding={8} className="account-menu-profile">
      {avatar(40)}
      <Flexbox gap={4} allowShrink>
        <Text as="strong">{name}</Text>
        {user.hydroline_id && <Text className="muted">Hydroline ID {user.hydroline_id}</Text>}
        <Text code className="code">清算 ID {user.id}</Text>
      </Flexbox>
    </Flexbox>
  }>
    <Button type="text" className="account-menu-trigger" aria-label={'账号菜单 · ' + roleLabel}>
      {avatar(30)}
      <Text className="account-role">{roleLabel}</Text>
      <Icon icon={ChevronDown} size={14} aria-hidden="true" />
    </Button>
  </DropdownMenu>;
}
