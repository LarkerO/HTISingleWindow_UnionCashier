# 商户开放接口

## 快速接入

1. 在商户后台登记 SM2 公钥和回跳来源，再复制平台生成的 API Key。轮换公钥时，API Key 同步轮换。首次测试可用后台沙箱调试。
2. 调用 `POST /open/v1` 创建订单，读取 `result.order.checkout_url`，让玩家在浏览器确认。
3. 玩家回跳后查询并验签。普通订单以 `paid` 为准，预授权以 `held` 为准，免密签约以 `active` 为准。后台扣款、退款等有异步结果，按请求编号查询。

此入口按 `action` 区分各项操作。下方 JSON 示例为**业务明文**，实际 HTTP 正文需要按SM2/SM3 报文规范封装。使用 PHP 示例工具时，请求文件只需写业务明文，工具会补上通用字段并执行加解密和验签。

## 通用请求参数

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `merchant` | 字符串 | 是 | 32 字节 | 商户号，与 X-Merchant-Id 一致 | `11111111111111111111111111111111` |
| `key_id` | 字符串 | 是 | 32 字节 | API Key，与 X-Key-Id 一致 | `22222222222222222222222222222222` |
| `environment` | 字符串 | 是 | 7 字节 | sandbox 或 live | `sandbox` |
| `timestamp` | 整数 | 是 | — | Unix 秒，允许前后偏差 300 秒 | `1794888000` |
| `challenge` | 字符串 | 是 | 100 字节 | 每次发起请求重新生成，用于匹配响应 | `req-nonce-001` |

## 通用响应参数

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `ok` | 布尔 | 是 | — | 业务调用是否成功 | `true` |
| `result` | 对象 | 成功时 | — | 业务响应，字段见各接口 | `{}` |
| `code` | 字符串 | 失败时 | — | 机器可读错误码 | `INVALID_PARAMETER` |
| `error` | 字符串 | 失败时 | — | 用于展示的错误信息 | `参数无效` |
| `merchant` | 字符串 | 是 | 32 字节 | 商户号回显 | `11111111111111111111111111111111` |
| `key_id` | 字符串 | 是 | 32 字节 | API Key 回显 | `22222222222222222222222222222222` |
| `environment` | 字符串 | 是 | 7 字节¹ | 环境回显，参数校验失败时可能回显输入值 | `sandbox` |
| `request_id` | 字符串或 null | 是 | 100 字节¹ | 请求编号回显，未提交时为 null | `PAY-001` |
| `timestamp` | 整数 | 是 | — | 平台响应时间，Unix 秒 | `1794888000` |
| `challenge` | 字符串 | 是 | 100 字节 | 请求 challenge 回显 | `req-nonce-001` |

¹ 上限适用于有效请求。参数错误时，响应可能回显原输入。签名及解密前发生的错误可返回普通 JSON，仅包含 code 和 error。

## 通用错误码

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `INVALID_PARAMETER` | 参数缺失或无效（400） | 按请求参数表检查字段、类型、长度和取值。 |
| `INVALID_CREDENTIALS` | 商户号或 API Key 无效（401） | 核对请求头，从商户后台获取当前 API Key。 |
| `AUTHENTICATION_FAILED` | 认证失败或密钥已轮换（401） | 核对商户最新公钥与 API Key。 |
| `INVALID_ENVELOPE` | 报文验签、格式或解密失败（401） | 检查方向、SM2 密钥、Base64 和 SM2/SM3 签名。 |
| `INVALID_REQUEST_CONTEXT` | 报文归属或时间戳无效（401） | 核对商户与密钥回显，将服务器时钟同步到标准时间。 |
| `MERCHANT_NOT_APPROVED` | 商户尚未获准正式交易（403） | 使用沙箱或等待商户审核通过。 |
| `UNSUPPORTED_BODY` | 正文类型不符或超过 128 KiB（415） | 发送 application/json 并检查封装后大小。 |
| `INTERNAL_ERROR` | 服务异常（500） | 结果不明时先查询原请求，保留编号并联系平台。 |
| `UNAVAILABLE` | 平台尚未安装（503） | 联系平台管理员。 |

已认证的业务错误经签名加密返回，解密明文含 `ok: false`、`code`、`error` 及通用回显。校验报文或鉴权失败可直接返回 `{"code":"INVALID_ENVELOPE","error":"报文验签或解密失败"}`。按 `code` 分支处理，`error` 用于展示。异步执行失败时，查询本身可成功，实际结果看 `result.request.status=failed` 和 `result.request.failure`。常见原因包括 `insufficient`、`unavailable`、`range`、`declined` 和 `reconciled_failure`。结果不确定时可能保留处理中，等待平台复核。

## SM2/SM3 报文

1. 生成 32 字节随机 AES 密钥和 12 字节随机 IV。UTF-8 JSON 明文用 AES-256-GCM 加密，标签为 16 字节，AAD 是方向名。
2. 用接收方 SM2 公钥包裹 AES 密钥，输出 OpenSSL 兼容的 DER 序列 `(x INTEGER, y INTEGER, c3 OCTET STRING, c2 OCTET STRING)`。
3. 将包裹密钥、IV、标签、密文分别编码为标准 Base64，保存为 `key`、`iv`、`tag`、`data`。
4. 用 LF 拼接 `HTISW1`、方向名、`key`、`iv`、`tag`、`data`，末尾无换行。发送方用 SM2/SM3 对拼接串签名，SM2 ID 为 ASCII `1234567812345678`，DER 签名编码为 Base64 放入 `signature`。
5. 请求方向为 `merchant-request`，用商户私钥签名和平台公钥加密。响应方向为 `merchant-response`，用平台私钥签名和商户公钥加密。以登记的公钥验签，解密后核对回显与时间戳。

```sh
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:SM2 -out merchant-private.pem
openssl pkey -in merchant-private.pem -pubout -out merchant-public.pem
php backend/bin/merchant.php http://127.0.0.1:48787 MERCHANT_ID KEY_ID merchant-private.pem backend-public.pem sandbox request.json
```

## 创建普通收银台订单

<!-- operation: checkout / 收银台与预授权 -->

### 产品介绍

创建待付款订单并返回收银台链接。玩家确认后查询到订单状态 `paid` 才表示付款成功。

### 接入准备

