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
const TODAY = "2030-1-1"; // 与小程序一致：月日不补零

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

// HAR 抓包中的固定随机数与签名，用于校验签名算法是否完全复现。
const HAR_NONCE = 542658;
const HAR_TIMESTAMP = 1792568358;
const HAR_SIGNATURE = "J3RMo4c0LUuZ7VXKfoNIC+lqmQA=";

const RECORDS = "/user/sign/records";
const CONDITION = "/user/sign/condition";
const SAVE = "/user/sign/save";

function state(overrides = {}) {
  return Object.assign(
    {
      token: "TEST-TOKEN-1234567890",
      capturedAt: "2030-01-01T00:00:00.000Z",
      version: "1.1.0",
      common: COMMON,
      params: Object.assign({}, PARAMS),
      headers: { "User-Agent": "TEST-UA", Referer: "https://tm-web.pin-dao.cn/naixue/sign-in" },
    },
    overrides
  );
}

function storeWith(value, extra = {}) {
  const store = new Map(Object.entries(extra));
  if (value !== undefined) store.set(STATE_KEY, typeof value === "string" ? value : JSON.stringify(value));
  return store;
}

async function run({ store = new Map(), request, response, replies = [], clock = NOW, keys = {} } = {}) {
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
        if (!next) throw new Error(`测试未配置第 ${calls.length} 个请求`);
        if (next.throw) throw new Error(next.throw);
        callback(next.error || null, next.response, next.body);
      },
      get: () => { throw new Error("奈雪签到不应使用 GET"); },
    },
  };
  if (request) context.$request = request;
  if (response) context.$response = response;

  vm.runInNewContext(source, context, { timeout: 1000 });
  await completed;
  // 多步流程里 $done 只应被调用一次。
  assert.equal(doneCount, 1, "$done 必须且只能调用一次");
  return { store, notifications, logs, calls, doneValue, saved: () => JSON.parse(store.get(STATE_KEY)) };
}

function signKey(name) {
  const line = source.split("\n").find((item) => item.startsWith(`const ${name} =`));
  return line.split('"')[1];
}

function signature(key, nonce, timestamp) {
  const message = encodeURI(`nonce=${nonce}&openId=${OPEN_ID}&timestamp=${timestamp}`);
  return crypto.createHmac("sha1", key).update(message).digest("base64");
}

function conditionBody({ status, signCount = 3, infos = [] } = {}) {
  const data = { signCoins: [{ date: 1, coin: 1 }] };
  if (status !== undefined) data.status = status;
  if (signCount !== undefined) data.signCount = signCount;
  if (infos.length) data.infos = infos.map((info) => ({ info }));
  return JSON.stringify({ code: 0, success: true, data });
}

function recordsBody({ status, days = [], signCount } = {}) {
  const data = {
    records: days.map((day) => ({ date: day.date, status: day.status })),
  };
  if (status !== undefined) data.status = status;
  if (signCount !== undefined) data.signCount = signCount;
  return JSON.stringify({ code: 0, success: true, data });
}

function saveBody(extra = {}) {
  return JSON.stringify({
    code: 0,
    success: true,
    data: { flag: true, infos: [{ info: "每天签到可获得 1 奈雪币" }] },
    ...extra,
  });
}

function reply(body, status = 200) {
  return { response: { status }, body };
}

/* ------------------------------ 签名 ------------------------------ */

test("签名算法与抓包签名完全一致，且不依赖 Buffer/atob/crypto", async () => {
  const result = await run({
    store: storeWith(state()),
    clock: HAR_TIMESTAMP * 1000,
    replies: [reply(recordsBody({ status: true }))],
  });
  const body = JSON.parse(result.calls[0].body);
  assert.equal(body.common.openId, OPEN_ID);
  assert.equal(body.common.signature, HAR_SIGNATURE);
  assert.ok(!/\b(Buffer|atob|btoa|require)\b/.test(source), "脚本需保持纯 JS 实现");
});

