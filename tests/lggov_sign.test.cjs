const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../Script/lggov_sign.js"), "utf8");
const KEY = "byhooi_lggov_accounts";
const LOCK = "byhooi_lggov_lock";
const NOW = Date.UTC(2030, 0, 2, 0, 20);
const BASE = "https://tsg.lggov.cn/userHub/opac/";

function token(cardno, seconds = 60000, extra = {}, urlSafe = true) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString(urlSafe ? "base64url" : "base64");
  return `Bearer ${encode({ alg: "SM2", typ: "JWT" })}.${encode({ cardno, exp: NOW / 1000 + seconds, ...extra })}.TEST_SIGNATURE`;
}

function account(cardno, seconds = 60000, extra = {}) {
  return { cardno, token: token(cardno, seconds), expiresAt: NOW + seconds * 1000, enabled: true, ...extra };
}

function storeWith(accounts) {
  return new Map([[KEY, JSON.stringify(accounts)]]);
}

function stored(store) {
  return JSON.parse(store.get(KEY));
}

function reply(data, headers = {}, status = 200, code = 0) {
  return { response: { status, headers }, body: JSON.stringify({ code, msg: "", data }) };
}

async function run({ store = new Map(), request, response, mode, replies = [], failWrite = false, clock = NOW, fastTimeout = false, nativeTimers = false } = {}) {
  const notifications = [];
  const logs = [];
  const calls = [];
  const timers = [];
  let doneCount = 0;
  let doneValue;
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const context = {
    Date: MockDate,
    setTimeout: (fn, delay) => {
      const timer = setTimeout(fn, fastTimeout ? 0 : delay);
      timers.push(timer);
      return timer;
    },
    console: { log: (line) => logs.push(line) },
    $persistentStore: {
      read: (key) => store.get(key) || null,
      write: (value, key) => { if (failWrite) return false; store.set(key, value); return true; },
    },
    $notification: { post: (...args) => notifications.push(args) },
    $done: (value) => { doneCount++; doneValue = value; finish(); },
    $httpClient: {},
  };
  if (!nativeTimers) context.clearTimeout = clearTimeout;
  for (const method of ["get", "post"]) {
    context.$httpClient[method] = (options, callback) => {
      calls.push({ method, options });
      const next = replies[calls.length - 1];
      if (!next) throw new Error("测试未配置此请求");
      if (next.pending) return;
      clock += next.advanceMs || 0;
      if (next.beforeReply) next.beforeReply(store);
      callback(next.error || null, next.response, next.body);
    };
  }
  if (request) context.$request = request;
  if (response) context.$response = response;
  if (mode !== undefined) context.$argument = mode;
  const watchdog = setTimeout(() => finish(), 1500);
  try {
    vm.runInNewContext(source, context, { timeout: 1000 });
    await completed;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(doneCount, 1, "$done 必须且只能调用一次");
  } finally {
    clearTimeout(watchdog);
    timers.forEach(clearTimeout);
  }
  return { store, notifications, logs, calls, doneValue };
}

function capture(store, cardno, seconds = 60000, extra = {}) {
  return run({
    store,
    request: { url: BASE + "reader/info", headers: { Authorization: token(cardno, seconds - 10) } },
    response: { status: 200, headers: { authorization: token(cardno, seconds) } },
    ...extra,
  });
}

test("优先保存响应 Token，多账号不覆盖，同账号更新且不重复通知", async () => {
  const store = new Map();
  const first = await capture(store, "TEST-A-1001");
  assert.equal(first.notifications.length, 1);
  assert.equal(first.calls.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(first.doneValue)), {});
  await capture(store, "TEST-B-2002");
  const update = await capture(store, "TEST-A-1001", 70000);
  assert.equal(stored(store).length, 2);
  assert.equal(stored(store)[0].token, token("TEST-A-1001", 70000));
  assert.equal(update.notifications.length, 0);
  assert.equal(stored(store)[1].cardno, "TEST-B-2002");
});

test("支持带填充的标准 Base64 和 UTF-8 元数据，不依赖 atob/Buffer", async () => {
  const result = await capture(new Map(), "TEST-1001", 60000, {
    response: { status: 200, headers: { AUTHORIZATION: token("TEST-1001", 60000, { nickname: "测试读者" }, false) } },
  });
  assert.equal(stored(result.store)[0].cardno, "TEST-1001");
});

test("无响应 Token 时个人信息可回退请求头，切换账号不可回退", async () => {
  const first = await capture(new Map(), "TEST-1001", 60000, { response: { status: 200, headers: {} } });
  assert.equal(stored(first.store)[0].token, token("TEST-1001", 59990));
  const second = await run({
    request: { url: BASE + "reader/cards/switch", headers: { Authorization: token("TEST-OLD") } },
    response: { status: 200, headers: {} },
  });
  assert.equal(second.store.has(KEY), false);
});

