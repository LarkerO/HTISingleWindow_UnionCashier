# 站内和游戏端接口

本页用于维护应用内部调用。商户系统使用 [商户开放接口](merchant-api.md)。

## 页面和 OAuth

| 方法与路径 | 用途 |
| --- | --- |
| `GET /` | 玩家、商户、系统管理面板和接口文档 |
| `GET /install` | 安装向导 |
| `GET /checkout/{id}` | 玩家确认付款、预授权或签约 |
| `GET /mobile/` | 独立玩家移动钱包，WingoUI + React + Vite |
| `GET /mobile/checkout/{id}` | 独立移动收银台，复用同源登录会话和付款接口 |
| `GET /api/platform-key` | 匿名获取平台 SM2 公钥，未安装时返回空值 |
| `GET /oauth/login?next=/checkout/{id}` | 跳往 Portal，`next` 可省略 |
| `GET /oauth/callback` | 校验 state，并用 PKCE verifier 向 Portal 换取身份。失败时返回安装页或登录前页面 |

Portal 调用顺序为 `/oauth/authorize`、`/api/oauth/token`、`/api/oauth/userinfo`、`/api/public/users/{preferred_username}/minecraft-accounts`。最后一个接口需同时开启公开个人资料和显示 Minecraft 档案。同步时先选定唯一的 `isPrimary=true` 主展示账号；仅有一个账号且未标记主账号时使用该账号，多个账号无唯一主账号则等待用户指定，不回退到其他账号。主账号须为未解绑的 `AUTHENTICATED / VERIFIED` 账号。

头像优先使用 OAuth `picture`，缺失或地址无效时读取公开用户资料的 `profile.avatarUrl`，支持 Portal 相对路径及 HTTPS CDN。头像获取不依赖 Minecraft UUID；已有会话只读取本地缓存，前端「同步 Portal 资料」通过重新授权更新头像与绑定，完成后回到原收银台。

主展示账号按 `uuid` → `playerIdentity.boundUuid` → `playerIdentity.resolvedUuid` 顺序获取 UUID，允许直接使用 Portal 解析的同名游戏记录。若这些字段均无效，则从该主账号 `observedPlayers` 中按玩家名（不区分大小写）筛选并去重，仅有一个 UUID 时采用，多个不同 UUID 返回 `uuid_conflict`；不得从次要账号取 UUID。跨服务器的同一 UUID 不算冲突。

`user.minecraft_status` 区分 `profile_scope_missing`、`profile_unavailable`、`unverified`、`primary_required`、`uuid_missing`、`uuid_conflict`、`uuid_in_use`、`linked`、`linked_manual`。旧 `uuid_observed_only` 状态提示用户重新同步。`minecraft_uuid_origin` 为 `bound`（Portal 绑定）、`resolved`（Portal 同名解析）、`observed`（唯一同名记录）或 `manual`（管理员手工绑定）。

管理员手工绑定优先于自动同步，玩家重新登录仍保留手工结果，同时更新最近的 Portal 主账号快照。恢复自动绑定使用该快照，玩家可重新授权刷新。UUID 改变时清除旧余额缓存与归属索引，保留旧订单的资金来源；新旧 UUID 不一致的免密协议须重新签约。Portal 自动同步和管理员绑定均不能占用其他有效清算账号的 UUID。

## 浏览器 API

除安装前查询和卡面资源外，下列业务查询需要登录。POST 使用 JSON、会话 Cookie 和 `X-CSRF-Token`。从 `GET /api/status` 获取 CSRF 值。错误返回 `code` 和 `error`。

