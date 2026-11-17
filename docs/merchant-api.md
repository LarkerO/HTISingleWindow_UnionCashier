# 商户开放接口

## 快速接入

1. 在商户后台登记 SM2 公钥和回跳来源，再复制平台生成的 API Key。轮换公钥时，API Key 同步轮换。首次测试可用后台沙箱调试。
2. 调用 `POST /open/v1` 创建订单，读取 `result.order.checkout_url`，让玩家在浏览器确认。
3. 玩家回跳后查询并验签。普通订单以 `paid` 为准，预授权以 `held` 为准，免密签约以 `active` 为准。后台扣款、退款等有异步结果，按请求编号查询。

此入口按 `action` 区分各项操作。下方 JSON 示例为**业务明文**，实际 HTTP 正文需要按本页协议封装。使用 PHP 示例工具时，请求文件只需写业务明文，工具会补上通用字段并执行加解密和验签。

## 接口清单

| 功能 | action | 专用参数 | 查询或确认 |
| --- | --- | --- | --- |
| 创建收银台订单 | `create` | `kind=pay`、订单号、标题、金额 | `order.status=paid` |
| 创建预授权 | `create` | `kind=hold`、订单号、标题、金额 | `order.status=held` |
| 结算或解除预授权 | `capture` | `order_id`、`amount` | `paid` 或 `released` |
| 创建免密签约 | `create` | `kind=agreement`、订单号、标题 | `order.status=active` |
| 免密扣款 | `debit` | 签约 `order_id`、`amount` | 查询新的支付订单 |
| 免密解约 | `revoke` | 签约 `order_id` | `order.status=revoked` |
| 退款 | `refund` | 支付 `order_id`、`amount` | 查询请求状态与累计退款 |
| 查询订单或操作 | `query` | `order_id` 或 `request_id` | 订单或请求记录 |
| 分账给玩家 | `split` | `rail`、`amount`、`user` | 查询请求状态 |
| 提现至玩家 | `payout` | `rail`、`amount`；可选 `user` | 查询请求状态 |
| 预付卡代激活 | `card_bind` | `number`、`secret`、`user` | `request.card.state=active` |
| 获取商户对账流水 | `statement` | 可选 `month`、`page` | `items`、`total`、分页 |

## 通用字段与响应

请求头使用 `Content-Type: application/json`、`X-Merchant-Id` 和 `X-Key-Id`。业务明文还需包括以下字段。

| 字段 | 要求 |
| --- | --- |
| `merchant`、`key_id` | 分别与请求头一致 |
| `environment` | `sandbox` 或 `live` |
| `timestamp` | Unix 秒，允许前后偏差 300 秒 |
| `challenge` | 每次重新生成，用于匹配响应，最长 100 字节 |
| `action` | 本页接口清单中的操作 |
| `request_id` | 除查询和对账外必填。同一商户、同一环境内用作幂等编号。最多 100 字节 |

金额单位是整数游戏单位，范围 1 至 2,000,000,000，`capture` 允许 0。`rail` 为 `vault` 或 `scoreboard`。`user` 为玩家面板显示的清算账号 ID。

成功响应的明文结构如下。操作示例中的响应只展示 `result`，省略回显及未用字段。

```json
{
  "ok": true,
  "result": {"request": {"request_id": "PAY-001", "status": "completed"}},
  "merchant": "商户号",
  "key_id": "API Key",
  "environment": "sandbox",
  "request_id": "PAY-001",
  "timestamp": 1794888000,
  "challenge": "本次请求的随机值"
}
```

`request.status=completed` 只表示该操作已完成。创建操作完成后，订单仍为 `pending`。异步请求以 `processing`、`completed` 或 `failed` 表示操作状态。超时或断线时，用原编号查询或保持原业务参数重试。每次重试更新 `timestamp` 和 `challenge`。

## 下单、预授权、签约

### 普通收银台 · create / pay

```json
{"action":"create","kind":"pay","request_id":"PAY-001","out_trade_no":"METRO-001","title":"地铁单程票","amount":25,"return_url":"https://merchant.example/orders/METRO-001"}
```

```json
{"request":{"status":"completed"},"order":{"id":"11111111111111111111111111111111","status":"pending","amount":25,"checkout_url":"https://cashier.example/checkout/11111111111111111111111111111111"}}
```

`out_trade_no`、`title` 必填，`user`、`return_url` 可选。商户订单号在同一商户和环境内唯一。传 `user` 时仅指定玩家可确认。回跳来源须先登记，交易信息可放在商户自己的回跳路径或查询参数中。待支付订单的有效期为 30 分钟。

### 创建预授权 · create / hold

```json
{"action":"create","kind":"hold","request_id":"HOLD-001","out_trade_no":"RESERVE-001","title":"预约冻结","amount":100}
```