test("切换响应的新读者证单独保存，不关联到旧读者证", async () => {
  const store = storeWith([account("TEST-OLD")]);
  await capture(store, "TEST-NEW", 60000, {
    request: { url: BASE + "reader/cards/switch", headers: { Authorization: token("TEST-OLD") } },
  });
  assert.deepEqual(stored(store).map((a) => a.cardno), ["TEST-OLD", "TEST-NEW"]);
});

test("拒绝无效、过期或无身份 Token，不覆盖旧数据", async () => {
  for (const value of ["Bearer INVALID_PRIVATE_VALUE", token("TEST-1001", -1), token("", 100)]) {
    const store = storeWith([account("TEST-OLD")]);
    const before = store.get(KEY);
    const result = await capture(store, "TEST-1001", 60000, { response: { status: 200, headers: { Authorization: value } } });
    assert.equal(store.get(KEY), before);
    assert.ok(!JSON.stringify([result.logs, result.notifications]).includes("INVALID_PRIVATE_VALUE"));
  }
});

test("不捕获无关域名和失败响应；较旧响应不回退有效期，停用状态保留", async () => {
  const store = storeWith([account("TEST-1001", 70000, { enabled: false })]);
  await capture(store, "TEST-1001", 60000);
  assert.equal(stored(store)[0].expiresAt, NOW + 70000000);
  await capture(store, "TEST-1001", 80000);
  assert.equal(stored(store)[0].enabled, false);
  await capture(store, "TEST-NEW", 60000, { request: { url: "https://example.com/userHub/opac/reader/info" } });
  await capture(store, "TEST-NEW", 60000, { response: { status: 401, headers: { Authorization: token("TEST-NEW") } } });
  assert.equal(stored(store).length, 1);
});

test("签到空请求体，保存滚动 Token，再用新 Token 查询总积分", async () => {
  const store = storeWith([account("TEST-1001")]);
  const result = await run({ store, replies: [reply(true, { authorization: token("TEST-1001", 70000) }), reply({ cardno: "TEST-1001", total_points: 8 }, { Authorization: token("TEST-1001", 80000) })] });
  assert.deepEqual(result.calls.map((r) => r.method), ["post", "get"]);
  assert.equal(result.calls[0].options.url, BASE + "login/points");
  assert.equal(result.calls[0].options.body, undefined);
  assert.equal(result.calls[0].options["auto-redirect"], false);
  assert.equal(result.calls[0].options["auto-cookie"], false);
  assert.equal(result.calls[1].options.headers.Authorization, token("TEST-1001", 70000));
  assert.equal(stored(store)[0].token, token("TEST-1001", 80000));
  assert.equal(stored(store)[0].lastSignDate, "2030-01-02");
  assert.equal(stored(store)[0].totalPoints, 8);
  assert.match(result.notifications[0][2], /签到成功，总积分 8/);
  assert.equal(store.get(LOCK), "");
});

test("按北京时间去重，次日才重新签到", async () => {
  const store = storeWith([account("TEST-1001", 60000, { lastSignDate: "2030-01-02" })]);
  const today = await run({ store });
  assert.equal(today.calls.length, 0);
  const nextDay = Date.UTC(2030, 0, 2, 16, 0);
  const tomorrow = await run({ store, clock: nextDay, replies: [reply(true), reply({ total_points: 9 })] });
  assert.equal(tomorrow.calls.length, 2);
  assert.equal(stored(store)[0].lastSignDate, "2030-01-03");
});

test("false/0 不宣称成功；未知返回值不记录签到", async () => {
  for (const value of [false, 0, "0", null, {}, "unexpected"]) {
    const store = storeWith([account("TEST-1001")]);
    const result = await run({ store, replies: [reply(value), reply({ total_points: 8 })] });
    assert.equal(stored(store)[0].lastSignDate, undefined);
    assert.ok(!result.notifications[0][2].includes("签到成功"));
  }
});

test("网页兼容的数字和字符串 1 均视为成功", async () => {
  for (const value of [1, "1"]) {
    const store = storeWith([account("TEST-1001")]);
    await run({ store, replies: [reply(value), reply({})] });
    assert.equal(stored(store)[0].lastSignDate, "2030-01-02");
  }
});

