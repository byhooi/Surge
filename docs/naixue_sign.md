# 奈雪点单签到

## 模块说明

奈雪点单小程序（品牌 `26000252` / `26000254`，宿主域 `tm-web.pin-dao.cn`）的签到接口要求每个请求携带动态签名：

```text
POST https://tm-web.pin-dao.cn/user/sign/save
```

请求体为 `{"common":{...},"params":{"signDate":"YYYY-M-D",...}}`，其中 `common.signature` 由前端计算：

```text
message   = encodeURI("nonce=<nonce>&openId=<openId>&timestamp=<timestamp>")
signature = Base64(HMAC-SHA1(message, key))
key       = 品牌为 26000252/26000254 且 version >= 4.2 且 platform=wxapp ? 奈雪 key : 默认 key
```

`openId` 与两个签名 key 都是小程序前端公开常量（可在 `static/js/1.*.chunk.js` 的 `HmacSHA1` 调用处看到），不是账号凭证，因此可以脱离小程序重放请求，不需要重放整段抓包内容（抓包中的 `timestamp` 几分钟后即被服务端判为过期）。

## 为什么不能只看 save 的返回

**`/user/sign/save` 是幂等接口：今天已签过再提交一次，同样返回 `{"code":0,"data":{"flag":true,...}}`。** 只看这个响应无法区分「今天第一次签到」和「早就签过了」。

小程序自己也印证了这点——签到弹窗（chunk `40`）显示什么，取决于 `/user/sign/condition` 返回的 `data.status`：

```js
i && !i.status
  ? "立即签到"   // status 为假 → 尚未签到
  : "已签到"     // status 为真 → 已签
```

而 `save` 的回调里只检查 `code === 0`，然后立刻重新查一遍状态：

```js
postSignSave({ signDate }).then(n => { n && (刷新账户, 重查签到条件); ... })
```

所以正确的判定必须**先查状态、再签、签完复查**，本模块 v1.1.0 按此实现。

## 该查哪个接口（重要）

两个接口都能反映签到状态，但**只有 `records` 是签到页真正会调的**：

| 页面 | 调用的接口 |
| --- | --- |
| `/naixue/sign-in`（签到页） | `postSignRecords`、`postUserAccount`、`postBaseUserInfo` |
| `/naixue/points-mall`（奈雪币商店页） | `postSignCondition`（签到弹窗） |

所以**只在签到页操作时，不会有 `condition` 请求**。v1.2.0 改为以 `records` 为主、`condition` 降级备用。

`records` 的请求参数与判定字段：

```text
POST /user/sign/records   params.startDate = "YYYY-M"（当月，不是当天）
响应 data.status           → 今日是否已签
响应 data.records[]        → 每日明细 {date, status}，用于顶层 status 缺失时兜底
```

`records` 的 `startDate` 是**月份**，与签到用的 `signDate`（日期）不同，不要混用。

## 执行流程

| 步骤 | 请求 | 判定 | 结果 |
| --- | --- | --- | --- |
| 1. 查状态 | `POST /user/sign/records`（`startDate=当月`） | `data.status` 为真，或当日明细 `status` 为真 | 通知「今日已签到」，**不提交** |
| 1'. 降级 | `POST /user/sign/condition`（`signDate=当天`） | 同上 | 仅在 `records` 判不出时调用 |
| 2. 签到 | `POST /user/sign/save` | `code === 0` | 继续复查 |
| 3. 复查 | 同第 1 步 | 已签 | 通知「签到成功 ✅」，附连签天数 |
| 3'. 复查 | 同上 | 未签 | 通知「签到未确认」，不谎报成功 |
| 3''. 复查 | 同上 | 无法判定 | 通知「签到未确认」，请自行确认 |

**宁可多签一次也不漏签**：第 1 步凡是无法确认（接口异常、网络失败、字段缺失、`status` 无法识别），一律继续提交。第 2 步若服务端直接回「已签到」，则视为完成、不再复查，但通知用「今日已签到」而不是「签到成功」。

`status` 语义来自前端代码（签到弹窗 `i && !i.status ? "立即签到" : "已签到"`、签到日历 `n.records.status`），尚未实机核对取值类型，因此按宽松方式识别：`true` / `1` / `"true"` / `"1"` 视为已签，`false` / `0` / `"false"` / `"0"` / `""` 视为未签，其余返回「未知」。

## 安装与首次抓取

