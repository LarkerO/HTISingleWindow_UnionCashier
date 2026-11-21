import { useEffect, useState } from 'react';
import { Button, Descriptions, Flexbox, Text } from '@lobehub/ui';
import { api, date, Empty, Feedback, Field, Loading, Panel, useAction, useLoad } from './shared';
import { minecraftIssue } from './portal-profile.mjs';

const sourceName = user => user?.minecraft_source === 'admin' ? '管理员手工绑定'
  : user?.minecraft_uuid_origin === 'resolved' || user?.minecraft_uuid_origin === 'observed' ? 'Portal 主展示账号同名游戏记录'
    : user?.uuid ? 'Portal 主展示账号绑定' : '尚未绑定';

export default function AdminMinecraftBinding() {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');
  const [form, setForm] = useState({ uuid: '', minecraft_name: '', reason: '' });
  const profile = useLoad(target ? 'minecraft-binding?user=' + encodeURIComponent(target) : null);
  const flow = useAction();
  const data = profile.data;
  useEffect(() => {
    if (data) setForm({ uuid: data.user.uuid ?? '', minecraft_name: data.user.minecraft_name ?? '', reason: '' });
  }, [data]);
  const change = action => flow.run(async () => {
    await api('minecraft-binding', { action, user: target, ...form });
    profile.reload();
  }, action === 'bind' ? '手工绑定已保存，重新登录也会保留' : '已恢复 Portal 自动绑定');

  return <>
    <Panel title="查找玩家">
      <form className="stack" onSubmit={event => { event.preventDefault(); setTarget(query.trim()); profile.reload(); }}>
        <Field name="binding-user" label="玩家清算账号 ID" value={query} onChange={setQuery} required />
        <Flexbox horizontal><Button htmlType="submit" disabled={flow.busy || !query.trim()}>查询绑定</Button></Flexbox>
      </form>
    </Panel>
    <Feedback error={flow.error ?? profile.error} success={flow.success} />
    {target && !data && !profile.error && <Loading />}
    {data && <>
      <Panel title={data.user.name || data.user.id}>
        <Descriptions column={1} items={[
          { label: '清算账号 ID', children: data.user.id },
          { label: '游戏名称', children: data.user.minecraft_name || '尚未同步' },
          { label: '当前 UUID', children: <Text code>{data.user.uuid || '未绑定'}</Text> },
          { label: '绑定来源', children: sourceName(data.user) },
          { label: 'Portal 主账号', children: data.portal?.minecraft_name || '尚未同步' },
          { label: 'Portal UUID', children: <Text code>{data.portal?.uuid || '暂无可用 UUID'}</Text> },
        ]} />
        {!data.user.uuid && <Text as="p" className="muted">{minecraftIssue(data.user.minecraft_status).description}</Text>}
        <Text as="p" className="muted">手工绑定优先于 Portal 自动同步；恢复自动绑定后使用最近一次登录获取的主展示账号。玩家可重新登录更新 Portal 资料。</Text>
        <form className="stack" onSubmit={event => { event.preventDefault(); change('bind'); }}>
          <Field name="binding-name" label="Minecraft 玩家名称" value={form.minecraft_name}
            onChange={minecraft_name => setForm({ ...form, minecraft_name })} required />
          <Field name="binding-uuid" label="Minecraft UUID" value={form.uuid}
            onChange={uuid => setForm({ ...form, uuid })} required />
          <Field name="binding-reason" label="变更原因" value={form.reason}
            onChange={reason => setForm({ ...form, reason })} required />
          <Flexbox horizontal gap={8} wrap="wrap">
            <Button type="primary" htmlType="submit" loading={flow.busy}>保存手工绑定</Button>
            <Button disabled={!data.override || flow.busy || !form.reason.trim()} onClick={() => change('restore')}>恢复 Portal 自动绑定</Button>
          </Flexbox>
        </form>
      </Panel>
      <Panel title="最近变更记录">
        {!data.events.length && <Empty>暂无手工绑定记录。</Empty>}
        {data.events.map(event => <Flexbox key={event.id} gap={4} className="record">
          <Text as="strong">{event.action === 'bind' ? '手工绑定' : '恢复自动绑定'} · {date(event.created)}</Text>
          <Text className="muted">管理员 {event.actor} · {event.reason}</Text>
          <Text code className="code">{event.previous_uuid || '未绑定'} → {event.uuid || '未绑定'}</Text>
        </Flexbox>)}
      </Panel>
    </>}
  </>;
}
