const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sources = Object.fromEntries(['jdcookie', 'jdcookie_ql_sync', 'jdcookie_clear'].map(name => [
  name, fs.readFileSync(path.join(__dirname, `../Script/${name}.js`), 'utf8')
]));
const NOW = Date.UTC(2030, 0, 1);
const STATE_KEY = 'jd_cookie_sync_state';
const TEST_KEY = 'FAKE_TEST_KEY_0123456789';
const cookie = (pin = 'abc', key = TEST_KEY) => `pt_pin=${pin};pt_key=${key};`;
const config = () => ({
  ql_url: 'https://panel.invalid', ql_client_id: 'test-id', ql_client_secret: 'TEST_SECRET',
  ql_token: 'TEST_TOKEN', ql_token_expires: String(NOW + 86400000)
});
const env = (id, pin, extra = {}) => ({
  id, name: 'JD_COOKIE', value: cookie(pin, 'OLD_TEST_KEY'), remarks: `${pin} - 测试`, status: 0, ...extra
});
const states = store => JSON.parse(store[STATE_KEY] || '{}');
const state = (store, pin = 'abc') => states(store)[`pin:${encodeURIComponent(pin)}`];

function harness(store = config(), handler = () => ({})) {
  let clock = NOW;
  let nextId = 0;
  const timers = new Map();
  const calls = [];
  const instances = [];
  const schedule = (fn, delay, transport = false) => {
    const id = ++nextId;
    timers.set(id, { fn, at: clock + delay, transport });
    return id;
  };
  const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  function start({ script = 'jdcookie', value = cookie(), request = true } = {}) {
    const run = { calls: [], logs: [], notices: [], doneCount: 0, started: clock };
    instances.push(run);
    class MockDate extends Date {
      constructor(...args) { super(...(args.length ? args : [clock])); }
      static now() { return clock; }
    }
    const context = {
      Date: MockDate,
      setTimeout: (fn, delay) => schedule(fn, delay),
      clearTimeout: id => timers.delete(id),
      console: { log: (...args) => run.logs.push(args.join(' ')) },
      $persistentStore: {
        read: key => store[key] ?? null,
        write: (value, key) => { store[key] = value; return true; }
      },
      $notification: { post: (...args) => run.notices.push(args.join('\n')) },
      $done: () => { run.doneCount++; run.elapsed = clock - run.started; },
      $httpClient: {}
    };
    for (const method of ['get', 'post', 'put', 'delete']) {
      context.$httpClient[method] = (options, callback) => {
        const call = { method, options, body: options.body ? JSON.parse(options.body) : null, at: clock };
        run.calls.push(call);
        calls.push(call);
        const response = handler(call, calls.length, run) || {};
        if (response.pending) return;
        const deliver = () => {
          const body = response.body || (options.url.includes('/auth/token')
            ? { code: 200, data: { token: 'TEST_NEW_TOKEN' } }
            : { code: 200, data: [] });
          callback(response.error || null, { status: response.status || 200 }, JSON.stringify(body));
        };
        if (response.delay) schedule(deliver, response.delay, true);
        else deliver();
      };
    }
    if (script === 'jdcookie' && request) context.$request = { headers: { Cookie: value } };
    vm.runInNewContext(sources[script], context, { timeout: 1000 });
    run.context = context;
    return run;
  }
  async function advanceTo(target) {
    await flush();
    for (let step = 0; step < 1000; step++) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      timers.delete(next[0]);
      clock = next[1].at;
      next[1].fn();
      await flush();
    }
    clock = target;
    await flush();
  }
  async function finish(...runs) {
    await flush();
    for (let step = 0; step < 1000 && runs.some(run => !run.doneCount); step++) {
      const next = [...timers.values()].sort((a, b) => a.at - b.at)[0];
      assert.ok(next, '脚本未结束，但没有可推进的定时器');
      assert.ok(next.at - runs[0].started < 30000, '自动入口必须在模块超时前结束');
      await advanceTo(next.at);
    }
    runs.forEach(run => assert.equal(run.doneCount, 1, '$done 必须且只能调用一次'));
  }
  return { store, calls, start, finish, advanceTo, get clock() { return clock; }, timers, instances };
}

