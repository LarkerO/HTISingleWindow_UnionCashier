import { createRoot } from 'react-dom/client';
import { A, ConfigProvider, Flexbox, Image, Markdown, Text } from '@lobehub/ui';
import { Braces } from 'lucide-react';
import { motion } from 'motion/react';
import '@lobehub/ui/theme.css';
import '@lobehub/ui/style.css';
import './styles.css';
import guide from '../../docs/merchant-api.md?raw';
import { Feedback, Loading, PageTitle, Panel, useLoad } from './shared';
import WorkspacePage from './WorkspacePage';

const sections = guide.replace(/\r\n/g, '\n').split(/^## /m).slice(1).map(section => {
  const end = section.indexOf('\n');
  return { title: section.slice(0, end), body: section.slice(end).trim() };
});
const operations = [];
const common = new Map();
const groups = new Map();
for (const { title, body } of sections) {
  const marker = /^<!-- operation: ([a-z-]+) \/ (.+) -->\n+/.exec(body);
  if (marker) {
    const [prefix, id, group] = marker;
    const operation = { id, title, body: body.slice(prefix.length) };
    operations.push(operation);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(operation);
  } else common.set(title, body);
}
const navigation = Array.from(groups, ([group, links]) => [group, links.map(({ id, title }) =>
  [id, title, '/docs/' + id, Braces])]);

function operationBody(operation) {
  const commonRows = title => common.get(title).split('\n').slice(2).filter(line => line.startsWith('| ')).join('\n');
  return operation.body
    .replace(/\n\n请求还需包含 \[通用请求参数\]\(#通用请求参数\)\。/, () => '\n' + commonRows('通用请求参数'))
    .replace(/\n\n响应外层见 \[通用响应参数\]\(#通用响应参数\)\。字段“是否必给”按成功业务响应说明。/, () =>
      '\n' + commonRows('通用响应参数') + '\n\n' + common.get('通用响应参数').split('\n\n').at(-1))
    .replace(/### 错误码表\n\n([\s\S]*)$/, (_, specific) => {
      const rows = specific.split('\n').slice(2).filter(line => line.startsWith('| ')).join('\n');
      const [table, notes] = common.get('通用错误码').split('\n\n');
      return '### 错误码表\n\n' + table + (rows ? '\n' + rows : '') + '\n\n' + notes;
    })
    .replace('[SM2/SM3 报文](#sm2sm3-报文)', '下方 SM2/SM3 报文规范')
    .replace('\n\n### 请求参数说明表', () => '\n\n#### SM2/SM3 报文\n\n' + common.get('SM2/SM3 报文') + '\n\n### 请求参数说明表');
}

const components = { pre: ({ children }) => <Text as="pre" className="code">{children}</Text> };

function Docs() {
  const slug = location.pathname.split('/').filter(Boolean)[1];
  const operation = slug ? operations.find(({ id }) => id === slug) : operations[0];
  const publicKey = useLoad('platform-key');
  return <>
    <Flexbox as="header" className="masthead">
      <Flexbox horizontal align="center" gap={16} className="shell docs-masthead">
        <A className="brand" href="/docs" aria-label="开放接口文档首页">
          <Image className="brand-logo" preview={false} src="/logo.png" alt="" width={380} height={48} />
        </A>
        <A className="docs-return" href="/">清算首页</A>
      </Flexbox>
    </Flexbox>
    <Flexbox as="main" className="shell content docs-content">
      <WorkspacePage groups={navigation} page={operation?.id} title="开放接口栏目">
        {operation ? <>
          <PageTitle title={operation.title} description="商户开放接口 · POST /open/v1" />
          <Panel className="documentation">
            <Markdown components={components} enableLatex={false} enableMermaid={false} enableStream={false}>
              {operationBody(operation)}
            </Markdown>
          </Panel>
          <Panel title="平台 SM2 公钥">
            {publicKey.data?.public_key ? <Text as="pre" code className="code">{publicKey.data.public_key}</Text>
              : publicKey.error ? <Feedback error={publicKey.error} />
                : publicKey.data ? <Text>平台尚未生成公钥。</Text> : <Loading />}
          </Panel>
        </> : <Panel title="接口文档不存在"><A href="/docs">返回接口文档首页</A></Panel>}
      </WorkspacePage>
    </Flexbox>
  </>;
}

createRoot(document.getElementById('root')).render(
  <ConfigProvider motion={motion} locale="zh-CN" enableCustomFonts={false}><Docs /></ConfigProvider>,
);
