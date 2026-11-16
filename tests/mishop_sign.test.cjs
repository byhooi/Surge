const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../Script/mishop_sign.js"), "utf8");
const ACCOUNTS_KEY = "byhooi_mishop_accounts";
const LOCK_KEY = "byhooi_mishop_lock";
// 北京时间 2030-01-01 08:30
const NOW = Date.UTC(2030, 0, 1, 0, 30);
const TODAY = "2030-01-01";
const ACT_A = "6706c0695404a23dfb5b2cab";
const ACT_B = "6af6cd340918c14f2652d046";
const TOKEN = "test-service-token-0000000000000001";
const SIGN_URL = "https://shop-api.retail.mi.com/mtop/mf/act/infinite/done";

// 通知里的活动名由 actId 前 8 位映射而来。
const ACT_A_NAME = "米金商城签到";
const ACT_B_NAME = "米家商城签到";

function requestBody(actId, taskToken) {
  return JSON.stringify([{}, { taskToken, actId, taskType: 110 }]);
}

function captureRequest(actId = ACT_A, taskToken = "task-a", token = TOKEN) {
  const cookie = token
    ? `dummy=1; serviceToken=${token}; other=2`
    : "dummy=1";
  return {
    method: "POST",
    url: SIGN_URL,
    headers: {
      Host: "shop-api.retail.mi.com",
      "Content-Length": "101",
      "Content-Type": "application/json",
      equipmenttype: "2",
      "x-user-agent": "channel/mishop platform/smarthome.ios",
      "d-id": "dDF2REM3NjloeTdIL2Q2Uy8vRGtrU1pYK0l4eldJbmc2cU05QzcycGZQdEtsRWlqZnRjYmNiQmlFUzdqYjBmNg==",
      "d-model": "iPhone18,3",
      "User-Agent": "MiHome/11.10.200.360 CFNetwork/3896.200.61 Darwin/27.2.0",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
      Cookie: cookie,
    },
    body: requestBody(actId, taskToken),
  };
}

function account(overrides = {}) {
  return Object.assign(
    {
      token: TOKEN,
      enabled: true,
      headers: {
        equipmenttype: "2",
        "x-user-agent": "channel/mishop platform/smarthome.ios",
        "d-id": "device-id",
        "d-model": "iPhone18,3",
        "User-Agent": "MiHome/11.10.200.360",
      },
      activities: [{ actId: ACT_A, taskToken: "task-a", capturedAt: NOW }],
      capturedAt: NOW,
    },
    overrides
  );
}

function storeWith(accounts) {
  return new Map([[ACCOUNTS_KEY, JSON.stringify(accounts)]]);
}

function stored(store) {
  return JSON.parse(store.get(ACCOUNTS_KEY));
}

function okBody(series = 3) {
  return JSON.stringify({
    msg: "ok",
    code: 0,
    success: true,
    data: {
      taskInfo: { doneInSeriesCount: series },
      awardList: [
        {
          awardName: "米金",
          customAwardName: "米金",
          awardValue: "5",
          awardType: 12,
          success: true,
        },
      ],
    },
  });
}

function failBody(code = 10001, message = "任务已完成") {
  return JSON.stringify({ code, success: false, message, data: {} });
}

function context({ store, notifications, logs, clock = NOW }) {
  class MockDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() {
      return clock;
    }
  }
  return {
    Date: MockDate,
    console: { log: (line) => logs.push(line) },
    $persistentStore: {
      read: (key) => store.get(key) || null,
      write: (value, key) => {
        store.set(key, value);
        return true;
      },
    },
    $notification: { post: (...args) => notifications.push(args) },
    $httpClient: {},
  };
}

function runCapture(options = {}) {
  const notifications = [];
  const logs = [];
  const store = options.store || new Map();
  const ctx = context({ store, notifications, logs });
  let doneValue;
  let doneCount = 0;
  ctx.$request = options.request || captureRequest();
  ctx.$done = (value) => {
    doneCount++;
    doneValue = value;
  };
  vm.runInNewContext(source, ctx, { filename: "mishop_sign.js" });
  return { store, notifications, logs, doneValue, doneCount };
}

async function runTask({ store, replies, clock = NOW }) {
  const notifications = [];
  const logs = [];
  const calls = [];
  let finish;
  const completed = new Promise((resolve) => {
    finish = resolve;
  });
  const ctx = context({ store, notifications, logs, clock });
  ctx.$done = () => finish();
  ctx.$httpClient.post = (options, callback) => {
    calls.push(options);
    const next = replies && replies[calls.length - 1];
    if (!next) throw new Error("测试未配置此请求");
    if (next.error) {
      callback(next.error, null, null);
      return;
    }
    callback(null, { status: next.status || 200 }, next.body);
  };
  vm.runInNewContext(source, ctx, { filename: "mishop_sign.js" });
  const watchdog = setTimeout(() => finish(), 2000);
  await completed;
  clearTimeout(watchdog);
  return { store, notifications, logs, calls };
}

