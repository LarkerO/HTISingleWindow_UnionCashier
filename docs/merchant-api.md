# 商户开放接口

商户管理员登记三项信息：商户的 SM2 公钥、浏览器回跳来源、商户成员权限。平台生成 API Key 标识，私钥由商户自行保管。覆盖公钥会轮换 API Key。配置正式能力由超级管理员审核。

## 请求

向 `POST /open/v1` 发送 JSON，头部设置 `Content-Type: application/json`、`X-Merchant-Id` 和 `X-Key-Id`。正文是加密并签名的信封。以下字段在解密后的 JSON 中：

| 字段 | 说明 |
| --- | --- |
| merchant | 商户号，须和请求头相同 |
| key_id | API Key，须和请求头相同 |
| environment | `sandbox` 或 `live` |
| timestamp | Unix 时间，整数秒。请求有效窗口为当前时间前后 300 秒 |
| challenge | 每次请求的随机值，用于绑定响应 |
| action | 下表中的操作 |
| request_id | 除 query 外所有操作的幂等编号。同一商户、同一环境内，重试需保持业务参数一致 |

| 操作 | 业务字段 |
| --- | --- |
| create | `kind` 为 `pay`、`hold`、`agreement`，`out_trade_no` 为商户订单号，`title` 为收银台标题。pay/hold 必填 `amount`。可选 `user` 和 `return_url`。 |
| query | `order_id` 或 `request_id`。两者同时提供时取 `request_id`。 |
| capture | `order_id` 和 `amount`。0 为全额解除，大于 0 为实际结算金额，剩余部分退回原支付方式。 |
| debit | 签约 `order_id` 和 `amount`，返回供退款和查询用的独立支付订单。 |
| refund | 已支付的 `order_id` 和 `amount`，允许多次部分退款，累计不超过实际扣款。 |
| split | `user`、`rail` 和 `amount`。向该玩家转账。 |
| payout | `rail` 和 `amount`。清算给超级管理员的游戏钱包。 |

字段 `amount` 使用 1 至 2,000,000,000 的整数，capture 允许 0。字段 `rail` 使用 `vault` 或 `scoreboard`。字段 `user` 使用 Portal 登录后玩家面板中显示的清算账号 ID。指定 `user` 的收银台仅允许对应 Portal 账号确认。商户订单号在同一商户和环境中唯一。使用已登记的回跳来源，允许同一来源下任意路径，商户可在 URL 查询参数里附带自有订单号。

## 加密与验签

1. 生成 32 字节随机密钥和 12 字节随机 IV。对 UTF-8 JSON 明文做 AES-256-GCM 加密，标签为 16 字节，使用方向名称作为 AAD。
2. 用接收方 SM2 公钥包裹 AES 密钥。OpenSSL CLI 可使用 `pkeyutl -encrypt -pubin -inkey PUBLIC`，输出为 DER 序列 `(x INTEGER, y INTEGER, c3 OCTET STRING, c2 OCTET STRING)`。
3. 对包裹后的密钥、IV、标签和密文分别做标准 Base64，作为 `key`、`iv`、`tag`、`data`。
4. 用 LF 拼接 `HTISW1`、方向名称、`key`、`iv`、`tag`、`data`，末尾无 LF。使用发送方 SM2 私钥签名，摘要算法 SM3，签名标识使用 ASCII `1234567812345678`，DER 签名的 Base64 放入 `signature`。
5. 请求用方向名 `merchant-request`，由商户签名、平台解密。响应的方向名是 `merchant-response`，由平台签名、商户解密。

创建和对接示例：

```sh
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:SM2 -out merchant-private.pem
openssl pkey -in merchant-private.pem -pubout -out merchant-public.pem
php backend/bin/merchant.php http://127.0.0.1:8787 MERCHANT_ID KEY_ID merchant-private.pem backend-public.pem sandbox request.json
```

输入文件 `request.json`：

```json
{
  "action": "create",
  "kind": "pay",
  "request_id": "metro-request-001",
  "out_trade_no": "metro-ticket-001",
  "title": "地铁单程票",
  "amount": 25,
  "return_url": "https://merchant.example/orders/metro-ticket-001"
}
```

接口返回经认证的响应包含 `ok` 布尔值、`result` 或 `error`，并回显 `merchant`、`key_id`、`environment`、`request_id`、`challenge`、`timestamp`。先验签再解密，再核对回显和时间戳。鉴权、报文或系统故障可能返回普通错误 JSON，商户可记录错误原因并用同一编号查询或重试。

创建订单后把玩家重定向到 `result.order.checkout_url`。浏览器回跳是导航，验签确认商户查询结果后再发放服务。通过 `order_id` 查询直接返回订单，使用 `request_id` 查询返回操作对应的 `request` 和可能存在的 `order`。资金写入操作可能返回 `processing`，应轮询至 `completed` 或 `failed`。状态 `held` 代表冻结已完成，`paid` 代表已确认实扣，`active` 代表免密签约成功。