for (const script of ['jdcookie', 'jdcookie_ql_sync']) {
  async function sync(envs, pin = 'abc') {
    const store = config();
    if (script === 'jdcookie_ql_sync') store.jdCookieList = JSON.stringify([{ userName: pin, cookie: cookie(pin) }]);
    const h = harness(store, call => call.method === 'get' ? { body: { code: 200, data: envs } } : {});
    const run = h.start({ script, value: cookie(pin) });
    await h.finish(run);
    return run;
  }

  test(`${script}: 前缀账号和错误备注不能覆盖另一个账号`, async () => {
    const run = await sync([
      env(11, 'abcdef'), env(12, 'other', { remarks: 'abc - 测试' }), env(22, 'abc')
    ]);
    assert.equal(run.calls.find(call => call.method === 'put').body.id, 22);
    assert.equal(run.calls.some(call => call.method === 'post'), false);
  });

  test(`${script}: 没有备注时依据 pt_pin 更新已有变量`, async () => {
    const run = await sync([env(22, 'abc', { remarks: '' })]);
    assert.equal(run.calls.find(call => call.method === 'put').body.id, 22);
  });

  test(`${script}: 编码账号、Cookie 边界和变量名都精确匹配`, async () => {
    const run = await sync([
      env(1, 'abc', { name: 'NOT_JD_COOKIE', remarks: 'JD_COOKIE abc' }),
      env(2, 'other', { value: 'not_pt_pin=abc;', remarks: '' }),
      env(3, 'abc', { value: 'pt_pin=%61bc;pt_key=OLD_TEST_KEY;', remarks: '' })
    ]);
    assert.equal(run.calls.find(call => call.method === 'put').body.id, 3);
  });

  test(`${script}: 仅缺少账号字段时允许精确备注兜底`, async () => {
    const run = await sync([
      env(1, 'other', { value: '', remarks: 'abcdef - 测试' }),
      env(2, 'other', { value: '', remarks: 'abc - 测试' })
    ]);
    assert.equal(run.calls.find(call => call.method === 'put').body.id, 2);
  });

  test(`${script}: 值中的精确账号优先于前面的备注兜底`, async () => {
    const run = await sync([env(1, 'other', { value: '', remarks: 'abc' }), env(2, 'abc')]);
    assert.equal(run.calls.find(call => call.method === 'put').body.id, 2);
  });

  test(`${script}: 无对应账号时新增，不覆盖相似账号`, async () => {
    const run = await sync([env(11, 'abcdef')]);
    assert.equal(run.calls.some(call => call.method === 'put'), false);
    assert.equal(run.calls.find(call => call.method === 'post').body[0].value, cookie());
  });

  test(`${script}: 值相同但已禁用时重新启用`, async () => {
    const run = await sync([env(22, 'abc', { value: cookie(), status: 1 })]);
    const enable = run.calls.find(call => call.options.url.endsWith('/enable'));
    assert.deepEqual(enable.body, [22]);
  });
}

test('同步成功后，跨分钟、跨账号请求不再同步或通知', async () => {
  const h = harness();
  for (const pin of ['abc', 'other']) {
    const run = h.start({ value: cookie(pin) });
    await h.finish(run);
    assert.equal(run.calls.length, 2);
    assert.equal(state(h.store, pin).status, 'success');
  }
  await h.advanceTo(NOW + 3600000);
  for (const pin of ['abc', 'other', 'abc']) {
    const run = h.start({ value: cookie(pin) });
    await h.finish(run);
    assert.equal(run.calls.length, 0);
    assert.equal(run.notices.length, 0);
  }
});

test('Cookie 更新或青龙目标变化时允许重新同步', async () => {
  const h = harness();
  const first = h.start();
  await h.finish(first);
  const changed = h.start({ value: cookie('abc', 'NEW_TEST_KEY') });
  await h.finish(changed);
  assert.equal(changed.calls.length, 2);
  h.store.ql_url = 'https://another-panel.invalid';
  const moved = h.start({ value: cookie('abc', 'NEW_TEST_KEY') });
  await h.finish(moved);
  assert.equal(moved.calls.length, 2);
});

