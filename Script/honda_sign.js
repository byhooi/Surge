/**************************************
 * 东风本田每日签到
 *
 * 网关 https://api.dongfeng-honda.com/appv3/api 要求
 *   sign    = SHA512(uuid + api + noncestr + timestamp + token + body)
 *   keysign = SHA512(appid + appkey + api + noncestr + timestamp + body)
 * body 为该请求的原始 JSON 字符串（无 body 或空对象时为 ""）。
 *
 * 小程序渠道的 appid/appkey 拿不到，这里改用官方 H5 生产环境的
 * appid/appkey（公开包内信息），登录态由手机号 + 短信验证码换取
 * 的 token 提供，无需 MITM，也不需要重放抓包。
 *
 * 用法：
 *   argument=sign     仅签到（cron 使用，永不发短信）
 *   argument=sendCode 只发短信验证码
 *   argument=login    用已填写的验证码登录
 *   无 argument       自动：有 token 先签到；有验证码则登录；都没有才发验证码
 *
 * APP_ID/APP_KEY 取自 H5 生产包，属公开信息；上游轮换后需按
 * docs/honda_sign.md 重新取值覆盖（否则网关返回 174）。
 **************************************/

var SCRIPT_NAME = '东风本田签到';
var SCRIPT_VERSION = '1.0.0';

var API_BASE = 'https://api.dongfeng-honda.com/appv3/api';
var APP_ID = 'appUL7JIwsMlCsxylXgR0og4EZUiiFiNp4d';
var APP_KEY = 'i7B5uf9xnOsoJYFDkh6ECdpAITodIv3C70uKcDAXklSrKwUd2Gk9OHl21BkQOHjcBEkCZXTRvrx8WE3lIkEAciwT46Svb6prtg5YiXqlj0vOB0bOcsFPYeSxyLMIJDZi';
var APP_CODE = 'hondaapp';
var LANG = 'cn';
var USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
var LOGIN_EXTEND = { deviceType: 'android', version: '2.9.5' };
var REQUEST_TIMEOUT = 12;   // 秒，Surge $httpClient 显式超时；默认值偏短会误报 timeout
var RETRY_DELAY_MS = 1500;  // 网络错误重试间隔

var API = {
  sendCode: 'honda.app.login.getValidCode2',
  login: 'honda.app.telLogin',
  signState: 'honda.app.sign.signDayState',
  sign: 'honda.app.member.memberSign',
  track: 'honda.app.member.memberSignTrackNew',
  memberInfo: 'honda.app.member.memberInfo'
};

var ACCOUNT_KEY = 'byhooi_honda_account';  // 自动维护：手机号、uuid、token
var PHONE_KEY = 'byhooi_honda_phone';      // 手动填写：手机号
var CODE_KEY = 'byhooi_honda_code';        // 手动填写：短信验证码（登录后即清）
var LOCK_KEY = 'byhooi_honda_lock';        // 自动维护：运行锁
var SMS_KEY = 'byhooi_honda_sms_at';       // 自动维护：上次发短信时间

var LOCK_MS = 150 * 1000;      // 单次运行最长占用，避免 cron 与手动叠加
var SMS_INTERVAL_MS = 3 * 60 * 1000; // 验证码最小间隔，防止连点/误触发重复计费

var RESULT_TEXT = {
  '1001': '登录已失效，请重新登录',
  '147': '身份信息无效，请重新登录',
  '170': '密钥未注册',
  '174': '密钥签名错误',
  '175': '密钥无该接口权限',
  '176': '缺少密钥字段',
  '178': '签名已失效（签名被重复使用）',
  '111': '接口不存在',
  '1121': '设备时间与服务器时间不一致',
  '50109': '滑块验证失败',
  '-1': '服务器未知异常'
};

/* ---------- SHA-512 ---------- */