test("过期账号跳过且继续其他账号，停用账号不发请求", async () => {
  const store = storeWith([account("TEST-EXPIRED", -1), account("TEST-DISABLED", 60000, { enabled: false }), account("TEST-OK")]);
  const result = await run({ store, replies: [reply(true), reply({ total_points: 5 })] });
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].options.headers.Authorization, token("TEST-OK"));
  assert.match(result.notifications[0][2], /Token 已过期/);
  assert.equal(stored(store)[2].lastSignDate, "2030-01-02");
});

test("HTTP/业务错误和非 JSON 不记录成功、不打印服务端敏感正文", async () => {
  const badResponses = [
    reply(true, {}, 401), reply(true, {}, 403), reply(true, {}, 302), reply(true, {}, 500),
    reply(true, {}, 200, 401), reply(true, {}, 200, 500),
    { response: { status: 200 }, body: "<html>PRIVATE_SERVER_BODY</html>" },
    { error: "PRIVATE_NETWORK_ERROR" },
  ];
  for (const bad of badResponses) {
    const store = storeWith([account("TEST-1001"), account("TEST-2002")]);
    const result = await run({ store, replies: [bad, reply(true), reply({})] });
    assert.equal(stored(store)[0].lastSignDate, undefined);
    assert.equal(stored(store)[1].lastSignDate, "2030-01-02");
    assert.ok(!JSON.stringify([result.logs, result.notifications]).includes("PRIVATE_"));
  }
});

test("响应 Token 串号时拒绝覆盖，不新增第三个账号", async () => {
  const store = storeWith([account("TEST-1001")]);
  const result = await run({ store, replies: [reply(true, { Authorization: token("TEST-OTHER", 80000) })] });
  assert.equal(stored(store).length, 1);
  assert.equal(stored(store)[0].token, token("TEST-1001"));
  assert.match(result.notifications[0][2], /其他读者证/);
});

test("续期只查询个人信息，成功延长时静默，内层 Token 过期不阻止", async () => {
  const a = account("TEST-1001");
  a.token = token(a.cardno, 60000, { sz_token_expires_at: NOW / 1000 - 100 });
  const store = storeWith([a]);
  const result = await run({ store, mode: "refresh", replies: [reply({ cardno: a.cardno }, { Authorization: token(a.cardno, 80000) })] });
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].method, "get");
  assert.equal(result.notifications.length, 0);
  assert.equal(stored(store)[0].expiresAt, NOW + 80000000);
});

test("续期未延长提醒；个人信息串号不保存响应 Token", async () => {
  const store = storeWith([account("TEST-1001")]);
  const result = await run({ store, mode: "refresh", replies: [reply({ total_points: 8 })] });
  assert.match(result.notifications[0][2], /未观察到续期/);
  const mismatch = await run({ store, mode: "refresh", replies: [reply({ cardno: "TEST-OTHER" }, { Authorization: token("TEST-1001", 90000) })] });
  assert.match(mismatch.notifications[0][2], /不匹配/);
  assert.equal(stored(store)[0].expiresAt, NOW + 60000000);
});

test("签到成功后积分查询失败仍保留成功状态", async () => {
  const store = storeWith([account("TEST-1001")]);
  const result = await run({ store, replies: [reply(true), { error: "NETWORK_ERROR" }] });
  assert.equal(stored(store)[0].lastSignDate, "2030-01-02");
  assert.match(result.notifications[0][2], /查询积分失败/);
});

test("保存前重读，保留新捕获账号，不以迟到响应覆盖重新登录的 Token", async () => {
  const store = storeWith([account("TEST-1001")]);
  const delayed = reply(true, { Authorization: token("TEST-1001", 90000) });
  delayed.beforeReply = (data) => data.set(KEY, JSON.stringify([account("TEST-1001", 80000), account("TEST-NEW")]));
  const result = await run({ store, replies: [delayed, reply({})] });
  assert.equal(stored(store).length, 2);
  assert.equal(stored(store)[0].token, token("TEST-1001", 80000));
  assert.equal(result.calls[1].options.headers.Authorization, token("TEST-1001", 80000));
});

test("请求期间删除账号不会被响应重新添加", async () => {
  const store = storeWith([account("TEST-1001")]);
  const response = reply(true, { Authorization: token("TEST-1001", 90000) });
  response.beforeReply = (data) => data.set(KEY, "[]");
  await run({ store, replies: [response] });
  assert.deepEqual(stored(store), []);
});

test("损坏数据不覆盖，写失败不宣称保存成功", async () => {
  for (const raw of ["INVALID_JSON", "{}", '[{"cardno":"same"},{"cardno":"same"}]']) {
    const store = new Map([[KEY, raw]]);
    const result = await capture(store, "TEST-1001");
    assert.equal(store.get(KEY), raw);
    assert.match(result.notifications[0][1], /未完成/);
  }
  const failed = await capture(new Map(), "TEST-1001", 60000, { failWrite: true });
  assert.equal(failed.store.has(KEY), false);
  assert.match(failed.notifications[0][2], /保存失败/);
});