```json
{"request":{"status":"completed"},"order":{"id":"22222222222222222222222222222222","status":"pending","amount":100,"checkout_url":"https://cashier.example/checkout/22222222222222222222222222222222"}}
```

玩家确认后，查询到 `held` 才表示冻结成功。预付卡支持组合支付时，可以用游戏钱包补差额。

### 预授权结算与解除 · capture

```json
{"action":"capture","request_id":"CAP-001","order_id":"22222222222222222222222222222222","amount":60}
```

```json
{"request":{"status":"processing","amount":60},"order":{"id":"22222222222222222222222222222222","status":"held","amount":100}}
```

上例结算 60，释放其余 40。全额解除传 `amount:0`，结束后订单为 `released`。全额结算传冻结金额，结束后为 `paid`。已释放或已结算的同一笔预授权无法再次结算。

### 免密签约 · create / agreement

```json
{"action":"create","kind":"agreement","request_id":"SIGN-001","out_trade_no":"AGREE-001","title":"公交免密协议"}
```

```json
{"request":{"status":"completed"},"order":{"id":"33333333333333333333333333333333","status":"pending","amount":0,"checkout_url":"https://cashier.example/checkout/33333333333333333333333333333333"}}
```

玩家进入签约页面，确认支付方式顺序。查询到 `active` 后可扣款。这里的订单 ID 就是签约 ID。

### 免密扣款 · debit

```json
{"action":"debit","request_id":"DEBIT-001","order_id":"33333333333333333333333333333333","amount":12}
```

```json
{"request":{"status":"processing","result_order":"44444444444444444444444444444444"},"order":{"id":"44444444444444444444444444444444","status":"processing","amount":12}}
```

使用返回的独立支付订单 ID 查询扣款或发起退款。后续扣款使用新的 `request_id`。玩家当前钱包与签约时不一致时，扣款返回 `AGREEMENT_INACTIVE`，需要重新签约。

### 免密解约 · revoke

```json
{"action":"revoke","request_id":"REVOKE-001","order_id":"33333333333333333333333333333333"}
```

```json
{"request":{"status":"completed"},"order":{"id":"33333333333333333333333333333333","status":"revoked"}}
```

仅可解约本商户、本环境的已生效或已解约协议。玩家也可在玩家面板解约。解约阻止新扣款，已受理的扣款继续清算。

## 退款、查询、分账与提现

### 退款 · refund

```json
{"action":"refund","request_id":"REF-001","order_id":"11111111111111111111111111111111","amount":5}
```

```json
{"request":{"status":"completed","amount":5},"order":{"id":"11111111111111111111111111111111","status":"paid","captured":25,"refunded":5}}
```

仅支持已付款订单，累计退款上限为实扣。退款走原支付来源。组合支付从末次使用的资金部分向前退款。清算期内从原订单的清算批次预留退款，清算到期后使用商户已清算可用余额。若返回 `processing`，轮询到 `completed` 后再确认退款成功。

### 查询 · query

按订单查交易状态，返回订单本身。

```json
{"action":"query","order_id":"11111111111111111111111111111111"}
```

```json
{"id":"11111111111111111111111111111111","status":"paid","amount":25,"captured":25,"refunded":5}
```

按请求编号查操作状态，返回 `request`，有相关订单时还返回 `order`。两项同时传入时优先查 `request_id`。

```json
{"action":"query","request_id":"REF-001"}
```

```json
{"request":{"action":"refund","request_id":"REF-001","status":"completed","amount":5},"order":{"status":"paid","refunded":5}}
```

### 分账 · split

```json
{"action":"split","request_id":"SPLIT-001","rail":"vault","amount":8,"user":"player-account-id"}
```

```json
{"request":{"action":"split","status":"processing","rail":"vault","amount":8,"user":"player-account-id"}}
```

### 提现 · payout

```json
{"action":"payout","request_id":"PAYOUT-001","rail":"scoreboard","amount":10,"user":"player-account-id"}
```

```json
{"request":{"action":"payout","status":"processing","rail":"scoreboard","amount":10,"user":"player-account-id"}}
```

提现未填 `user` 时转给超级管理员。正式提现与分账使用对应支付方式已到清算期的资金。请求处于 `processing` 时资金已预留。

## 预付卡与对账

### 预付卡代激活 · card_bind

```json
{"action":"card_bind","request_id":"BIND-001","number":"卡号","secret":"卡密","user":"player-account-id"}
```

```json
{"request":{"action":"card_bind","status":"completed","card":{"number":"卡号","state":"active","balance":100,"rail":"vault","env":"sandbox","owner":"player-account-id"}}}
```

商户仅可激活本商户发行且与请求环境一致的卡。卡密只能使用一次。平台发行的卡可由超级管理员后台绑定，或由持有卡密的玩家自行激活。

### 对账流水 · statement

```json
{"action":"statement","month":"2026-11","page":1}
```

