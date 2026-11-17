# 东风本田签到

## 为什么旧模块失效

旧方案（`Module/Backup/honda.sgmodule`）是"抓包即重放"：把小程序里一次签到请求的 URL、请求头、body 原样存下来，cron 时再发一次。网关现在对每个请求校验签名与时间戳，重放必然失败：

| 返回 | 含义 | 触发方式 |
| --- | --- | --- |
| `1121` | 系统时间与标准时间不一致 | 用旧的 `timestamp` 重放 |
| `174` | 密钥签名错误 | 改了 `timestamp` 但沿用旧 `sign` |
| `178` | 签名已失效（`keysign repeat`） | 把 `sign` 置零或重复使用同一组签名 |

小程序渠道的 `appid`/`appkey` 拿不到，所以新方案改用**官方 H5 生产环境**的 `appid`/`appkey`（打包产物里的公开配置）自行签名，登录态由手机号 + 短信验证码换来的 `token` 提供。

## 网关

```text
POST https://api.dongfeng-honda.com/appv3/api
Content-Type: application/json
api: <接口名>
appid: <H5 prod appid>
appcode: hondaapp
uuid: <会员 uuid>
noncestr: <随机字母数字串>
timestamp: <毫秒时间戳>
lang: cn
sign: <见下>
keysign: <见下>
```

签名（H5 打包产物里的实现，全部 SHA-512，小写 hex）：

```text
body    = 无 body 或空对象时为 ""，否则为该请求的原始 JSON 字符串
sign    = SHA512(uuid + api + noncestr + timestamp + token + body)
keysign = SHA512(appid + appkey + api + noncestr + timestamp + body)
```

- `token` 就是 H5 存储里的 `authorize`，未登录时为空串。
- 空对象要按 `""` 参与签名，发 `{}` 出去会被判为 `174`。
- `appid`/`appkey` 写在 `Script/honda_sign.js` 顶部的 `APP_ID`/`APP_KEY`；H5 重新发版换了密钥时，从 `https://h5.dongfeng-honda.com/js/app.*.js` 里 `appid:"app...",appkey:"..."` 取新值覆盖即可。

## 用到的接口

| 用途 | 接口 | body |
| --- | --- | --- |
| 发短信验证码 | `honda.app.login.getValidCode2` | `{"telephone":"<手机号>","validType":"04"}` |
| 登录换 token | `honda.app.telLogin` | `{"validType":"04","telephone":"<手机号>","validCode":"<验证码>"}` |
| 查询今日是否已签 | `honda.app.sign.signDayState` | 无 |
| 签到 | `honda.app.member.memberSign` | 无 |
| 签到日历（连续天数、积分） | `honda.app.member.memberSignTrackNew` | `{"sceneType":"1"}` |
| 会员信息（补 uuid） | `honda.app.member.memberInfo` | 无 |

- `appkey` 不随请求发送，只参与 `keysign` 计算。
- 登录成功返回 `rows`（或 `model`）`{accessToken, userInfo{telephone, uuid, ...}}`，`accessToken` 即后续请求签名里的 `token`，`userInfo.uuid` 即请求头 `uuid`。
- 小程序那套 `honda.mini.*` 接口对 H5 凭据返回 `175`（无权限），不能复用。
- 返回码：`1001` 未登录、`147` 身份信息无效、`170` 密钥未注册、`174` 签名错误、`175` 无权限、`176` 缺密钥字段、`178` 签名重放、`111` 接口不存在。

## 使用

1. 安装 `Module/honda_sign.sgmodule`。**不需要 MITM**，也不需要在小程序里重新抓包。
2. BoxJS →「东风本田签到」填手机号。
3. 运行「登录 / 签到」：第一次会发短信验证码（通知提示）。
4. 把验证码填进「短信验证码」，再运行一次：登录成功、写入 Token，并立即执行当天签到。
5. 之后 cron 每日 `8:20` 自动签到（`argument=sign`，不会再触发短信）。

脚本模式：

| 触发方式 | 行为 |
| --- | --- |
| cron（`argument=sign`） | 只签到。没有 Token 时只通知「未登录」，**不会发短信** |
| BoxJS 手动运行（无 argument） | 有 Token → 签到；有验证码 → 登录并签到；都没有 → 发验证码 |
| `argument=sendCode` | 只发验证码（可临时改模块参数应急） |
| `argument=login` | 用 BoxJS 里已填的验证码登录 |
| 未知 argument | 直接报「参数错误」，不会静默降级为自动模式 |

保护措施：

- 验证码**只有在登录成功后**才会从 BoxJS 清掉；登录失败也会清掉（并提示重新获取），避免填错一次的旧码永久卡住流程。
- 同一设备 3 分钟内不重复发短信，防止连点或 cron 参数配错时反复收短信、反复计费。
- 运行锁 150 秒：cron 与手动点击叠在一起时，后来者只提示「正在执行」并退出，不会重复签到。

Token 失效（`1001`/`147`）会清除 `账号数据` 里的 Token 并通知；再手动运行一次就会重新发验证码。要强制重登，清空 BoxJS 的「账号数据」即可。

## 存储

| 键 | 说明 |
| --- | --- |
| `byhooi_honda_phone` | 手机号，手填 |
| `byhooi_honda_code` | 短信验证码，手填，登录结束后脚本自动清空 |
| `byhooi_honda_account` | `{telephone, uuid, token, updatedAt}`，脚本自动维护 |
| `byhooi_honda_lock` | 运行锁时间戳，脚本自动维护 |
| `byhooi_honda_sms_at` | 上次发短信时间，用于节流 |

Token 与手机号只存在本机 `$persistentStore`，不要提交到仓库、不要贴进 issue 或聊天。日志与通知里手机号已脱敏。

## 排错

- 通知"密钥签名错误（174）"：`APP_ID`/`APP_KEY` 与 H5 现行版本不匹配，或签名串拼接与 `body` 不一致（注意空对象要用 `""`）。
- 通知"密钥无该接口权限（175）"：该接口属小程序渠道，H5 凭据无法访问。
- 通知“身份信息无效（147）”/“登录已失效（1001）”：Token 不可用，脚本会自动清空并提示重登。
- 通知“滑块验证失败（50109）”：网关开始强制 `ly.app.verify.slider.captcha` 才发短信（目前未强制）。此时只能在小程序 / APP 内人工登录，再从抓包响应里取 `accessToken` 写进 `账号数据` 的 `token` 字段。
- 通知"请稍后"：3 分钟内已经发过一次验证码，等间隔过后再运行；确实没收到短信可清空 `byhooi_honda_sms_at`。
- 通知"正在执行"：上一次运行还没结束（多为 cron 与手动叠加），等两分半后重试。
- 通知"设备时间与服务器时间不一致（1121）"：设备时间偏差过大，需校准时间。
- 通知"脚本异常"：先用 `node --check Script/honda_sign.js` 查语法；SHA-512 实现有 `tests/honda_sign.test.cjs` 覆盖（对 `node:crypto` 逐条比对）。

## 验证与测试

```bash
node --check Script/honda_sign.js
node --test tests/honda_sign.test.cjs
```
