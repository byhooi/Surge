'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const honda = require('../Script/honda_sign.js');

const SCRIPT_PATH = path.join(__dirname, '..', 'Script', 'honda_sign.js');
const SCRIPT_SRC = fs.readFileSync(SCRIPT_PATH, 'utf8');
const FAKE_PHONE = ['1', '3', '8', '0', '0', '0', '0', '0', '0', '0', '0'].join('');

function reference(input) {
  return crypto.createHash('sha512').update(input, 'utf8').digest('hex');
}

// 在干净的 vm 上下文里跑脚本，stub 掉 Surge 的四个全局，模拟真实执行路径
function runScript(options) {
  const opts = options || {};
  const store = Object.assign({}, opts.store);
  const requests = [];
  const notifications = [];
  const timeouts = [];
  let doneCount = 0;
  const responses = opts.responses || {};
  const failures = Object.assign({}, opts.failures);

  const sandbox = {
    console: { log() {} },
    $persistentStore: {
      read: (key) => (key in store ? store[key] : null),
      write: (value, key) => { store[key] = value; return true; }
    },
    $notification: { post: (title, subtitle, body) => notifications.push([subtitle, body]) },
    $done: () => { doneCount += 1; },
    $argument: opts.argument || '',
    $httpClient: {
      post(request, callback) {
        const api = request.headers.api;
        requests.push(api);
        timeouts.push(request.timeout);
        if (failures[api] > 0) {
          failures[api] -= 1;
          return callback('HTTP request timeout');
        }
        const payload = typeof responses[api] === 'function' ? responses[api](request) : responses[api];
        callback(null, { status: 200 }, JSON.stringify(payload === undefined ? {} : payload));
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(SCRIPT_SRC, sandbox, { filename: 'honda_sign.js' });
  return { store, requests, notifications, timeouts, doneCount: () => doneCount };
}

test('sha512 与 node:crypto 结果一致', () => {
  const samples = [
    '',
    'a',
    'abc',
    'honda',
    '东风本田签到',
    'uuid-abc123member.apiV1nonce12341700000000000tok-123{"sceneType":"1"}',
    'x'.repeat(111),
    'x'.repeat(112),
    'x'.repeat(127),
    'x'.repeat(128),
    'x'.repeat(1000),
    'x'.repeat(128 * 1024),
    '东风本田🎈'.repeat(40),
    '\u0000\uFFFF',
    '\ud800',
    '\udc00abc'
  ];
  for (const sample of samples) {
    assert.equal(honda.sha512(sample), reference(sample), `不一致：长度 ${sample.length}`);
  }
});

test('空对象按无 body 处理', () => {
  assert.equal(honda.buildBody(null), '');
  assert.equal(honda.buildBody(undefined), '');
  assert.equal(honda.buildBody({}), '');
  assert.equal(honda.buildBody({ sceneType: '1' }), '{"sceneType":"1"}');
});

test('签名串拼接与 H5 一致', () => {
  const account = { uuid: 'uuid-123', token: 'tok-123' };
  const api = 'honda.app.member.memberSign';
  const body = '';
  const built = honda.buildHeaders(api, body, account);
  const { headers, nonce, timestamp } = built;

  assert.equal(headers.appid, honda.APP_ID);
  assert.equal(headers.appcode, 'hondaapp');
  assert.equal(headers.noncestr, nonce);
  assert.equal(headers.timestamp, timestamp);
  assert.equal(nonce.length, 18);
  assert.equal(headers.sign, reference(account.uuid + api + nonce + timestamp + account.token + body));
  assert.equal(headers.keysign, reference(honda.APP_ID + honda.APP_KEY + api + nonce + timestamp + body));
  assert.match(headers.sign, /^[0-9a-f]{128}$/);
  assert.match(headers.keysign, /^[0-9a-f]{128}$/);
});

test('登录类请求的签名不带旧 token', () => {
  const account = { uuid: 'uuid-123', token: 'old-token-1' };
  assert.deepEqual(honda.credential(account), { uuid: 'uuid-123' });
  const built = honda.buildHeaders('honda.app.login.getValidCode2', '', honda.credential(account));
  assert.equal(built.headers.sign, reference('uuid-123' + 'honda.app.login.getValidCode2' + built.nonce + built.timestamp));
});

test('手机号与长数字串脱敏', () => {
  assert.equal(honda.maskPhone(FAKE_PHONE), '138****0000');
  assert.equal(honda.maskPhone(''), '');
  assert.equal(honda.maskPhone('123'), '***');
  assert.equal(honda.scrub('验证码已发送至' + FAKE_PHONE), '验证码已发送至138****');
  assert.equal(honda.scrub('无需打码'), '无需打码');
});

test('识别今日是否已签到', () => {
  const today = '2026-11-17';
  assert.equal(honda.signedToday({ signList: [{ signDate: today, flag: 1 }] }), true);
  assert.equal(honda.signedToday({ signList: [{ signDate: '17', flag: '1' }] }), true);
  assert.equal(honda.signedToday({ signList: [{ signDate: '17', isSign: 1 }] }), true);
  assert.equal(honda.signedToday({ signList: [{ signDate: '17', flag: 0 }] }), false);
  assert.equal(honda.signedToday({ signList: [{ signDate: '14', flag: 1 }] }), false);
  assert.equal(honda.signedToday(null), false);
  assert.equal(honda.signedToday({}), false);
});

test('通知文案汇总', () => {
  assert.equal(honda.summarize({ signCount: 123, pointsNum: '5' }), '连续 123 天，积分 5');
  assert.equal(honda.summarize({}), '');
  assert.equal(honda.summarize(null), '');
});

const SIGN_RESPONSES = {
  'honda.app.sign.signDayState': { result: 1, rows: { isSign: 0 } },
  'honda.app.member.memberSign': { result: 1, rows: null },
  'honda.app.member.memberSignTrackNew': { result: 1, rows: { signCount: 124, pointsNum: '5' } }
};

test('cron 模式无 token 时只提示未登录，不发短信', () => {
  const run = runScript({ argument: 'sign', store: { byhooi_honda_phone: FAKE_PHONE } });
  assert.deepEqual(run.requests, []);
  assert.equal(run.notifications.length, 1);
  assert.equal(run.notifications[0][0], '未登录');
  assert.equal(run.doneCount(), 1);
  assert.equal(run.store.byhooi_honda_sms_at, undefined);
});

test('cron 模式带 token 直接签到并汇总结果', () => {
  const account = JSON.stringify({ telephone: FAKE_PHONE, uuid: 'uuid-1', token: 'tok-1' });
  const run = runScript({
    argument: 'sign',
    store: { byhooi_honda_account: account, byhooi_honda_phone: FAKE_PHONE },
    responses: SIGN_RESPONSES
  });
  assert.deepEqual(run.requests, [
    'honda.app.sign.signDayState',
    'honda.app.member.memberSign',
    'honda.app.member.memberSignTrackNew'
  ]);
  assert.deepEqual(run.notifications[0], ['签到成功', '连续 124 天，积分 5']);
  assert.equal(run.doneCount(), 1);
});

test('今日已签时不重复签到', () => {
  const account = JSON.stringify({ telephone: FAKE_PHONE, uuid: 'uuid-1', token: 'tok-1' });
  const run = runScript({
    argument: 'sign',
    store: { byhooi_honda_account: account },
    responses: {
      'honda.app.sign.signDayState': { result: 1, rows: { isSign: 1 } },
      'honda.app.member.memberSignTrackNew': { result: 1, rows: { signCount: 120, pointsNum: '2' } }
    }
  });
  assert.deepEqual(run.requests, ['honda.app.sign.signDayState', 'honda.app.member.memberSignTrackNew']);
  assert.equal(run.notifications[0][0], '今日已签到');
});

test('token 失效时清除 token 但保留手机号', () => {
  const run = runScript({
    argument: 'sign',
    store: {
      byhooi_honda_account: JSON.stringify({ telephone: FAKE_PHONE, uuid: 'uuid-1', token: 'dead' }),
      byhooi_honda_phone: FAKE_PHONE
    },
    responses: { 'honda.app.sign.signDayState': { result: '1001', msg: '请先登录' } }
  });
  assert.deepEqual(run.requests, ['honda.app.sign.signDayState']);
  assert.equal(run.notifications[0][0], '未登录');
  const saved = JSON.parse(run.store.byhooi_honda_account);
  assert.equal(saved.token, '');
  assert.equal(saved.uuid, 'uuid-1');
});

test('残留验证码不会劫持已登录账号', () => {
  const run = runScript({
    store: {
      byhooi_honda_account: JSON.stringify({ telephone: FAKE_PHONE, uuid: 'uuid-1', token: 'tok-1' }),
      byhooi_honda_code: '999999',
      byhooi_honda_phone: FAKE_PHONE
    },
    responses: SIGN_RESPONSES
  });
  assert.equal(run.requests.indexOf('honda.app.telLogin'), -1);
  assert.equal(run.notifications[0][0], '签到成功');
});

test('登录失败会清空验证码，避免旧码反复重试', () => {
  const run = runScript({
    store: { byhooi_honda_phone: FAKE_PHONE, byhooi_honda_code: '999999' },
    responses: { 'honda.app.telLogin': { result: -1, msg: '验证码错误' } }
  });
  assert.deepEqual(run.requests, ['honda.app.telLogin']);
  assert.equal(run.notifications[0][0], '登录失败');
  assert.match(run.notifications[0][1], /验证码已清空/);
  assert.equal(run.store.byhooi_honda_code, '');
  assert.equal(run.store.byhooi_honda_lock, '');
});

test('登录成功后保存 token、清空验证码并立即签到', () => {
  const run = runScript({
    store: { byhooi_honda_phone: FAKE_PHONE, byhooi_honda_code: '123456' },
    responses: Object.assign({
      'honda.app.telLogin': {
        result: 1,
        rows: { accessToken: 'tok-new', userInfo: { telephone: FAKE_PHONE, uuid: 'uuid-9' } }
      }
    }, SIGN_RESPONSES)
  });
  assert.equal(run.requests[0], 'honda.app.telLogin');
  assert.equal(run.store.byhooi_honda_code, '');
  const saved = JSON.parse(run.store.byhooi_honda_account);
  assert.equal(saved.token, 'tok-new');
  assert.equal(saved.uuid, 'uuid-9');
  assert.equal(run.notifications[0][0], '登录成功');
  assert.equal(run.notifications[1][0], '签到成功');
});

test('首次运行发送验证码，短时间内不重复发送', () => {
  const responses = { 'honda.app.login.getValidCode2': { result: 1, msg: '验证码发送成功' } };
  const first = runScript({ store: { byhooi_honda_phone: FAKE_PHONE }, responses });
  assert.deepEqual(first.requests, ['honda.app.login.getValidCode2']);
  assert.equal(first.notifications[0][0], '验证码已发送');

  const second = runScript({ store: first.store, responses });
  assert.deepEqual(second.requests, []);
  assert.equal(second.notifications[0][0], '请稍后');
});

test('未知 argument 报错而不是静默降级', () => {
  const run = runScript({ argument: 'signIn', store: { byhooi_honda_phone: FAKE_PHONE } });
  assert.deepEqual(run.requests, []);
  assert.equal(run.notifications[0][0], '参数错误');
});

test('运行锁阻止并发执行', () => {
  const run = runScript({
    argument: 'sign',
    store: {
      byhooi_honda_account: JSON.stringify({ uuid: 'uuid-1', token: 'tok-1' }),
      byhooi_honda_lock: String(Date.now())
    },
    responses: SIGN_RESPONSES
  });
  assert.deepEqual(run.requests, []);
  assert.equal(run.notifications[0][0], '正在执行');
});

test('非 JSON 响应带上状态码，便于排查网关错误', () => {
  const sandbox = {
    console: { log() {} },
    $persistentStore: { read: (key) => (key === 'byhooi_honda_phone' ? FAKE_PHONE : null), write: () => true },
    $notification: { post: (t, s, b) => { sandbox.__note = [s, b]; } },
    $done: () => { sandbox.__done = (sandbox.__done || 0) + 1; },
    $argument: 'sendCode',
    $httpClient: { post: (req, cb) => cb(null, { status: 502 }, '<html>Bad Gateway</html>') }
  };
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT_SRC, sandbox, { filename: 'honda_sign.js' });
  assert.equal(sandbox.__done, 1);
});

test('每个请求都带显式 timeout，避免 Surge 默认超时误报', () => {
  const account = JSON.stringify({ uuid: 'uuid-1', token: 'tok-1' });
  const run = runScript({ argument: 'sign', store: { byhooi_honda_account: account }, responses: SIGN_RESPONSES });
  assert.ok(run.timeouts.length > 0);
  for (const value of run.timeouts) assert.equal(value, 12);
});

test('网络超时会重试一次，成功则不报错', () => {
  const account = JSON.stringify({ uuid: 'uuid-1', token: 'tok-1' });
  const run = runScript({
    argument: 'sign',
    store: { byhooi_honda_account: account },
    responses: SIGN_RESPONSES,
    failures: { 'honda.app.sign.signDayState': 1 }
  });
  assert.equal(run.requests.filter((api) => api === 'honda.app.sign.signDayState').length, 2);
  assert.equal(run.notifications[0][0], '签到成功');
  assert.equal(run.doneCount(), 1);
});

test('发短信失败不重试，避免重复计费', () => {
  const run = runScript({
    store: { byhooi_honda_phone: FAKE_PHONE },
    failures: { 'honda.app.login.getValidCode2': 5 }
  });
  assert.deepEqual(run.requests, ['honda.app.login.getValidCode2']);
  assert.equal(run.notifications[0][0], '验证码发送失败');
  assert.match(run.notifications[0][1], /耗时 0 秒/);
});

test('登录请求超时不重试（验证码一次性）', () => {
  const run = runScript({
    store: { byhooi_honda_phone: FAKE_PHONE, byhooi_honda_code: '123456' },
    failures: { 'honda.app.telLogin': 5 }
  });
  assert.deepEqual(run.requests, ['honda.app.telLogin']);
  assert.equal(run.store.byhooi_honda_code, '');
});