```json
{"items":[{"id":"流水号","order_id":"订单号","out_trade_no":"METRO-001","merchant":"商户号","merchant_name":"轨道交通","env":"sandbox","event":"payment","amount":25,"rail":"vault","time":1794888000}],"total":1,"page":1,"page_size":50}
```

`month` 按北京时间，省略时查询全部。每页 50 条。付款流水金额为正，退款为负。`rail` 可出现 `card` 或组合名称。`legacy_refund` 表示升级前的累计退款，时间沿用旧订单时间。XLSX 下载入口在商户后台。

## 错误码

已认证的业务错误会签名返回，明文包括 `ok:false`、`code`、`error` 以及通用回显。验签、鉴权、报文格式或服务故障可返回普通 JSON，外形为 `{"code":"INVALID_ENVELOPE","error":"报文验签或解密失败"}`。以 `code` 做程序判断，`error` 用于展示。

下例为解密后的业务错误，HTTP 状态为 409。

```json
{
  "ok": false,
  "code": "AGREEMENT_INACTIVE",
  "error": "签约未生效或已解约",
  "merchant": "商户号",
  "key_id": "API Key",
  "environment": "sandbox",
  "request_id": "DEBIT-001",
  "challenge": "本次请求的随机值",
  "timestamp": 1794888000
}
```

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `INVALID_PARAMETER`、`RETURN_ORIGIN_DENIED` | 参数无效或回跳来源未登记 |
| 401 | `INVALID_CREDENTIALS`、`AUTHENTICATION_FAILED` | 商户头或密钥无效，或密钥已轮换 |
| 401 | `INVALID_ENVELOPE`、`INVALID_REQUEST_CONTEXT` | 报文验签或解密失败，或报文归属／时间戳无效 |
| 403 | `MERCHANT_NOT_APPROVED`、`PRODUCT_DISABLED`、`FORBIDDEN` | 审核、产品或权限限制 |
| 404 | `UNKNOWN_ACTION`、`ORDER_NOT_FOUND`、`REQUEST_NOT_FOUND`、`NOT_FOUND` | 操作、订单、请求或目标账号不存在 |
| 409 | `IDEMPOTENCY_CONFLICT`、`DUPLICATE_TRADE_NO` | 编号已使用，查询原请求或用新编号提交新业务 |
| 409 | `AGREEMENT_INACTIVE`、`INVALID_CAPTURE`、`INVALID_REFUND` | 协议或订单状态不符，或金额越界 |
| 409 | `OPERATION_IN_PROGRESS`、`CONFLICT` | 订单有未结束操作或其他状态冲突 |
| 409 | `MERCHANT_LIMIT_EXCEEDED`、`MERCHANT_FUNDS_UNAVAILABLE` | 收款限额已用尽或已清算资金不足 |
| 409 | `CARD_NOT_REDEEMABLE` | 卡密无效、卡已用或超出发行方／环境范围 |
| 415 | `UNSUPPORTED_BODY` | 正文类型不符或超过 128 KiB |
| 500、503 | `INTERNAL_ERROR`、`UNAVAILABLE` | 服务故障或系统尚未安装 |

异步失败的 HTTP 查询本身仍可成功。比如 `result.request.status=failed`，且 `result.request.failure=insufficient`。其他可能的资金执行原因包括 `unavailable`、`range`、`declined`、`reconciled_failure`。结果不确定时会保留处理中状态并进入平台人工复核。

## SM2/SM3 报文

1. 生成 32 字节随机 AES 密钥和 12 字节随机 IV。UTF-8 JSON 明文用 AES-256-GCM 加密，标签为 16 字节，AAD 是方向名。
2. 用接收方 SM2 公钥包裹 AES 密钥，输出 OpenSSL 兼容的 DER 序列 `(x INTEGER, y INTEGER, c3 OCTET STRING, c2 OCTET STRING)`。
3. 将包裹密钥、IV、标签、密文分别编码为标准 Base64，保存为 `key`、`iv`、`tag`、`data`。
4. 用 LF 拼接 `HTISW1`、方向名、`key`、`iv`、`tag`、`data`，末尾无换行。发送方用 SM2/SM3 对拼接串签名，SM2 ID 为 ASCII `1234567812345678`，DER 签名编码为 Base64 放入 `signature`。
5. 请求方向为 `merchant-request`，用商户私钥签名和平台公钥加密。响应方向为 `merchant-response`，用平台私钥签名和商户公钥加密。以登记的公钥验签，解密后核对回显与时间戳。

```sh
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:SM2 -out merchant-private.pem
openssl pkey -in merchant-private.pem -pubout -out merchant-public.pem
php backend/bin/merchant.php http://127.0.0.1:8787 MERCHANT_ID KEY_ID merchant-private.pem backend-public.pem sandbox request.json
```
