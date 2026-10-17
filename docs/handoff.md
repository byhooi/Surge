# 交接文档（Handoff）

> 更新于 2026-10-17。面向接手本仓库的下一位维护者（人或 AI 会话），说明当前状态、最近工作脉络与待办。
>
> 延伸阅读：[CLAUDE.md](../CLAUDE.md)（项目总览与开发规范）、[AGENTS.md](../AGENTS.md)（仓库指南）、[boxjs/README.md](../boxjs/README.md)（用户文档）、[docs/lggov_sign.md](lggov_sign.md)（龙岗图书馆专项，改动前必读）。

## 一句话现状

`main` 分支干净且已推送到 `origin/main`，无未提交改动、无其他分支。最近的开发集中在京东 Cookie 脚本（`jdcookie`）的自动同步重构：v1.10.0 曾在真机翻车被回滚，随后以 v1.10.1 重新实现并补齐 38 项自动化测试（当前全部通过）。**实机验收尚未执行，是第一优先待办**。

## 最近工作脉络：jdcookie 自动同步

时间线集中在 2026-10-07 一天内：

| 提交 | 内容 |
| --- | --- |
| `c6ad5e4` | v1.9.3 引入"抓取后自动同步到青龙" |
| `52312fb` | v1.9.4 支持 PUT、自动同步失败通知 |
| `d6a5926` | v1.9.5 错误日志与响应结构优化 |
| `b9343b5` / `fff41ec` | v1.10.0：每次请求尝试同步 + 时间窗口去重 |
| `8226569` | **回滚至 v1.9.5**，撤销 v1.10.0 与 fff41ec |
| `7d3bc73` | 重新实现为 **v1.10.1**（提交信息仅 "fix"），带完整测试与文档 |

### v1.10.0 为什么失败（重要教训）

`mars.jd.com/log/sdk/v2` 是京东的高频日志上报接口，拦截规则会对**每一次**请求运行脚本。v1.10.0 的"每次请求都尝试同步 + 时间窗口去重"在该频率下失效：同步通知每 60 秒重复弹出，同步失败时每 10 秒一次。教训是：在这个高频入口上，任何"每请求都做某事"的逻辑都必须有持久化的、按账号隔离的状态机兜底，不能依赖内存或短时间窗口。

### v1.10.1 设计要点（当前线上版本）

- **采集与同步状态分离**：`$.cookieChanged` 决定是否写盘和发采集通知；同步独立走 `runAutoSync()`，Cookie 未变化但同步失败时仍可重试。
- **同步状态机**：持久化在 `jd_cookie_sync_state`，按 `pin:<URL编码账号>` 隔离。字段含 `cookie`、`target`（青龙地址 + Client ID）、`status`、`token`、`failures`、`nextRetryAt`、`failureNotified`。
- **并发防护**：进行中的任务写 20 秒租约（`SYNC_LEASE_TIME`），换租约用随机 token 校验，迟到的回调不能再写入。
- **退避重试**：失败后 1、2、4、8 分钟，之后封顶每 15 分钟一次（`SYNC_RETRY_BASE` / `SYNC_RETRY_MAX`），由后续京东请求触发，不是后台定时任务。
- **失败通知去重**：相同 Cookie 连续失败只提醒一次，恢复成功后重新武装。
- **时间预算**：单次请求最长 4 秒（`DEFAULT_TIMEOUT`），整轮网络流程共用 12 秒预算（`SYNC_TOTAL_BUDGET`），早于模块的 30 秒超时；超时后忽略迟到回调，不再发起后续写入。
- **凭证脱敏**：`redactSecrets()` 处理所有日志和通知（实际 secret 值、`pt_key=`/`wskey=`/`client_secret=`、`Bearer`、JSON 凭证字段）；BoxJS 存储和实际 HTTP 请求仍用原值。
- **精确账号匹配**：`findQLEnv()` 优先精确比较变量值中的 `pt_pin`（兼容 `pin` 与 URL 编码），仅当值缺少账号字段时才接受完整备注或 `账号 - 说明` 备注。修复了"互为前缀的账号"与"备注包含用户名即匹配"的误匹配；备注不能覆盖值中不同的账号。
- **查询方式**：改为 `searchValue=JD_COOKIE` 拉取全集后本地过滤，避免服务器搜索漏掉编码形式不同的 `pt_pin`。

### 配套改动（同一提交）