开通收银台支付产品。使用返回的收银台 URL 引导玩家确认。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `create` |
| `kind` | 字符串 | 是 | 100 字节 | 订单类型 | `pay` |
| `request_id` | 字符串 | 是 | 100 字节 | 同一商户、同一环境内的幂等编号 | `REQ-001` |
| `out_trade_no` | 字符串 | 是 | 100 字节 | 同商户、同环境内唯一的商户订单号 | `METRO-001` |
| `title` | 字符串 | 是 | 240 字节 | 向玩家展示的订单或协议标题 | `地铁单程票` |
| `user` | 字符串 | 否 | 100 字节 | 限定可在收银台确认的玩家 | `player-account-id` |
| `return_url` | 字符串 | 否 | — | 回跳 URL，来源须已登记 | `https://merchant.example/orders/METRO-001` |
| `amount` | 整数 | 是 | 10 位 | 订单金额，1 至 2,000,000,000 | `25` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"create","kind":"pay","request_id":"PAY-001","out_trade_no":"METRO-001","title":"地铁单程票","amount":25,"return_url":"https://merchant.example/orders/METRO-001"}
```

### 响应参数示例

```json
{"request":{"status":"completed"},"order":{"id":"11111111111111111111111111111111","status":"pending","amount":25,"checkout_url":"https://cashier.example/checkout/11111111111111111111111111111111"}}
```

`out_trade_no`、`title` 必填，`user`、`return_url` 可选。商户订单号在同一商户和环境内唯一。传 `user` 时仅指定玩家可确认。回跳来源须先登记，交易信息可放在商户自己的回跳路径或查询参数中。待支付订单的有效期为 30 分钟。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |
| `result.order` | 对象 | 是 | — | 相关订单记录 | `{}` |
| `result.order.id` | 字符串 | 是 | 32 字节 | 清算订单 ID | `11111111111111111111111111111111` |
| `result.order.merchant` | 字符串 | 是 | 32 字节 | 订单所属商户 | `11111111111111111111111111111111` |
| `result.order.merchant_name` | 字符串 | 是 | 180 字节 | 下单时商户名称 | `轨道交通` |
| `result.order.env` | 字符串 | 是 | 7 字节 | 订单环境 | `sandbox` |
| `result.order.kind` | 字符串 | 是 | 9 字节 | pay、hold 或 agreement | `pay` |
| `result.order.status` | 字符串 | 是 | 10 字节 | 按订单类型返回 pending、processing、paid、held、released、active、revoked 或 failed | `paid` |
| `result.order.title` | 字符串 | 是 | 240 字节 | 订单或协议标题 | `地铁单程票` |
| `result.order.out_trade_no` | 字符串 | 是 | 100 字节 | 商户订单号；免密扣款订单使用扣款请求编号 | `METRO-001` |
| `result.order.return_url` | 字符串 | 创建时 | — | 商户回跳 URL，未传为空字符串 | `https://merchant.example/orders/METRO-001` |
| `result.order.target` | 字符串或 null | 创建时 | 100 字节 | 限定付款或签约的账号 | `player-account-id` |
| `result.order.amount` | 整数 | 是 | 10 位 | 订单金额，签约订单为 0 | `25` |
| `result.order.refunded` | 整数 | 是 | 10 位 | 累计已退款金额 | `5` |
| `result.order.created` | 整数 | 是 | — | 订单创建时间，Unix 秒 | `1794888000` |
| `result.order.expires` | 整数 | 是 | — | 订单到期时间，Unix 秒 | `1794889800` |
| `result.order.checkout_url` | 字符串 | 创建时 | — | 玩家确认入口 | `https://cashier.example/checkout/11111111111111111111111111111111` |
| `result.order.captured` | 整数 | 已结算时 | 10 位 | 实扣金额 | `25` |
| `result.order.rail` | 字符串 | 有资金来源时 | — | 资金来源，组合来源以 + 连接 | `vault` |
| `result.order.settlement_at` | 整数 | 已结算时 | — | 资金到期时间，Unix 秒 | `1794888000` |
| `result.order.agreement_id` | 字符串 | 免密扣款时 | 32 字节 | 关联签约 ID | `33333333333333333333333333333333` |
| `result.order.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `IDEMPOTENCY_CONFLICT` | 同一请求编号用于不同参数（409） | 查询原操作，新业务使用新编号。 |
| `PRODUCT_DISABLED` | 产品未开通（403） | 请平台管理员开通对应产品。 |
| `DUPLICATE_TRADE_NO` | 商户订单号已存在（409） | 查询或复用原订单，新订单换用新商户订单号。 |
| `RETURN_ORIGIN_DENIED` | 回跳来源未登记（400） | 在商户后台登记回跳地址的来源。 |
| `NOT_FOUND` | 目标账号不存在（404） | 核对目标的清算账号 ID。 |
| `MERCHANT_LIMIT_EXCEEDED` | 商户收款限额已用尽（409） | 检查商户单笔及月度限额。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 创建预授权

<!-- operation: preauthorize / 收银台与预授权 -->

### 产品介绍

创建用于冻结一定金额的预授权订单。玩家确认后，查询到 `held` 才表示冻结成功。

### 接入准备

开通预授权产品。需要冻结资金的玩家应可使用适用的游戏钱包或预付卡。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `create` |
| `kind` | 字符串 | 是 | 100 字节 | 订单类型 | `hold` |
| `request_id` | 字符串 | 是 | 100 字节 | 同一商户、同一环境内的幂等编号 | `REQ-001` |
| `out_trade_no` | 字符串 | 是 | 100 字节 | 同商户、同环境内唯一的商户订单号 | `METRO-001` |
| `title` | 字符串 | 是 | 240 字节 | 向玩家展示的订单或协议标题 | `地铁单程票` |
| `user` | 字符串 | 否 | 100 字节 | 限定可在收银台确认的玩家 | `player-account-id` |
| `return_url` | 字符串 | 否 | — | 回跳 URL，来源须已登记 | `https://merchant.example/orders/METRO-001` |
| `amount` | 整数 | 是 | 10 位 | 冻结金额，1 至 2,000,000,000 | `100` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"create","kind":"hold","request_id":"HOLD-001","out_trade_no":"RESERVE-001","title":"预约冻结","amount":100}
```

### 响应参数示例

```json
{"request":{"status":"completed"},"order":{"id":"22222222222222222222222222222222","status":"pending","amount":100,"checkout_url":"https://cashier.example/checkout/22222222222222222222222222222222"}}
```

玩家确认后，查询到 `held` 才表示冻结成功。预付卡支持组合支付时，可以用游戏钱包补差额。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |
| `result.order` | 对象 | 是 | — | 相关订单记录 | `{}` |
| `result.order.id` | 字符串 | 是 | 32 字节 | 清算订单 ID | `11111111111111111111111111111111` |
| `result.order.merchant` | 字符串 | 是 | 32 字节 | 订单所属商户 | `11111111111111111111111111111111` |
| `result.order.merchant_name` | 字符串 | 是 | 180 字节 | 下单时商户名称 | `轨道交通` |
| `result.order.env` | 字符串 | 是 | 7 字节 | 订单环境 | `sandbox` |
| `result.order.kind` | 字符串 | 是 | 9 字节 | pay、hold 或 agreement | `pay` |
| `result.order.status` | 字符串 | 是 | 10 字节 | 按订单类型返回 pending、processing、paid、held、released、active、revoked 或 failed | `paid` |
| `result.order.title` | 字符串 | 是 | 240 字节 | 订单或协议标题 | `地铁单程票` |
| `result.order.out_trade_no` | 字符串 | 是 | 100 字节 | 商户订单号；免密扣款订单使用扣款请求编号 | `METRO-001` |
| `result.order.return_url` | 字符串 | 创建时 | — | 商户回跳 URL，未传为空字符串 | `https://merchant.example/orders/METRO-001` |
| `result.order.target` | 字符串或 null | 创建时 | 100 字节 | 限定付款或签约的账号 | `player-account-id` |
| `result.order.amount` | 整数 | 是 | 10 位 | 订单金额，签约订单为 0 | `25` |
| `result.order.refunded` | 整数 | 是 | 10 位 | 累计已退款金额 | `5` |
| `result.order.created` | 整数 | 是 | — | 订单创建时间，Unix 秒 | `1794888000` |
| `result.order.expires` | 整数 | 是 | — | 订单到期时间，Unix 秒 | `1794889800` |
| `result.order.checkout_url` | 字符串 | 创建时 | — | 玩家确认入口 | `https://cashier.example/checkout/11111111111111111111111111111111` |
| `result.order.captured` | 整数 | 已结算时 | 10 位 | 实扣金额 | `25` |
| `result.order.rail` | 字符串 | 有资金来源时 | — | 资金来源，组合来源以 + 连接 | `vault` |
| `result.order.settlement_at` | 整数 | 已结算时 | — | 资金到期时间，Unix 秒 | `1794888000` |
| `result.order.agreement_id` | 字符串 | 免密扣款时 | 32 字节 | 关联签约 ID | `33333333333333333333333333333333` |
| `result.order.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `IDEMPOTENCY_CONFLICT` | 同一请求编号用于不同参数（409） | 查询原操作，新业务使用新编号。 |
| `PRODUCT_DISABLED` | 产品未开通（403） | 请平台管理员开通对应产品。 |
| `DUPLICATE_TRADE_NO` | 商户订单号已存在（409） | 查询或复用原订单，新订单换用新商户订单号。 |
| `RETURN_ORIGIN_DENIED` | 回跳来源未登记（400） | 在商户后台登记回跳地址的来源。 |
| `NOT_FOUND` | 目标账号不存在（404） | 核对目标的清算账号 ID。 |
| `MERCHANT_LIMIT_EXCEEDED` | 商户收款限额已用尽（409） | 检查商户单笔及月度限额。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 结算或解除预授权

<!-- operation: capture / 收银台与预授权 -->

### 产品介绍

对已冻结订单结算指定金额；传 0 全额解除。若有异步释放，查询原请求直到完成。

### 接入准备

开通预授权产品，并取得状态为 held 的清算订单 ID。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `capture` |
| `request_id` | 字符串 | 是 | 100 字节 | 同一商户、同一环境内的幂等编号 | `REQ-001` |
| `order_id` | 字符串 | 是 | 100 字节 | 已冻结的清算订单 ID | `22222222222222222222222222222222` |
| `amount` | 整数 | 是 | 10 位 | 结算金额，0 至原冻结金额 | `60` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"capture","request_id":"CAP-001","order_id":"22222222222222222222222222222222","amount":60}
```

