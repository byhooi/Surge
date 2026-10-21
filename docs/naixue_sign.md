# 奈雪点单签到

## 模块说明

奈雪点单小程序（品牌 `26000252` / `26000254`，宿主域 `tm-web.pin-dao.cn`）的签到接口要求每个请求携带动态签名：

```text
POST https://tm-web.pin-dao.cn/user/sign/save
```

请求体为 `{"common":{...},"params":{"signDate":"YYYY-MM-DD",...}}`，其中 `common.signature` 由前端计算：

```text
message   = encodeURI("nonce=<nonce>&openId=<openId>&timestamp=<timestamp>")
signature = Base64(HMAC-SHA1(message, key))
key       = 品牌为 26000252/26000254 且 version >= 4.2 且 platform=wxapp ? 奈雪 key : 默认 key
```

`openId` 与两个签名 key 都是小程序前端公开常量（可在 `static/js/1.*.chunk.js` 的 `HmacSHA1` 调用处看到），不是账号凭证，因此可以脱离小程序重放请求，不需要重放整段抓包内容（抓包中的 `timestamp` 几分钟后即被服务端判为过期）。

本模块的做法：

1. 拦截 `tm-web.pin-dao.cn` 下 `user/`、`naixue/`、`chayuan/`、`coupon/` 前缀的请求，保存 `Authorization` 中的 accessToken、`common`/`params`（品牌、门店、城市等）与请求头。
2. 定时任务用保存的 token 和门店参数，按当天日期重新计算 `signDate`、`nonce`、`timestamp` 与签名，直接调用签到接口。
3. 除 token 与门店参数外不保存 Cookie、传感器埋点等无关信息，日志中的 token 只输出首尾各 4 位。

## 安装与首次抓取

```text
https://raw.githubusercontent.com/byhooi/Surge/main/Module/naixue_sign.sgmodule
```

1. 在 Surge 中开启 MITM 并安装、信任证书，确认 `tm-web.pin-dao.cn` 被解密。
2. 在微信中打开奈雪点单小程序，进入“我的 - 签到”页面（进入签到页或点单页都会触发带 token 的请求）。
3. 收到“已获取 accessToken”通知即完成。之后可关闭小程序，由定时任务签到。
4. 默认每日 9:15 签到（设备时区），可在模块参数“定时签到”中修改 Cron。
5. 需要换账号或换常用门店时，用目标账号重新打开小程序对应页面，脚本会刷新 token 与门店参数；参数变化会单独通知。

模块安装后也可以先在 Surge 里手动运行“奈雪点单签到”，验证当前 token 是否可用。

## 结果判定

| 情况 | 表现 | 处理 |
| --- | --- | --- |
| `code === 0` | 通知“签到成功 ✅”，附奈雪币说明 | 记录 `lastSignDate` |
| `message` 命中“已签到” | 通知“今日已签到” | 同样视为当天完成 |
| `code === 1500000` 或提示未登录 | 通知“签到失败”，提示 token 失效 | 重新打开小程序抓取 |
| HTTP 401/403 | 同上 | 同上 |
| HTTP 400 | 通知“请求被拒绝” | 多为签名不匹配，检查模块参数或 key 覆盖项 |
| 缺 token / 缺门店参数 | 不发请求，直接提示操作步骤 | 按通知指引进入签到页 |
| 其他 code | 通知“签到失败”，带原始 message | 查看 Surge 日志排查 |

token 的有效期由服务端决定，样本中未见独立的 refresh 接口。长期不打开小程序、切换账号或服务端主动失效后，需要重新抓取一次。

## BoxJS

| Key | 说明 |
| --- | --- |
| `byhooi_naixue_state` | 自动维护的 JSON（token、门店参数、最近结果、最近签到日期）。含凭证，请勿分享；清空为 `{}` 或删空可清除。 |
| `byhooi_naixue_sign_key` | 可选。签名 key 的覆盖值，仅在服务端更换 key 时使用；留空表示按品牌/版本自动选择。 |

BoxJS 中的“手动执行奈雪签到”等价于在 Surge 里运行模块的定时脚本。

## 本地验证

```bash
node --check Script/naixue_sign.js
node --test tests/naixue_sign.test.cjs
```

测试覆盖：与 HAR 抓包签名逐字节对齐（同 nonce/timestamp 得到相同 Base64）、品牌/版本选择不同 key、参数覆盖 key、凭证与门店参数抓取去重、`signDate` 按当天重算、已签到/凭证失效/HTTP 400/网络错误的判定分支，以及缺少凭证时不发请求。

注意：自动化测试不能替代实机验证。发布后用真实账号在 Surge 中确认：抓取通知是否出现、手动运行是否返回 `code 0` 或“已签到”、次日定时任务是否成功、通知中的 token 是否仅部分显示。

## 已知限制

- 依赖小程序前端常量（`openId` 与两个 key）。若服务端更换 key，签到会返回 `request sign ... is not valid`（HTTP 400），此时用 BoxJS 的 `byhooi_naixue_sign_key` 覆盖即可，无需改脚本逻辑。
- 门店参数决定记录归属门店。抓到的 `params` 中含 `storeId`、`cityId`、`districtId`，换城市后请重新抓取，否则可能签到到旧门店或失败。
- `signDate` 固定按北京时间计算。设备时区不同不影响签到日期。