test('失败指数退避，重复失败静默，恢复后只通知一次', async () => {
  let offline = true;
  const h = harness(config(), () => offline ? { error: new Error('测试离线') } : {});
  const first = h.start();
  await h.finish(first);
  assert.equal(first.notices.length, 1);
  assert.equal(state(h.store).nextRetryAt - h.clock, 60000);
  const early = h.start();
  await h.finish(early);
  assert.equal(early.calls.length, 0);
  assert.equal(early.notices.length, 0);
  await h.advanceTo(state(h.store).nextRetryAt);
  const second = h.start();
  await h.finish(second);
  assert.equal(second.calls.length, 1);
  assert.equal(second.notices.length, 0);
  assert.equal(state(h.store).nextRetryAt - h.clock, 120000);
  offline = false;
  await h.advanceTo(state(h.store).nextRetryAt);
  const recovered = h.start();
  await h.finish(recovered);
  assert.equal(recovered.calls.length, 2);
  assert.equal(recovered.notices.length, 1);
  assert.equal(state(h.store).status, 'success');
});

test('长期失败退避封顶十五分钟，不再重复通知', async () => {
  const h = harness(config(), () => ({ error: new Error('测试离线') }));
  for (const expected of [60000, 120000, 240000, 480000, 900000, 900000]) {
    const run = h.start();
    await h.finish(run);
    assert.equal(state(h.store).nextRetryAt - h.clock, expected);
    if (expected !== 60000) assert.equal(run.notices.length, 0);
    await h.advanceTo(state(h.store).nextRetryAt);
  }
});

test('配置不完整时只提醒一次，补全配置后可同步', async () => {
  const store = config();
  delete store.ql_url;
  const h = harness(store);
  const first = h.start();
  await h.finish(first);
  assert.equal(first.calls.length, 0);
  assert.equal(first.notices.length, 1);
  await h.advanceTo(state(store).nextRetryAt);
  const repeated = h.start();
  await h.finish(repeated);
  assert.equal(repeated.notices.length, 0);
  store.ql_url = config().ql_url;
  const ready = h.start();
  await h.finish(ready);
  assert.equal(ready.calls.length, 2);
  assert.equal(state(store).status, 'success');
});

test('通知锁命中不会阻止同步；升级后旧 Cookie 可补同步', async () => {
  const store = config();
  store.jd_cookie_notify_lock = JSON.stringify({ cookie: cookie(), ts: NOW });
  store.jd_cookie_sync_lock = JSON.stringify({ cookie: cookie(), ts: NOW, ok: true });
  const h = harness(store);
  const run = h.start();
  await h.finish(run);
  assert.equal(run.calls.length, 2);
  assert.equal(run.notices[0].includes('获取成功'), false);
  assert.equal(run.notices[0].includes('自动同步'), true);
});

test('已有本地 Cookie、缺少同步状态时不会误当作同步成功', async () => {
  const store = config();
  store.jdCookieList = JSON.stringify([{ userName: 'abc', cookie: cookie() }]);
  const h = harness(store);
  const run = h.start();
  await h.finish(run);
  assert.equal(run.calls.length, 2);
  assert.equal(run.notices[0].includes('获取成功'), false);
});

test('自动同步关闭时只采集，重新开启后可同步相同 Cookie', async () => {
  const h = harness({ ...config(), auto_sync_jdcookie_ql: 'false' });
  const first = h.start();
  await h.finish(first);
  assert.equal(first.calls.length, 0);
  h.store.auto_sync_jdcookie_ql = 'true';
  const enabled = h.start();
  await h.finish(enabled);
  assert.equal(enabled.calls.length, 2);
});

test('同账号并发只发起一轮同步，不同账号状态互不覆盖', async () => {
  const h = harness(config(), () => ({ delay: 100 }));
  const first = h.start();
  const second = h.start();
  await h.finish(first, second);
  assert.equal(h.calls.length, 2);
  const third = h.start({ value: cookie('third') });
  const fourth = h.start({ value: cookie('fourth') });
  await h.finish(third, fourth);
  assert.equal(state(h.store, 'third').status, 'success');
  assert.equal(state(h.store, 'fourth').status, 'success');
  assert.equal(state(h.store, 'abc').status, 'success');
});

