![Transit Information Single Window](https://larkerw-1256088996.cos.ap-shanghai.myqcloud.com/TISW_Title.png)
![Project title](/docs/title.png)
# 氢气工艺服务器·交通信息单一窗口 | 统一支付清算

面向 Minecraft 虚拟城市的交通支付清算。玩家通过 HydCraft Portal 登录，在收银台使用 Vault、计分板或预付卡。商户通过签名 API 下单、退款、管理签约和获取对账流水。

## 快速开始

1. 在 `frontend/` 运行 `npm ci` 和 `npm run build`。
2. 在 `backend/` 运行 `composer install --no-dev` 和 `php start.php setup-token`。
3. Windows 运行 `php start.php`。Linux 运行 `php start.php start`。
4. 打开 [本地安装向导](http://127.0.0.1:8787/install)，配置数据库和 Portal OAuth 客户端。
5. 用 `mvn -f plugin/pom.xml clean package` 构建插件，并按部署指南登记游戏端公钥。

## 文档

| 文档 | 内容 |
| --- | --- |
| [功能清单与原需求核对](docs/features.md) | 分模块功能、实现情况和待验收项 |
| [部署及运维](docs/deployment.md) | 安装、插件配对、升级、备份、排查 |
| [清算业务规则](docs/clearing.md) | 资金从下单到清算的状态、预付卡、限额与对账 |
| [商户开放接口](docs/merchant-api.md) | 全部签名接口、请求、响应和错误码，也可在站内查看 |
| [站内和游戏端接口](docs/internal-api.md) | OAuth、浏览器 API、插件 WebSocket |
| [协作约定](AGENTS.md) | 仓库技术要求与提交规范 |
