# 同程旅行签到

> [!WARNING]
> **已停用归档**：同程小程序登录凭证（`TC-MALL-USER-TOKEN` / `TCSecTk`）服务端有效期约 24 小时，且登录续期与最新签到请求已走微信云托管加密网关（`wxgateway.com/__wx__/call`），Surge 无法自动续期。模块与脚本已归档至 `Module/Backup/tongcheng_sign.sgmodule` 与 `Script/Backup/tongcheng_sign.js`。

## 模块说明

同程旅行小程序（appid `wx336dcaf6a1ecf632`）的里程签到入口在 `page/AC/sign/msindex/msindex`，接口全部走宿主域 `wx.17u.cn`：

| 用途 | 请求 | 主要响应字段 |
| --- | --- | --- |
| 签到状态 | `POST /wxmpsign/sign/getSignInfo`，body `{}` | `todaySigned`、`canSign`、`signMileage`、`periodContinuedSignDays`、`tomorrowMileage` |
| 签到日历 | `POST /wxmpsign/sign/signCalendar`，body `{"beginDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}` | `today`、`todaySigned`、`canSign`、`dateInfo[{date,mileage,isSigned}]` |
| 执行签到 | `POST /wxmpsign/sign/saveSignInfo`，body `{}` | `code === 200` |
| 里程余额 | `POST https://tcmobileapi.17usoft.com/mallgatewayapi/userApi/mileages/remain` | 不在本模块调用 |

`signCalendar` 与 `getSignInfo` 的字段已用真实抓包确认；`saveSignInfo` 的接口名与 `code === 200` 语义来自公开脚本（`smallfawn/QLScriptPublic` 的 `wxapp/tclx_lc.js`），尚未在本仓库实机验证。首次运行后请查看通知结果。

## 鉴权头

小程序不要求本地签名，直接复用请求头里的登录态：

```text
TC-MALL-USER-TOKEN: <sectoken>      # 与 secToken 同值
secToken:           <sectoken>
TCSecTk:            <TCSecTk>       # 小程序安全 SDK 生成，可能短期有效
apmat:              <openId>|<yyyyMMddHHmm>|<随机数>
platform:           WX_MP
TC-MALL-PLATFORM-CODE: WX_MP
osType:             1
TCxcxVersion:       8.4.3
TCReferer:          page%2FAC%2Fsign%2Fmsindex%2Fmsindex
```

- `TCSecTk` 在抓包中与 `TC-MALL-USER-TOKEN` 不同值，签到页每次打开都可能刷新。脚本保存最新值，缺失时回退用 `sectoken` 填充。
- `apmat` 每次请求重新生成，只保存其中的 `openId`，不重放旧时间戳。
- `openId` 也可从 `POST /wcsign/config/GetHomePageConfig` 的 body（`{"unionId":...,"openId":...}`）取得，作为 `apmat` 缺失时的兜底。

## 执行流程

| 步骤 | 请求 | 判定 | 结果 |
| --- | --- | --- | --- |
| 1. 查状态 | `getSignInfo` | `todaySigned` 为真 | 通知「今日已签到」，**不提交** |
| 1'. 降级 | `signCalendar`（今天前后各 2 天） | `todaySigned` 或当日 `dateInfo[].isSigned` | 仅在 `getSignInfo` 无法判定时调用 |
| 2. 签到 | `saveSignInfo` | `code === 200` | 继续复查 |
| 3. 复查 | 同第 1 步 | 已签 | 通知「签到成功 ✅」 |
| 3'. 复查 | 同上 | 未签或无法判定 | 通知「签到未确认」，不谎报成功 |

- 状态无法确认（接口异常、字段缺失）时**继续提交**，宁可多签一次也不漏签；`saveSignInfo` 自身幂等，重复提交不会重复发放。
- 服务端在 `saveSignInfo` 直接回「已签到」时，按「今日已签到」通知。
- `canSign === 0` 时通知「当前不可签到」，不提交。

## 安装与首次抓取

```text
https://raw.githubusercontent.com/byhooi/Surge/main/Module/tongcheng_sign.sgmodule
```

1. 在 Surge 中开启 MITM 并信任证书，确认 `wx.17u.cn` 被解密。
2. 在微信中打开同程旅行小程序，进入「我的 - 里程/签到」页面，触发任意 `wxmpsign` 请求。
3. 收到「已获取登录凭证」通知即完成。之后可关闭小程序，由定时任务签到。
4. 默认每日 8:21 签到（设备时区），可在模块参数「定时签到」中修改 Cron。
5. 凭证失效（`code` `50002`/`50006` 或返回「token 过期请重新登录」）时，重新打开小程序签到页即可刷新。

脚本更新后在 Surge「外部资源」中手动点更新脚本即可生效（`script-update-interval=0` 只表示不自动轮询），不需要重装模块。

## 结果判定

| 通知标题 | 含义 |
| --- | --- |
| 今日已签到 | 签到前查询确认今日已签，未发起提交 |
| 签到成功 ✅ | 提交后复查确认已签，附连续天数与今日/明日里程 |
| 签到未确认 | 已提交但复查不通过或无法确认，需人工查看 |
| 签到失败 | 网络错误、HTTP 错误或接口返回非 200 且不是「已签到」 |
| 登录凭证已失效 | `50002`/`50006` 或消息含 token/登录/过期，需重新打开小程序 |
| 缺少登录凭证 | 本地没有保存凭证，从未捕获过或状态被清空 |

## 限制

- 签到后小程序按钮会切换为「做任务，赚里程积分」，任务中心在分包 `page/AC/sign/` 内，接口未还原，本模块只做每日签到，任务仍需在小程序内手动完成。
- 里程余额接口需要额外的 `TC-MALL-DEPT-CODE`、`TC-MALL-CLIENT` 等头，本模块不查询余额。
- 签到活动偶尔要求身份验证（`/platformpubapi/risk/checkUserRisk` 返回 `pass:0` 并带 `identity.ly.com` 跳转），脚本无法绕过；遇到时请在小程序内完成验证。