### 响应参数示例

```json
{"request":{"status":"processing","amount":60},"order":{"id":"22222222222222222222222222222222","status":"held","amount":100}}
```

上例结算 60，释放其余 40。全额解除传 `amount:0`，结束后订单为 `released`。全额结算传冻结金额，结束后为 `paid`。已释放或已结算的同一笔预授权无法再次结算。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |
| `result.order` | 对象 | 是 | — | 相关订单记录 | `{}` |
| `result.order.id` | 字符串 | 是 | 32 字节 | 清算订单 ID | `11111111111111111111111111111111` |
| `result.order.merchant` | 字符串 | 是 | 32 字节 | 订单所属商户 | `11111111111111111111111111111111` |
| `result.order.merchant_name` | 字符串 | 是 | 180 字节 | 下单时商户名称 | `轨道交通` |
| `result.order.env` | 字符串 | 是 | 7 字节 | 订单环境 | `sandbox` |
| `result.order.kind` | 字符串 | 是 | 9 字节 | pay、hold 或 agreement | `pay` |
| `result.order.status` | 字符串 | 是 | 10 字节 | 按订单类型返回 pending、processing、paid、held、released、active、revoked 或 failed | `paid` |
| `result.order.title` | 字符串 | 是 | 240 字节 | 订单或协议标题 | `地铁单程票` |
| `result.order.out_trade_no` | 字符串 | 是 | 100 字节 | 商户订单号；免密扣款订单使用扣款请求编号 | `METRO-001` |
| `result.order.return_url` | 字符串 | 创建时 | — | 商户回跳 URL，未传为空字符串 | `https://merchant.example/orders/METRO-001` |
| `result.order.target` | 字符串或 null | 创建时 | 100 字节 | 限定付款或签约的账号 | `player-account-id` |
| `result.order.amount` | 整数 | 是 | 10 位 | 订单金额，签约订单为 0 | `25` |
| `result.order.refunded` | 整数 | 是 | 10 位 | 累计已退款金额 | `5` |
| `result.order.created` | 整数 | 是 | — | 订单创建时间，Unix 秒 | `1794888000` |
| `result.order.expires` | 整数 | 是 | — | 订单到期时间，Unix 秒 | `1794889800` |
| `result.order.checkout_url` | 字符串 | 创建时 | — | 玩家确认入口 | `https://cashier.example/checkout/11111111111111111111111111111111` |
| `result.order.captured` | 整数 | 已结算时 | 10 位 | 实扣金额 | `25` |
| `result.order.rail` | 字符串 | 有资金来源时 | — | 资金来源，组合来源以 + 连接 | `vault` |
| `result.order.settlement_at` | 整数 | 已结算时 | — | 资金到期时间，Unix 秒 | `1794888000` |
| `result.order.agreement_id` | 字符串 | 免密扣款时 | 32 字节 | 关联签约 ID | `33333333333333333333333333333333` |
| `result.order.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `IDEMPOTENCY_CONFLICT` | 同一请求编号用于不同参数（409） | 查询原操作，新业务使用新编号。 |
| `PRODUCT_DISABLED` | 产品未开通（403） | 请平台管理员开通对应产品。 |
| `ORDER_NOT_FOUND` | 订单不存在（404） | 核对清算订单 ID、商户与交易环境。 |
| `OPERATION_IN_PROGRESS` | 订单有尚未结束的资金操作（409） | 查询原请求，终结后再执行下一笔。 |
| `INVALID_CAPTURE` | 订单状态不符或金额越界（409） | 核对冻结状态和剩余可结算金额。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 创建免密签约

<!-- operation: agreement / 免密支付 -->

### 产品介绍

生成免密签约确认链接。玩家选择支付方式顺序后，签约必须达到 `active` 才能扣款。

### 接入准备

开通免密签约产品，并引导玩家进入返回的签约页面。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `create` |
| `kind` | 字符串 | 是 | 100 字节 | 订单类型 | `agreement` |
| `request_id` | 字符串 | 是 | 100 字节 | 同一商户、同一环境内的幂等编号 | `REQ-001` |
| `out_trade_no` | 字符串 | 是 | 100 字节 | 同商户、同环境内唯一的商户订单号 | `METRO-001` |
| `title` | 字符串 | 是 | 240 字节 | 向玩家展示的订单或协议标题 | `地铁单程票` |
| `user` | 字符串 | 否 | 100 字节 | 限定可在收银台确认的玩家 | `player-account-id` |
| `return_url` | 字符串 | 否 | — | 回跳 URL，来源须已登记 | `https://merchant.example/orders/METRO-001` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"create","kind":"agreement","request_id":"SIGN-001","out_trade_no":"AGREE-001","title":"公交免密协议"}
```

### 响应参数示例

```json
{"request":{"status":"completed"},"order":{"id":"33333333333333333333333333333333","status":"pending","amount":0,"checkout_url":"https://cashier.example/checkout/33333333333333333333333333333333"}}
```

玩家进入签约页面，确认支付方式顺序。查询到 `active` 后可扣款。这里的订单 ID 就是签约 ID。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |
| `result.order` | 对象 | 是 | — | 相关订单记录 | `{}` |
| `result.order.id` | 字符串 | 是 | 32 字节 | 清算订单 ID | `11111111111111111111111111111111` |
| `result.order.merchant` | 字符串 | 是 | 32 字节 | 订单所属商户 | `11111111111111111111111111111111` |
| `result.order.merchant_name` | 字符串 | 是 | 180 字节 | 下单时商户名称 | `轨道交通` |
| `result.order.env` | 字符串 | 是 | 7 字节 | 订单环境 | `sandbox` |
| `result.order.kind` | 字符串 | 是 | 9 字节 | pay、hold 或 agreement | `pay` |
| `result.order.status` | 字符串 | 是 | 10 字节 | 按订单类型返回 pending、processing、paid、held、released、active、revoked 或 failed | `paid` |
| `result.order.title` | 字符串 | 是 | 240 字节 | 订单或协议标题 | `地铁单程票` |
| `result.order.out_trade_no` | 字符串 | 是 | 100 字节 | 商户订单号；免密扣款订单使用扣款请求编号 | `METRO-001` |
| `result.order.return_url` | 字符串 | 创建时 | — | 商户回跳 URL，未传为空字符串 | `https://merchant.example/orders/METRO-001` |
| `result.order.target` | 字符串或 null | 创建时 | 100 字节 | 限定付款或签约的账号 | `player-account-id` |
| `result.order.amount` | 整数 | 是 | 10 位 | 订单金额，签约订单为 0 | `25` |
| `result.order.refunded` | 整数 | 是 | 10 位 | 累计已退款金额 | `5` |
| `result.order.created` | 整数 | 是 | — | 订单创建时间，Unix 秒 | `1794888000` |
| `result.order.expires` | 整数 | 是 | — | 订单到期时间，Unix 秒 | `1794889800` |
| `result.order.checkout_url` | 字符串 | 创建时 | — | 玩家确认入口 | `https://cashier.example/checkout/11111111111111111111111111111111` |
| `result.order.captured` | 整数 | 已结算时 | 10 位 | 实扣金额 | `25` |
| `result.order.rail` | 字符串 | 有资金来源时 | — | 资金来源，组合来源以 + 连接 | `vault` |
| `result.order.settlement_at` | 整数 | 已结算时 | — | 资金到期时间，Unix 秒 | `1794888000` |
| `result.order.agreement_id` | 字符串 | 免密扣款时 | 32 字节 | 关联签约 ID | `33333333333333333333333333333333` |
| `result.order.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `IDEMPOTENCY_CONFLICT` | 同一请求编号用于不同参数（409） | 查询原操作，新业务使用新编号。 |
| `PRODUCT_DISABLED` | 产品未开通（403） | 请平台管理员开通对应产品。 |
| `DUPLICATE_TRADE_NO` | 商户订单号已存在（409） | 查询或复用原订单，新订单换用新商户订单号。 |
| `RETURN_ORIGIN_DENIED` | 回跳来源未登记（400） | 在商户后台登记回跳地址的来源。 |
| `NOT_FOUND` | 目标账号不存在（404） | 核对目标的清算账号 ID。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 免密扣款

<!-- operation: debit / 免密支付 -->

### 产品介绍

按已生效协议的支付方式顺序尝试扣款，返回独立的支付订单。

### 接入准备

开通免密签约产品，准备生效的签约 ID。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `debit` |
| `request_id` | 字符串 | 是 | 100 字节 | 同一商户、同一环境内的幂等编号 | `REQ-001` |
| `order_id` | 字符串 | 是 | 100 字节 | 已生效的签约 ID | `33333333333333333333333333333333` |
| `amount` | 整数 | 是 | 10 位 | 扣款金额，1 至 2,000,000,000 | `12` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"debit","request_id":"DEBIT-001","order_id":"33333333333333333333333333333333","amount":12}
```