```text
https://raw.githubusercontent.com/byhooi/Surge/main/Module/naixue_sign.sgmodule
```

1. 在 Surge 中开启 MITM 并安装、信任证书，确认 `tm-web.pin-dao.cn` 被解密。
2. 在微信中打开奈雪点单小程序，进入“我的 - 签到”页面（进入签到页或点单页都会触发带 token 的请求）。
3. 收到“已获取 accessToken”通知即完成。之后可关闭小程序，由定时任务签到。
4. 默认每日 9:15 签到（设备时区），可在模块参数“定时签到”中修改 Cron。
5. 需要换账号或换常用门店时，用目标账号重新打开小程序对应页面，脚本会刷新 token 与门店参数；参数变化会单独通知。

模块安装后也可以先在 Surge 里手动运行“奈雪点单签到”。

## 结果判定

| 通知标题 | 含义 |
| --- | --- |
| 今日已签到 | 签到前查询确认今日已签，未发起提交 |
| 签到成功 ✅ | 提交后复查确认已签，附连签天数与奈雪币说明 |
| 签到未确认 | 已提交但复查不通过或无法确认，需人工查看 |
| 签到失败 | 凭证失效、签名被拒、HTTP 错误或网络失败 |
| 缺少 accessToken / 缺少门店参数 | 未发请求，直接给操作指引 |

常见失败：

- `code 1500000` / HTTP 401 / 403 → token 失效，重新打开小程序抓取
- HTTP 400 `request sign ... is not valid` → 签名不匹配，多为服务端更换 key

## 状态响应记录（用于核对字段）

模块带一条 `http-response` 规则，会把 `/user/sign/records` 与 `/user/sign/condition` 的原始响应截断后存进 state：

| 字段 | 说明 |
| --- | --- |
| `lastRecordsRaw` | 最近一次 `records` 响应（截断 800 字符）。**只在签到页操作时看这个** |
| `lastRecordsAt` | 记录时间 |
| `lastConditionRaw` / `lastConditionAt` | `condition` 的同名字段（商店页才触发） |

用途是核对真实字段名。**若首次实机运行通知「签到未确认」，请把 `lastRecordsRaw` 的内容反馈，以便修正 `readSigned()` 的解析逻辑。** 该规则只记录、不改写响应，可在模块参数“禁用抓取”中一并停用。

## BoxJS

| Key | 说明 |
| --- | --- |
| `byhooi_naixue_state` | 自动维护的 JSON（token、门店参数、最近结果、最近签到日期、响应样本）。含凭证，请勿分享；清空为 `{}` 或删空可清除。 |
| `byhooi_naixue_sign_key` | 可选。签名 key 的覆盖值，仅在服务端更换 key 时使用；留空表示按品牌/版本自动选择。 |

## 本地验证

```bash
node --check Script/naixue_sign.js
node --test tests/naixue_sign.test.cjs
```

测试覆盖（18 项）：与 HAR 抓包签名逐字节对齐、品牌/版本选择不同 key、key 覆盖、已签到时不重复提交、`status` 为假→提交→复查成功、复查失败不谎报、字段缺失时降级继续签到、`status` 的字符串/数字形式、查询异常与网络失败降级、凭证失效/签名被拒/HTTP 500 的区分、缺凭证不发请求、凭证抓取去重、Cookie 不落盘、`http-response` 记录且不改写响应、超长内容截断。

注意：自动化测试不能替代实机验证。发布后请用真实账号确认：抓取通知是否出现、手动运行的通知结论是否符合预期、`lastRecordsRaw` 中的 `status` 是否符合预期语义、次日定时任务是否成功。

## 已知限制

- 依赖小程序前端常量（`openId` 与两个 key）。若服务端更换 key，签到会返回 HTTP 400 `request sign ... is not valid`，用 BoxJS 的 `byhooi_naixue_sign_key` 覆盖即可。
- `status` 语义由前端代码推断，未用真实响应验证；解析不确定时按「未知」处理，只会影响通知措辞，不会导致漏签。
- `records` 是主接口，`condition` 仅降级备用：如果只进签到页（不进奈雪币商店页），`lastConditionRaw` 会一直为空，这是正常的。
- 门店参数决定记录归属门店。换城市后请重新抓取，否则可能签到到旧门店或失败。
- `signDate` 采用与前端一致的 `YYYY-M-D`（月日不补零，如 `2026-1-5`），按北京时间计算；设备时区不影响签到日期。
