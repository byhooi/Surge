# Surge 脚本与模块集合

> 面向 Surge 的 HTTP 拦截、数据提取、签到、发票捕获和 BoxJS 配置集合。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Surge-orange.svg)](https://nssurge.com/)

## 项目简介

本仓库维护一组 Surge 模块、JavaScript 脚本、BoxJS 订阅和分流规则。常见用途包括：

- 京东 WSKEY/Cookie 获取，并手动同步到青龙面板
- 京东和美团发票链接捕获，供快捷指令批量保存
- 跳绳记录分析和 BoxJS 阈值配置
- 伴生活、途虎等服务的 Token 捕获和签到
- 菜鸟、CamScanner、GitHub 429、Google 搜索等功能模块
- 富途/Moomoo 的 Surge 与 Clash 分流规则

基础流程：`Surge 模块拦截请求 -> Script 脚本处理数据 -> $persistentStore 持久化 -> BoxJS 查看或手动执行脚本`。

## 快速开始

### 1. 添加 BoxJS 订阅

```text
https://raw.githubusercontent.com/byhooi/Surge/main/boxjs/byhooi.boxjs.json
```

BoxJS 主要用于查看保存的数据、配置青龙参数、调整跳绳阈值，以及手动执行同步/清理脚本。详细说明见 [boxjs/README.md](boxjs/README.md)。

### 2. 安装 Surge 模块

在 Surge 中添加所需模块，例如：

```text
https://raw.githubusercontent.com/byhooi/Surge/main/Module/wskey.sgmodule
https://raw.githubusercontent.com/byhooi/Surge/main/Module/jdcookie.sgmodule
https://raw.githubusercontent.com/byhooi/Surge/main/Module/jd_invoice.sgmodule
https://raw.githubusercontent.com/byhooi/Surge/main/Module/meituan_invoice.sgmodule
https://raw.githubusercontent.com/byhooi/Surge/main/Module/VideoUrl.sgmodule
```

安装后按模块要求开启 MITM，并确认 `[MITM] hostname` 中的域名已生效。

### 3. 配置青龙面板（可选）

如需同步京东变量到青龙：

1. 在青龙面板进入“系统设置 -> 应用设置”。
2. 创建应用并授予环境变量的查看、新增、更新权限。
3. 复制 `Client ID` 和 `Client Secret`。
4. 在 BoxJS 的“京东 Cookie 青龙同步”或“京东 WSKEY 青龙同步”中填写配置。
5. 获取 Cookie/WSKEY 后，在 BoxJS 点击同步按钮。

## 主要模块

| 功能 | 模块 | 脚本 | 说明 |
| --- | --- | --- | --- |
| 京东 WSKEY | `Module/wskey.sgmodule` | `Script/wskey.js` | 捕获 `pt_pin` 和 `wskey` |
| 京东 Cookie | `Module/jdcookie.sgmodule` | `Script/jdcookie.js` | 捕获 `pt_key` 和 `pt_pin` |
| 青龙同步 | BoxJS 手动脚本 | `Script/wskey_ql_sync.js`、`Script/jdcookie_ql_sync.js` | 写入 `JD_WSCK`、`JD_COOKIE` |
| 京东发票 | `Module/jd_invoice.sgmodule` | `Script/jd_invoice*.js` | 捕获 PDF 链接，提供本地读取/清空 API |
| 美团发票 | `Module/meituan_invoice.sgmodule` | `Script/meituan_invoice*.js` | 捕获 PNG 链接，提供本地读取/清空 API |
| 跳绳统计 | `Module/VideoUrl.sgmodule` | `Script/VideoUrl.js` | 分析记录、推送结果、写入日志 |
| 途虎养车 | `Module/tuhu.sgmodule` | `Script/tuhu.js` | Token 捕获和定时签到 |
| 通用重放 | BoxJS 应用 | `Script/surgeRecordMulti.js` | 多账号请求重放 |

发票快捷指令可读取以下本地接口：

```text
http://jd.invoice.local/get
http://jd.invoice.local/clear
http://meituan.invoice.local/get
http://meituan.invoice.local/clear
```

## 目录结构

```text
.
├── Module/                 # Surge 模块文件
├── Script/                 # Surge/BoxJS JavaScript 脚本
├── boxjs/                  # BoxJS 订阅和使用说明
├── Rule/                   # Surge/Clash 分流规则
├── icon/                   # BoxJS 图标资源
├── AGENTS.md               # 贡献者指南
└── CLAUDE.md               # 历史开发说明
```

各目录下的 `Backup/` 是旧版本或备用文件，日常维护优先修改根目录下的当前文件。

## 本地开发与验证

本项目没有构建流程。常用检查命令：

```bash
git status
git diff
rg "SCRIPT_VERSION|CACHE_KEY" Script
node --check Script/jdcookie.js
```

`node --check` 只能做语法检查。实际功能仍需在 Surge 中通过本地文件路径或 GitHub raw 链接验证，包括拦截规则、MITM 域名、通知、BoxJS 写入和青龙同步结果。

## 开发约定

- 新增功能通常同时维护 `Module/*.sgmodule` 与 `Script/*.js`。
- `.sgmodule` 的 `script-path` 使用 `https://raw.githubusercontent.com/byhooi/Surge/main/Script/...`。
- 需要请求或响应体时显式设置 `requires-body=1` 和合适的 `max-size`。
- 涉及持久化时使用稳定的 key，例如 `jdCookieList`、`wskeyList`、`meituan_invoices_batch`。
- 不要在日志、通知或提交中暴露 Cookie、WSKEY、Token、青龙密钥或真实用户数据。

## 提交规范

提交信息建议使用：

```bash
git commit -m "feat: 添加京东发票提取模块"
git commit -m "fix: 修复 WSKEY 同步判断"
git commit -m "docs: 更新 BoxJS 使用说明"
```

常用前缀：`feat:`、`fix:`、`docs:`、`refactor:`、`chore:`。

## 许可与声明

本项目采用 MIT License。脚本仅供学习和个人自动化使用，请遵守相关服务条款并自行承担使用风险。