### 响应参数示例

```json
{"request":{"status":"processing","result_order":"44444444444444444444444444444444"},"order":{"id":"44444444444444444444444444444444","status":"processing","amount":12}}
```

使用返回的独立支付订单 ID 查询扣款或发起退款。后续扣款使用新的 `request_id`。玩家当前钱包与签约时不一致时，扣款返回 `AGREEMENT_INACTIVE`，需要重新签约。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |
| `result.order` | 对象 | 是 | — | 相关订单记录 | `{}` |
| `result.order.id` | 字符串 | 是 | 32 字节 | 清算订单 ID | `11111111111111111111111111111111` |
| `result.order.merchant` | 字符串 | 是 | 32 字节 | 订单所属商户 | `11111111111111111111111111111111` |
| `result.order.merchant_name` | 字符串 | 是 | 180 字节 | 下单时商户名称 | `轨道交通` |
| `result.order.env` | 字符串 | 是 | 7 字节 | 订单环境 | `sandbox` |
| `result.order.kind` | 字符串 | 是 | 9 字节 | pay、hold 或 agreement | `pay` |
| `result.order.status` | 字符串 | 是 | 10 字节 | 按订单类型返回 pending、processing、paid、held、released、active、revoked 或 failed | `paid` |
| `result.order.title` | 字符串 | 是 | 240 字节 | 订单或协议标题 | `地铁单程票` |
| `result.order.out_trade_no` | 字符串 | 是 | 100 字节 | 商户订单号；免密扣款订单使用扣款请求编号 | `METRO-001` |
| `result.order.return_url` | 字符串 | 创建时 | — | 商户回跳 URL，未传为空字符串 | `https://merchant.example/orders/METRO-001` |
| `result.order.target` | 字符串或 null | 创建时 | 100 字节 | 限定付款或签约的账号 | `player-account-id` |
| `result.order.amount` | 整数 | 是 | 10 位 | 订单金额，签约订单为 0 | `25` |
| `result.order.refunded` | 整数 | 是 | 10 位 | 累计已退款金额 | `5` |
| `result.order.created` | 整数 | 是 | — | 订单创建时间，Unix 秒 | `1794888000` |
| `result.order.expires` | 整数 | 是 | — | 订单到期时间，Unix 秒 | `1794889800` |
| `result.order.checkout_url` | 字符串 | 创建时 | — | 玩家确认入口 | `https://cashier.example/checkout/11111111111111111111111111111111` |
| `result.order.captured` | 整数 | 已结算时 | 10 位 | 实扣金额 | `25` |
| `result.order.rail` | 字符串 | 有资金来源时 | — | 资金来源，组合来源以 + 连接 | `vault` |
| `result.order.settlement_at` | 整数 | 已结算时 | — | 资金到期时间，Unix 秒 | `1794888000` |
| `result.order.agreement_id` | 字符串 | 免密扣款时 | 32 字节 | 关联签约 ID | `33333333333333333333333333333333` |
| `result.order.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `IDEMPOTENCY_CONFLICT` | 同一请求编号用于不同参数（409） | 查询原操作，新业务使用新编号。 |
| `PRODUCT_DISABLED` | 产品未开通（403） | 请平台管理员开通对应产品。 |
| `ORDER_NOT_FOUND` | 订单不存在（404） | 核对清算订单 ID、商户与交易环境。 |
| `AGREEMENT_INACTIVE` | 签约未生效、已解约或钱包已变更（409） | 查询签约状态，按需重新签约。 |
| `MERCHANT_LIMIT_EXCEEDED` | 商户收款限额已用尽（409） | 检查商户单笔及月度限额。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 免密解约

<!-- operation: revoke / 免密支付 -->

### 产品介绍

撤销免密协议，阻止新扣款。已受理的扣款继续清算。解约同步返回。

### 接入准备

开通免密签约产品，准备本商户、本环境的签约 ID。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `revoke` |
| `request_id` | 字符串 | 是 | 100 字节 | 同一商户、同一环境内的幂等编号 | `REQ-001` |
| `order_id` | 字符串 | 是 | 100 字节 | 清算签约 ID | `33333333333333333333333333333333` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"revoke","request_id":"REVOKE-001","order_id":"33333333333333333333333333333333"}
```