test("品牌与版本决定签名密钥，可被 BoxJS 覆盖", async () => {
  const nai = await run({
    store: storeWith(state()),
    clock: HAR_TIMESTAMP * 1000,
    replies: [reply(recordsBody({ status: true }))],
  });
  const naiBody = JSON.parse(nai.calls[0].body);
  assert.equal(naiBody.common.signature, signature(signKey("SIGN_KEY_NAIXUE"), HAR_NONCE, HAR_TIMESTAMP));

  const other = await run({
    store: storeWith(state({ params: Object.assign({}, PARAMS, { brand: 26000141 }) })),
    clock: HAR_TIMESTAMP * 1000,
    replies: [reply(recordsBody({ status: true }))],
  });
  const otherBody = JSON.parse(other.calls[0].body);
  assert.equal(otherBody.common.signature, signature(signKey("SIGN_KEY_DEFAULT"), HAR_NONCE, HAR_TIMESTAMP));

  const custom = await run({
    store: storeWith(state()),
    clock: HAR_TIMESTAMP * 1000,
    keys: { byhooi_naixue_sign_key: "MY-CUSTOM-KEY" },
    replies: [reply(recordsBody({ status: true }))],
  });
  const customBody = JSON.parse(custom.calls[0].body);
  assert.equal(customBody.common.signature, signature("MY-CUSTOM-KEY", HAR_NONCE, HAR_TIMESTAMP));
});

/* ------------------------------ 先查后签 ------------------------------ */

test("查到今日已签到则不再提交签到请求", async () => {
  const result = await run({
    store: storeWith(state()),
    replies: [reply(recordsBody({ status: true, signCount: 7 }))],
  });
  assert.equal(result.calls.length, 1, "已签到不应再调用 save");
  assert.match(result.calls[0].url, /\/user\/sign\/records$/);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0][1], "今日已签到");
  assert.match(result.notifications[0][2], /连签 7 天/);
  assert.equal(result.saved().lastSignDate, TODAY);
  assert.equal(result.saved().checkedBeforeSign, true);
});

test("status 为 false 时提交签到，复查确认后报告成功", async () => {
  const result = await run({
    store: storeWith(state()),
    replies: [
      reply(recordsBody({ status: false, signCount: 2 })),
      reply(saveBody()),
      reply(recordsBody({ status: true, signCount: 3 })),
    ],
  });
  assert.equal(result.calls.length, 3, "应为 查询 → 签到 → 复查");
  assert.match(result.calls[0].url, /\/user\/sign\/records$/);
  assert.match(result.calls[1].url, /\/user\/sign\/save$/);
  assert.match(result.calls[2].url, /\/user\/sign\/records$/);

  const saved = result.calls.map((call) => JSON.parse(call.body));
  assert.equal(saved[0].params.startDate, "2030-1", "records 传当月，与前端一致");
  assert.equal(saved[1].params.signDate, TODAY, "签到必须带当天日期");
  assert.equal(saved[2].params.startDate, "2030-1", "复查同样查当月");
  saved.forEach((body) => {
    assert.equal(body.params.storeId, PARAMS.storeId, "门店参数必须保留");
  });
  [saved[0], saved[2]].forEach((body) => {
    assert.equal(body.params.signDate, undefined, "records 不应带 signDate");
    assert.ok(body.params.startDate, "records 必须带 startDate");
  });

  assert.equal(result.notifications[0][1], "签到成功 ✅");
  assert.match(result.notifications[0][2], /连签 3 天/);
  assert.equal(result.saved().lastSignDate, TODAY);
});

test("签到后复查仍为未签到时不谎报成功", async () => {
  const result = await run({
    store: storeWith(state()),
    replies: [reply(recordsBody({ status: false })), reply(saveBody()), reply(recordsBody({ status: false, signCount: 2 }))],
  });
  assert.equal(result.notifications[0][1], "签到未确认");
  assert.match(result.notifications[0][2], /仍为未签到/);
  assert.ok(!/成功/.test(result.notifications[0][2]));
});

test("状态字段无法识别时按未知处理，仍照常提交签到", async () => {
  const result = await run({
    store: storeWith(state()),
    replies: [
      reply(JSON.stringify({ code: 0, data: { records: [] } })), // records 里没有 status
      reply(conditionBody({ status: false })), // 降级查 condition
      reply(saveBody()),
      reply(recordsBody({ status: true })),
    ],
  });
  assert.equal(result.calls.length, 4, "无法判断时必须继续提交，不能漏签");
  assert.match(result.calls[0].url, /records$/);
  assert.match(result.calls[1].url, /condition$/, "records 判不出时降级查 condition");
  assert.equal(result.notifications[0][1], "签到成功 ✅");
});

