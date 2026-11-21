const issues = {
  profile_scope_missing: ['Portal 授权缺少用户名', '请联系平台管理员检查 OAuth profile 权限，再同步 Portal 资料。'],
  profile_unavailable: ['Portal 公开档案暂不可用', 'Portal 未返回公开 Minecraft 档案。请核对公开个人资料和显示 Minecraft 档案两项设置，再同步资料。'],
  unverified: ['主展示账号尚未验证', '请在 Portal 完成主展示账号的绑定验证，再同步资料；也可联系清算管理员协助绑定 UUID。'],
  primary_required: ['请在 Portal 选定主展示账号', 'Portal 有多个 Minecraft 账号，请选定唯一的主展示账号，再同步资料。'],
  uuid_missing: ['主展示账号暂无游戏 UUID', 'Portal 主展示账号没有提供可用的 UUID 或同名游戏记录。请联系清算管理员手工绑定 UUID。'],
  uuid_observed_only: ['请重新同步主展示账号', '此账号使用旧版同步结果，请同步 Portal 资料以使用主展示账号的同名游戏记录。'],
  uuid_conflict: ['主展示账号存在多个游戏 UUID', 'Portal 没有选定游戏 UUID，同名记录对应多个不同 UUID。请联系清算管理员核对并手工绑定 UUID。'],
  uuid_in_use: ['Minecraft UUID 已关联其他账号', '请联系清算管理员核对该 Minecraft UUID 的归属。'],
};

export function minecraftIssue(status) {
  const [title, description] = Object.hasOwn(issues, status) ? issues[status]
    : ['尚未同步 Portal 档案', '请同步 Portal 资料，获取头像并检查已验证的 Minecraft 绑定状态。'];
  return { title, description };
}

export function portalSyncUrl(path = '/') {
  const next = /^\/(?:checkout\/[a-f0-9]{32}|mobile\/(?:checkout\/[a-f0-9]{32})?)?$/.test(path) ? path : '/';
  return '/oauth/login?next=' + encodeURIComponent(next);
}