var K512 = [
  [0x428a2f98,0xd728ae22],[0x71374491,0x23ef65cd],[0xb5c0fbcf,0xec4d3b2f],[0xe9b5dba5,0x8189dbbc],
  [0x3956c25b,0xf348b538],[0x59f111f1,0xb605d019],[0x923f82a4,0xaf194f9b],[0xab1c5ed5,0xda6d8118],
  [0xd807aa98,0xa3030242],[0x12835b01,0x45706fbe],[0x243185be,0x4ee4b28c],[0x550c7dc3,0xd5ffb4e2],
  [0x72be5d74,0xf27b896f],[0x80deb1fe,0x3b1696b1],[0x9bdc06a7,0x25c71235],[0xc19bf174,0xcf692694],
  [0xe49b69c1,0x9ef14ad2],[0xefbe4786,0x384f25e3],[0x0fc19dc6,0x8b8cd5b5],[0x240ca1cc,0x77ac9c65],
  [0x2de92c6f,0x592b0275],[0x4a7484aa,0x6ea6e483],[0x5cb0a9dc,0xbd41fbd4],[0x76f988da,0x831153b5],
  [0x983e5152,0xee66dfab],[0xa831c66d,0x2db43210],[0xb00327c8,0x98fb213f],[0xbf597fc7,0xbeef0ee4],
  [0xc6e00bf3,0x3da88fc2],[0xd5a79147,0x930aa725],[0x06ca6351,0xe003826f],[0x14292967,0x0a0e6e70],
  [0x27b70a85,0x46d22ffc],[0x2e1b2138,0x5c26c926],[0x4d2c6dfc,0x5ac42aed],[0x53380d13,0x9d95b3df],
  [0x650a7354,0x8baf63de],[0x766a0abb,0x3c77b2a8],[0x81c2c92e,0x47edaee6],[0x92722c85,0x1482353b],
  [0xa2bfe8a1,0x4cf10364],[0xa81a664b,0xbc423001],[0xc24b8b70,0xd0f89791],[0xc76c51a3,0x0654be30],
  [0xd192e819,0xd6ef5218],[0xd6990624,0x5565a910],[0xf40e3585,0x5771202a],[0x106aa070,0x32bbd1b8],
  [0x19a4c116,0xb8d2d0c8],[0x1e376c08,0x5141ab53],[0x2748774c,0xdf8eeb99],[0x34b0bcb5,0xe19b48a8],
  [0x391c0cb3,0xc5c95a63],[0x4ed8aa4a,0xe3418acb],[0x5b9cca4f,0x7763e373],[0x682e6ff3,0xd6b2b8a3],
  [0x748f82ee,0x5defb2fc],[0x78a5636f,0x43172f60],[0x84c87814,0xa1f0ab72],[0x8cc70208,0x1a6439ec],
  [0x90befffa,0x23631e28],[0xa4506ceb,0xde82bde9],[0xbef9a3f7,0xb2c67915],[0xc67178f2,0xe372532b],
  [0xca273ece,0xea26619c],[0xd186b8c7,0x21c0c207],[0xeada7dd6,0xcde0eb1e],[0xf57d4f7f,0xee6ed178],
  [0x06f067aa,0x72176fba],[0x0a637dc5,0xa2c898a6],[0x113f9804,0xbef90dae],[0x1b710b35,0x131c471b],
  [0x28db77f5,0x23047d84],[0x32caab7b,0x40c72493],[0x3c9ebe0a,0x15c9bebc],[0x431d67c4,0x9c100d4c],
  [0x4cc5d4be,0xcb3e42b6],[0x597f299c,0xfc657e2a],[0x5fcb6fab,0x3ad6faec],[0x6c44198c,0x4a475817]
];

var H512_INIT = [
  [0x6a09e667,0xf3bcc908],[0xbb67ae85,0x84caa73b],[0x3c6ef372,0xfe94f82b],[0xa54ff53a,0x5f1d36f1],
  [0x510e527f,0xade682d1],[0x9b05688c,0x2b3e6c1f],[0x1f83d9ab,0xfb41bd6b],[0x5be0cd19,0x137e2179]
];