test("records 顶层没有 status 时，用当日明细判定", async () => {
  const signed = await run({
    store: storeWith(state()),
    replies: [reply(recordsBody({ days: [
      { date: "2030-1-1", status: true },
      { date: "2029-12-31", status: true },
    ] }))],
  });
  assert.equal(signed.calls.length, 1, "明细显示今日已签，不应提交");
  assert.equal(signed.notifications[0][1], "今日已签到");

  const pending = await run({
    store: storeWith(state()),
    replies: [
      reply(recordsBody({ days: [{ date: "2030-1-1", status: false }] })),
      reply(saveBody()),
      reply(recordsBody({ status: true, signCount: 5 })),
    ],
  });
  assert.equal(pending.calls.length, 3, "明细显示未签，应提交");
  assert.equal(pending.notifications[0][1], "签到成功 ✅");

  const others = await run({
    store: storeWith(state()),
    replies: [
      // 只有昨天有记录，今天不在明细里 → 判定为未知，仍继续提交
      reply(recordsBody({ days: [{ date: "2029-12-31", status: true }] })),
      reply(recordsBody({ days: [] })),
      reply(saveBody()),
      reply(recordsBody({ status: true })),
    ],
  });
  assert.equal(others.calls.length, 4);
});

test("records 的日期支持补零与紧凑格式", async () => {
  for (const date of ["2030-01-01", "20300101", "2030-1-1"]) {
    const result = await run({
      store: storeWith(state()),
      replies: [reply(recordsBody({ days: [{ date, status: true }] }))],
    });
    assert.equal(result.calls.length, 1, `date=${date} 应识别为今日已签`);
    assert.equal(result.notifications[0][1], "今日已签到");
  }
});

test("status 兼容字符串与数字形式", async () => {
  for (const value of ["true", "1", 1]) {
    const result = await run({
      store: storeWith(state()),
      replies: [reply(conditionBody({ status: value }))],
    });
    assert.equal(result.calls.length, 1, `status=${JSON.stringify(value)} 应视为已签到`);
    assert.equal(result.notifications[0][1], "今日已签到");
  }
  for (const value of ["false", "0", 0]) {
    const result = await run({
      store: storeWith(state()),
      replies: [reply(conditionBody({ status: value })), reply(saveBody()), reply(recordsBody({ status: true }))],
    });
    assert.equal(result.calls.length, 3, `status=${JSON.stringify(value)} 应视为未签到并提交`);
  }
});

test("查询接口异常时降级为直接签到", async () => {
  const result = await run({
    store: storeWith(state()),
    replies: [
      reply('{"code":-1,"message":"服务器内部异常"}'),
      reply('{"code":-1,"message":"服务器内部异常"}'),
      reply(saveBody()),
      reply(recordsBody({ status: true })),
    ],
  });
  assert.equal(result.calls.length, 4);
  assert.equal(result.notifications[0][1], "签到成功 ✅");
});

test("查询请求网络失败时仍尝试签到", async () => {
  const result = await run({
    store: storeWith(state()),
    replies: [
      { error: "The request timed out." },
      { error: "The request timed out." },
      reply(saveBody()),
      reply(recordsBody({ status: true })),
    ],
  });
  assert.equal(result.calls.length, 4);
  assert.equal(result.notifications[0][1], "签到成功 ✅");
});

/* ------------------------------ 失败分支 ------------------------------ */

test("签到接口返回已签到也视为完成，且不谎报本次新签", async () => {
  const result = await run({
    store: storeWith(state()),
    replies: [
      reply(recordsBody({ status: false })),
      reply(JSON.stringify({ code: 1000001, message: "今日已签到" })),
    ],
  });
  assert.equal(result.calls.length, 2, "识别为已签到后不再复查");
  assert.equal(result.notifications[0][1], "今日已签到");
  assert.ok(!/成功/.test(result.notifications[0][2]));
  assert.equal(result.saved().lastSignDate, TODAY);
});

test("凭证失效与签名被拒分别给出不同指引", async () => {
  const expired = await run({
    store: storeWith(state()),
    replies: [
      reply(recordsBody({ status: false })),
      reply(JSON.stringify({ code: 1500000, message: "用户未登录，请登录！" })),
    ],
  });
  assert.equal(expired.notifications[0][1], "签到失败");
  assert.match(expired.notifications[0][2], /失效/);
  assert.match(expired.saved().lastResult, /^失败：/);

  const unauthorized = await run({
    store: storeWith(state()),
    replies: [reply(recordsBody({ status: false })), reply("unauthorized", 401)],
  });
  assert.equal(unauthorized.notifications[0][1], "签到失败");
  assert.match(unauthorized.notifications[0][2], /失效/);

  const rejected = await run({
    store: storeWith(state()),
    replies: [reply(recordsBody({ status: false })), reply('{"message":"request sign is not valid"}', 400)],
  });
  assert.equal(rejected.notifications[0][1], "签到失败");
  assert.match(rejected.notifications[0][2], /拒绝/);

  const serverError = await run({
    store: storeWith(state()),
    replies: [reply(recordsBody({ status: false })), reply("<html>500</html>", 500)],
  });
  assert.equal(serverError.notifications[0][1], "签到失败");
  assert.match(serverError.notifications[0][2], /HTTP 500/);
});

