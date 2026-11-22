# 顺丰速运签到

## 模块说明

顺丰速运会小程序的会员积分页（`mcs-mimp-web` H5）提供每日签到。签到相关接口都在宿主域 `mcs-mimp-web.sf-express.com` 的 `/mcs-mimp/commonPost/` 下，路径里带服务名：

| 用途 | 请求 | 主要响应字段 |
| --- | --- | --- |
| 会员信息 | `POST /mcs-mimp/commonPost/~memberIntegral~userInfoService~queryUserInfo`，body `{"sysCode":"ESG-CEMP-CORE","optionalColumns":["usablePoint"],"token":"<小程序下发的 token>"}` | `obj.usablePoint`、`obj.nickName`、`obj.newGradeName` |
| 今日签到状态 | `POST /mcs-mimp/commonPost/~memberNonactivity~integralSignV2Service~getTodaySign`，body `{}` | `obj.signed`、`obj.dayCount`、`obj.bubbleText` |
| 执行签到 | `POST /mcs-mimp/commonPost/~memberNonactivity~integralSignV2Service~sign`，body `{"tab":2}` | `obj.signed`、`obj.dayCount`、`obj.award.productDTOList[]{productName, amount}` |
| 签到记录 | `POST /mcs-mimp/commonPost/~memberNonactivity~integralSignV2Service~getSignInfoRecords`，body `{"startTm":"YYYY-MM-DD 00:00:00","endTm":"YYYY-MM-DD 23:59:59"}` | `obj.signRecords[]{signed,signTm}`，本模块不调用 |

`queryUserInfo` 的 body token 需要从小程序请求里带，缺失时接口同样回 `100111`，所以本模块只用它做「尽力而为」的积分展示：失败就静默跳过，不影响签到判定。

## 请求签名

`mcs-mimp` H5 的请求拦截器会给每个 `commonPost` 请求加三个头：

```text
timestamp: 13 位毫秒时间戳
sysCode:   MCS-MIMP-CORE
signature: md5("token=<前端盐>&timestamp=<timestamp>&sysCode=<sysCode>")
```

- 盐是会员页 `main.js` 里硬编码的常量（`/mimp-up/assets/js/main.*.js`，搜索 `n.headers.signature`），与本机账号无关，脚本里直接内联。
- 签名只依赖 `timestamp` 与 `sysCode`，与请求路径、请求体无关；同一毫秒内的多个请求签名相同。
- 已用抓包里的 3 组 `(timestamp, signature)` 复算，全部一致；脚本内 `md5()` 为自实现，已与 Node `crypto` 对拍。
- `timestamp` 必须是本次运行的当前时间，脚本每次请求重新计算。

## 鉴权

登录态是 Cookie 里的 `JSESSIONID`，脚本通过 Surge 的 `http-request` 捕获，不硬编码：

- 拦截 pattern 与模块一致：`^https:\/\/mcs-mimp-web\.sf-express\.com\/mcs-mimp\/`
- 只在 `JSESSIONID` 变化时落盘 `cookie`（完整 Cookie 头）、`sessionId`、`userAgent`、`referer`；埋点 cookie（`sensorsdata2015jssdkcross`、`sa_jssdk_2015_*`、`tgw_l7_route`）变化频繁，不触发写入。
- 签到请求复用捕获到的 `User-Agent` 与 `Referer`，避免设备指纹不一致。
- 会员信息接口另有 `sw8`（SkyWalking 链路头）与 `Sec-Fetch-*`，抓包中由前端埋点注入；`sw8` 缺失不影响业务层返回（以实机为准），脚本不伪造。

## 执行流程

| 步骤 | 请求 | 判定 | 结果 |
| --- | --- | --- | --- |
| 0. 会员信息 | `queryUserInfo` | `success === true` | 仅在通知里附加积分余额，失败静默 |
| 1. 查状态 | `getTodaySign` | `obj.signed === true` | 通知「今日已签到」，**不提交** |
| 2. 签到 | `sign`（`{"tab":2}`） | `success === true` | 通知「签到成功 ✅」，带连续天数与奖励明细 |
| 2'. 已签兜底 | 同上 | `success !== true` 且消息含「已签到」 | 按「今日已签到」通知，不谎报成功 |

- 查状态失败（网络错误或 `success !== true`）时**不盲签**，通知「签到状态未知」，避免重复提交。
- 接口错误码 `100111`（`用户信息失效，请退出重新进入`）或消息含登录失效关键词时，判定为凭证失效，通知「登录凭证已失效」。
- 签到成功后 `sign` 响应的 `obj.award.productDTOList` 就是本次到账的券与积分，通知里按 `productName`（`amount > 1` 时带 `×N`）列出。

## 安装与首次抓取

```text
https://raw.githubusercontent.com/byhooi/Surge/main/Module/sfsy_sign.sgmodule
```

1. 在 Surge 中开启 MITM 并信任证书，确认 `mcs-mimp-web.sf-express.com` 被解密。
2. 在微信中打开顺丰速运小程序，进入「我的」（会员/积分页），触发任意 `/mcs-mimp/` 请求。
3. 收到「已获取登录凭证」通知即完成；之后可关闭小程序，由定时任务签到。
4. 默认每日 8:30 签到（设备时区），可在模块参数「定时签到」中改 Cron。
5. 凭证失效时重新打开小程序会员页刷新；也可以临时在 BoxJS「Cookie 覆盖」里手填完整 Cookie（至少含 `JSESSIONID`）。

脚本更新后在 Surge「外部资源」里手动点更新脚本即可生效（`script-update-interval=0` 只表示不自动轮询），不需要重装模块。

## 结果判定

| 通知标题 | 含义 |
| --- | --- |
| 今日已签到 | 签到前查询确认今日已签，未发起提交 |
| 签到成功 ✅ | `sign` 返回成功，附连续天数与奖励明细 |
| 签到失败 | 网络错误或接口返回非 `success`，且消息不是「已签到」 |
| 签到状态未知 | 查状态接口异常，未提交签到 |
| 登录凭证已失效 | `errorCode=100111` 或消息含「用户信息失效」 |
| 缺少登录凭证 | 本地没有保存凭证，需要先打开小程序会员页 |
| 已获取登录凭证 | 抓取脚本落盘成功（凭证发生变化时才提示） |

## 限制与验证状态

- 只做每日签到。会员日翻倍、蜂蜜/采蜜等任务、签到后的任务引导（`signGuide`）都不在范围内。
- `getTodaySign` 与 `sign` 的字段来自小程序真实抓包；签名算法已用前端 `main.js` 与抓包样本双向验证。但抓包里的 `JSESSIONID` 在 Surge 之外重放时服务端返回 `100111`（会话与设备/IP 绑定或已过期），所以**本模块的端到端请求需要在实机首次运行时确认**，失败请查看 Surge 日志里的 `→ POST` 与响应。
- `sign` 的请求体固定 `{"tab":2}`（对应积分签到页的 tab），不同版本小程序若改了 tab 语义需要同步调整。
- 通知里的积分余额依赖 `queryUserInfo` 的 body token，抓包显示它来自小程序运行时，脚本未捕获该 token，因此多数情况下通知只有签到奖励、没有积分余额。