function utf8Bytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      var next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        var cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        // 孤立高位代理，与 Buffer 一样输出 U+FFFD
        bytes.push(0xef, 0xbf, 0xbd);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes.push(0xef, 0xbf, 0xbd);
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

function add64(ah, al, bh, bl) {
  var lo = (al >>> 0) + (bl >>> 0);
  var hi = (ah >>> 0) + (bh >>> 0) + (lo >= 4294967296 ? 1 : 0);
  return [hi >>> 0, lo >>> 0];
}

function shr64(hi, lo, n) {
  if (n >= 32) return [0, hi >>> (n - 32)];
  if (n === 0) return [hi, lo];
  return [hi >>> n, (lo >>> n) | (hi << (32 - n))];
}

function rotr64(hi, lo, n) {
  if (n === 0) return [hi, lo];
  if (n === 32) return [lo, hi];
  if (n > 32) {
    var m = n - 32;
    return [(lo >>> m) | (hi << (32 - m)), (hi >>> m) | (lo << (32 - m))];
  }
  return [(hi >>> n) | (lo << (32 - n)), (lo >>> n) | (hi << (32 - n))];
}

function sha512(str) {
  var bytes = utf8Bytes(str);
  var h = H512_INIT.slice();
  var bitLen = bytes.length * 8;
  var lenLo = bitLen >>> 0;
  var lenHi = Math.floor(bitLen / 4294967296);

  bytes.push(0x80);
  while (bytes.length % 128 !== 112) bytes.push(0);
  // 128 位长度域：前 64 位恒为 0
  for (var z = 0; z < 8; z++) bytes.push(0);
  bytes.push((lenHi >>> 24) & 0xff, (lenHi >>> 16) & 0xff, (lenHi >>> 8) & 0xff, lenHi & 0xff);
  bytes.push((lenLo >>> 24) & 0xff, (lenLo >>> 16) & 0xff, (lenLo >>> 8) & 0xff, lenLo & 0xff);

  var w = [];
  for (var t = 0; t < 80; t++) w.push([0, 0]);

  for (var off = 0; off < bytes.length; off += 128) {
    for (t = 0; t < 16; t++) {
      var p = off + t * 8;
      w[t][0] = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
      w[t][1] = ((bytes[p + 4] << 24) | (bytes[p + 5] << 16) | (bytes[p + 6] << 8) | bytes[p + 7]) >>> 0;
    }
    for (t = 16; t < 80; t++) {
      var x = w[t - 15];
      var s0 = xor3(rotr64(x[0], x[1], 1), rotr64(x[0], x[1], 8), shr64(x[0], x[1], 7));
      var y = w[t - 2];
      var s1 = xor3(rotr64(y[0], y[1], 19), rotr64(y[0], y[1], 61), shr64(y[0], y[1], 6));
      var a1 = add64(w[t - 16][0], w[t - 16][1], s0[0], s0[1]);
      var a2 = add64(w[t - 7][0], w[t - 7][1], s1[0], s1[1]);
      w[t] = add64(a1[0], a1[1], a2[0], a2[1]);
    }

    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (t = 0; t < 80; t++) {
      var S1 = xor3(rotr64(e[0], e[1], 14), rotr64(e[0], e[1], 18), rotr64(e[0], e[1], 41));
      var ch = [(e[0] & f[0]) ^ (~e[0] & g[0]), (e[1] & f[1]) ^ (~e[1] & g[1])];
      var t1 = add64(hh[0], hh[1], S1[0], S1[1]);
      t1 = add64(t1[0], t1[1], ch[0], ch[1]);
      t1 = add64(t1[0], t1[1], K512[t][0], K512[t][1]);
      t1 = add64(t1[0], t1[1], w[t][0], w[t][1]);

      var S0 = xor3(rotr64(a[0], a[1], 28), rotr64(a[0], a[1], 34), rotr64(a[0], a[1], 39));
      var maj = [(a[0] & b[0]) ^ (a[0] & c[0]) ^ (b[0] & c[0]), (a[1] & b[1]) ^ (a[1] & c[1]) ^ (b[1] & c[1])];
      var t2 = add64(S0[0], S0[1], maj[0], maj[1]);

      hh = g;
      g = f;
      f = e;
      e = add64(d[0], d[1], t1[0], t1[1]);
      d = c;
      c = b;
      b = a;
      a = add64(t1[0], t1[1], t2[0], t2[1]);
    }

    h[0] = add64(h[0][0], h[0][1], a[0], a[1]);
    h[1] = add64(h[1][0], h[1][1], b[0], b[1]);
    h[2] = add64(h[2][0], h[2][1], c[0], c[1]);
    h[3] = add64(h[3][0], h[3][1], d[0], d[1]);
    h[4] = add64(h[4][0], h[4][1], e[0], e[1]);
    h[5] = add64(h[5][0], h[5][1], f[0], f[1]);
    h[6] = add64(h[6][0], h[6][1], g[0], g[1]);
    h[7] = add64(h[7][0], h[7][1], hh[0], hh[1]);
  }

  var out = '';
  for (var i = 0; i < 8; i++) {
    out += hex32(h[i][0]) + hex32(h[i][1]);
  }
  return out;
}

