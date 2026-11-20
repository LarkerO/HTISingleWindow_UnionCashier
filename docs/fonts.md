# 全局字体与流量

原完整面板、接口文档页、移动钱包使用同一份 `shared/fonts.css`，字体顺序为 `D-DIN → HarmonyOS Sans SC → HarmonyOS Sans → sans-serif`。Lobe UI 的 `--lobe-font-family`、Tailwind 的 `--font-sans` 和原生表单控件同步使用该顺序；代码块保留其等宽字体。

## 字体来源

| 字体 | npm 包及固定版本 | 引入方式 |
| --- | --- | --- |
| D-DIN | `@sarap422/font-d-din@1.0.6`，包内字体为 D-DIN-PRO，声明 OFL-1.1 | 直接引用 npm CDN 的 WOFF2，以 CSS 家族名 `D-DIN` 使用；选择 400、500、600、700 四个字重 |
| HarmonyOS Sans SC | Lobe Assets 的 `@lobehub/webfont-harmony-sans-sc-mini@1.0.1` | 页面引用官方 `css/index.css`，以 `unicode-range` 按页面字符加载 WOFF2 分片 |

D-DIN 的四个 WOFF2 文件分别为 9,944、9,940、10,032、10,472 字节，合计约 39.4 KiB，浏览器只下载实际使用的字重。限定拉丁字符、数字和常用标点范围，中文由鸿蒙字体补齐。使用原始字面大小，不引入该包默认的 `size-adjust` 调整。

原 HarmonyOS Sans SC 完整版单个 400／500／700 字重的 WOFF2 分别约 4.16／4.23／4.27 MiB。Mini 将字体分片，单片约 1–59 KiB；实际流量随页面字符和字重变化，不能将整个 npm 包大小当作每次页面下载量。分片 CSS 本身也有体积，CDN 应保留 gzip／Brotli 传输压缩。

两个前端及文档页使用相同的固定版本 CDN URL，可复用同一来源下的浏览器缓存。`font-display: swap` 保证字体未完成下载时正文仍可显示。不预加载全部字重或中文分片，不使用 TTF、WOFF 回退，不将字体包手动复制到仓库或构建目录。页面 CSP 已允许 `https://cdn.jsdelivr.net` 的样式与字体。

核对时发现 `typeface-d-din@1.1.13` 只有 CSS 与许可文本，缺少 CSS 引用的字体文件，因此未采用；`@fontsource/d-din` 当前不存在。升级字体版本前应重新核实真实 WOFF2 文件、授权和字符覆盖。

来源：[D-DIN npm 包](https://www.npmjs.com/package/@sarap422/font-d-din)、[Lobe Assets 字体说明](https://github.com/lobehub/lobe-assets#-webfonts)、[D-DIN 原始字体说明与 OFL](https://github.com/amcchord/datto-d-din)。
