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
| request_id | 除 query、statement 外的操作的幂等编号。同一商户、同一环境内，重试需保持业务参数一致 |

| 操作 | 业务字段 |
| --- | --- |
| create | `kind` 为 `pay`、`hold`、`agreement`，`out_trade_no` 为商户订单号，`title` 为收银台标题。pay/hold 必填 `amount`。可选 `user` 和 `return_url`。 |
| query | `order_id` 或 `request_id`。两者同时提供时取 `request_id`。 |
| capture | `order_id` 和 `amount`。0 为全额解除，大于 0 为实际结算金额，剩余部分退回原支付方式。 |
| debit | 签约 `order_id` 和 `amount`，返回供退款和查询用的独立支付订单。 |
| refund | 已支付的 `order_id` 和 `amount`，允许多次部分退款，累计不超过实际扣款。 |
| split | `user`、`rail` 和 `amount`。向该玩家转账。 |
| card_bind | `number`、`secret`、`user`。激活本商户发行且与请求环境一致的预付卡。 |
| statement | 可传 `month`（YYYY-MM）和 `page`（从 1 开始）。返回当前商户、当前环境的收款及退款流水。 |
| payout | `rail` 和 `amount`。可传 `user` 提现到指定玩家，留空使用超级管理员。正式提现与分账只可使用已清算的资金。 |

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


## 预付卡与混合支付

预付卡兑付使用购卡时的 Vault 或计分板资金来源，商户按对应来源收到可清算款项。收银台确认、预授权和免密签约由玩家选择使用顺序。卡内余额不足且卡种支持组合时，卡余额先冻结，所选游戏方式补足剩余金额。游戏方式最终失败会解除卡余额冻结。部分结算优先使用已冻结的卡余额，未扣部分按原来源释放。退款先退最近使用的资金部分，再退前面的部分，避免同一来源超额退款。

代绑定输入示例：

```json
{"action":"card_bind","request_id":"activate-001","number":"卡号","secret":"卡密","user":"清算账号 ID"}
```

卡密只能使用一次。商户 API 只能激活本商户发行的卡，平台发行卡由超级管理员或持有卡密的玩家激活。买卡和退卡状态在玩家面板查询。

## 交易对账

`{"action":"statement","month":"2026-11","page":1}` 查询指定月份。省略 month 则查询全部月份。结果含 `items`、`total`、`page`、`page_size`，每页 50 条。每条记录有 `id`（流水号）、`order_id`、`out_trade_no`、`merchant`、`merchant_name`、`rail`、`time`（Unix 秒）、`event` 和有符号的 `amount`。付款为正数，退款为负数。旧版已累计的退款以 `legacy_refund` 展示，时间沿用原订单时间。

## 限额和清算周期

支付方式限额包括玩家每单实际由该方式承担的金额和每月支付笔数，正式与沙箱分别计数。商户限额包括单笔金额、每月累计金额和每月笔数，待支付订单在有效期内占用额度。清算态或冻结态的订单按确认时所在月份计入额度。已支付扣款按交易总额计入，退款保留原月销售记录。

正式交易使用超级管理员为商户指定的清算规则。D+0 即时可用。T+0 按北京时间工作日即时可用，周末顺延至下一个工作日。T+1 / T+2 自交易工作日起再加一个 / 两个工作日。当前工作日定义为周一至周五。书面规则变更用于之后入账的款项。沙箱余额即时可用。
