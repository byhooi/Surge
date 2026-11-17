const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../Script/tongcheng_sign.js"), "utf8");
const KEY = "byhooi_tongcheng_state";
const NOW = Date.UTC(2030, 0, 2, 0, 20);

const STATE = JSON.stringify({
  token: "TEST-TOKEN-1234567890",
  secTk: "SECTK-PRIVATE-5678",
  openId: "oABC123xyz",
  userAgent: "TEST-UA",
  tcVersion: "8.4.3",
  osType: "1",
  tcReferer: "page%2FAC%2Fsign%2Fmsindex%2Fmsindex",
});

function reply(code, data, extra = {}) {
  const body = JSON.stringify(Object.assign({ code, msg: extra.msg || "ok", data }, extra.json));
  return { body };
}

function run({ request, store = new Map(), replies = [], failWrite = false } = {}) {
  const calls = [];
  const notifications = [];
  const logs = [];
  class MockDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [NOW]));
    }
    static now() {
      return NOW;
    }
  }
  const context = {
    Date: MockDate,
    console: { log: (line) => logs.push(line) },
    $persistentStore: {
      read: (key) => (store.has(key) ? store.get(key) : null),
      write: (value, key) => {
        if (failWrite) return false;
        store.set(key, value);
        return true;
      },
    },
    $notification: { post: (...args) => notifications.push(args) },
    $done: () => {},
    $httpClient: {
      post: (options, callback) => {
        calls.push(options);
        const next = replies[calls.length - 1];
        if (!next) throw new Error("测试未配置此请求");
        callback(next.error || null, { status: next.status || 200 }, next.body);
      },
    },
  };
  if (request) context.$request = request;
  vm.runInNewContext(source, context);
  return { calls, notifications, logs, store, state: () => JSON.parse(store.get(KEY) || "{}") };
}

test("捕获 TC-MALL-USER-TOKEN、TCSecTk 与 apmat 中的 openId", () => {
  const store = new Map();
  const result = run({
    store,
    request: {
      url: "https://wx.17u.cn/wxmpsign/sign/signCalendar",
      headers: {
        "TC-MALL-USER-TOKEN": "TEST-TOKEN-1234567890",
        TCSecTk: "SECTK-PRIVATE-5678",
        apmat: "oABC123xyz|202611171154|597024",
        "User-Agent": "WX-UA",
        TCxcxVersion: "10.8.7",
        osType: "1",
        TCReferer: "page%2FAC%2Fsign%2Fmsindex%2Fmsindex",
      },
      body: "{}",
    },
  });
  const state = result.state();
  assert.equal(state.token, "TEST-TOKEN-1234567890");
  assert.equal(state.secTk, "SECTK-PRIVATE-5678");
  assert.equal(state.openId, "oABC123xyz");
  assert.equal(state.userAgent, "WX-UA");
  assert.equal(state.tcVersion, "10.8.7");
  assert.equal(result.notifications[0][1], "已获取登录凭证");
  assert.ok(!JSON.stringify(result.logs).includes("TEST-TOKEN-1234567890"));
});

test("非 wxmpsign 请求与无 token 请求不写凭证", () => {
  const store = new Map();
  const skipped = run({
    store,
    request: { url: "https://wx.17u.cn/wxmpsign/sign/signCalendar", headers: {}, body: "{}" },
  });
  assert.equal(store.has(KEY), false);
  assert.equal(skipped.notifications.length, 0);

  const other = run({
    store,
    request: { url: "https://wx.17u.cn/other/path", headers: { "TC-MALL-USER-TOKEN": "X-PRIVATE-1" } },
  });
  assert.equal(store.has(KEY), false);
  assert.equal(other.notifications.length, 0);
});

test("今日已签到只查询一次，不提交签到", () => {
  const result = run({
    store: new Map([[KEY, STATE]]),
    replies: [reply(200, { todaySigned: 1, canSign: 1, signMileage: 5, periodContinuedSignDays: 3, tomorrowMileage: 8 })],
  });
  assert.equal(result.calls.length, 1);
  assert.match(result.calls[0].url, /\/wxmpsign\/sign\/getSignInfo$/);
  assert.equal(result.calls[0].headers["TC-MALL-USER-TOKEN"], "TEST-TOKEN-1234567890");
  assert.equal(result.calls[0].headers.secToken, "TEST-TOKEN-1234567890");
  assert.match(result.calls[0].headers.apmat, /^oABC123xyz\|\d{12}\|\d+$/);
  assert.equal(result.notifications[0][1], "今日已签到");
  assert.match(result.notifications[0][2], /连续 3 天/);
  assert.match(result.notifications[0][2], /今日 \+5 里程/);
  assert.match(result.notifications[0][2], /明日 \+8 里程/);
  assert.equal(result.state().checkedBeforeSign, true);
});