test("活动任务锁阻止重叠，过期锁恢复，空账号提示获取凭证", async () => {
  const store = storeWith([account("TEST-1001")]);
  store.set(LOCK, JSON.stringify({ id: "active", until: NOW + 1000 }));
  const locked = await run({ store });
  assert.equal(locked.calls.length, 0);
  assert.match(store.get(LOCK), /active/);
  store.set(LOCK, JSON.stringify({ id: "expired", until: NOW - 1 }));
  const recovered = await run({ store, replies: [reply(true), reply({})] });
  assert.equal(recovered.calls.length, 2);
  assert.equal(store.get(LOCK), "");
  const empty = await run();
  assert.equal(empty.calls.length, 0);
  assert.match(empty.notifications[0][1], /没有启用/);
});

test("无回调请求会超时结束且不自动重试", async () => {
  const result = await run({ store: storeWith([account("TEST-1001")]), replies: [{ pending: true }], fastTimeout: true });
  assert.equal(result.calls.length, 1);
  assert.match(result.notifications[0][2], /超时/);
});

test("预算耗尽时通知未处理账号，下次优先处理未运行账号", async () => {
  const store = storeWith([account("TEST-1001"), account("TEST-2002")]);
  const slow = reply(true);
  slow.advanceMs = 65000;
  const result = await run({ store, replies: [slow, reply({})] });
  assert.equal(result.calls.length, 2);
  assert.match(result.notifications[0][2], /本轮时间或账号配额不足/);
  assert.equal(stored(store)[1].lastRunAt, undefined);
  const retry = await run({ store, replies: [reply(true), reply({})] });
  assert.equal(retry.calls[0].options.headers.Authorization, token("TEST-2002"));
  assert.equal(stored(store)[1].lastSignDate, "2030-01-02");
});

test("Surge 原生引擎缺少 clearTimeout 时仍能完成签到", async () => {
  const store = storeWith([account("TEST-1001")]);
  const result = await run({ store, nativeTimers: true, replies: [reply(true), reply({ total_points: 3 })] });
  assert.equal(stored(store)[0].lastSignDate, "2030-01-02");
  assert.match(result.notifications[0][2], /签到成功/);
});

test("每轮最多 30 个账号，避免原生计时器超过 64 个限制", async () => {
  const accounts = Array.from({ length: 31 }, (_, i) => account(`TEST-${i}`));
  const replies = accounts.flatMap(() => [reply(true), reply({})]);
  const result = await run({ store: storeWith(accounts), replies, nativeTimers: true });
  assert.equal(result.calls.length, 60);
  assert.equal(stored(result.store)[30].lastSignDate, undefined);
  assert.match(result.notifications[0][2], /账号配额不足/);
});

test("日志及通知不暴露 Token 和完整证号", async () => {
  const a = account("TEST-PRIVATE-1234");
  const result = await run({ store: storeWith([a]), replies: [reply(true), reply({ total_points: 3 })] });
  const output = JSON.stringify([result.logs, result.notifications]);
  assert.ok(!output.includes(a.cardno));
  assert.ok(!output.includes(a.token));
  assert.match(output, /\*\*\*\*1234/);
});

test("模块捕获范围、计划任务与 BoxJS 配置一致", () => {
  const moduleText = fs.readFileSync(path.join(__dirname, "../Module/lggov_sign.sgmodule"), "utf8");
  const captureLine = moduleText.split(/\r?\n/).find((line) => line.includes("type=http-response"));
  const pattern = new RegExp(captureLine.match(/pattern=(.*?),requires-body/)[1]);
  for (const route of ["reader/info", "reader/login", "reader/cards/switch", "login/points?test=1"]) assert.ok(pattern.test(BASE + route));
  assert.ok(!pattern.test(BASE + "reader/info/extra"));
  assert.ok(!pattern.test("https://evil.example/userHub/opac/reader/info"));
  assert.match(moduleText, /argument=refresh/);
  assert.match(moduleText, /定时续期:15 \*\/12 \* \* \*/);
  const box = JSON.parse(fs.readFileSync(path.join(__dirname, "../boxjs/byhooi.boxjs.json"), "utf8"));
  const app = box.apps.find((item) => item.id === "byhooi_lggov_sign");
  assert.ok(app.keys.includes(KEY));
  assert.equal(app.settings.find((setting) => setting.id === KEY).val, "[]");
});