function xor3(x, y, z) {
  return [(x[0] ^ y[0] ^ z[0]) >>> 0, (x[1] ^ y[1] ^ z[1]) >>> 0];
}

function hex32(n) {
  var s = (n >>> 0).toString(16);
  while (s.length < 8) s = '0' + s;
  return s;
}

/* ---------- 运行时工具 ---------- */

function storeRead(key, dft) {
  var value;
  if (typeof $persistentStore !== 'undefined' && $persistentStore.read) {
    value = $persistentStore.read(key);
  } else if (typeof $prefs !== 'undefined') {
    value = $prefs.valueForKey(key);
  }
  if (value === null || value === undefined || value === '') return dft;
  return value;
}

function storeWrite(key, value) {
  if (typeof $persistentStore !== 'undefined' && $persistentStore.write) {
    return $persistentStore.write(value === null ? '' : String(value), key);
  }
  if (typeof $prefs !== 'undefined') {
    return $prefs.setValueForKey(value === null ? '' : String(value), key);
  }
  return false;
}

function notify(subtitle, body) {
  if (typeof $notification !== 'undefined' && $notification.post) {
    $notification.post(SCRIPT_NAME, subtitle, body);
  }
  console.log('[' + SCRIPT_NAME + '] ' + subtitle + ' | ' + body);
}

// 服务端 msg 常带完整手机号，输出前统一打码
function scrub(text) {
  return String(text === null || text === undefined ? '' : text).replace(/\d{7,}/g, function (m) {
    return m.slice(0, 3) + '****';
  });
}

var finished = false;
var locked = false;

function finish(subtitle, body) {
  if (finished) return;
  finished = true;
  try {
    notify(scrub(subtitle), scrub(body));
  } finally {
    releaseLock();
    if (typeof $done !== 'undefined') $done();
  }
}

function maskPhone(phone) {
  if (!phone) return '';
  var text = String(phone);
  if (text.length < 7) return '***';
  return text.slice(0, 3) + '****' + text.slice(-4);
}

function acquireLock() {
  var last = Number(storeRead(LOCK_KEY, '')) || 0;
  var now = Date.now();
  if (last && now - last < LOCK_MS) return false;
  storeWrite(LOCK_KEY, String(now));
  return true;
}

function releaseLock() {
  if (!locked) return;
  locked = false;
  storeWrite(LOCK_KEY, '');
}

