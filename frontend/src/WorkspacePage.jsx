import { useState } from 'react';
import { A, Button, Drawer, Flexbox, Icon, SideNav, Text } from '@lobehub/ui';
import { PanelLeft } from 'lucide-react';

export default function WorkspacePage({ children, groups, page, title = '工作台栏目' }) {
  const [open, setOpen] = useState(false);
  const currentLabel = groups.flatMap(([, links]) => links).find(([key]) => key === page)?.[1];
  const navigation = <SideNav as="nav" aria-label={title} className="workspace-nav" bottomActions={null}
    topActions={groups.map(([label, links]) => <Flexbox key={label} gap={3} className="workspace-nav-group">
      {label && <Text as="h2" className="workspace-nav-label">{label}</Text>}
      {links.map(([key, label, href, icon]) => <A key={key} className="workspace-link" href={href}
        aria-current={page === key ? 'page' : undefined} onClick={() => setOpen(false)}>
        {icon && <Icon icon={icon} size={16} aria-hidden="true" />}{label}
      </A>)}
    </Flexbox>)} />;
  return <Flexbox className="workspace">
    <Flexbox className="workspace-sidebar">{navigation}</Flexbox>
    <Flexbox gap={18} className="workspace-content">
      <Button className="workspace-menu" icon={<Icon icon={PanelLeft} aria-hidden="true" />} aria-expanded={open} onClick={() => setOpen(true)}>栏目 · {currentLabel}</Button>
      <Drawer title={title} placement="left" width="min(300px, 90vw)" open={open} onClose={() => setOpen(false)}>
        {open && navigation}
      </Drawer>
      {children}
    </Flexbox>
  </Flexbox>;
}
