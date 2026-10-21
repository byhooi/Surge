const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../Script/naixue_sign.js"), "utf8");
const STATE_KEY = "byhooi_naixue_state";
const OPEN_ID = "QL6ZOftGzbziPlZwfiXM";
const NOW = Date.UTC(2030, 0, 1, 1, 0, 0); // 北京时间 2030-01-01 09:00
const TODAY = "2030-01-01";

const PARAMS = {
  businessType: 1,
  brand: 26000252,
  tenantId: 1,
  channel: 2,
  stallType: "PD_S_004",
  storeId: 26073958,
  storeType: 1,
  cityId: 440300,
  districtId: 440307,
  appId: "wxab7430e6e8b9a4ab",
  dAId: 100019,
};

const COMMON = { platform: "wxapp", version: "6.0.86", lang: "zh_CN", currency: "CNY", osn: "iPhone 17<iPhone18,3>", sv: "iOS 27.0.1" };

// 与 HAR 抓包一致的固定随机数，用于校验签名算法是否完全复现。
const HAR_NONCE = 542658;
const HAR_TIMESTAMP = 1792568358;
const HAR_SIGNATURE = "J3RMo4c0LUuZ7VXKfoNIC+lqmQA=";

function state(overrides = {}) {
  return {
    token: "TEST-TOKEN-1234567890",
    capturedAt: "2030-01-01T00:00:00.000Z",
    version: "1.0.0",
    common: COMMON,
    params: Object.assign({}, PARAMS),
    headers: { "User-Agent": "TEST-UA", Referer: "https://tm-web.pin-dao.cn/naixue/sign-in" },
    ...overrides,
  };
}

function storeWith(value) {
  const store = new Map();
  if (value !== undefined) store.set(STATE_KEY, typeof value === "string" ? value : JSON.stringify(value));
  return store;
}

async function run({ store = new Map(), request, replies = [], clock = NOW, keys = {} } = {}) {
  const notifications = [];
  const logs = [];
  const calls = [];
  let doneValue;
  let doneCount = 0;
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });

  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  // 固定随机数，便于校验签名结果与抓包一致。
  const MockMath = Object.create(Math);
  MockMath.random = () => (HAR_NONCE + 0.5) / 1e6;

  const context = {
    Date: MockDate,
    Math: MockMath,
    console: { log: (line) => logs.push(String(line)) },
    $persistentStore: {
      read: (key) => (keys[key] !== undefined ? keys[key] : store.has(key) ? store.get(key) : null),
      write: (value, key) => { store.set(key, value); return true; },
    },
    $notification: { post: (...args) => notifications.push(args) },
    $done: (value) => { doneCount += 1; doneValue = value; finish(); },
    $httpClient: {
      post: (options, callback) => {
        calls.push(options);
        const next = replies[calls.length - 1];
        if (!next) throw new Error("测试未配置此请求");
        callback(next.error || null, next.response, next.body);
      },
      get: () => { throw new Error("奈雪签到不应使用 GET"); },
    },
  };
  if (request) context.$request = request;

  vm.runInNewContext(source, context, { timeout: 1000 });
  await completed;
  assert.equal(doneCount, 1, "$done 必须且只能调用一次");
  return { store, notifications, logs, calls, doneValue };
}

function signature(key, nonce, timestamp) {
  const message = encodeURI(`nonce=${nonce}&openId=${OPEN_ID}&timestamp=${timestamp}`);
  return crypto.createHmac("sha1", key).update(message).digest("base64");
}

function signKey(name) {
  const line = source.split("\n").find((item) => item.startsWith(`const ${name} =`));
  return line.split('"')[1];
}

function captureBody(overrides = {}) {
  return JSON.stringify({
    common: Object.assign({}, COMMON, { nonce: 1, openId: OPEN_ID, timestamp: HAR_TIMESTAMP, signature: "x" }),
    params: Object.assign({}, PARAMS, overrides),
  });
}

test("签名算法与抓包签名完全一致，且不依赖 atob/Buffer/crypto", async () => {
  const result = await run({
    store: storeWith(state({ params: Object.assign({}, PARAMS, { signDate: "2020-01-01" }) })),
    clock: HAR_TIMESTAMP * 1000,
    replies: [{ response: { status: 200 }, body: JSON.stringify({ code: 0, data: { flag: true, infos: [] } }) }],
  });
  assert.equal(result.calls.length, 1);
  const body = JSON.parse(result.calls[0].body);
  assert.equal(body.common.openId, OPEN_ID);
  assert.equal(body.common.signature, HAR_SIGNATURE);
  assert.ok(!/\b(Buffer|atob|btoa|require)\b/.test(source), "脚本需保持纯 JS 实现");
});

