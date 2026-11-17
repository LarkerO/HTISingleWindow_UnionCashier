import { Button, Flexbox, Text } from '@lobehub/ui';
import { PageTitle, Panel } from './shared';

const example = {
  merchant: '<商户号>', key_id: '<API Key>', environment: 'sandbox', timestamp: 0, challenge: '<本次请求随机值>',
  action: 'create', request_id: 'request-001', out_trade_no: 'trip-001', kind: 'pay', title: '公交车票',
  amount: 25, return_url: 'https://merchant.example/orders/trip-001',
};

const endpoints = [
  ['create', '创建收银台', 'kind 为 pay、hold 或 agreement。提供 request_id、out_trade_no、title。pay 和 hold 需要 amount。可选 user 和 return_url。'],
  ['query', '查询结果', '提供 order_id 或 request_id。收到浏览器回跳后，以验签后的查询结果为准。'],
  ['capture', '解除或结算预授权', '提供 order_id、request_id、amount。0 全额解除，全部冻结金额表示全额扣款。'],
  ['debit', '免密扣款', '提供签约 order_id、request_id、amount。返回本次支付的独立订单 ID。'],
  ['refund', '退款', '提供已支付 order_id、request_id、amount。支持多次部分退款，累计不可超过实扣。'],
  ['split', '分账给玩家', '提供 request_id、rail、user、amount。扣减商户在该支付方式的余额并转给玩家。'],
  ['payout', '提现', '提供 request_id、rail、amount。按所选支付方式转给超级管理员的已绑定玩家。'],
];

export default function Docs({ publicKey }) {
  return <>
    <PageTitle title="开放接口文档" description="接入商户收银台、查询结算结果和发起后续资金操作。" />
    <Panel title="认证与环境">
      <Text as="p"><Text as="span" code>POST /open/v1</Text> · Content-Type 为 application/json</Text>
      <Text as="p">请求头使用 X-Merchant-Id 与 X-Key-Id。请求明文也包含 merchant、key_id、environment、timestamp、challenge。environment 使用 sandbox 或 live，timestamp 为 Unix 秒，允许偏差 300 秒。challenge 使用每次请求新生成的随机值。</Text>
      <Text as="p">商户管理员登记自己的 SM2 公钥。接口请求使用商户私钥签名、平台公钥加密。响应使用平台私钥签名、商户公钥加密。保存平台公钥并核对响应中的 challenge、merchant、key_id、environment、request_id 和时间戳。</Text>
      {publicKey && <Text as="pre" code className="code">{publicKey}</Text>}
    </Panel>
    <Panel title="报文格式">
      <Text as="p">报文 JSON 字段是 key、iv、tag、data、signature，全部采用标准 Base64。随机 32 字节 AES 密钥由 SM2 公钥包裹，使用 OpenSSL 兼容 DER 格式。明文使用 AES-256-GCM、12 字节随机 IV 和 16 字节标签加密。</Text>
      <Text as="p">AAD 为方向名的 ASCII 字节，请求为 merchant-request，响应为 merchant-response。签名算法为 SM2/SM3，标识为 1234567812345678，签名为 DER 格式。</Text>
      <Text as="pre" code className="code">{['HTISW1', '<方向名>', '<key Base64>', '<iv Base64>', '<tag Base64>', '<data Base64>'].join('\n')}</Text>
      <Text as="p">签名输入是上述内容使用 LF 拼接的字节串，末尾无换行。</Text>
    </Panel>
    <Panel title="交易接口" subtitle="金额为整数，rail 为 vault 或 scoreboard，user 为玩家面板展示的清算账号 ID。">
      {endpoints.map(([action, label, description]) => <Flexbox className="record" gap={5} key={action}>
        <Text as="strong">{label} · {action}</Text><Text className="muted">{description}</Text>
      </Flexbox>)}
    </Panel>
    <Panel title="下单明文示例">
      <Text as="pre" code className="code">{JSON.stringify(example, null, 2)}</Text>
      <Text as="p">成功返回 ok 和 result。创建后把玩家送到 result.order.checkout_url。资金操作可能返回 processing，按 request_id 查询到 completed 或 failed。重试保持 request_id 和业务参数一致，并重新生成时间戳和 challenge。</Text>
      <Flexbox horizontal><Button href="https://github.com/LarkerO/HTISingleWindow_UnionCashier/blob/main/docs/merchant-api.md">查看完整字段与示例</Button></Flexbox>
    </Panel>
  </>;
}
