# BoxJS 订阅配置说明

## 订阅地址

```text
https://raw.githubusercontent.com/byhooi/Surge/main/boxjs/byhooi.boxjs.json
```

在 BoxJS 中添加该订阅后，可以查看脚本写入的持久化数据、填写青龙面板配置、调整跳绳参数，并手动执行同步或清理脚本。

## 应用列表

| 应用 | ID | 主要 key | 说明 |
| --- | --- | --- | --- |
| 京东 Cookie 青龙同步 | `byhooi_jdcookie_ql` | `auto_sync_jdcookie_ql`、`jdCookieList`、`ql_url`、`ql_client_id`、`ql_client_secret` | 自动/手动同步 Cookie 到青龙 `JD_COOKIE` |
| 京东 WSKEY 青龙同步 | `byhooi_wskey_ql` | `wskeyList`、`ql_url`、`ql_client_id`、`ql_client_secret` | 手动同步 WSKEY 到青龙 `JD_WSCK` |
| 跳绳参数 | `byhooi_videourl_config` | `DEFAULT_REQUIRED_QUALIFIED_COUNT`、`QUALIFIED_THRESHOLD`、`EXCELLENT_THRESHOLD` | 配置 `VideoUrl.js` 判定阈值 |
| 跳绳日志 | `byhooi_videourl_logs` | `videourl_logs` | 查看最新一次跳绳统计日志 |
| 伴生活 Token 管理 | `bsh_token_manager` | `token` | 查看或手动修改 `bsh.js` 捕获的 Token |
| 途虎养车 Token 管理 | `tuhu_token_manager` | `tuhu_token` | 查看或手动修改 `tuhu.js` 捕获的 Token |
| 龙岗图书馆多账号签到 | `byhooi_lggov_sign` | `byhooi_lggov_accounts`、`byhooi_lggov_lock` | 查看/停用读者证账号、手动签到和续期；见 [使用说明](../docs/lggov_sign.md) |
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
| 自动同步到青龙 | 开启 | 开启后抓取到新 Cookie 自动同步到青龙（默认开启） |
| 青龙面板地址 | `http://192.168.1.100:5700` | 不要遗漏协议和端口 |
| 青龙 Client ID | `xxxx` | 从青龙应用设置复制 |
| 青龙 Client Secret | `xxxx` | 从青龙应用设置复制 |
| Cookie/WSKEY 列表 | 自动写入 | 通常不要手动改 JSON 结构 |

填写青龙信息后，获取到新 Cookie 时将自动触发同步（亦可点击下方按钮手动执行同步）。脚本会自动获取并缓存青龙 Token，过期后重新获取。

### Cookie 自动同步与通知

- 采集与同步分别去重：新 Cookie 写入 `jdCookieList` 后发送采集通知；相同账号、相同 Cookie 已成功同步到同一青龙地址和 Client ID 后，不会因高频请求或时间流逝重复同步、通知。
- 失败后保留待同步状态，在后续京东请求触发时重试，间隔为 1、2、4、8 分钟，之后最多每 15 分钟一次；不是后台定时任务。相同 Cookie 的连续失败只提醒一次，恢复成功再提醒一次。
- 关闭自动同步时只采集；重新开启后，未成功同步的 Cookie 可继续同步。升级到 `jdcookie.js v1.10.1` 后，旧数据没有新同步状态，首次再次抓取时会补同步一次。
- Cookie 更新或青龙地址、Client ID 改变时重新同步。仅轮换 Client Secret 不会主动重同步已有成功记录。需要强制检查、恢复被删除或禁用的青龙变量时，使用 BoxJS 的“同步 Cookie 到青龙”。手动入口不受自动同步状态限制，也不更新自动同步状态，因此之后可能还有一次自动核对。
- 自动同步每次请求最多等待 4 秒，整轮网络流程共用 12 秒预算，连同去重等待通常不超过 13 秒，早于模块的 30 秒超时。超时后忽略迟到回调，不再发起后续写入；已发送的 HTTP 请求无法保证在服务端撤销。
- 自动同步状态保存在 `jd_cookie_sync_state`，按账号隔离，进行中的任务使用 20 秒租约防止重复发起。清空 Cookie 时同时清除新旧同步状态；清空操作不会删除青龙变量。不要公开导出状态，其中包含用于比较的 Cookie。

通知和脚本日志隐藏 `pt_key`、青龙 Token 与 Client Secret；BoxJS 存储和实际同步请求仍保留完整凭证。需要复制 Cookie 时请从受控的 BoxJS 页面获取，不再从通知获取。

### 青龙变量格式

| 类型 | 变量名 | 变量值 |
| --- | --- | --- |
| Cookie | `JD_COOKIE` | `pt_key=xxx;pt_pin=xxx;` |
| WSKEY | `JD_WSCK` | `pin=用户名; wskey=xxxxx;` |

同步脚本会按用户标识判断新增、更新或跳过，避免重复写入。

Cookie 的自动与手动入口都只匹配 `JD_COOKIE`：优先精确比较变量值中的 `pt_pin`（兼容 `pin` 和 URL 编码）。只有变量值缺少账号字段时，才接受完整账号备注或 `账号 - 说明` 形式；备注包含用户名片段不再算匹配，备注也不能覆盖值中不同的账号。已有错误备注建议修正；历史重复变量需在青龙中人工核对，脚本不会自动合并或删除。

### Cookie 本地验证与实机验收

在仓库根目录执行：

```bash
node --check Script/jdcookie.js
node --check Script/jdcookie_ql_sync.js
node --check Script/jdcookie_clear.js
node --test tests/jdcookie.test.cjs
```

测试使用虚构凭证、模拟 Surge 存储/HTTP 和虚拟时钟，不连接真实账号或面板。覆盖账号匹配、新增/更新/跳过、失败退避、并发去重、超时、清空和脱敏，但不能替代以下实机验收：

1. 用测试账号确认新 Cookie 只同步一次，持续使用京东超过一分钟仍无重复同步通知；另一个账号不受影响。
2. 临时断开测试面板，在 Cookie 更新后确认首次失败通知；保持失败并触发后续请求，确认没有重复通知；恢复连接后等待退避到期，再触发请求确认同步成功。
3. 用互为前缀的账号、无备注变量验证只更新正确 ID；值相同但禁用的变量通过手动同步重新启用。不要拿真实账号做覆盖测试。
4. 确认慢请求会在模块超时前收尾，普通/调试日志与系统通知均不出现完整凭证。清空后重新采集应再次同步，已有青龙变量不被清空操作删除。

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