test("捕获请求：保存 serviceToken、活动参数与去噪后的请求头", () => {
  const { store, notifications, doneValue } = runCapture();
  const [saved] = stored(store);
  assert.equal(saved.token, TOKEN);
  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.activities.map((item) => [item.actId, item.taskToken]), [[ACT_A, "task-a"]]);
  assert.equal(saved.headers.Cookie, undefined);
  assert.equal(saved.headers.Cookie === undefined, true);
  for (const name of Object.keys(saved.headers)) {
    assert.ok(!["host", "content-length", "cookie", "connection", "accept-encoding"].includes(name.toLowerCase()), name);
  }
  assert.equal(saved.headers["x-user-agent"], "channel/mishop platform/smarthome.ios");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][1], "已添加签到账号");
  assert.deepEqual(JSON.parse(JSON.stringify(doneValue)), {});
});

test("捕获请求：同一活动重复捕获不重复通知，新活动只追加一次", () => {
  const first = runCapture();
  const store = first.store;
  const second = runCapture({ store });
  assert.equal(second.notifications.length, 0);
  assert.equal(stored(store)[0].activities.length, 1);

  const third = runCapture({ store, request: captureRequest(ACT_B, "task-b") });
  assert.equal(third.notifications.length, 1);
  assert.equal(third.notifications[0][1], "已更新签到活动");
  assert.deepEqual(stored(store)[0].activities.map((item) => item.actId), [ACT_A, ACT_B]);
});

test("捕获请求：没有 serviceToken 或活动参数时不写入", () => {
  const noToken = runCapture({ request: captureRequest(ACT_A, "task-a", "") });
  assert.equal(noToken.store.has(ACCOUNTS_KEY), false);
  assert.equal(noToken.notifications.length, 0);

  const badBody = runCapture({ request: Object.assign(captureRequest(), { body: "[]" }) });
  assert.equal(badBody.store.has(ACCOUNTS_KEY), false);
  assert.equal(badBody.notifications.length, 0);
});