test("不同品牌/版本选择不同签名密钥，可被 BoxJS 覆盖", async () => {
  const har = await run({
    store: storeWith(state({
      common: Object.assign({}, COMMON, { version: "6.0.86" }),
      params: Object.assign({}, PARAMS, { brand: 26000252 }),
    })),
    clock: HAR_TIMESTAMP * 1000,
    replies: [{ response: { status: 200 }, body: '{"code":0,"data":{"flag":true}}' }],
  });
  const harBody = JSON.parse(har.calls[0].body);
  assert.equal(harBody.common.signature, signature(signKey("SIGN_KEY_NAIXUE"), harBody.common.nonce, HAR_TIMESTAMP));

  const other = await run({
    store: storeWith(state({ params: Object.assign({}, PARAMS, { brand: 26000141 }) })),
    clock: HAR_TIMESTAMP * 1000,
    replies: [{ response: { status: 200 }, body: '{"code":0,"data":{"flag":true}}' }],
  });
  const otherBody = JSON.parse(other.calls[0].body);
  assert.equal(otherBody.common.signature, signature(signKey("SIGN_KEY_DEFAULT"), otherBody.common.nonce, HAR_TIMESTAMP));

  const custom = await run({
    store: storeWith(state()),
    clock: HAR_TIMESTAMP * 1000,
    keys: { byhooi_naixue_sign_key: "MY-CUSTOM-KEY" },
    replies: [{ response: { status: 200 }, body: '{"code":0,"data":{"flag":true}}' }],
  });
  const customBody = JSON.parse(custom.calls[0].body);
  assert.equal(customBody.common.signature, signature("MY-CUSTOM-KEY", customBody.common.nonce, HAR_TIMESTAMP));
});

test("抓取凭证：保存 Authorization、门店参数与请求头，未变化时不重复通知", async () => {
  const store = new Map();
  const first = await run({
    store,
    request: {
      url: "https://tm-web.pin-dao.cn/user/sign/save",
      headers: {
        Authorization: "Bearer TOKEN-AAA-1111",
        "User-Agent": "UA-1",
        Referer: "https://tm-web.pin-dao.cn/naixue/sign-in?sf=&accessToken=TOKEN-AAA-1111",
        Cookie: "sensorsdata=SECRET_SHOULD_NOT_BE_STORED",
      },
      body: captureBody(),
    },
  });
  assert.equal(first.notifications.length, 1);
  assert.equal(first.calls.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(first.doneValue)), {});
  const saved = JSON.parse(store.get(STATE_KEY));
  assert.equal(saved.token, "TOKEN-AAA-1111");
  assert.equal(saved.params.storeId, PARAMS.storeId);
  assert.equal(saved.headers.Referer, "https://tm-web.pin-dao.cn/naixue/sign-in");
  assert.equal(saved.common.platform, "wxapp");
  assert.ok(!store.get(STATE_KEY).includes("SECRET_SHOULD_NOT_BE_STORED"), "不应保存 Cookie");

  const again = await run({
    store,
    request: {
      url: "https://tm-web.pin-dao.cn/user/sign/condition",
      headers: { Authorization: "Bearer TOKEN-AAA-1111", "User-Agent": "UA-1", Referer: "https://tm-web.pin-dao.cn/naixue/sign-in" },
      body: captureBody(),
    },
  });
  assert.equal(again.notifications.length, 0, "凭证与参数未变化时不应通知");

  const changed = await run({
    store,
    request: {
      url: "https://tm-web.pin-dao.cn/user/sign/save",
      headers: { Authorization: "Bearer TOKEN-BBB-2222", "User-Agent": "UA-2" },
      body: captureBody({ storeId: 26010435, cityId: 110100 }),
    },
  });
  assert.equal(changed.notifications.length, 1);
  const updated = JSON.parse(store.get(STATE_KEY));
  assert.equal(updated.token, "TOKEN-BBB-2222");
  assert.equal(updated.params.storeId, 26010435);
  assert.equal(updated.headers["User-Agent"], "UA-2");
});