- `Script/jdcookie_ql_sync.js` → v1.8.7：同步账号匹配与脱敏逻辑；值未变化但被禁用的变量会重新启用。
- `Script/jdcookie_clear.js`：清空时同时清除 `jd_cookie_sync_state` 与旧的 `jd_cookie_sync_lock`；不删除青龙变量。
- `tests/jdcookie.test.cjs`（新增）：38 项测试，模拟 Surge 存储/HTTP 与虚拟时钟，覆盖账号匹配、新增/更新/跳过、失败退避、并发去重、超时预算、清空、脱敏等，不连接真实账号或面板。
- `boxjs/README.md`：新增"Cookie 自动同步与通知"与"Cookie 本地验证与实机验收"章节。

## 待办事项

### P0：实机验收（尚未执行）

自动化测试不能替代真机验证，`boxjs/README.md` 已列出验收步骤，按顺序执行：

1. 用测试账号确认新 Cookie 只同步一次；持续使用京东超过一分钟无重复同步通知；另一个账号不受影响。
2. 临时断开测试面板：Cookie 更新后确认首次失败通知；保持失败触发后续请求，确认不重复通知；恢复连接、等退避到期后再触发请求，确认同步成功。
3. 用互为前缀的账号、无备注变量验证只更新正确 ID；值相同但禁用的变量通过手动同步重新启用。不要拿真实账号做覆盖测试。
4. 确认慢请求在模块超时前收尾；普通/调试日志与系统通知均不出现完整凭证；清空后重新采集可再次同步，已有青龙变量不被清空操作删除。

### 若验收发现问题

优先检查 `jd_cookie_sync_state` 的租约与 `nextRetryAt` 逻辑；不要退回"时间窗口去重"方案（v1.10.0 已证明在 `mars.jd.com` 高频请求下不可行）。修复后同步更新测试与 `boxjs/README.md`。

### 升级注意事项

- 升级到 v1.10.1 后旧数据没有新同步状态，首次再次抓取时会补同步一次，属预期行为。
- 仅轮换 Client Secret 不会触发重同步；需要强制核对时用 BoxJS 的"同步 Cookie 到青龙"按钮。

## 验证命令

```bash
node --check Script/jdcookie.js
node --check Script/jdcookie_ql_sync.js
node --check Script/jdcookie_clear.js
node --test tests/jdcookie.test.cjs
```

测试于 2026-10-17 复跑：38 项全部通过（`pass 38 / fail 0`）。

## 关键文件索引

| 文件 | 作用 |
| --- | --- |
| `Script/jdcookie.js` | 采集 + 自动同步主逻辑（v1.10.1） |
| `Script/jdcookie_ql_sync.js` | BoxJS 手动同步入口（v1.8.7） |
| `Script/jdcookie_clear.js` | 清空本地 Cookie 与同步状态 |
| `tests/jdcookie.test.cjs` | 自动化测试（38 项） |
| `Module/jdcookie.sgmodule` | 拦截 `mars.jd.com/log/sdk/v2`，timeout=30 |
| `boxjs/byhooi.boxjs.json` | BoxJS 订阅定义（应用 `byhooi_jdcookie_ql`） |
| `boxjs/README.md` | 用户文档 + 实机验收步骤 |

## 通用注意事项

- **发布流程**：所有脚本经 GitHub raw 引用，修改必须 push 后才生效；Surge 有 CDN 缓存，约 5 分钟刷新，可手动更新模块强制刷新。
- **不要提交凭证**：Cookie、WSKEY、青龙 Client ID/Secret、Token 一律不入库、不进日志；`jd_cookie_sync_state` 含用于比较的 Cookie，不要公开导出。
- **不要编辑生成文件**：`Script/lggov_refresh.js` 由 `node scripts/build-lggov-refresh.cjs` 生成，业务逻辑只改 `Script/lggov_sign.js`，改动前先读 `docs/lggov_sign.md`。
- **Backup/ 目录**仅作历史备份，不是维护目标。
- 提交信息用中文，格式 `feat:` / `fix:` / `docs:` / `refactor:` / `chore:`。

## 仓库其他部分状态

除 jdcookie 外，其余模块（wskey、发票、跳绳、龙岗图书馆、途虎、通用重放等）在本次交接窗口内无未完成工作，功能与文档保持上次提交时的状态。龙岗图书馆模块有独立的测试（`node --test tests/lggov_sign.test.cjs`）与专项文档。
