# 小米商城签到

## 接口

```text
POST https://shop-api.retail.mi.com/mtop/mf/act/infinite/done
Content-Type: application/json
Cookie: serviceToken=<serviceToken>

[{}, {"taskToken": "<活动令牌>", "actId": "<活动 ID>", "taskType": 110}]
```

- 请求体是 mtop 约定的数组：第 0 位是固定的空对象，第 1 位才是业务参数。
- 认证只依赖 Cookie 里的 `serviceToken`，没有 `sign`、`nonce` 或时间戳签名。
- `taskType` 为 `110`（签到类任务），`actId` 是 24 位十六进制活动 ID。
- 其余请求头是固定的端信息：`equipmenttype: 2`、`x-user-agent: channel/mishop platform/smarthome.ios`、`d-id`、`d-model`、`User-Agent: MiHome/...`。这些头来自米家 App 内置的小米商城，与商城 App 的渠道头不同，混用会被判为非法渠道。

成功响应：

```json
{"msg":"ok","code":0,"success":true,"data":{
  "taskInfo":{"doneInSeriesCount":3},
  "awardList":[{"customAwardName":"米金","awardValue":"5","awardType":12,"success":true}]}}
```

## 一个账号对应多个活动

同一天可以对多个 `actId` 各领一次，互不影响：

| 抓包 | `actId` | 通知里的活动名 | 奖励配置 id |
| --- | --- | --- | --- |
| 1.har | `6706c0695404a23dfb5b2cab` | 米金商城签到 | `6706c069c16def3db8897dec` |
| 2.har | `6af6cd340918c14f2652d046` | 米家商城签到 | `6af6cd358944f7219ad2fa03` |

奖励配置 id 与所属 `actId` 前 8 位同源，所以脚本用前 8 位把活动映射成可读名称：`6706c069` → 米金商城签到，`6af6cd34` → 米家商城签到，未收录的显示为 `活动 前8位`。活动名写在 `Script/mishop_sign.js` 的 `ACTIVITY_NAMES` 里，若线上名称对调了直接改这张表。

`doneInSeriesCount` 是连续签到天数，14 天一个周期，仅用于展示，不作为判重依据。米家商城连续签到第 3、7、14 天有其他奖励，米金商城第 2、7、14 天有机会获得额外米金或红包；这些额外奖励会在响应里一并返回，标题合计已包含。

## 抓包与执行

模块只有两条执行路径：

1. **捕获**（`http-request`，匹配 `/mtop/mf/act/infinite/(do|done)`）：从 Cookie 取 `serviceToken`，从请求体取 `actId` / `taskToken`，并把除 `host`、`content-length`、`cookie`、`connection`、`accept-encoding` 以外的请求头存成模板。只在出现新账号或新活动时通知，反复打开签到页不会重复打扰。
2. **签到**（cron，`argument=sign`）：按账号 → 活动顺序串行请求，同一天成功过的活动直接跳过。

判定规则：

| 情况 | 处理 |
| --- | --- |
| `code === 0` 且 `awardList` 里有成功奖励 | 记录 `lastSignDate`，奖励计入账号与全局合计 |
| `code !== 0` 或 `success === false` | 视为失败，**不写** `lastSignDate`，下次仍会重试 |
| `code === 0` 但奖励为空 | 视为失败（可能已签或未到发放条件），**不写** `lastSignDate` |
| HTTP 非 2xx、非 JSON、网络错误 | 视为失败，不写 `lastSignDate` |

`taskToken` 与 `actId` 绑定，若服务端换了活动或令牌过期，签到会返回业务错误，此时重新打开签到页即可刷新。

## 安装与首次使用

```text
https://raw.githubusercontent.com/byhooi/Surge/main/Module/mishop_sign.sgmodule
```

