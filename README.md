# 氢气工艺服务器·交通信息单一窗口 | 统一支付清算

面向 Minecraft 虚拟城市的交通支付清算。HydCraft Portal 提供唯一的登录和账号入口，Webman 管理交易与商户账本，Bukkit 插件通过 Vault 或主计分板读写游戏余额。

## 快速启动

需要 PHP 8.2+、Composer、支持 SM2/SM3 的 OpenSSL 3 CLI、Node.js 20.19+ 或 22.12+、npm。PHP 需启用 curl、mbstring、openssl、zip、PDO 和所用的 PDO 驱动。Linux 还需 pcntl 和 posix。建议使用 64 位 PHP。

从仓库根目录执行：

```sh
cd frontend
npm ci
npm run build
cd ../backend
composer install --no-dev
php start.php setup-token
```

Windows 使用 PowerShell 时：

```powershell
# OpenSSL 不在 PATH 时指定可执行文件。
$env:CASHIER_OPENSSL = 'C:\Program Files\Git\usr\bin\openssl.exe'
php start.php
```

Linux 使用 `php start.php start`，后台运行使用 `php start.php start -d`。HTTP 默认监听 `127.0.0.1:8787`，WebSocket 默认监听 `127.0.0.1:8788`。跨机器部署时可分别设置 `CASHIER_HTTP_LISTEN` 和 `CASHIER_WS_LISTEN`。也可设置 `CASHIER_RUNTIME_DIR` 为该实例独占的绝对路径。前端构建输出至 `backend/public/`，Webman 一起提供页面与 API。

1. 在 HydCraft Portal 的 OAuth 客户端管理中创建客户端，开通 `profile`，登记 `<本系统公开地址>/oauth/callback`。用于验证的 Portal 应实现 `/oauth/authorize`、`/api/oauth/token` 和 `/api/oauth/userinfo`。
2. 打开 [安装向导](http://127.0.0.1:8787/install)，输入安装口令并选择数据库。SQLite 无需另建数据库。使用 MySQL 或 PostgreSQL 时，先创建空库并赋予应用用户建表、建索引和读写权限。可选 Redis 为浏览器会话提供后端存储，交易账本使用 SQL。
3. 输入 OAuth Client ID / Secret，完成 Portal 登录测试。首位通过测试的账号成为超级管理员。安装完成时创建平台 SM2 密钥，并测试 SM2 加解密与 SM3 签名流程。
4. 完成后端和插件配对，在「系统管理」登记插件 SM2 公钥。登录后自动从 Portal 的公开 Minecraft 档案同步主账号 UUID。玩家需要在 Portal 绑定账号并允许公开 Minecraft 档案。升级后，使用过旧绑定码的玩家需重新登录以同步 Portal UUID。

开发与正式部署运行同一套交易代码。每次安装使用自己的数据库和密钥。商户交易使用 `sandbox` 或 `live`，沙箱余额及账本与正式余额隔离。HTTP 和 `ws://` 可直接运行，适合本地或可信专网。公网部署使用 HTTPS 和 WSS 反向代理以保护浏览器会话及 Portal OAuth 往返。反向代理需要将 WebSocket upgrade 转发到 8788 端口，浏览器流量转发到 8787。

## Minecraft 插件

插件包名 `cn.bg7qvu.htisw.ecashier`。使用 Maven 和 JDK 17+ 构建：

```sh
mvn -f plugin/pom.xml clean package
```

将 `plugin/target/ecashier-0.1.0.jar` 放入服务器 `plugins/`。插件以 Spigot 1.18.2 API 编译、Java 17 为字节码目标，依赖 Bukkit API。用各服务器版本要求的 Java 运行，1.21.1 的 Paper/Spigot 使用 Java 21。Vault 轨道需要安装适配服务器版本的 Vault 及已注册的 Economy Provider，如 EssentialsX 或 XConomy。参考目录的具体插件版本需分别核对与目标服务器版本的兼容性。

生成插件密钥并登记其公钥：

```sh
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:SM2 -out plugin-private.pem
openssl pkey -in plugin-private.pem -pubout -out plugin-public.pem
```

将 `plugin-private.pem` 和平台公钥 `backend-public.pem` 放入 `plugins/UnionCashier/`。平台公钥在站内「接口文档」显示。首次启用会生成 `config.yml`。修改 WebSocket 地址、计分板 objective 和可选 Vault provider 名称后重启。默认计分板 objective 为 `city_balance`，可设 `create-objective: true` 或手动用 `/scoreboard objectives add city_balance dummy` 创建。计分按 Bukkit 当前玩家名读取主计分板，玩家改名时需按服务器的计分规则迁移旧条目。Vault 账户须由所选经济插件建立。游戏服务器应采用正版验证，或使用受信任且已配置校验的代理转发玩家 UUID。

## 清算规则

- 正式资金按 Vault 和计分板分账记账，交易金额使用整数游戏单位，各支付方式独立。预授权和免密扣款可按顺序尝试支付方式，单笔扣款由一种方式全额承担。
- 预授权先从玩家余额扣入托管，解除时实扣金额可为 0 到冻结金额，差额返还原支付方式。冻结和退款流水未完成时可按请求编号查询状态。
- 免密签约由玩家确认，解约后拒绝新的扣款，已经提交的资金指令会继续处理。交易和签约链接在创建后 30 分钟内可确认。
- 退款从商户对应支付方式余额退回原玩家。分账将商户对应余额转给指定已绑定玩家，提现可指定已同步的玩家，留空转给超级管理员。
- 保护并备份 `backend/runtime/`、SQL 账本和插件的 `economy-journal.log`。部署一个清算实例和一个权威游戏插件。切换游戏端前，应停服核对处理中任务并保留流水，避免同一个指令由不同游戏实例分别执行。
- 游戏端在资金调用前持久化请求编号，调用完成后持久化回执。崩溃或长时间失联导致状态无法判定时，管理员根据当时的 Vault、计分板和插件流水，在系统面板确认是否执行。游戏经济插件与 SQL 账本各自提交事务，需通过该流程核对跨系统结果。

## 预付卡和对账

- 超级管理员可发行平台卡并配置商户名单。已审核商户可发行仅供本店使用的预付卡。购卡时保存面值、折扣、转让与退卡条款。商户名单、可支付场景、限额和组合支付规则始终采用卡种的当前设置。
- 折扣差额按支付方式从发行方可用资金预留。平台管理员可为补贴金充值。卡内余额由购卡付款和发行方补贴共同支持。
- 可转让预付卡按卡种设置扣除游戏单位手续费。退卡退款按剩余面值所对应的实付金额折算，再乘退卡比例、扣退卡手续费。商户退回原卡的资金仍可由卡片当前持有人使用。
- 玩家和商户可下载 XLSX。商户也可调用验签开放接口拉取逐笔记录。XLSX 导出由 PHP ZipArchive 生成。
- 商户正式收款按 D+0、T+0、T+1 或 T+2 清算。可提现余额显示在商户面板。T 使用北京时间周一至周五，暂未接入法定节假日日历。

[商户开放接口](docs/merchant-api.md) · [HydCraft Portal](https://github.com/Hydroline/hydcraft-portal) · [Webman](https://www.workerman.net/doc/webman/) · [Lobe UI](https://ui.lobehub.com/)

界面使用 HarmonyOS Sans 字体，版权归华为终端有限公司。字体通过 Lobe Assets 的 HarmonyOS Sans SC Webfont 加载。
