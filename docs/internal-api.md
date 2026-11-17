# 站内和游戏端接口

本页用于维护应用内部调用。商户系统使用 [商户开放接口](merchant-api.md)。

## 页面和 OAuth

| 方法与路径 | 用途 |
| --- | --- |
| `GET /` | 玩家、商户、系统管理面板和接口文档 |
| `GET /install` | 安装向导 |
| `GET /checkout/{id}` | 玩家确认付款、预授权或签约 |
| `GET /api/platform-key` | 匿名获取平台 SM2 公钥，未安装时返回空值 |
| `GET /oauth/login?next=/checkout/{id}` | 跳往 Portal，`next` 可省略 |
| `GET /oauth/callback` | 校验 state，并用 PKCE verifier 向 Portal 换取身份。失败时返回安装页或登录前页面 |

Portal 调用顺序为 `/oauth/authorize`、`/api/oauth/token`、`/api/oauth/userinfo`、`/api/public/users/{preferred_username}/minecraft-accounts`。最后一个接口需同时开启公开个人资料和显示 Minecraft 档案。仅同步已验证绑定的 UUID，按用户名匹配的游戏服务器 UUID 不作为钱包身份。登录响应另包含头像地址与 Minecraft 档案同步状态。

## 浏览器 API

除安装前查询和卡面资源外，下列业务查询需要登录。POST 使用 JSON、会话 Cookie 和 `X-CSRF-Token`。从 `GET /api/status` 获取 CSRF 值。错误返回 `code` 和 `error`。

| 方法和路径 | 输入 | 输出 |
| --- | --- | --- |
| `GET /api/status` | 无 | `installed`、`csrf`、`user`、`mode`、`plugin_online`、`public_key`、`oauth_error`、`oauth_setup_retry` |
| `GET /api/account` | 无 | 本人 `orders`、上次查询的 `balance` |
| `GET /api/checkout/{id}` | 清算订单 ID | 订单与可用预付卡 |
| `GET /api/cards` | 无 | `catalog`、`cards`、`operations`、`events` |
| `GET /api/card-types?issuer=` | 商户号，留空为平台卡 | 有权限的发行方卡种和流水 |
| `GET /api/card-art/{id}` | 卡面图片 ID | PNG／JPEG／WebP 原图 |
| `GET /api/payment-limits` | 无 | 当前账号支付限额 |
| `GET /api/statement` | `environment`、`month`、`merchant`、`page`；商户视图加 `scope=merchant` | 经过权限过滤的流水分页 |
| `GET /api/statement.xlsx` | 与流水查询相同 | 过滤后的 XLSX 附件 |
| `GET /api/merchants` | 无 | 有权查看的商户 |
| `GET /api/merchants/{id}` | 商户 ID | 商户、订单、总余额及可提现余额 |
| `GET /api/admin` | 超级管理员会话 | 插件配置状态和待复核记录 |
| `POST /api/install` | 安装口令、DB、Redis 可选项、Portal OAuth、部署模式 | Portal 授权跳转地址 |
| `POST /api/logout` | 空 JSON | `ok`；清理登录会话 |
| `POST /api/balance` | 空 JSON | 受理后返回查询时间和结果快照 |
| `POST /api/checkout` | `id`、`action=confirm`、`methods`；解约用 `action=revoke` | 订单或协议 |
| `POST /api/cards` | 见下表 | 卡类型、卡或操作状态 |
| `POST /api/card-art` | `data` 为图片标准 Base64 | 卡面 `id` |
| `POST /api/payment-limits` | `method`、`single`、`count` | 已保存的规则 |
| `POST /api/merchant` | 见下表 | 商户配置或调试结果 |
| `POST /api/plugin` | 插件 SM2 公钥 `public_key` | `ok` |
| `POST /api/review` | 指令 `id`，资金是否实际变更 `applied` | `ok` |

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