### 响应参数示例

```json
{"request":{"status":"completed"},"order":{"id":"33333333333333333333333333333333","status":"revoked"}}
```

仅可解约本商户、本环境的已生效或已解约协议。玩家也可在玩家面板解约。解约阻止新扣款，已受理的扣款继续清算。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |
| `result.order` | 对象 | 是 | — | 相关订单记录 | `{}` |
| `result.order.id` | 字符串 | 是 | 32 字节 | 清算订单 ID | `11111111111111111111111111111111` |
| `result.order.merchant` | 字符串 | 是 | 32 字节 | 订单所属商户 | `11111111111111111111111111111111` |
| `result.order.merchant_name` | 字符串 | 是 | 180 字节 | 下单时商户名称 | `轨道交通` |
| `result.order.env` | 字符串 | 是 | 7 字节 | 订单环境 | `sandbox` |
| `result.order.kind` | 字符串 | 是 | 9 字节 | pay、hold 或 agreement | `pay` |
| `result.order.status` | 字符串 | 是 | 10 字节 | 按订单类型返回 pending、processing、paid、held、released、active、revoked 或 failed | `paid` |
| `result.order.title` | 字符串 | 是 | 240 字节 | 订单或协议标题 | `地铁单程票` |
| `result.order.out_trade_no` | 字符串 | 是 | 100 字节 | 商户订单号；免密扣款订单使用扣款请求编号 | `METRO-001` |
| `result.order.return_url` | 字符串 | 创建时 | — | 商户回跳 URL，未传为空字符串 | `https://merchant.example/orders/METRO-001` |
| `result.order.target` | 字符串或 null | 创建时 | 100 字节 | 限定付款或签约的账号 | `player-account-id` |
| `result.order.amount` | 整数 | 是 | 10 位 | 订单金额，签约订单为 0 | `25` |
| `result.order.refunded` | 整数 | 是 | 10 位 | 累计已退款金额 | `5` |
| `result.order.created` | 整数 | 是 | — | 订单创建时间，Unix 秒 | `1794888000` |
| `result.order.expires` | 整数 | 是 | — | 订单到期时间，Unix 秒 | `1794889800` |
| `result.order.checkout_url` | 字符串 | 创建时 | — | 玩家确认入口 | `https://cashier.example/checkout/11111111111111111111111111111111` |
| `result.order.captured` | 整数 | 已结算时 | 10 位 | 实扣金额 | `25` |
| `result.order.rail` | 字符串 | 有资金来源时 | — | 资金来源，组合来源以 + 连接 | `vault` |
| `result.order.settlement_at` | 整数 | 已结算时 | — | 资金到期时间，Unix 秒 | `1794888000` |
| `result.order.agreement_id` | 字符串 | 免密扣款时 | 32 字节 | 关联签约 ID | `33333333333333333333333333333333` |
| `result.order.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `IDEMPOTENCY_CONFLICT` | 同一请求编号用于不同参数（409） | 查询原操作，新业务使用新编号。 |
| `PRODUCT_DISABLED` | 产品未开通（403） | 请平台管理员开通对应产品。 |
| `ORDER_NOT_FOUND` | 订单不存在（404） | 核对清算订单 ID、商户与交易环境。 |
| `AGREEMENT_INACTIVE` | 签约未生效、已解约或钱包已变更（409） | 查询签约状态，按需重新签约。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 退款

<!-- operation: refund / 资金操作 -->

### 产品介绍

将已付订单的款项沿原资金来源退回。若返回 processing，需按请求编号继续查询。

### 接入准备

开通退款产品并取得已付款订单的清算订单 ID。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `refund` |
| `request_id` | 字符串 | 是 | 100 字节 | 同一商户、同一环境内的幂等编号 | `REQ-001` |
| `order_id` | 字符串 | 是 | 100 字节 | 已付款的清算订单 ID | `11111111111111111111111111111111` |
| `amount` | 整数 | 是 | 10 位 | 退款金额，1 至剩余可退金额 | `5` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"refund","request_id":"REF-001","order_id":"11111111111111111111111111111111","amount":5}
```

