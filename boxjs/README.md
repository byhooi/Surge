# BoxJS 订阅配置说明

## 订阅地址

```text
https://raw.githubusercontent.com/byhooi/Surge/main/boxjs/byhooi.boxjs.json
```

在 BoxJS 中添加该订阅后，可以查看脚本写入的持久化数据、填写青龙面板配置、调整跳绳参数，并手动执行同步或清理脚本。

## 应用列表

| 应用 | ID | 主要 key | 说明 |
| --- | --- | --- | --- |
| 京东 Cookie 青龙同步 | `byhooi_jdcookie_ql` | `jdCookieList`、`ql_url`、`ql_client_id`、`ql_client_secret` | 手动同步 Cookie 到青龙 `JD_COOKIE` |
| 京东 WSKEY 青龙同步 | `byhooi_wskey_ql` | `wskeyList`、`ql_url`、`ql_client_id`、`ql_client_secret` | 手动同步 WSKEY 到青龙 `JD_WSCK` |
| 跳绳参数 | `byhooi_videourl_config` | `DEFAULT_REQUIRED_QUALIFIED_COUNT`、`QUALIFIED_THRESHOLD`、`EXCELLENT_THRESHOLD` | 配置 `VideoUrl.js` 判定阈值 |
| 跳绳日志 | `byhooi_videourl_logs` | `videourl_logs` | 查看最新一次跳绳统计日志 |
| 伴生活 Token 管理 | `bsh_token_manager` | `token` | 查看或手动修改 `bsh.js` 捕获的 Token |
| 途虎养车 Token 管理 | `tuhu_token_manager` | `tuhu_token` | 查看或手动修改 `tuhu.js` 捕获的 Token |
| Surge 通用重放模块 | `byhooi_surge` | `byhooi_surge_retry`、`@byhooi.record` | 配置并执行多账号请求重放 |

## 京东青龙同步

### 前置条件

1. 在 Surge 安装 `Module/jdcookie.sgmodule` 或 `Module/wskey.sgmodule`。
2. 在京东 App 中登录账号并触发对应请求，使脚本写入 `jdCookieList` 或 `wskeyList`。
3. 在青龙面板“系统设置 -> 应用设置”中新建应用，授予环境变量的查看、新增、更新权限。

### BoxJS 配置

在“京东 Cookie 青龙同步”或“京东 WSKEY 青龙同步”中填写：

| 配置项 | 示例 | 说明 |
| --- | --- | --- |
| 青龙面板地址 | `http://192.168.1.100:5700` | 不要遗漏协议和端口 |
| 青龙 Client ID | `xxxx` | 从青龙应用设置复制 |
| 青龙 Client Secret | `xxxx` | 从青龙应用设置复制 |
| Cookie/WSKEY 列表 | 自动写入 | 通常不要手动改 JSON 结构 |

填写后点击“同步 Cookie 到青龙”或“同步 WSKEY 到青龙”。脚本会自动获取并缓存青龙 Token，过期后重新登录。

### 青龙变量格式

| 类型 | 变量名 | 变量值 |
| --- | --- | --- |
| Cookie | `JD_COOKIE` | `pt_key=xxx;pt_pin=xxx;` |
| WSKEY | `JD_WSCK` | `pin=用户名; wskey=xxxxx;` |

同步脚本会按用户标识判断新增、更新或跳过，避免重复写入。

## 跳绳参数与日志

`VideoUrl.js` 会读取以下配置：

| key | 默认值 | 说明 |
| --- | --- | --- |
| `DEFAULT_REQUIRED_QUALIFIED_COUNT` | `3` | 达成多少次合格视为通过 |
| `QUALIFIED_THRESHOLD` | `195` | 一分钟跳绳数达到该值计为合格 |
| `EXCELLENT_THRESHOLD` | `200` | 一分钟跳绳数达到该值计为优秀 |

安装 `Module/VideoUrl.sgmodule` 后，访问跳绳记录页面即可触发分析。最新结果会写入 `videourl_logs`，并显示在“跳绳日志”应用中。

## Token 管理

`bsh.js` 会将伴生活 Token 写入 `token`，`tuhu.js` 会将途虎 Token 写入 `tuhu_token`。如果脚本自动捕获失败，可以在 BoxJS 中手动粘贴最新 Token；不要把这些值提交到仓库或公开日志。

## Surge 通用重放模块

“Surge 通用重放模块”用于执行 `Script/surgeRecordMulti.js`。常见流程：

1. 通过对应模块或脚本抓取请求记录，保存到 `@byhooi.record`。
2. 在 BoxJS 的 `ckName` 中填写需要重放的记录名。
3. 点击“手动执行多账号重放”。

脚本支持多账号、重试次数、间隔和响应路径提取等参数。修改记录数据前先备份，避免 JSON 结构损坏导致重放失败。

## 发票功能说明

京东和美团发票模块不依赖 BoxJS 应用，数据写入 Surge 持久化存储，并通过本地接口供快捷指令读取：

```text
http://jd.invoice.local/get
http://jd.invoice.local/clear
http://meituan.invoice.local/get
http://meituan.invoice.local/clear
```

安装 `Module/jd_invoice.sgmodule` 或 `Module/meituan_invoice.sgmodule` 后，打开对应发票页面即可捕获链接。通知会尝试唤起“批量保存京东发票”或“批量保存美团发票”快捷指令。

## 排查建议

- BoxJS 没有数据：先确认 Surge 模块已启用，并检查 MITM 域名是否生效。
- 青龙同步失败：检查面板地址、应用权限、Client ID 和 Client Secret。
- JSON 列表异常：优先使用清空按钮重置，不要手动删除部分括号或引号。
- 远程脚本未更新：在 Surge 中手动更新模块，或等待 GitHub raw/CDN 缓存刷新。
