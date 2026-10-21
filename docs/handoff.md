# 交接文档（Handoff）

> 更新于 2026-10-21。面向接手本仓库的下一位维护者（人或 AI 会话），说明当前状态、最近工作脉络与待办。
>
> 延伸阅读：[CLAUDE.md](../CLAUDE.md)（项目总览与开发规范）、[AGENTS.md](../AGENTS.md)（仓库指南）、[boxjs/README.md](../boxjs/README.md)（用户文档）、[docs/naixue_sign.md](naixue_sign.md)（奈雪签到专项，改动前必读）、[docs/lggov_sign.md](lggov_sign.md)（龙岗图书馆专项，改动前必读）。

## 一句话现状

`main` 分支最近一次提交是规则更新（`01cf86b`）。当前**有未提交改动**：新增奈雪点单自动签到模块（模块 + 脚本 + 测试 + 专项文档 + BoxJS 应用 + README 一行），自动化测试 8 项全部通过，**但尚未 commit、未 push、未实机验收**。第一优先待办是提交并实机验证奈雪签到；其次仍是 jdcookie v1.10.1 的实机验收。

## 最近工作脉络：奈雪点单自动签到（本次新增，未提交）

起点是仓库根目录的 `1.har`（已被 `.gitignore` 忽略，`*.har` 不入库），其中只有一条抓包：奈雪点单小程序的 `POST https://tm-web.pin-dao.cn/user/sign/save`。

### 逆向过程与结论

1. HAR 请求体结构：`{"common":{...,"nonce","timestamp","signature"},"params":{...,"signDate","brand","storeId",...}}`，`Authorization: Bearer <accessToken>` 在请求头。
2. 直接重放整包 → 服务端返回 `time is 1792568358 is is expired`，说明**不能重放抓包**（时间戳很快过期）。
3. 从 `https://tm-web.pin-dao.cn/naixue/sign-in` 的 HTML 里取出 webpack chunk 映射，逐个下载 516 个分包，在 `static/js/1.<hash>.chunk.js` 的模块 `548` 中找到签名实现：

   ```text
   message   = encodeURI("nonce=<nonce>&openId=<openId>&timestamp=<timestamp>")
   signature = Base64(HMAC-SHA1(message, key))
   key       = brand ∈ {26000252, 26000254} && version >= 4.2 && platform === "wxapp"
                 ? 奈雪 key : 默认 key
   ```

   `openId` 与两个 key 都是小程序前端硬编码常量（明文出现在分包里），不是账号凭证。
4. 用 HAR 的 `nonce=542658` / `timestamp=1792568358` 复现签名，得到与 HAR 完全相同的 `J3RMo4c0LUuZ7VXKfoNIC+lqmQA=`。
5. 真实接口联调（假 token）：
   - 新时间戳 + 正确签名 → `{"code":1500000,"message":"用户未登录，请登录！"}`，即**签名通过、仅 token 失效**；
   - 新时间戳 + 错误签名 → HTTP 400 `request sign ... is not valid`；
   - 两者对比证明签名算法已完全还原，剩余未知只有真实 token 的响应体。

### 设计要点

- **抓取与签分离**：`http-request` 只负责保存 `Authorization` 里的 token、`common`、`params`（品牌/门店/城市）、`User-Agent`/`Referer`；定时任务用当天日期重算 `signDate`、随机 `nonce`、当前 `timestamp` 和签名后直接调用签到接口。
- **只存必要字段**：Cookie、`sensorsdata` 埋点等一律不落盘；日志中 token 只显示首尾各 4 位（`maskToken`）。
- **`signDate` 每次重算**，按北京时间（`Date.now() + 8h` 后取 UTC 日期），不沿用抓包历史值；抓取时会从 `params` 中删除 `signDate`。
- **纯 JS 密码学**：脚本内自带 SHA-1 / HMAC-SHA1 / Base64 实现，不依赖 `crypto`、`Buffer`、`atob`，保证 Surge 与 Node 测试环境行为一致（测试里有一条断言防止回退到 `require`/`Buffer`）。
- **结果判定**：`code === 0` → 成功（附 `data.infos` 说明）；`message` 命中 `已签到` → 今日已签到；`code === 1500000` / 401 / 403 / 提示未登录 → 提示重新抓取；HTTP 400 → 提示签名不匹配；无 token / 无 `brand` → 不发请求直接给操作指引。
- **key 可覆盖**：`byhooi_naixue_sign_key` 非空时优先使用，用于服务端更换 key 时应急，无需改脚本。
- **抓取 pattern**：`^https:\/\/tm-web\.pin-dao\.cn\/(?:user|naixue|chayuan|coupon)\/`（前缀匹配，`requires-body=1`）。已验证不会误命中 `evil.com`、`tm-web.pin-dao.cn.evil.com`。
- **状态结构**（`byhooi_naixue_state`）：`token`、`common`、`params`、`headers`、`capturedAt`、`version`、`lastResult`、`lastSignDate`、`lastRunAt`。

### 本次改动文件

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `Script/naixue_sign.js` | 新增 | v1.0.0，抓取 + 定时签到 + 签名实现 |
| `Module/naixue_sign.sgmodule` | 新增 | 默认每日 9:15 签到，参数化“定时签到 / 禁用抓取 / 禁用MITM” |
| `tests/naixue_sign.test.cjs` | 新增 | 8 项测试，vm 沙箱模拟 Surge 存储/HTTP/通知，含 HAR 签名回归断言 |
| `docs/naixue_sign.md` | 新增 | 算法说明、安装步骤、结果判定表、BoxJS key、已知限制 |
| `boxjs/byhooi.boxjs.json` | 修改 | 新增应用 `byhooi_naixue_sign`（凭证 textarea + key 覆盖 + 手动签到脚本） |
| `README.md` | 修改 | 模块表新增“奈雪点单”一行 |