### 响应参数示例

```json
{"request":{"status":"completed","amount":5},"order":{"id":"11111111111111111111111111111111","status":"paid","captured":25,"refunded":5}}
```

仅支持已付款订单，累计退款上限为实扣。退款走原支付来源。组合支付从末次使用的资金部分向前退款。清算期内从原订单的清算批次预留退款，清算到期后使用商户已清算可用余额。若返回 `processing`，轮询到 `completed` 后再确认退款成功。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |
| `result.order` | 对象 | 是 | — | 相关订单记录 | `{}` |
| `result.order.id` | 字符串 | 是 | 32 字节 | 清算订单 ID | `11111111111111111111111111111111` |
| `result.order.merchant` | 字符串 | 是 | 32 字节 | 订单所属商户 | `11111111111111111111111111111111` |
| `result.order.merchant_name` | 字符串 | 是 | 180 字节 | 下单时商户名称 | `轨道交通` |
| `result.order.env` | 字符串 | 是 | 7 字节 | 订单环境 | `sandbox` |
| `result.order.kind` | 字符串 | 是 | 9 字节 | pay、hold 或 agreement | `pay` |
| `result.order.status` | 字符串 | 是 | 10 字节 | 按订单类型返回 pending、processing、paid、held、released、active、revoked 或 failed | `paid` |
| `result.order.title` | 字符串 | 是 | 240 字节 | 订单或协议标题 | `地铁单程票` |
| `result.order.out_trade_no` | 字符串 | 是 | 100 字节 | 商户订单号；免密扣款订单使用扣款请求编号 | `METRO-001` |
| `result.order.return_url` | 字符串 | 创建时 | — | 商户回跳 URL，未传为空字符串 | `https://merchant.example/orders/METRO-001` |
| `result.order.target` | 字符串或 null | 创建时 | 100 字节 | 限定付款或签约的账号 | `player-account-id` |
| `result.order.amount` | 整数 | 是 | 10 位 | 订单金额，签约订单为 0 | `25` |
| `result.order.refunded` | 整数 | 是 | 10 位 | 累计已退款金额 | `5` |
| `result.order.created` | 整数 | 是 | — | 订单创建时间，Unix 秒 | `1794888000` |
| `result.order.expires` | 整数 | 是 | — | 订单到期时间，Unix 秒 | `1794889800` |
| `result.order.checkout_url` | 字符串 | 创建时 | — | 玩家确认入口 | `https://cashier.example/checkout/11111111111111111111111111111111` |
| `result.order.captured` | 整数 | 已结算时 | 10 位 | 实扣金额 | `25` |
| `result.order.rail` | 字符串 | 有资金来源时 | — | 资金来源，组合来源以 + 连接 | `vault` |
| `result.order.settlement_at` | 整数 | 已结算时 | — | 资金到期时间，Unix 秒 | `1794888000` |
| `result.order.agreement_id` | 字符串 | 免密扣款时 | 32 字节 | 关联签约 ID | `33333333333333333333333333333333` |
| `result.order.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `IDEMPOTENCY_CONFLICT` | 同一请求编号用于不同参数（409） | 查询原操作，新业务使用新编号。 |
| `PRODUCT_DISABLED` | 产品未开通（403） | 请平台管理员开通对应产品。 |
| `ORDER_NOT_FOUND` | 订单不存在（404） | 核对清算订单 ID、商户与交易环境。 |
| `OPERATION_IN_PROGRESS` | 订单有尚未结束的资金操作（409） | 查询原请求，终结后再执行下一笔。 |
| `MERCHANT_FUNDS_UNAVAILABLE` | 已清算可用资金不足（409） | 核对支付方式对应的可用余额和清算周期。 |
| `INVALID_REFUND` | 订单不能退款或金额超限（409） | 核对订单实扣金额及累计退款。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 分账给玩家

<!-- operation: split / 资金操作 -->

### 产品介绍

从商户余额中划拨资金到指定玩家游戏钱包。执行可能异步。

### 接入准备

开通分账产品，准备接收方清算 ID。正式操作使用对应支付方式已到清算期的可用余额。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `split` |
| `request_id` | 字符串 | 是 | 100 字节 | 同一商户、同一环境内的幂等编号 | `REQ-001` |
| `rail` | 字符串 | 是 | 10 字节 | 资金来源，vault 或 scoreboard | `vault` |
| `amount` | 整数 | 是 | 10 位 | 分账金额，1 至 2,000,000,000 | `8` |
| `user` | 字符串 | 是 | 100 字节 | 接收方清算账号 ID | `player-account-id` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"split","request_id":"SPLIT-001","rail":"vault","amount":8,"user":"player-account-id"}
```

### 响应参数示例

```json
{"request":{"action":"split","status":"processing","rail":"vault","amount":8,"user":"player-account-id"}}
```

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `IDEMPOTENCY_CONFLICT` | 同一请求编号用于不同参数（409） | 查询原操作，新业务使用新编号。 |
| `PRODUCT_DISABLED` | 产品未开通（403） | 请平台管理员开通对应产品。 |
| `MERCHANT_FUNDS_UNAVAILABLE` | 已清算可用资金不足（409） | 核对支付方式对应的可用余额和清算周期。 |
| `NOT_FOUND` | 目标账号不存在（404） | 核对目标的清算账号 ID。 |
| `CONFLICT` | 目标钱包不可用或操作状态冲突（409） | 确认目标清算账号已有可用游戏钱包，若请求已提交请查询原编号。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 提现至玩家

<!-- operation: payout / 资金操作 -->

### 产品介绍

将商户资金提现至目标玩家钱包。执行可能异步。

### 接入准备