function randomString(len) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var out = '';
  for (var i = 0; i < len; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function loadAccount() {
  var raw = storeRead(ACCOUNT_KEY, '');
  if (!raw) return {};
  try {
    var obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function saveAccount(account) {
  return storeWrite(ACCOUNT_KEY, JSON.stringify(account));
}

function buildBody(payload) {
  if (!payload) return '';
  var keys = Object.keys(payload);
  if (!keys.length) return '';
  return JSON.stringify(payload);
}

function buildHeaders(api, body, account) {
  var nonce = randomString(18);
  var timestamp = String(Date.now());
  var token = (account && account.token) || '';
  var uuid = (account && account.uuid) || '';
  return {
    headers: {
      api: api,
      appid: APP_ID,
      appcode: APP_CODE,
      sign: sha512(uuid + api + nonce + timestamp + token + body),
      keysign: sha512(APP_ID + APP_KEY + api + nonce + timestamp + body),
      uuid: uuid,
      noncestr: nonce,
      timestamp: timestamp,
      lang: LANG,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT
    },
    nonce: nonce,
    timestamp: timestamp
  };
}

var RETRYABLE = {};
RETRYABLE[API.signState] = true;
RETRYABLE[API.sign] = true;
RETRYABLE[API.track] = true;
RETRYABLE[API.memberInfo] = true;
// 发短信会重复计费、登录码一次性，都不重试

function later(fn, ms) {
  if (typeof setTimeout === 'function') setTimeout(fn, ms);
  else fn();
}

function postApi(api, payload, account, extraHeader, callback) {
  var body = buildBody(payload);
  var built = buildHeaders(api, body, account);
  var headers = built.headers;
  if (extraHeader) {
    Object.keys(extraHeader).forEach(function (k) { headers[k] = extraHeader[k]; });
  }
  // 显式给 timeout：Surge 默认超时偏短，网关偶发抖动会被误判为失败
  var request = {
    url: API_BASE,
    headers: headers,
    body: typeof body === 'string' ? body : '',
    timeout: REQUEST_TIMEOUT,
    'auto-redirect': false,
    'auto-cookie': false
  };

  if (typeof $httpClient === 'undefined') {
    return callback('当前环境不支持 $httpClient');
  }

  var started = Date.now();
  var attempts = 0;

  function attempt() {
    attempts += 1;
    $httpClient.post(request, function (error, response, data) {
      if (error) {
        if (attempts < 2 && RETRYABLE[api]) return later(attempt, RETRY_DELAY_MS);
        return callback(String(error) + '（耗时 ' + Math.round((Date.now() - started) / 100) / 10 + ' 秒）');
      }
      var parsed = null;
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        // 把状态码与正文片段带进诊断，否则 502/HTML 错误页只能显示「未知返回」
        var status = response && response.status ? 'HTTP ' + response.status + ' ' : '';
        parsed = { result: '', msg: status + String(data || '').slice(0, 80) };
      }
      callback(null, parsed, data || '');
    });
  }

  attempt();
}

function parseResult(response) {
  if (!response || typeof response !== 'object') return '';
  return String(response.result === undefined || response.result === null ? '' : response.result);
}

function isOk(response) {
  var code = parseResult(response);
  if (code === '1' || code === '200') return true;
  return response && response.success === true;
}

function describe(response) {
  var code = parseResult(response);
  var msg = (response && response.msg) || '';
  var text = RESULT_TEXT[code];
  if (text) return msg ? text + '（' + msg + '）' : text;
  return (code ? code + ' ' : '') + (msg || '未知返回');
}

function rowsOf(response) {
  if (!response) return {};
  var rows = response.rows;
  if (rows && typeof rows === 'object') return rows;
  if (response.model && typeof response.model === 'object') return response.model;
  return {};
}

/* ---------- 业务 ---------- */

// 发码/登录只带 uuid、不带旧 token：sign 混入失效凭据会被网关判为登录态错误
function credential(account) {
  return { uuid: (account && account.uuid) || '' };
}

function smsTooSoon() {
  var last = Number(storeRead(SMS_KEY, '')) || 0;
  return last > 0 && Date.now() - last < SMS_INTERVAL_MS;
}

function sendCode(phone) {
  if (smsTooSoon()) {
    return finish('请稍后', '验证码刚发过，' + Math.round(SMS_INTERVAL_MS / 60000) + ' 分钟内不重复发送');
  }
  var account = loadAccount();
  if (!account.uuid) account.uuid = randomString(18);
  // 验证码可能绑定 uuid，发请求前先落库，失败也不丢
  if (saveAccount(account) === false) return finish('验证码发送失败', '本地账号数据写入失败，请检查 BoxJS 存储');
  postApi(API.sendCode, { telephone: phone, validType: '04' }, credential(account), null, function (error, response) {
    if (error) return finish('验证码发送失败', error.slice(0, 120));
    if (!isOk(response)) return finish('验证码发送失败', describe(response));
    storeWrite(SMS_KEY, String(Date.now()));
    finish('验证码已发送', maskPhone(phone) + ' 收到短信后把验证码填进 BoxJS 再运行一次');
  });
}

function login(phone, code) {
  var account = loadAccount();
  if (!account.uuid) account.uuid = randomString(18);
  var header = { extend: JSON.stringify(LOGIN_EXTEND) };
  postApi(API.login, { validType: '04', telephone: phone, validCode: code }, credential(account), header, function (error, response) {
    // 验证码一次性：任何终局失败都清掉，否则旧码会永久劫持自动流程
    function fail(subtitle, body) {
      storeWrite(CODE_KEY, '');
      finish(subtitle, body + '（验证码已清空，重新运行会自动发送新验证码）');
    }

    if (error) return fail('登录失败', error.slice(0, 120));
    if (!isOk(response)) return fail('登录失败', describe(response));

    var rows = rowsOf(response);
    var token = rows.accessToken || '';
    var userInfo = rows.userInfo || {};
    if (!token) return fail('登录失败', '返回中没有 accessToken');

    var next = {
      telephone: userInfo.telephone || phone,
      uuid: String(userInfo.uuid || userInfo.memberId || account.uuid),
      token: token,
      updatedAt: new Date().toISOString()
    };

    // 短信码已消耗，先落库 token；写失败要如实报错，不能谎报登录成功
    if (saveAccount(next) === false) {
      storeWrite(CODE_KEY, '');
      return finish('登录失败', '登录已成功但本地保存失败，请检查 BoxJS 存储后重新登录');
    }
    storeWrite(CODE_KEY, '');

    function afterLogin() {
      notify('登录成功', maskPhone(next.telephone) + ' 开始执行今日签到');
      runSign(next);
    }

    if (userInfo.uuid || userInfo.memberId) return afterLogin();

    // 登录响应没带 uuid 时用会员信息补；查不到就沿用发码时的 uuid，不伪造新值
    postApi(API.memberInfo, null, next, null, function (e2, info) {
      var infoRows = rowsOf(info);
      if (infoRows.uuid) {
        next.uuid = String(infoRows.uuid);
        saveAccount(next);
      }
      afterLogin();
    });
  });
}

function todayString() {
  var now = new Date();
  return now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
}

function fetchTrack(account, callback) {
  postApi(API.track, { sceneType: '1' }, account, null, function (error, response) {
    callback(isOk(response) ? rowsOf(response) : null);
  });
}

function signedToday(rows) {
  if (!rows || !rows.signList || !rows.signList.length) return false;
  var today = todayString();
  var day = today.slice(-2);
  for (var i = 0; i < rows.signList.length; i++) {
    var item = rows.signList[i] || {};
    var signDate = String(item.signDate === undefined || item.signDate === null ? '' : item.signDate);
    var hit = signDate === today || signDate === day || signDate === String(Number(day));
    if (hit && (String(item.flag) === '1' || String(item.isSign) === '1')) return true;
  }
  return false;
}

function summarize(rows) {
  var parts = [];
  if (rows && rows.signCount !== undefined && rows.signCount !== null) parts.push('连续 ' + rows.signCount + ' 天');
  if (rows && rows.pointsNum !== undefined && rows.pointsNum !== null && rows.pointsNum !== '') parts.push('积分 ' + rows.pointsNum);
  return parts.join('，');
}

// 1001/147 都代表 token 不可用，清掉后重新走短信登录
function authFailed(account, response) {
  var code = parseResult(response);
  if (code !== '1001' && code !== '147') return false;
  if (!account || !account.token) return false;
  account.token = '';
  account.updatedAt = new Date().toISOString();
  saveAccount(account);
  finish(code === '147' ? '登录已失效' : '未登录', '已清除旧 Token，手动运行一次即可重新获取验证码');
  return true;
}

function runSign(account) {
  if (!account || !account.token) {
    return finish('未登录', '请在 BoxJS 填写手机号并获取验证码完成登录');
  }

  postApi(API.signState, null, account, null, function (error, response) {
    if (error) return finish('签到失败', error.slice(0, 120));
    if (authFailed(account, response)) return;
    var stateRows = error ? {} : rowsOf(response);
    if (isOk(response) && String(stateRows.isSign) === '1') {
      return fetchTrack(account, function (rows) {
        finish('今日已签到', summarize(rows) || '无需重复签到');
      });
    }
    doSign(account);
  });
}

function doSign(account) {
  postApi(API.sign, null, account, null, function (error, response) {
    if (error) return finish('签到失败', error.slice(0, 120));

    if (authFailed(account, response)) return;

    if (isOk(response)) {
      return fetchTrack(account, function (rows) {
        finish('签到成功', summarize(rows) || '打卡完成');
      });
    }

    // 未明确成功时，用日历确认是否为「今天已签」
    fetchTrack(account, function (rows) {
      if (signedToday(rows)) {
        return finish('今日已签到', summarize(rows) || '无需重复签到');
      }
      finish('签到失败', describe(response));
    });
  });
}

function run() {
  var argument = typeof $argument !== 'undefined' && $argument ? String($argument) : '';
  var mode = argument.trim();
  var queryMode = mode.match(/(?:^|&)mode=([^&]+)/);
  if (queryMode) mode = queryMode[1];

  var phone = String(storeRead(PHONE_KEY, '') || '').trim();
  var code = String(storeRead(CODE_KEY, '') || '').trim();
  var account = loadAccount();

  if (mode === 'sign') return runSign(account);

  if (mode === 'sendCode' || mode === 'sendcode') {
    if (!/^1\d{10}$/.test(phone)) return finish('手机号无效', '请在 BoxJS 填写 11 位手机号');
    return sendCode(phone);
  }

  if (mode === 'login') {
    if (!/^1\d{10}$/.test(phone)) return finish('手机号无效', '请在 BoxJS 填写 11 位手机号');
    if (!code) return finish('缺少验证码', '请先把短信验证码填进 BoxJS');
    return login(phone, code);
  }

  // 未知 argument 不能悄悄降级成 auto，否则 cron 参数写错会每天发短信
  if (mode !== '' && mode !== 'auto') return finish('参数错误', '未知的 argument：' + mode);

  // auto：有 token 先签到（残留的旧验证码不再劫持流程），没 token 才走登录
  if (account.token) return runSign(account);

  if (code) {
    if (!/^1\d{10}$/.test(phone)) return finish('手机号无效', '请在 BoxJS 填写 11 位手机号');
    return login(phone, code);
  }

  if (!/^1\d{10}$/.test(phone)) return finish('尚未登录', '请在 BoxJS 填写手机号后运行本脚本获取验证码');
  return sendCode(phone);
}

function main() {
  if (!acquireLock()) return finish('正在执行', '上一次运行还没结束，请稍后再试');
  locked = true;
  try {
    run();
  } catch (e) {
    finish('脚本异常', String((e && e.message) || e).slice(0, 160));
  }
}

main();

if (typeof module === 'object' && module.exports) {
  module.exports = {
    SCRIPT_VERSION: SCRIPT_VERSION,
    sha512: sha512,
    buildBody: buildBody,
    buildHeaders: buildHeaders,
    maskPhone: maskPhone,
    scrub: scrub,
    credential: credential,
    signedToday: signedToday,
    summarize: summarize,
    todayString: todayString,
    APP_ID: APP_ID,
    APP_KEY: APP_KEY
  };
}
