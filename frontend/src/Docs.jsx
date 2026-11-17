import { Markdown, Text } from '@lobehub/ui';
import guide from '../../docs/merchant-api.md?raw';
import { PageTitle, Panel } from './shared';

const components = { pre: ({ children }) => <Text as="pre" className="code">{children}</Text> };

export default function Docs({ publicKey }) {
  return <>
    <PageTitle title="开放接口文档" description="接入收银台、预付卡、对账单与资金操作。" />
    {publicKey && <Panel title="平台 SM2 公钥"><Text as="pre" code className="code">{publicKey}</Text></Panel>}
    <Panel className="documentation"><Markdown components={components} enableLatex={false} enableMermaid={false} enableStream={false}>{guide.replace(/^# [^\r\n]+\r?\n(?:\r?\n)*/, '')}</Markdown></Panel>
  </>;
}