开通提现产品。正式操作使用对应支付方式已到清算期的可用余额。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `payout` |
| `request_id` | 字符串 | 是 | 100 字节 | 同一商户、同一环境内的幂等编号 | `REQ-001` |
| `rail` | 字符串 | 是 | 10 字节 | 资金来源，vault 或 scoreboard | `vault` |
| `amount` | 整数 | 是 | 10 位 | 提现金额，1 至 2,000,000,000 | `10` |
| `user` | 字符串 | 否 | 100 字节 | 目标清算账号 ID，省略时提现至超级管理员 | `player-account-id` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"payout","request_id":"PAYOUT-001","rail":"scoreboard","amount":10,"user":"player-account-id"}
```

### 响应参数示例

```json
{"request":{"action":"payout","status":"processing","rail":"scoreboard","amount":10,"user":"player-account-id"}}
```

提现未填 `user` 时转给超级管理员。正式提现与分账使用对应支付方式已到清算期的资金。请求处于 `processing` 时资金已预留。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `IDEMPOTENCY_CONFLICT` | 同一请求编号用于不同参数（409） | 查询原操作，新业务使用新编号。 |
| `PRODUCT_DISABLED` | 产品未开通（403） | 请平台管理员开通对应产品。 |
| `MERCHANT_FUNDS_UNAVAILABLE` | 已清算可用资金不足（409） | 核对支付方式对应的可用余额和清算周期。 |
| `NOT_FOUND` | 目标账号不存在（404） | 核对目标的清算账号 ID。 |
| `CONFLICT` | 目标钱包不可用或操作状态冲突（409） | 确认目标清算账号已有可用游戏钱包，若请求已提交请查询原编号。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 预付卡代激活

<!-- operation: card-bind / 预付卡 -->

### 产品介绍

使用卡号、卡密将商户发行的预付卡绑定给指定玩家。绑定同步返回。

### 接入准备

准备本商户、本环境发行的卡号、卡密和目标清算账号 ID。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `card_bind` |
| `request_id` | 字符串 | 是 | 100 字节 | 同一商户、同一环境内的幂等编号 | `REQ-001` |
| `number` | 字符串 | 是 | 100 字节 | 预付卡卡号 | `卡号` |
| `secret` | 字符串 | 是 | 100 字节 | 未使用的卡密 | `卡密` |
| `user` | 字符串 | 是 | 100 字节 | 绑定至指定清算账号 | `player-account-id` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"card_bind","request_id":"BIND-001","number":"卡号","secret":"卡密","user":"player-account-id"}
```

### 响应参数示例

```json
{"request":{"action":"card_bind","status":"completed","card":{"number":"卡号","state":"active","balance":100,"rail":"vault","env":"sandbox","owner":"player-account-id"}}}
```

商户仅可激活本商户发行且与请求环境一致的卡。卡密只能使用一次。平台发行的卡可由超级管理员后台绑定，或由持有卡密的玩家自行激活。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |
| `result.request.card` | 对象 | 是 | — | 完成绑定后的卡片 | `{}` |
| `result.request.card.number` | 字符串 | 是 | — | 卡号 | `卡号` |
| `result.request.card.state` | 字符串 | 是 | 6 字节 | 已激活状态 | `active` |
| `result.request.card.balance` | 整数 | 是 | 10 位 | 卡内余额 | `100` |
| `result.request.card.rail` | 字符串 | 是 | 20 字节 | 购卡支付方式 | `vault` |
| `result.request.card.env` | 字符串 | 是 | 7 字节 | 卡片环境 | `sandbox` |
| `result.request.card.owner` | 字符串 | 是 | 100 字节 | 持卡人清算账号 | `player-account-id` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `IDEMPOTENCY_CONFLICT` | 同一请求编号用于不同参数（409） | 查询原操作，新业务使用新编号。 |
| `NOT_FOUND` | 目标账号不存在（404） | 核对目标的清算账号 ID。 |
| `CARD_NOT_REDEEMABLE` | 卡密无效、卡已用或发行方／环境不符（409） | 核对卡片资料、归属和环境。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 查询订单或操作

<!-- operation: query / 查询与对账 -->

### 产品介绍

查询订单状态或异步操作状态。传入两种编号时，优先查请求编号。

### 接入准备

使用原交易的商户和环境，准备清算订单 ID 或请求编号。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `query` |
| `request_id` | 字符串 | 二选一 | 100 字节 | 待查询的请求编号，优先于 order_id | `REF-001` |
| `order_id` | 字符串 | 二选一 | 100 字节 | 清算订单 ID | `11111111111111111111111111111111` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

**按清算订单 ID 查询**

```json
{"action":"query","order_id":"11111111111111111111111111111111"}
```

**按请求编号查询**

```json
{"action":"query","request_id":"REF-001"}
```

### 响应参数示例

**按清算订单 ID 查询**

```json
{"id":"11111111111111111111111111111111","status":"paid","amount":25,"captured":25,"refunded":5}
```

**按请求编号查询**

```json
{"request":{"action":"refund","request_id":"REF-001","status":"completed","amount":5},"order":{"status":"paid","refunded":5}}
```

按订单查交易状态，返回订单本身。下表 `{order.}` 表示按订单查询时省略该段，按请求查询且有订单时保留该段。