1. 在 Surge 中开启 MITM 并信任证书，确认 `shop-api.retail.mi.com` 被解密。
2. 打开米家 App →「小米商城」→ 签到页，点一次签到（这一步只是为了让脚本抓到请求）。
3. 收到「已添加签到账号」通知即完成，之后由定时任务执行。默认每日 8:20（设备时区）。
4. 换账号或换设备时，用目标账号重新打开签到页，脚本按 `serviceToken` 归档，新账号会单独追加。
5. 通知按活动逐行展示，活动名由 `actId` 前 8 位映射，账号按 `账号1`、`账号2` 编号，不显示脱敏 token。

`script-update-interval=0` 只表示不自动轮询，脚本更新后在 Surge「外部资源」手动更新即可。

## 结果判定

通知按活动逐行展示，能直接看出每个活动签到到第几天：

- 标题带状态词与奖励合计：全部成功为 `签到成功 · 米金 +10`；有成功也有失败为 `部分成功 · 米金 +5 · 失败 1`；全部失败为 `签到失败 · n 项`；全部跳过为 `今日已签到`。
- 正文每个活动一行，格式为 `账号N · 活动名：结果`，例如 `账号1 · 米金商城签到：米金 +5（连续签到第 4 天）`。
- 当天已签到不再发请求，显示 `账号1 · 米家商城签到：今日已签到（连续签到第 3 天）`，天数取自上次成功记录。
- 失败统一列在 `失败：` 之后，每行带账号、活动名与原因；失败不写签到日期，下一轮自动重试。

| 通知标题 | 含义 |
| --- | --- |
| `签到成功 · 米金 +10` | 本轮全部成功，标题附带奖励合计 |
| `部分成功 · 米金 +5 · 失败 1` | 有成功也有失败，正文`失败：`后逐行给出原因 |
| `签到失败 · n 项` | 本轮没有任何成功领取 |
| `今日已签到` | 所有活动当天已领过，未发请求 |
| 没有已捕获的账号 | 未抓包，按上文第 2 步操作 |
| 任务未完成 | 账号数据损坏或其他异常，原数据未被覆盖 |

常见失败：

- 业务错误提示登录失效 → `serviceToken` 过期，重新打开签到页抓取。
- 提示缺少 `taskToken` → 活动参数缺失，重新打开签到页。
- HTTP 401 / 403 → 凭证失效或渠道头被拒。

## BoxJS

| Key | 说明 |
| --- | --- |
| `byhooi_mishop_accounts` | 自动维护的 JSON 数组：`token`（serviceToken）、`headers`（请求头模板）、`activities`（actId/taskToken/lastSignDate/lastResult/lastSeries）。含凭证，请勿分享；清空为 `[]` 可移除全部账号，`enabled: false` 可单独停用。 |
| `byhooi_mishop_lock` | 任务锁，异常中断后 150 秒自动失效。 |

## 本地验证

```bash
node --check Script/mishop_sign.js
node --test tests/mishop_sign.test.cjs
```

测试覆盖：抓包解析与请求头去噪、重复捕获不重复通知、新活动追加、无 `serviceToken`/无活动参数时不写入、签到请求体与 URL 与抓包一致、当天已签到跳过、业务失败不写签到日期、`code 0` 但无奖励、HTTP 502、锁占用、无账号提示、账号数据损坏不覆盖、多账号多活动逐个请求、同一账号多活动逐活动展示、部分失败时标题与正文分区、活动名映射与未知 `actId` 回退、连续签到天数写入 `lastSeries`。

自动化测试不能替代实机验证：发布后请用真实账号确认抓取通知、手动执行的通知结论，以及次日定时任务是否成功。

## 已知限制

- 凭证归档以 `serviceToken` 为键。若同一账号换登录态后 `serviceToken` 变化，会多出一个账号条目，需要在 BoxJS 里删掉旧条目。
- `actId` 对应的活动可能随时下线，下线后该活动每天都会报失败，可在 BoxJS 的 `activities` 里删除对应条目。
- 活动参数只能从抓包获得，脚本不主动枚举活动列表；新增活动需再打开一次签到页。
- 只在 08:51 的两次实机抓包上验证过，服务端若调整请求体结构或新增签名，需要重新抓包核对。