test("缺少凭证或门店参数时不发请求", async () => {
  const empty = await run({ replies: [] });
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.notifications[0][1], "缺少 accessToken");

  const broken = await run({ store: storeWith("{not-json}"), replies: [] });
  assert.equal(broken.calls.length, 0);

  const noBrand = await run({ store: storeWith(state({ params: { storeId: 26073958 } })), replies: [] });
  assert.equal(noBrand.calls.length, 0);
  assert.equal(noBrand.notifications[0][1], "缺少门店参数");
});

/* ------------------------------ 抓取 ------------------------------ */

test("抓取凭证：保存 token、门店参数与请求头，不保存 Cookie", async () => {
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
      body: JSON.stringify({
        common: COMMON,
        params: Object.assign({}, PARAMS, { signDate: "2019-05-05" }),
      }),
    },
  });
  assert.equal(first.notifications.length, 1);
  assert.equal(first.calls.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(first.doneValue)), {});
  const saved = JSON.parse(store.get(STATE_KEY));
  assert.equal(saved.token, "TOKEN-AAA-1111");
  assert.equal(saved.params.storeId, PARAMS.storeId);
  assert.equal(saved.params.signDate, undefined, "signDate 不应写入 state");
  assert.equal(saved.headers.Referer, "https://tm-web.pin-dao.cn/naixue/sign-in");
  assert.ok(!store.get(STATE_KEY).includes("SECRET_SHOULD_NOT_BE_STORED"), "不应保存 Cookie");

  const again = await run({
    store,
    request: {
      url: "https://tm-web.pin-dao.cn/user/sign/condition",
      headers: { Authorization: "Bearer TOKEN-AAA-1111", "User-Agent": "UA-1", Referer: "https://tm-web.pin-dao.cn/naixue/sign-in" },
      body: JSON.stringify({ common: COMMON, params: PARAMS }),
    },
  });
  assert.equal(again.notifications.length, 0, "无变化时不应通知");

  const changed = await run({
    store,
    request: {
      url: "https://tm-web.pin-dao.cn/user/sign/save",
      headers: { Authorization: "Bearer TOKEN-BBB-2222", "User-Agent": "UA-2" },
      body: JSON.stringify({ common: COMMON, params: Object.assign({}, PARAMS, { storeId: 26010435, cityId: 110100 }) }),
    },
  });
  assert.equal(changed.notifications.length, 1);
  const updated = JSON.parse(store.get(STATE_KEY));
  assert.equal(updated.token, "TOKEN-BBB-2222");
  assert.equal(updated.params.storeId, 26010435);
});

test("无 Authorization 的请求不写入数据", async () => {
  const result = await run({ request: { url: "https://tm-web.pin-dao.cn/user/sign/condition", headers: {}, body: "" } });
  assert.equal(result.store.has(STATE_KEY), false);
  assert.equal(result.notifications.length, 0);
});

test("http-response 记录签到状态原始响应且不改写响应", async () => {
  const store = storeWith(state());
  const raw = conditionBody({ status: true, signCount: 9 });
  const result = await run({
    store,
    request: { url: "https://tm-web.pin-dao.cn/user/sign/condition", headers: {} },
    response: { status: 200, body: raw },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.doneValue)), {}, "不应改写响应体");
  const saved = JSON.parse(store.get(STATE_KEY));
  assert.equal(saved.lastConditionRaw, raw);
  assert.ok(saved.lastConditionAt);
  assert.equal(saved.token, "TEST-TOKEN-1234567890", "记录响应不能影响已有凭证");
  assert.equal(result.calls.length, 0, "抓取响应不应发请求");
});

test("http-response 对非 JSON 与超长内容安全处理", async () => {
  const store = storeWith(state());
  const long = JSON.stringify({ code: 0, data: { status: true, pad: "x".repeat(2000) } });
  const result = await run({
    store,
    request: { url: "https://tm-web.pin-dao.cn/user/sign/records", headers: {} },
    response: { status: 200, body: long },
  });
  const saved = JSON.parse(store.get(STATE_KEY));
  assert.ok(saved.lastRecordsRaw.length <= 803, "原始响应需截断");
  assert.ok(saved.lastRecordsRaw.endsWith("..."));
  assert.equal(result.notifications.length, 0);

  const html = await run({
    store: storeWith(state()),
    request: { url: "https://tm-web.pin-dao.cn/user/sign/condition", headers: {} },
    response: { status: 200, body: "<html>nope</html>" },
  });
  assert.equal(JSON.parse(html.store.get(STATE_KEY)).lastConditionRaw, undefined);
});