按请求编号查操作状态，返回 `request`，有相关订单时还返回 `order`。两项同时传入时优先查 `request_id`。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.request` | 对象 | 操作模式 | — | 请求执行记录 | `{}` |
| `result.request.request_id` | 字符串 | 操作模式 | 100 字节 | 商户的幂等请求编号 | `PAY-001` |
| `result.request.status` | 字符串 | 操作模式 | 10 字节 | processing、completed 或 failed | `processing` |
| `result.request.action` | 字符串 | 操作模式 | 10 字节 | 原操作名 | `create` |
| `result.request.env` | 字符串 | 操作模式 | 7 字节 | 原操作环境 | `sandbox` |
| `result.request.merchant` | 字符串 | 操作模式 | 32 字节 | 原操作商户号 | `11111111111111111111111111111111` |
| `result.request.result_order` | 字符串 | 有结果订单时 | 32 字节 | 结果订单 ID | `44444444444444444444444444444444` |
| `result.request.order_id` | 字符串 | 涉及原订单时 | 32 字节 | 原清算订单 ID | `11111111111111111111111111111111` |
| `result.request.amount` | 整数 | 涉及金额时 | 10 位 | 操作金额 | `25` |
| `result.request.rail` | 字符串 | 涉及支付方式时 | 10 字节 | 操作使用的支付方式 | `vault` |
| `result.request.user` | 字符串 | 分账或提现时 | 100 字节 | 目标清算账号 | `player-account-id` |
| `result.request.failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |
| `result.order` | 对象 | 按请求编号查询且有订单时 | — | 相关订单记录 | `{}` |
| `result.{order.}id` | 字符串 | 是 | 32 字节 | 清算订单 ID | `11111111111111111111111111111111` |
| `result.{order.}merchant` | 字符串 | 是 | 32 字节 | 订单所属商户 | `11111111111111111111111111111111` |
| `result.{order.}merchant_name` | 字符串 | 是 | 180 字节 | 下单时商户名称 | `轨道交通` |
| `result.{order.}env` | 字符串 | 是 | 7 字节 | 订单环境 | `sandbox` |
| `result.{order.}kind` | 字符串 | 是 | 9 字节 | pay、hold 或 agreement | `pay` |
| `result.{order.}status` | 字符串 | 是 | 10 字节 | 按订单类型返回 pending、processing、paid、held、released、active、revoked 或 failed | `paid` |
| `result.{order.}title` | 字符串 | 是 | 240 字节 | 订单或协议标题 | `地铁单程票` |
| `result.{order.}out_trade_no` | 字符串 | 是 | 100 字节 | 商户订单号；免密扣款订单使用扣款请求编号 | `METRO-001` |
| `result.{order.}return_url` | 字符串 | 创建时 | — | 商户回跳 URL，未传为空字符串 | `https://merchant.example/orders/METRO-001` |
| `result.{order.}target` | 字符串或 null | 创建时 | 100 字节 | 限定付款或签约的账号 | `player-account-id` |
| `result.{order.}amount` | 整数 | 是 | 10 位 | 订单金额，签约订单为 0 | `25` |
| `result.{order.}refunded` | 整数 | 是 | 10 位 | 累计已退款金额 | `5` |
| `result.{order.}created` | 整数 | 是 | — | 订单创建时间，Unix 秒 | `1794888000` |
| `result.{order.}expires` | 整数 | 是 | — | 订单到期时间，Unix 秒 | `1794889800` |
| `result.{order.}checkout_url` | 字符串 | 创建时 | — | 玩家确认入口 | `https://cashier.example/checkout/11111111111111111111111111111111` |
| `result.{order.}captured` | 整数 | 已结算时 | 10 位 | 实扣金额 | `25` |
| `result.{order.}rail` | 字符串 | 有资金来源时 | — | 资金来源，组合来源以 + 连接 | `vault` |
| `result.{order.}settlement_at` | 整数 | 已结算时 | — | 资金到期时间，Unix 秒 | `1794888000` |
| `result.{order.}agreement_id` | 字符串 | 免密扣款时 | 32 字节 | 关联签约 ID | `33333333333333333333333333333333` |
| `result.{order.}failure` | 字符串 | 失败时 | — | 资金执行失败原因 | `insufficient` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

| 错误码 | 错误描述 | 解决建议 |
| --- | --- | --- |
| `ORDER_NOT_FOUND` | 订单不存在（404） | 核对清算订单 ID、商户与交易环境。 |
| `REQUEST_NOT_FOUND` | 请求不存在（404） | 核对原请求的编号、商户和环境。 |

认证、格式及服务类错误见 [通用错误码](#通用错误码)。

## 获取商户对账流水

<!-- operation: statement / 查询与对账 -->

### 产品介绍

同步分页获取本商户的付款、退款流水。付款金额为正，退款为负。

### 接入准备

使用待对账的商户密钥和对应交易环境。

**请求方式**：`POST /open/v1`。请求头为 `Content-Type: application/json`、`X-Merchant-Id`、`X-Key-Id`。商户后台需先登记 SM2 公钥并取得 API Key。下方示例展示业务字段，实际请求需加入表中的通用字段并按 [SM2/SM3 报文](#sm2sm3-报文) 加密签名。

响应示例只展示解密后的 `result`。调用端需校验签名及商户、环境、时间戳和 challenge 回显。异步操作以请求状态为准，超时或断线时先用原请求编号查询；重试同一操作需保留业务参数及编号，更新 timestamp 和 challenge。

### 请求参数说明表

| 参数 | 类型 | 是否必选 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `action` | 字符串 | 是 | 100 字节 | 接口操作 | `statement` |
| `month` | 字符串 | 否 | 7 字节 | 北京时间月份 YYYY-MM，省略查全部 | `2026-11` |
| `page` | 整数 | 否 | 7 位 | 1 至 1,000,000，默认 1 | `1` |

请求还需包含 [通用请求参数](#通用请求参数)。

### 常见请求示例

```json
{"action":"statement","month":"2026-11","page":1}
```

### 响应参数示例

```json
{"items":[{"id":"流水号","order_id":"订单号","out_trade_no":"METRO-001","merchant":"商户号","merchant_name":"轨道交通","env":"sandbox","event":"payment","amount":25,"rail":"vault","time":1794888000}],"total":1,"page":1,"page_size":50}
```

`month` 按北京时间，省略时查询全部。每页 50 条。付款流水金额为正，退款为负。`rail` 可出现 `card` 或组合名称。`legacy_refund` 表示升级前的累计退款，时间沿用旧订单时间。XLSX 下载入口在商户后台。

### 响应参数说明表

| 参数 | 类型 | 是否必给 | 最大长度 | 描述 | 示例值 |
| --- | --- | --- | --- | --- | --- |
| `result.items` | 数组 | 是 | 50 项 | 流水列表 | `[]` |
| `result.total` | 整数 | 是 | — | 匹配的流水总数 | `1` |
| `result.page` | 整数 | 是 | 7 位 | 当前页码 | `1` |
| `result.page_size` | 整数 | 是 | 2 位 | 固定每页 50 条 | `50` |
| `result.items[].id` | 字符串 | 每项均有 | 46 字节 | 流水 ID，历史退款可含 legacy-refund- 前缀 | `legacy-refund-11111111111111111111111111111111` |
| `result.items[].order_id` | 字符串 | 每项均有 | 32 字节 | 清算订单 ID | `11111111111111111111111111111111` |
| `result.items[].out_trade_no` | 字符串 | 每项均有 | 100 字节 | 商户订单号 | `METRO-001` |
| `result.items[].merchant` | 字符串 | 每项均有 | 32 字节 | 商户号 | `11111111111111111111111111111111` |
| `result.items[].merchant_name` | 字符串 | 每项均有 | 180 字节 | 商户名称 | `轨道交通` |
| `result.items[].env` | 字符串 | 每项均有 | 7 字节 | 流水环境 | `sandbox` |
| `result.items[].event` | 字符串 | 每项均有 | 13 字节 | payment、refund 或 legacy_refund | `payment` |
| `result.items[].amount` | 整数 | 每项均有 | 10 位，不含符号 | 有符号游戏单位金额 | `25` |
| `result.items[].rail` | 字符串 | 每项均有 | — | 支付来源，可能为 card 或组合名称 | `vault` |
| `result.items[].time` | 整数 | 每项均有 | — | 流水时间，Unix 秒 | `1794888000` |

响应外层见 [通用响应参数](#通用响应参数)。字段“是否必给”按成功业务响应说明。

### 错误码表

认证、格式及服务类错误见 [通用错误码](#通用错误码)。