test("签到成功：按抓包结构发起请求并记录当天日期与连续天数", async () => {
  const store = storeWith([account()]);
  const { notifications, calls } = await runTask({ store, replies: [{ body: okBody(3) }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SIGN_URL);
  assert.equal(calls[0].headers.Cookie, `serviceToken=${TOKEN}`);
  assert.equal(calls[0].headers["Content-Type"], "application/json");
  assert.equal(calls[0].headers["x-user-agent"], "channel/mishop platform/smarthome.ios");
  assert.deepEqual(JSON.parse(calls[0].body), [
    {},
    { taskToken: "task-a", actId: ACT_A, taskType: 110 },
  ]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][1], "签到成功 · 米金 +5");
  assert.equal(notifications[0][2], `账号1 · ${ACT_A_NAME}：米金 +5（连续签到第 3 天）`);
  const [saved] = stored(store);
  assert.equal(saved.activities[0].lastResult, "米金 +5（连续签到第 3 天）");
  assert.equal(saved.activities[0].lastSeries, 3);
  assert.equal(saved.activities[0].lastSignDate, TODAY);
  assert.equal(store.get(LOCK_KEY), "");
});

test("当天已签到：不发请求并跳过，连续天数取自上次结果", async () => {
  const store = storeWith([
    account({
      activities: [
        { actId: ACT_A, taskToken: "task-a", lastSignDate: TODAY, lastResult: "米金 +5", lastSeries: 3 },
      ],
    }),
  ]);
  const { notifications, calls } = await runTask({ store, replies: [] });
  assert.equal(calls.length, 0);
  assert.equal(notifications[0][1], "今日已签到");
  assert.equal(notifications[0][2], `账号1 · ${ACT_A_NAME}：今日已签到（连续签到第 3 天）`);
  assert.equal(stored(store)[0].activities[0].lastResult, "米金 +5");
});

test("业务失败：不写 lastSignDate，下一次仍会重试", async () => {
  const store = storeWith([account()]);
  const { notifications } = await runTask({ store, replies: [{ body: failBody(10001, "任务已完成") }] });
  assert.equal(notifications[0][1], "签到失败 · 1 项");
  assert.equal(notifications[0][2], `失败：\n· 账号1 · ${ACT_A_NAME}：任务已完成`);
  assert.equal(stored(store)[0].activities[0].lastSignDate, undefined);
});

test("code 为 0 但没有奖励：不确认为签到成功", async () => {
  const store = storeWith([account()]);
  const body = JSON.stringify({ code: 0, success: true, data: { taskInfo: { doneInSeriesCount: 2 }, awardList: [] } });
  const { notifications } = await runTask({ store, replies: [{ body }] });
  assert.equal(notifications[0][1], "签到失败 · 1 项");
  assert.match(notifications[0][2], /未发放奖励/);
  assert.equal(stored(store)[0].activities[0].lastSignDate, undefined);
});

test("HTTP 与网络错误不会写入签到日期", async () => {
  const store = storeWith([account()]);
  const { notifications } = await runTask({ store, replies: [{ status: 502, body: "bad gateway" }] });
  assert.match(notifications[0][2], /HTTP 502/);
  assert.equal(stored(store)[0].activities[0].lastSignDate, undefined);
});

test("任务锁被占用时跳过且不产生请求", async () => {
  const store = storeWith([account()]);
  store.set(LOCK_KEY, JSON.stringify({ id: "other", until: NOW + 60000 }));
  const { notifications, calls, logs } = await runTask({ store, replies: [] });
  assert.equal(calls.length, 0);
  assert.equal(notifications.length, 0);
  assert.match(logs.join("\n"), /其他签到任务正在运行/);
});

test("没有账号时提示先抓包", async () => {
  const { notifications } = await runTask({ store: new Map(), replies: [] });
  assert.equal(notifications[0][1], "没有已捕获的账号");
  assert.match(notifications[0][2], /米家 App/);
});

test("账号数据损坏时不覆盖原数据", async () => {
  const store = new Map([[ACCOUNTS_KEY, "{bad json"]]);
  const { notifications } = await runTask({ store, replies: [] });
  assert.equal(store.get(ACCOUNTS_KEY), "{bad json");
  assert.equal(notifications[0][1], "任务未完成");
  assert.match(notifications[0][2], /数据损坏/);
});

test("多账号多活动：逐个请求，已签到的活动跳过", async () => {
  const secondToken = "test-service-token-0000000000000002";
  const store = storeWith([
    account({
      activities: [
        { actId: ACT_A, taskToken: "task-a", lastSignDate: TODAY },
        { actId: ACT_B, taskToken: "task-b" },
      ],
    }),
    account({
      token: secondToken,
      activities: [{ actId: ACT_B, taskToken: "task-b2" }],
    }),
  ]);
  const { notifications, calls } = await runTask({ store, replies: [{ body: okBody(2) }, { body: okBody(1) }] });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers.Cookie, `serviceToken=${secondToken}`);
  assert.equal(notifications[0][1], "签到成功 · 米金 +10");
  const body = notifications[0][2];
  assert.ok(body.includes(`账号1 · ${ACT_A_NAME}：今日已签到`), body);
  assert.ok(body.includes(`账号1 · ${ACT_B_NAME}：米金 +5（连续签到第 2 天）`), body);
  assert.ok(body.includes(`账号2 · ${ACT_B_NAME}：米金 +5（连续签到第 1 天）`), body);
  const touched = stored(store)[0].activities.find((item) => item.actId === ACT_B);
  assert.equal(touched.lastSignDate, TODAY);
});

test("同一账号多个活动：逐活动一行，标题累加奖励", async () => {
  const store = storeWith([
    account({
      activities: [
        { actId: ACT_A, taskToken: "task-a" },
        { actId: ACT_B, taskToken: "task-b" },
      ],
    }),
  ]);
  const { notifications } = await runTask({ store, replies: [{ body: okBody(2) }, { body: okBody(4) }] });
  assert.equal(notifications[0][1], "签到成功 · 米金 +10");
  assert.equal(
    notifications[0][2],
    `账号1 · ${ACT_A_NAME}：米金 +5（连续签到第 2 天）
账号1 · ${ACT_B_NAME}：米金 +5（连续签到第 4 天）`
  );
});

test("部分活动失败：标题带失败数，正文分开列出原因", async () => {
  const store = storeWith([
    account({
      activities: [
        { actId: ACT_A, taskToken: "task-a" },
        { actId: ACT_B, taskToken: "task-b" },
      ],
    }),
  ]);
  const { notifications } = await runTask({ store, replies: [{ body: okBody(2) }, { body: failBody(10001, "活动已下线") }] });
  assert.equal(notifications[0][1], "部分成功 · 米金 +5 · 失败 1");
  assert.equal(
    notifications[0][2],
    `账号1 · ${ACT_A_NAME}：米金 +5（连续签到第 2 天）\n失败：\n· 账号1 · ${ACT_B_NAME}：活动已下线`
  );
});

test("未知 actId：退回 id 前 8 位作为活动名", async () => {
  const unknown = "0123456789abcdef01234567";
  const store = storeWith([account({ activities: [{ actId: unknown, taskToken: "task-x" }] })]);
  const { notifications } = await runTask({ store, replies: [{ body: okBody(1) }] });
  assert.equal(notifications[0][1], "签到成功 · 米金 +5");
  assert.equal(notifications[0][2], "账号1 · 活动 01234567：米金 +5（连续签到第 1 天）");
});