test('中断任务的租约到期后允许重试', async () => {
  const store = config();
  store.jdCookieList = JSON.stringify([{ userName: 'abc', cookie: cookie() }]);
  store[STATE_KEY] = JSON.stringify({ 'pin:abc': {
    cookie: cookie(), target: JSON.stringify([store.ql_url, store.ql_client_id]),
    status: 'running', ts: NOW, token: 'aborted-test'
  } });
  const h = harness(store);
  const early = h.start();
  await h.finish(early);
  assert.equal(early.calls.length, 0);
  await h.advanceTo(NOW + 20001);
  const retry = h.start();
  await h.finish(retry);
  assert.equal(retry.calls.length, 2);
});

test('请求无响应时按单次超时结束，保留失败状态和通知', async () => {
  const h = harness(config(), () => ({ pending: true }));
  const run = h.start();
  await h.finish(run);
  assert.ok(run.elapsed <= 5000);
  assert.equal(state(h.store).status, 'failed');
  assert.equal(run.notices.length, 1);
  assert.equal(h.timers.size, 0);
});

test('401 重认证与串行请求共用总预算，迟到响应不能继续写入', async () => {
  const store = config();
  delete store.ql_token;
  let searches = 0;
  const h = harness(store, call => {
    if (call.options.url.includes('/auth/token')) return { delay: 3900 };
    searches++;
    return { delay: 3900, body: searches === 1 ? { code: 401 } : { code: 200, data: [] } };
  });
  const run = h.start();
  await h.finish(run);
  assert.ok(run.elapsed <= 13000);
  assert.equal(run.calls.length, 4);
  assert.equal(state(store).status, 'failed');
  const saved = store[STATE_KEY];
  await h.advanceTo(NOW + 60000);
  assert.equal(run.calls.length, 4);
  assert.equal(store[STATE_KEY], saved);
  assert.equal(run.doneCount, 1);
  assert.equal(run.notices.length, 1);
});

test('缓存 Token 返回 401 后重新认证并成功同步', async () => {
  const h = harness(config(), (_, index) => index === 1 ? { status: 401, body: { code: 401 } } : {});
  const run = h.start();
  await h.finish(run);
  assert.equal(run.calls.length, 4);
  assert.equal(state(h.store).status, 'success');
  assert.equal(h.timers.size, 0);
});

test('启用失败不能记录为同步成功', async () => {
  const h = harness(config(), call => call.method === 'get'
    ? { body: { code: 200, data: [env(22, 'abc', { value: cookie(), status: 1 })] } }
    : { body: { code: 500 } });
  const run = h.start();
  await h.finish(run);
  assert.equal(state(h.store).status, 'failed');
});

for (const existing of [false, true]) {
  test(`${existing ? '更新' : '新增'}失败后仍可退避重试`, async () => {
    let failWrite = true;
    const h = harness(config(), call => {
      if (call.method === 'get') return { body: { code: 200, data: existing ? [env(22, 'abc')] : [] } };
      return failWrite ? { body: { code: 500 } } : {};
    });
    const first = h.start();
    await h.finish(first);
    assert.equal(state(h.store).status, 'failed');
    failWrite = false;
    await h.advanceTo(state(h.store).nextRetryAt);
    const recovered = h.start();
    await h.finish(recovered);
    assert.equal(state(h.store).status, 'success');
    assert.equal(recovered.calls.length, 2);
    assert.equal(recovered.notices.length, 1);
  });
}

test('相同且启用的变量只查询不写入，记录成功后不再查询', async () => {
  const h = harness(config(), () => ({ body: { code: 200, data: [env(22, 'abc', { value: cookie() })] } }));
  const run = h.start();
  await h.finish(run);
  assert.equal(run.calls.length, 1);
  assert.equal(state(h.store).status, 'success');
  const repeated = h.start();
  await h.finish(repeated);
  assert.equal(repeated.calls.length, 0);
});

test('清空 Cookie 同时清理新旧同步状态，并阻止等待中的同步', async () => {
  const h = harness();
  const run = h.start();
  await h.advanceTo(NOW + 750);
  h.store.jd_cookie_sync_lock = 'legacy';
  const cleared = h.start({ script: 'jdcookie_clear' });
  await h.finish(run, cleared);
  assert.deepEqual(JSON.parse(h.store.jdCookieList), []);
  assert.equal(h.store[STATE_KEY], '');
  assert.equal(h.store.jd_cookie_sync_lock, '');
  assert.equal(run.calls.length, 0);
  const next = h.start();
  await h.finish(next);
  assert.equal(next.calls.length, 2);
});