test("无 Authorization 的请求不写入数据，也不报错", async () => {
  const result = await run({
    request: { url: "https://tm-web.pin-dao.cn/user/sign/condition", headers: {}, body: "" },
  });
  assert.equal(result.store.has(STATE_KEY), false);
  assert.equal(result.notifications.length, 0);
});

test("定时签到使用当天日期并重算签名，成功后写入结果", async () => {
  const result = await run({
    store: storeWith(state({ params: Object.assign({}, PARAMS, { signDate: "2019-05-05" }) })),
    replies: [{
      response: { status: 200 },
      body: JSON.stringify({ code: 0, success: true, data: { flag: true, infos: [{ info: "每天签到可获得 1 奈雪币" }] } }),
    }],
  });
  assert.equal(result.calls.length, 1);
  const options = result.calls[0];
  assert.equal(options.url, "https://tm-web.pin-dao.cn/user/sign/save");
  assert.equal(options.headers.Authorization, "Bearer TEST-TOKEN-1234567890");
  const body = JSON.parse(options.body);
  assert.equal(body.params.signDate, TODAY, "signDate 必须按当天重算");
  assert.equal(body.params.brand, PARAMS.brand);
  assert.equal(body.common.openId, OPEN_ID);
  assert.ok(body.common.nonce >= 0 && body.common.nonce < 1e6, "nonce 应为 6 位以内整数");
  assert.equal(body.common.timestamp, NOW / 1000);
  assert.equal(body.common.signature, signature(signKey("SIGN_KEY_NAIXUE"), body.common.nonce, body.common.timestamp));

  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0][1], "签到成功 ✅");
  const saved = JSON.parse(result.store.get(STATE_KEY));
  assert.equal(saved.lastSignDate, TODAY);
  assert.match(saved.lastResult, /奈雪币/);
});

test("已签到与凭证失效分别给出不同结论", async () => {
  const signed = await run({
    store: storeWith(state()),
    replies: [{ response: { status: 200 }, body: JSON.stringify({ code: 1000001, message: "今日已签到" }) }],
  });
  assert.equal(signed.notifications[0][1], "今日已签到");

  const expired = await run({
    store: storeWith(state()),
    replies: [{ response: { status: 200 }, body: JSON.stringify({ code: 1500000, message: "用户未登录，请登录！" }) }],
  });
  assert.equal(expired.notifications[0][1], "签到失败");
  assert.match(expired.notifications[0][2], /失效/);
  assert.match(JSON.parse(expired.store.get(STATE_KEY)).lastResult, /^失败：/);

  const status401 = await run({
    store: storeWith(state()),
    replies: [{ response: { status: 401 }, body: "unauthorized" }],
  });
  assert.equal(status401.notifications[0][1], "签到失败");

  const rejected = await run({
    store: storeWith(state()),
    replies: [{ response: { status: 400 }, body: '{"message":"request sign is not valid"}' }],
  });
  assert.equal(rejected.notifications[0][1], "签到失败");
  assert.match(rejected.notifications[0][2], /签名|拒绝/);
});

test("缺少凭证或门店参数时给出操作指引且不发请求", async () => {
  const empty = await run({ replies: [] });
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.notifications[0][1], "缺少 accessToken");

  const broken = await run({ store: storeWith("{not-json}"), replies: [] });
  assert.equal(broken.calls.length, 0);
  assert.equal(broken.notifications[0][1], "缺少 accessToken");

  const noBrand = await run({
    store: storeWith(state({ params: { storeId: 26073958 } })),
    replies: [],
  });
  assert.equal(noBrand.calls.length, 0);
  assert.equal(noBrand.notifications[0][1], "缺少门店参数");
});

test("非 JSON 响应与网络错误不会抛出未捕获异常", async () => {
  const html = await run({
    store: storeWith(state()),
    replies: [{ response: { status: 500 }, body: "<html>500 Internal Server Error</html>" }],
  });
  assert.equal(html.notifications[0][1], "签到失败");
  assert.match(html.notifications[0][2], /HTTP 500/);

  const network = await run({
    store: storeWith(state()),
    replies: [{ error: "The request timed out." }],
  });
  assert.equal(network.notifications[0][1], "签到失败");
  assert.match(network.notifications[0][2], /timed out/);
});