| 方法和路径 | 输入 | 输出 |
| --- | --- | --- |
| `GET /api/status` | 无 | `installed`、`csrf`、`user`、`mode`、`plugin_online`、`public_key`、`oauth_error`、`oauth_setup_retry` |
| `GET /api/account` | 无 | 本人 `orders`、上次查询的 `balance` |
| `GET /api/player-wallet?environment=live` | `environment=live` 或 `sandbox`，默认正式 | 本人钱包快照：`environment`、`available`、`balances`、`requested`、`complete`、已激活 `cards`。正式读取当前已验证 UUID 的余额缓存，沙箱读取隔离账本；不触发扣款。环境非法返回 HTTP 400、`INVALID_ENVIRONMENT` |
| `GET /api/checkout/{id}` | 清算订单 ID | 订单、可用预付卡与默认支付顺序 |
| `GET /api/cards` | 无 | `catalog`、`cards`、`operations`、`events` |
| `GET /api/card-types?issuer=` | 商户号，留空为平台卡 | 有权限的发行方卡种和流水 |
| `GET /api/card-art/{id}` | 卡面图片 ID | PNG／JPEG／WebP 原图 |
| `GET /api/payment-order` | 无 | 默认有序 `methods` 与账号可加入顺序的预付卡 |
| `GET /api/payment-limits` | 无 | 当前账号支付限额 |
| `GET /api/statement` | `environment`、`month`、`merchant`、`page`；商户视图加 `scope=merchant` | 经过权限过滤的流水分页 |
| `GET /api/statement.xlsx` | 与流水查询相同 | 过滤后的 XLSX 附件 |
| `GET /api/merchants` | 无 | 有权查看的商户 |
| `GET /api/merchants/{id}` | 商户 ID | 商户、订单、总余额及可提现余额 |
| `GET /api/admin` | 超级管理员会话 | 插件配置状态和待复核记录 |
| `GET /api/minecraft-binding?user={id}` | 超级管理员会话、玩家清算账号 ID | `user` 当前身份、`portal` 最近主账号快照、`override` 手工绑定（或 null）、最近 20 条 `events` |
| `POST /api/install` | 安装口令、DB、Redis 可选项、Portal OAuth、部署模式 | Portal 授权跳转地址 |
| `POST /api/logout` | 空 JSON | `ok`；清理登录会话 |
| `POST /api/minecraft-binding` | 超级管理员会话；`action=bind`、`user`、`uuid`、`minecraft_name`、`reason`；恢复自动绑定用 `action=restore`、`user`、`reason` | 同查询响应，同步完成。UUID 支持 32 位或带连字符格式；无权限 HTTP 403；账号不存在 HTTP 404；参数无效 HTTP 400；UUID 已占用 HTTP 409、`MINECRAFT_UUID_IN_USE`。记录操作人、原因、时间及前后 UUID |
| `POST /api/balance` | 空 JSON | 受理后返回查询时间和结果快照 |
| `POST /api/checkout` | `id`、`action=confirm`、`methods`；解约用 `action=revoke` | 订单或协议 |
| `POST /api/cards` | 见下表 | 卡类型、卡或操作状态 |
| `POST /api/card-art` | `data` 为图片标准 Base64 | 卡面 `id` |
| `POST /api/payment-order` | `methods` 为有序数组，包含 Vault 和计分板，最多 8 项，可加入自己的已激活预付卡 | 已保存的顺序与可加入的预付卡 |
| `POST /api/payment-limits` | `method`、`single`、`count` | 已保存的规则 |
| `POST /api/merchant` | 见下表 | 商户配置或调试结果 |
| `POST /api/plugin` | 插件 SM2 公钥 `public_key` | `ok` |
| `POST /api/review` | 指令 `id`，资金是否实际变更 `applied` | `ok` |

移动端页面与原前端共用 `/api`、`/oauth` 和 HttpOnly 会话 Cookie。原 `/checkout/{id}` 检测手机 UA 后跳往 `/mobile/checkout/{id}`，可用 `?desktop=1` 保留原界面。浏览器补充识别使用桌面 UA 的 iPadOS。`/oauth/login` 的 `next` 仅允许 `/`、`/checkout/{id}`、`/mobile/`、`/mobile/checkout/{id}`，拒绝外部回跳地址。

移动收银台先加载订单和对应环境钱包，游戏余额异步返回后展示金额；无可用游戏余额时显示不可用，不按零余额处理。界面绘制后打开不可拖拽关闭的付款 Drawer。`POST /api/checkout` 返回 `processing` 表示受理，必须通过 `GET /api/checkout/{id}` 继续查询至 `paid`、`held`、`active` 或失败。网络中断后只查询原订单，不自动重发确认。预付卡组合补扣及预授权、签约顺序在确认前展示，沿用现有清算逻辑。

| 浏览器入口 | action | 业务值 |
| --- | --- | --- |
| cards | `save` | 卡种配置和发行方。平台卡仅超级管理员可设 |
| cards | `buy` | `type`、`rail`、`environment`、`request_id` |
| cards | `redeem` | `number`、`secret`，绑定当前玩家 |
| cards | `bind` | `issuer`、`number`、`secret`、`user`，发行方代绑定 |
| cards | `transfer` | `number`、`user` |
| cards | `return` | `number`、`request_id` |
| cards | `fund` | 超级管理员补贴金充值，`rail`、`environment`、`amount`、`request_id` |
| merchant | `onboard`、`review` | 商户入驻、审核状态与产品分配 |
| merchant | `settings`、`member` | 回跳来源、公钥、API Key 轮换及成员管理 |
| merchant | `settlement` | 清算周期与商户收款限额 |
| merchant | `command` | 商户调试，`input` 与签名 API 的业务参数一致 |

## 插件 WebSocket

后台发出随机 `challenge`。插件用 `plugin-to-backend` 方向发送加密签名的 `hello`，报文体含 `nonce`，对应后台挑战。建立会话后，插件发送签名的 `ping`。后续签名报文均包含匹配的 `nonce`。

```json
{"type":"job","id":"指令 ID","action":"debit","rail":"vault","uuid":"玩家 UUID","amount":25,"expires":1794888012,"nonce":"会话挑战"}
```

```json
{"type":"result","id":"指令 ID","status":"ok","nonce":"会话挑战"}
```

后台发送方向为 `backend-to-plugin`。游戏指令 action 为 `balance`、`debit` 或 `credit`。查余额成功时回传 `balance`。结果可为 `ok`、`insufficient`、`unavailable`、`range`、`declined` 或 `uncertain`。正式资金指令通过持久化编号去重，同一指令重投沿用编号。人工复核决定只在后台记账，不重新执行游戏指令。