test("未签到时提交并复查成功", () => {
  const result = run({
    store: new Map([[KEY, STATE]]),
    replies: [
      reply(200, { todaySigned: 0, canSign: 1, signMileage: 5 }),
      reply(200, { todaySigned: 1 }),
      reply(200, { todaySigned: 1, canSign: 1, periodContinuedSignDays: 4, tomorrowMileage: 8 }),
    ],
  });
  assert.deepEqual(
    result.calls.map((item) => item.url.replace("https://wx.17u.cn", "")),
    ["/wxmpsign/sign/getSignInfo", "/wxmpsign/sign/saveSignInfo", "/wxmpsign/sign/getSignInfo"]
  );
  assert.equal(result.notifications[0][1], "签到成功 ✅");
  assert.match(result.notifications[0][2], /连续 4 天/);
  assert.match(result.notifications[0][2], /明日 \+8 里程/);
  const expected = new Date(NOW);
  const date = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-${String(
    expected.getDate()
  ).padStart(2, "0")}`;
  assert.equal(result.state().lastSignDate, date);
});

test("canSign=0 时不提交签到", () => {
  const result = run({
    store: new Map([[KEY, STATE]]),
    replies: [reply(200, { todaySigned: 0, canSign: 0 })],
  });
  assert.equal(result.calls.length, 1);
  assert.equal(result.notifications[0][1], "当前不可签到");
});

test("getSignInfo 不可用时回退签到日历判断状态", () => {
  const calendar = {
    today: "2030-01-02",
    todaySigned: 0,
    canSign: 1,
    dateInfo: [{ date: "2030-01-02", mileage: 8, isSigned: 0 }],
  };
  const result = run({
    store: new Map([[KEY, STATE]]),
    replies: [
      reply(500, null, { msg: "system error", json: { code: 500, data: null } }),
      reply(200, calendar),
      reply(200, {}),
      reply(200, { todaySigned: 1, canSign: 1, periodContinuedSignDays: 4 }),
    ],
  });
  assert.deepEqual(
    result.calls.map((item) => item.url.replace("https://wx.17u.cn", "")),
    [
      "/wxmpsign/sign/getSignInfo",
      "/wxmpsign/sign/signCalendar",
      "/wxmpsign/sign/saveSignInfo",
      "/wxmpsign/sign/getSignInfo",
    ]
  );
  assert.match(result.calls[1].body, /"beginDate":"2029-12-31"/);
  assert.equal(result.notifications[0][1], "签到成功 ✅");
});

test("凭证失效时通知重新捕获，不提交签到", () => {
  const result = run({
    store: new Map([[KEY, STATE]]),
    replies: [reply(50002, "", { msg: "token过期请重新登录" })],
  });
  assert.equal(result.calls.length, 1);
  assert.equal(result.notifications[0][1], "登录凭证已失效");
  assert.match(result.notifications[0][2], /重新打开/);
  assert.ok(!JSON.stringify(result.notifications).includes("TEST-TOKEN-1234567890"));
});

test("无凭证时提示先打开小程序签到页", () => {
  const result = run({ store: new Map() });
  assert.equal(result.calls.length, 0);
  assert.equal(result.notifications[0][1], "缺少登录凭证");
});

test("模块捕获范围、定时任务与 BoxJS 配置一致", () => {
  const moduleText = fs.readFileSync(path.join(__dirname, "../Module/tongcheng_sign.sgmodule"), "utf8");
  const captureLine = moduleText.split(/\r?\n/).find((line) => line.includes("type=http-request"));
  const pattern = new RegExp(captureLine.match(/pattern=(.*?),requires-body/)[1]);
  assert.ok(pattern.test("https://wx.17u.cn/wxmpsign/sign/signCalendar"));
  assert.ok(pattern.test("https://wx.17u.cn/wxmpsign/home/top?x=1"));
  assert.ok(!pattern.test("https://evil.example/wxmpsign/sign/signCalendar"));
  assert.ok(!pattern.test("https://wx.17u.cn/other/wxmpsign/"));
  assert.match(moduleText, /同程旅行签到 = type=cron/);
  assert.match(moduleText, /wake-system=1/);
  assert.match(moduleText, /\{\{\{禁用MITM\}\}\} = %APPEND% wx\.17u\.cn/);

  const box = JSON.parse(fs.readFileSync(path.join(__dirname, "../boxjs/byhooi.boxjs.json"), "utf8"));
  const app = box.apps.find((item) => item.id === "byhooi_tongcheng_sign");
  assert.ok(app, "缺少 BoxJS app");
  assert.deepEqual(app.keys, [KEY]);
  assert.equal(app.settings.find((setting) => setting.id === KEY).val, "{}");
  const button = app.scripts.find((script) => script.name === "手动执行同程签到");
  assert.equal(button.script, "https://raw.githubusercontent.com/byhooi/Surge/main/Script/tongcheng_sign.js");
  assert.equal(button.script_timeout, 60);
});
