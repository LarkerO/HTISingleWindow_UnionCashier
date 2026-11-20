# 玩家移动钱包

独立的 React 19 + TypeScript + Vite + Tailwind CSS v4 项目，使用 WingoUI 官方组件源码。原 `frontend/` 继续提供玩家完整面板、商户和系统管理。

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

开发入口为 `http://127.0.0.1:48002/mobile/`，预览端口为 48003。API 和 OAuth 请求代理到 Webman 48787。跨 Portal 登录回调应从 Webman 同源入口验收；需要保留热更新时，可用同一个反向代理分别转发 `/mobile/` 到 48002、其余业务路径到 Webman，OAuth 回调登记该代理的来源。

构建产物位于 `backend/public/mobile/`，正式由 Webman 同源提供。两个项目可以任意顺序构建。原前端开发服务器将 `/mobile` 转发给 48002。构建预览仅提供静态页面，接后端时应使用 Webman 或同源代理。

## 组件和手势

Button、Card、Tabs、Drawer、Badge、Avatar、Alert、EmptyState、Spinner、Skeleton、AnimatedCounter 和动画预设均由 WingoUI 官方 CLI 安装，无其他 UI 组件库。业务组件只组合这些控件与语义布局，付款手势采用其 Motion 基础。图标使用 WingoUI 同源依赖 lucide-react。`wingo-ui.json` 和 `.wingo-ui/base/` 记录上游版本与源码，更新前运行：

```sh
pnpm dlx wingo-ui@1.1.0 outdated
pnpm dlx wingo-ui@1.1.0 diff
pnpm dlx wingo-ui@1.1.0 update
```

横滑切卡；向上超过 84px 且以竖直方向为主才确认付款。余额不足时上拖 28px 回弹并显示红色提示。Drawer 使用 `dismissible=false`、`handleOnly=true`、无 Handle，不响应拖拽关闭、遮罩或 Escape。保留可聚焦的确认按钮作为手势的无障碍替代。遵循系统减少动态效果设置。

只有后端确认 `paid`、`held`、`active`、`released` 才显示绿色成功。处理中和回执未知时保留蓝色动画并查询原订单。锁住重复手势，绝不因超时自动重新扣款。返回商家只使用后端验证过的 HTTP(S) 地址；未提供时禁用该按钮。

## 验证

测试直接运行 TypeScript，使用 Node.js 22.18+（当前验证环境为 Node.js 24）。构建仍遵循 Vite 的 Node.js 要求。构建完成后可运行 `node tests/preview.mjs`，在 48004 打开隔离的本地交互验收数据；该脚本不会进入构建产物，不连接真实 Portal 或账本。

`pnpm test` 覆盖手机跳转、手势方向、余额不足、组合支付、顺序、过期、未知回执和重复确认。`php ../backend/tests/mobile.php` 验证钱包环境与账号隔离、隐私字段、旧 UUID 缓存、UA 跳转。真实 Portal 和 Minecraft 插件的正式付款仍需在已配置环境中验收。
