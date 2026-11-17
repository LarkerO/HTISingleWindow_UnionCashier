# 部署及运维

## 运行环境

| 部件 | 要求 |
| --- | --- |
| 前端构建 | Node.js 20.19+ 或 22.12+、pnpm 10.34.9 |
| 后台 | 64 位 PHP 8.2+、Composer、支持 SM2/SM3 的 OpenSSL 3 CLI |
| PHP 扩展 | curl、mbstring、openssl、zip、PDO 和所选数据库的 PDO 驱动。Linux 另需 pcntl、posix |
| 插件构建 | JDK 17+、Maven |
| 数据库 | 安装可选 SQLite、MySQL 或 PostgreSQL。Redis 可选，用于浏览器会话 |

## 安装后台

安装 pnpm 后，从仓库根目录运行以下命令。已安装 Corepack 时，可先运行 `corepack enable pnpm`。

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm build
cd ../backend
composer install --no-dev
php start.php setup-token
```

Windows 使用 `php start.php`。若 OpenSSL 不在 PATH，先在 PowerShell 指定它的位置。

```powershell
$env:CASHIER_OPENSSL = 'C:\Program Files\Git\usr\bin\openssl.exe'
php start.php
```

Linux 前台运行 `php start.php start`，后台运行 `php start.php start -d`。

| 环境变量 | 默认 |
| --- | --- |
| `CASHIER_HTTP_LISTEN` | `127.0.0.1:8787` |
| `CASHIER_WS_LISTEN` | `127.0.0.1:8788` |
| `CASHIER_RUNTIME_DIR` | `backend/runtime/`，自定义时请使用独占的绝对路径 |
| `CASHIER_OPENSSL` | `openssl` |

1. 在 Portal 创建 OAuth2 客户端，开通 `profile`，登记 `<清算网站地址>/oauth/callback`。
2. 打开 `/install`，输入命令生成的安装口令。选择 SQLite 即可创建本地库。使用 MySQL 或 PostgreSQL 时先建空库并授予建表、建索引和读写权限。
3. 输入 Portal 客户端配置，完成登录测试。该账号成为超级管理员。授权返回后，第三步显示 Portal 登录与平台 SM2 密钥生成结果。失败时可在同一步查看原因并重新授权。
4. 如果使用反向代理，HTTP 指向 8787，WebSocket upgrade 指向 8788。公网优先使用 HTTPS/WSS，专网和本机可以直接用 HTTP/WS。

开发和正式部署共用同一份程序。各实例应使用独立运行时目录、数据库和密钥。前端构建产物由 Webman 同源提供。

## 配对 Minecraft 插件

```sh
mvn -f plugin/pom.xml clean package
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:SM2 -out plugin-private.pem
openssl pkey -in plugin-private.pem -pubout -out plugin-public.pem
```

1. 将 `plugin/target/ecashier-0.1.0.jar` 放入游戏服务器的 `plugins/`，首次启动后会创建插件目录和默认配置。
2. 在清算系统管理页登记 `plugin-public.pem`。从站内接口文档复制平台公钥，保存为 `backend-public.pem`。
3. 将 `plugin-private.pem` 和 `backend-public.pem` 放在 `plugins/UnionCashier/`。修改 `config.yml` 的 WebSocket 地址，重启并在系统面板查看在线状态。
4. Vault 方式需要可用的 Economy Provider。配置项 `vault.provider` 可指定提供者。计分板方式默认使用 `city_balance`，可在插件配置启用自动创建，或者执行 `/scoreboard objectives add city_balance dummy`。

插件以 Spigot 1.18.2 API 和 Java 17 为基线。部署时使用目标服务器要求的 Java。Vault、EssentialsX 或 XConomy 版本也需与该服务端对应。游戏服务器应验证玩家身份，或使用已验证的代理转发 UUID。计分板使用 Bukkit 当前玩家名，改名后需按服务器规则迁移旧计分。

## 升级、备份和排查

- 升级前停止新交易，检查待清算和人工复核队列。保存数据库、运行时配置与卡面、平台与插件密钥，以及游戏服务器上的经济数据和 `economy-journal.log`。
- 升级后重新构建前端并重启后台。曾使用旧版游戏绑定码的玩家需要重新登录，从 Portal 获取已验证的档案 UUID。
- 插件处于离线时，检查网络地址、代理 upgrade、公私钥是否配套、游戏和后端时钟及 Vault Provider。
- Portal 回调提示 TLS 或 cURL 60 时，检查运行 Webman 的 PHP。Windows 上支持系统证书库的 cURL 会自动使用该库；其他环境可在 PHP 配置中设置 `curl.cainfo` 指向受信任的 PEM 证书包。重启后台后重新发起授权。
- 用户可登录但游戏钱包不可用时，检查 Portal 上的 Minecraft 绑定和公开档案权限。主档案应已通过验证。
- 资金操作显示处理中且长期无回执时，从系统管理的人工复核入口核对插件日志和游戏余额。确认实际扣款或增款后再完成复核。
- 一套账本配一个权威游戏插件。迁移实例时一并迁移插件持久化流水，避免同一资金指令在两个环境各执行一次。

## 验收

```sh
php backend/tests/clearing.php
mvn -f plugin/pom.xml clean package
```

部署后用独立商户测试查询余额、普通支付、预授权解冻、商户和玩家解约、部分退款、组合支付、T+2 可提现余额及对账导出。新部署的目标环境使用 [功能清单](features.md) 中的待验收项。