test('清空后迟到查询不得写入青龙或恢复本地同步状态', async () => {
  const h = harness(config(), () => ({ delay: 2000 }));
  const run = h.start();
  await h.advanceTo(NOW + 1500);
  assert.equal(run.calls.length, 1);
  const cleared = h.start({ script: 'jdcookie_clear' });
  await h.finish(run, cleared);
  assert.equal(run.calls.length, 1);
  assert.equal(h.store[STATE_KEY], '');
  assert.deepEqual(JSON.parse(h.store.jdCookieList), []);
});

test('请求进行中 Cookie 更新后不发送旧值写入', async () => {
  const h = harness(config(), () => ({ delay: 1000 }));
  const old = h.start();
  await h.advanceTo(NOW + 1100);
  const newer = h.start({ value: cookie('abc', 'NEW_TEST_KEY') });
  await h.finish(old, newer);
  assert.equal(old.calls.length, 1);
  assert.equal(newer.calls.length, 0);
  const latest = h.start({ value: cookie('abc', 'NEW_TEST_KEY') });
  await h.finish(latest);
  assert.equal(latest.calls.find(call => call.method === 'post').body[0].value, cookie('abc', 'NEW_TEST_KEY'));
});

test('普通/调试日志和通知隐藏凭证，持久化与 HTTP 仍使用原值', async () => {
  for (const is_debug of ['false', 'true']) {
    const h = harness({ ...config(), is_debug });
    const run = h.start();
    await h.finish(run);
    const output = [...run.logs, ...run.notices].join('\n');
    for (const secret of [TEST_KEY, 'TEST_SECRET', 'TEST_TOKEN']) {
      assert.equal(output.includes(secret), false, `不应泄露 ${secret}`);
    }
    assert.equal(JSON.parse(h.store.jdCookieList)[0].cookie, cookie());
    assert.equal(run.calls.find(call => call.method === 'post').body[0].value, cookie());
    assert.equal(run.calls[0].options.headers.Authorization, 'Bearer TEST_TOKEN');
  }
});

test('错误消息携带 URL 凭证时仍脱敏', async () => {
  const h = harness({ ...config(), is_debug: 'true' }, () => ({
    error: new Error('https://panel.invalid/?client_secret=TEST_SECRET pt_key=FAKE_TEST_KEY_0123456789; Bearer TEST_TOKEN')
  }));
  const run = h.start();
  await h.finish(run);
  const output = [...run.logs, ...run.notices].join('\n');
  for (const secret of [TEST_KEY, 'TEST_SECRET', 'TEST_TOKEN']) assert.equal(output.includes(secret), false);
});

test('手动同步的异常数据和错误通知也不泄露凭证', async () => {
  const store = config();
  store.jdCookieList = JSON.stringify([{ cookie: cookie() }, { userName: 'abc', cookie: cookie() }]);
  const h = harness(store, call => call.method === 'get' ? {} : {
    error: new Error(`测试错误 pt_key=${TEST_KEY}; client_secret=TEST_SECRET Bearer TEST_TOKEN`)
  });
  const run = h.start({ script: 'jdcookie_ql_sync' });
  await h.finish(run);
  const output = [...run.logs, ...run.notices].join('\n');
  for (const secret of [TEST_KEY, 'TEST_SECRET', 'TEST_TOKEN']) assert.equal(output.includes(secret), false);
  assert.equal(run.notices.length, 1);
});

test('两个入口的账号匹配与脱敏函数保持一致', () => {
  const contexts = {};
  for (const script of ['jdcookie', 'jdcookie_ql_sync']) {
    contexts[script] = harness().start({ script, request: false }).context;
  }
  for (const name of ['normalizePin', 'cookiePin', 'findQLEnv', 'redactSecrets']) {
    const codes = Object.values(contexts).map(context => vm.runInContext(`${name}.toString()`, context));
    assert.equal(codes[0], codes[1], `${name} 必须保持一致`);
  }
});