## 待办事项

### P0：提交与发布

1. 检查 `git status`，确认只提交上述 6 个文件，**不要提交 `1.har`**（`.gitignore` 已含 `*.har`，但注意它仍在工作区）。
2. 建议提交信息：`feat: 添加奈雪点单自动签到模块`。
3. push 后再实机安装模块；未 push 前 `raw.githubusercontent.com` 上的 `script-path` 仍是 404，模块会静默不工作。

### P0：奈雪实机验收（尚未执行）

自动化测试只能覆盖本地逻辑，`code 0` 与“已签到”两种真实响应无法构造，必须真机确认：

1. 安装模块、开 MITM、信任证书，确认 `tm-web.pin-dao.cn` 被解密。
2. 微信打开奈雪点单小程序进入“我的 - 签到”，确认收到“已获取 accessToken”；再进一次确认**不重复通知**。
3. Surge 手动运行“奈雪点单签到”，确认返回 `code 0` 或“已签到”，且通知里 token 只显示部分字符。
4. 次日检查定时任务是否成功；换一个门店/城市后重抓，确认收到“已更新签到参数”而非 token 通知。
5. 若提示 `request sign ... is not valid`：说明前端换了 key，用 BoxJS 的 `byhooi_naixue_sign_key` 覆盖，并把新 key 写回 `SIGN_KEY_NAIXUE` / `SIGN_KEY_DEFAULT`（注意前端还有“默认 key”分支，非奈雪品牌走那条）。

### P1：jdcookie v1.10.1 实机验收（延续上次交接，仍未执行）

按 [boxjs/README.md](../boxjs/README.md) 的“Cookie 自动同步与通知”“Cookie 本地验证与实机验收”执行，重点：新 Cookie 只同步一次、失败退避不重复通知、互为前缀账号只更新正确 ID、通知与日志不出现完整凭证。**不要退回 v1.10.0 的“时间窗口去重”方案**（在 `mars.jd.com` 高频入口已证明不可行），优先检查 `jd_cookie_sync_state` 的租约与 `nextRetryAt`。

## 验证命令

```bash
# 奈雪
node --check Script/naixue_sign.js
node --test tests/naixue_sign.test.cjs        # 期望 8 passed / 0 failed

# 签名回归（同 nonce/timestamp 应等于 HAR 签名）
node -e "
const fs=require('fs'),crypto=require('crypto');
const src=fs.readFileSync('Script/naixue_sign.js','utf8');
const key=src.split('\n').find(l=>l.startsWith('const SIGN_KEY_NAIXUE =')).split('\"')[1];
const msg=encodeURI('nonce=542658&openId=QL6ZOftGzbziPlZwfiXM&timestamp=1792568358');
console.log(crypto.createHmac('sha1',key).update(msg).digest('base64'));
// 期望输出 J3RMo4c0LUuZ7VXKfoNIC+lqmQA=
"

# 其他模块
node --test tests/lggov_sign.test.cjs
node --test tests/jdcookie.test.cjs
```

2026-10-21 复跑：奈雪 8 项通过；另在 Node 里用真实接口跑过一遍脚本（假 token），签名被服务端接受，仅返回“用户未登录”，与预期一致。

## 关键文件索引

| 文件 | 作用 |
| --- | --- |
| `Script/naixue_sign.js` | 奈雪抓取 + 签到 + 签名实现（v1.0.0） |
| `Module/naixue_sign.sgmodule` | 抓取 pattern 与每日 9:15 定时任务 |
| `tests/naixue_sign.test.cjs` | 8 项自动化测试 |
| `docs/naixue_sign.md` | 奈雪专项文档 |
| `Script/jdcookie.js` | 京东 Cookie 采集 + 自动同步（v1.10.1） |
| `Script/lggov_sign.js` | 龙岗图书馆多账号签到（`lggov_refresh.js` 由其生成） |
| `boxjs/byhooi.boxjs.json` | BoxJS 订阅定义（新增 `byhooi_naixue_sign`） |

## 通用注意事项

- **发布流程**：所有脚本经 GitHub raw 引用，修改必须 push 后才生效；Surge 有 CDN 缓存，约 5 分钟刷新，可手动更新模块强制刷新。
- **不要提交凭证**：Cookie、WSKEY、青龙 Client ID/Secret、accessToken 一律不入库、不进日志。`byhooi_naixue_state` 与 `jd_cookie_sync_state` 含凭证，不要公开导出。奈雪脚本里的 `openId` 与两个签名 key 是小程序前端公开常量，不属于凭证，可以留在源码里。
- **不要编辑生成文件**：`Script/lggov_refresh.js` 由 `node scripts/build-lggov-refresh.cjs` 生成，业务逻辑只改 `Script/lggov_sign.js`，改动前先读 `docs/lggov_sign.md`。
- **`Backup/` 目录**仅作历史备份，不是维护目标。`Module/Backup/naixue.sgmodule` 是旧的第三方脚本（gist 混淆版），本次新模块已取代它，不要再改旧的。
- **HAR 文件**：`*.har` 被忽略，分析完可删除；如需保留样例，请先脱敏 token。
- 提交信息用中文，格式 `feat:` / `fix:` / `docs:` / `refactor:` / `chore:`。

## 仓库其他部分状态

wskey、发票、跳绳、龙岗图书馆、途虎、通用重放等模块在本次窗口内无改动。龙岗图书馆与 jdcookie 各有独立测试与专项文档，改动前先读对应文档。
