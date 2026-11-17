# 项目协作约定

## 工程边界

- 项目全称为「氢气工艺服务器·交通信息单一窗口 | 统一支付清算」。前端页头使用项目 Logo。
- 插件包名固定为 `cn.bg7qvu.htisw.ecashier`。以 Bukkit／Spigot 1.18.2 API 和 Java 17 为基线，兼容性变动需复核 1.21.1 及更新版本的 Spigot／Paper。Vault 通过 Economy 接入 EssentialsX 或 XConomy。计分板是独立支付方式。保留支付方式扩展能力。
- 后台使用 Webman，支持 Windows、Linux、HTTP／WebSocket 和 HTTPS／WSS 代理部署。开发与正式环境使用相同业务代码。正式交易和沙箱账本隔离。支持 SQLite、MySQL、PostgreSQL，Redis 可用于会话。
- 通过 `/install` 配置数据库、验证 Portal OAuth2、生成 SM2 密钥。首位安装登录者为超级管理员。仅通过 HydCraft Portal 注册和登录，使用 OAuth2 PKCE S256。用 OAuth 身份查 Portal 玩家档案、同步已验证 Minecraft UUID，遵守 Portal 隐私设置。
- React 前端使用 `@lobehub/ui`，新增组件先核对 [Lobe UI 组件说明](https://ui.lobehub.com/skills.md)。适配宽屏和窄屏。HarmonyOS Sans 使用 [Lobe Assets](https://github.com/lobehub/lobe-assets) Webfont。清理手动下载的字体包和 TTF。页脚与项目正文保持简洁。

## 业务与接口

- 支持收银台、预授权冻结与全额解除或部分结算、免密签约／扣款／解约、退款、分账和提现。预授权和免密支持支付方式顺序。退款和释放沿原支付来源办理。
- 商户与 Portal 用户多对多，每个商户至少一位管理员。超级管理员审核、配置产品、收款限额及清算规则。商户管理员管理成员与 API 密钥，支持沙箱和正式调试。
- 超级管理员发行平台预付卡并控制商户名单。商户发行仅限本店使用的预付卡。卡种支持场景、限额、组合支付、转让、折扣、退卡政策、默认或上传卡面。卡支持玩家凭卡密激活、后台绑定与商户 API 绑定。激活、资金使用、退款分别记录。
- 玩家可设置支付方式限额；超级管理员可设置商户单笔及月度收款限额。正式提现、分账受商户 D+0、T+0、T+1、T+2 规则约束。玩家与商户可下载 XLSX，商户可使用签名 API 拉取对账记录。
- 商户 API 和插件 WebSocket 使用 SM2/SM3 加密验签。变更资金路径时检查幂等、并发、异步回执丢失、冻结释放、清算资金可用性及旧数据兼容。
- 对外文档列全公开操作，逐项写明请求、响应、错误码、同步或异步结果。前端「接口文档」读取同一份 Markdown。内部接口、部署、账本及功能清单各自维护。

## Git

- 提交遵循 Conventional Commits，标题格式固定为 `type(scope): 中文描述`。正文使用中文。
- 忽略 `reference/`、`.reference/`、密钥、环境配置、依赖、构建产物和运行时数据。保留项目需要的 Logo。
- 远端为 `LarkerO/HTISingleWindow_UnionCashier`，交付分支为 `main`。提交前核对暂存内容和相关验证；交付时核对远程分支提交。
