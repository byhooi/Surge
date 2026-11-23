const SCRIPT_NAME = "顺丰速运签到";
const SCRIPT_VERSION = "1.0.0";
const STATE_KEY = "byhooi_sfsy_state";
const COOKIE_OVERRIDE_KEY = "byhooi_sfsy_cookie";

const ORIGIN = "https://mcs-mimp-web.sf-express.com";
const PATH_TODAY = "/mcs-mimp/commonPost/~memberNonactivity~integralSignV2Service~getTodaySign";
const PATH_SIGN = "/mcs-mimp/commonPost/~memberNonactivity~integralSignV2Service~sign";
const PATH_USER_INFO = "/mcs-mimp/commonPost/~memberIntegral~userInfoService~queryUserInfo";

const SYS_CODE = "MCS-MIMP-CORE";
// mcs-mimp 会员页前端 main.js 里的固定签名盐，非账号凭证。
const SIGN_TOKEN = "wwesldfs29aniversaryvdld29&timestamp=";

// 与模块里的 http-request pattern 保持一致。
const CAPTURE_PATTERN = /^https:\/\/mcs-mimp-web\.sf-express\.com\/mcs-mimp\//;

const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Mobile/15E148 MicroMessenger/8.0.80(0x1800503d) NetType/WIFI Language/zh_CN miniProgram/wxd4185d00bf7e";
const DEFAULT_REFERER = "https://mcs-mimp-web.sf-express.com/up-member/newPoints";

const CHECK_TIMEOUT = 12;
const SIGN_TIMEOUT = 18;
const RUN_BUDGET_MS = 45000;
const RAW_SAMPLE_LIMIT = 300;

const AUTH_INVALID_CODE = 100111;
const AUTH_INVALID_PATTERN = /用户信息失效|登录(?:已)?(?:失效|过期)|未登录|请重新登录|重新进入/i;
const ALREADY_SIGNED_PATTERN = /已签到|已经签到|重复签到|今日已签/i;

// 会员信息只在本次运行内用于通知展示，不单独落盘。
const stateCache = { user: null };

/* ------------------------------ 抓取凭证 ------------------------------ */

function captureRequest() {
  try {
    const url = String($request && $request.url ? $request.url : "");
    if (!CAPTURE_PATTERN.test(url)) {
      $done({});
      return;
    }

    const headers = ($request && $request.headers) || {};
    const cookie = trim(getHeader(headers, "Cookie"));
    if (!cookie) {
      // 未登录的请求没有 JSESSIONID，直接放行。
      $done({});
      return;
    }
    // 会员域名的登录态在 JSESSIONID，其它埋点 cookie 变化频繁，只在登录态变化时落盘。
    const session = sessionOf(cookie);
    if (!session) {
      $done({});
      return;
    }

    const previous = readState() || {};
    if (previous.cookie === cookie) {
      $done({});
      return;
    }

    const next = Object.assign({}, previous, {
      cookie,
      sessionId: session,
      userAgent: trim(getHeader(headers, "User-Agent")) || previous.userAgent || "",
      referer: trim(getHeader(headers, "Referer")) || previous.referer || "",
      capturedAt: Date.now(),
      version: SCRIPT_VERSION,
    });
    if (!writeState(next)) throw new Error("写入持久化数据失败");

    log(`已保存登录凭证：${mask(session)}`);
    if (previous.sessionId !== session) {
      $notification.post(SCRIPT_NAME, "已获取登录凭证", "凭证已更新，定时签到可正常执行。");
    }
  } catch (error) {
    const message = String((error && error.message) || error);
    log(`捕获失败：${message}`);
    $notification.post(SCRIPT_NAME, "获取凭证失败", message);
  } finally {
    $done({});
  }
}

/* ------------------------------ 签到主流程 ------------------------------ */

function runSignIn() {
  const state = readState() || {};
  const cookie = trim($persistentStore.read(COOKIE_OVERRIDE_KEY)) || trim(state.cookie);
  if (!cookie) {
    const message = "请先在顺丰速运小程序打开「我的 - 积分/签到」页面，脚本会自动捕获登录凭证。";
    log("缺少登录凭证");
    $notification.post(SCRIPT_NAME, "缺少登录凭证", message);
    $done();
    return;
  }

  const deadline = Date.now() + RUN_BUDGET_MS;
  const auth = { cookie, userAgent: state.userAgent, referer: state.referer };
  log(`v${SCRIPT_VERSION} 开始签到`);

  // 顺带查一次会员信息，用于通知里带上积分余额；失败不影响签到。
  queryUserInfo(auth, () => {
    queryToday(auth, deadline, (current) => {
      if (current.authInvalid) {
        failAuth(state, current.message);
        return;
      }
      if (current.signed === true) {
        const message = describeStatus("今日已签到", current);
        finish(state, message, { lastCheck: true, lastDayCount: current.dayCount }, "今日已签到", message);
        return;
      }
      if (current.signed === null) {
        const message = `查询签到状态失败：${current.error}，请稍后重试或在小程序确认。`;
        finish(state, message, { lastCheck: null }, "签到状态未知", message);
        return;
      }

      log(`签到前状态：未签到（连续 ${current.dayCount || 0} 天），提交签到`);
      signNow(auth, current, (patch) => {
        if (patch && patch.authInvalid) {
          failAuth(state, patch.message);
          return;
        }
        finish(state, patch.logMessage, patch.statePatch, patch.title, patch.body);
      });
    });
  });
}

function signNow(auth, before, callback) {
  sendJson(auth, PATH_SIGN, { tab: 2 }, SIGN_TIMEOUT, (result) => {
    const json = result.json || {};
    const text = result.text || "";

    if (result.error) {
      callback(failResult(before, `网络请求失败：${result.error}`));
      return;
    }
    if (isAuthInvalid(result)) {
      callback({ authInvalid: true, message: authMessage(result) });
      return;
    }
    if (json.success !== true) {
      const reason = String(json.errorMessage || "").trim() || preview(text);
      if (ALREADY_SIGNED_PATTERN.test(reason)) {
        // 服务端回「已签到」，不谎报为本次新签成功。
        const message = describeStatus("今日已签到", before);
        callback({
          logMessage: message,
          title: "今日已签到",
          body: message,
          statePatch: { lastCheck: true, lastDayCount: before.dayCount },
        });
        return;
      }
      callback(failResult(before, `签到失败：code ${json.errorCode == null ? "未知" : json.errorCode} ${reason}`));
      return;
    }

    const obj = json.obj && typeof json.obj === "object" ? json.obj : {};
    const after = {
      signed: obj.signed === true ? true : before.signed,
      dayCount: numberOrNull(obj.dayCount) != null ? numberOrNull(obj.dayCount) : numberOrNull(obj.totalCount),
      award: awardText(obj),
    };
    const message = describeStatus("签到成功", after);
    log(message.replace(/\n/g, " / "));
    callback({
      logMessage: message,
      title: "签到成功 ✅",
      body: message,
      statePatch: { lastCheck: true, lastSignDate: today(), lastDayCount: after.dayCount },
    });
  });
}

function queryToday(auth, deadline, callback) {
  if (Date.now() > deadline) {
    callback({ signed: null, error: "超出时间预算" });
    return;
  }
  sendJson(auth, PATH_TODAY, {}, CHECK_TIMEOUT, (result) => {
    if (result.error) {
      callback({ signed: null, error: `网络请求失败：${result.error}` });
      return;
    }
    if (isAuthInvalid(result)) {
      callback({ authInvalid: true, message: authMessage(result) });
      return;
    }
    const json = result.json || {};
    const obj = json.obj && typeof json.obj === "object" ? json.obj : null;
    if (json.success !== true || !obj) {
      callback({ signed: null, error: preview(result.text) });
      return;
    }
    callback({
      signed: obj.signed === true,
      dayCount: numberOrNull(obj.dayCount),
      bubbleText: String(obj.bubbleText || ""),
    });
  });
}

// 只用于通知里展示积分余额，任何失败都静默忽略。
function queryUserInfo(auth, callback) {
  sendJson(auth, PATH_USER_INFO, { sysCode: "ESG-CEMP-CORE", optionalColumns: ["usablePoint"] }, CHECK_TIMEOUT, (result) => {
    const json = result.json || {};
    const obj = json.obj && typeof json.obj === "object" ? json.obj : null;
    if (json.success === true && obj) {
      stateCache.user = {
        nickName: String(obj.nickName || ""),
        usablePoint: numberOrNull(obj.usablePoint),
        gradeName: String(obj.newGradeName || obj.gradeName || ""),
      };
    }
    callback();
  });
}

function describeStatus(headline, info) {
  const parts = [];
  if (headline) parts.push(headline);
  const dayCount = numberOrNull(info && info.dayCount);
  if (dayCount) parts.push(`连续 ${dayCount} 天`);
  const parts2 = [];
  if (info && info.award) parts2.push(info.award);
  const line1 = parts.join("，");
  return parts2.length ? `${line1}\n${parts2.join(" · ")}` : line1 || "已签到";
}

function awardText(obj) {
  const award = obj && obj.award && typeof obj.award === "object" ? obj.award : null;
  if (!award) {
    const num = numberOrNull(obj && obj.awardNum);
    return num != null ? `+${num} 积分` : "";
  }
  const items = [];
  const list = Array.isArray(award.productDTOList) ? award.productDTOList : [];
  list.forEach((item) => {
    if (!item) return;
    const name = String(item.productName || item.productDesc || "").trim();
    if (!name) return;
    const amount = numberOrNull(item.amount);
    items.push(amount && amount > 1 ? `${name} ×${amount}` : name);
  });
  if (!items.length) {
    const name = String(award.giftBagName || "").trim();
    if (name) items.push(name);
  }
  return items.join("、");
}

function failAuth(state, reason) {
  const message = `登录凭证已失效（${reason}），请重新打开顺丰速运小程序「我的」页面抓取。`;
  log(message);
  patchState({ lastResult: message, lastRunAt: Date.now(), lastCheck: null, version: SCRIPT_VERSION });
  $notification.post(SCRIPT_NAME, "登录凭证已失效", message);
  $done();
}

function failResult(before, message) {
  return {
    logMessage: message,
    title: "签到失败",
    body: message,
    statePatch: { lastCheck: before ? before.signed : null },
  };
}

function finish(state, logMessage, patch, title, body) {
  const user = stateCache.user;
  let text = body || logMessage;
  if (user && user.usablePoint != null && text.indexOf("积分余额") < 0) {
    text += `\n积分余额 ${user.usablePoint}`;
  }
  log(String(logMessage).replace(/\n/g, " / "));
  patchState(Object.assign({ lastResult: logMessage, lastRunAt: Date.now(), version: SCRIPT_VERSION }, patch, user ? { user } : {}));
  $notification.post(SCRIPT_NAME, title, text);
  $done();
}

/* ------------------------------ 请求 ------------------------------ */

function sendJson(auth, path, body, timeoutSeconds, callback) {
  const options = {
    url: ORIGIN + path,
    headers: buildHeaders(auth),
    body: JSON.stringify(body || {}),
    timeout: timeoutSeconds,
  };

  log(`→ POST ${path}`);
  $httpClient.post(options, (error, response, data) => {
    if (error) {
      callback({ error: String(error), status: 0, text: "", json: null });
      return;
    }
    const status = Number((response && (response.status || response.statusCode)) || 0);
    const text = typeof data === "string" ? data : String(data == null ? "" : data);
    callback({ error: "", status, text, json: safeParse(text) });
  });
}

function buildHeaders(auth) {
  const timestamp = String(Date.now());
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "Accept-Encoding": "gzip,compress,br,deflate",
    "User-Agent": trim(auth.userAgent) || DEFAULT_UA,
    Origin: "https://mcs-mimp-web.sf-express.com",
    Referer: trim(auth.referer) || DEFAULT_REFERER,
    Cookie: trim(auth.cookie),
    channel: "mypoint",
    sysCode: SYS_CODE,
    platform: "MINI_PROGRAM",
    timestamp,
    // signature = md5("token=<前端盐>&timestamp=<毫秒时间戳>&sysCode=<sysCode>")
    signature: md5(`token=${SIGN_TOKEN}&timestamp=${timestamp}&sysCode=${SYS_CODE}`),
  };
}

function isAuthInvalid(result) {
  if (!result) return false;
  const json = result.json || {};
  if (Number(json.errorCode) === AUTH_INVALID_CODE) return true;
  const text = `${json.errorMessage || ""} ${result.text || ""}`;
  return AUTH_INVALID_PATTERN.test(text);
}

function authMessage(result) {
  const json = (result && result.json) || {};
  return String(json.errorMessage || "").trim() || "用户信息失效";
}

/* ------------------------------ 工具 ------------------------------ */

function sessionOf(cookie) {
  const match = /(?:^|;\s*)JSESSIONID=([^;]+)/i.exec(String(cookie || ""));
  return match ? match[1] : "";
}

function getHeader(headers, name) {
  if (!headers) return "";
  const key = Object.keys(headers).find((item) => item.toLowerCase() === String(name).toLowerCase());
  return key ? headers[key] : "";
}

function readState() {
  const raw = $persistentStore.read(STATE_KEY);
  if (!raw) return null;
  const json = safeParse(raw);
  return json && typeof json === "object" ? json : null;
}

function writeState(state) {
  return $persistentStore.write(JSON.stringify(state), STATE_KEY) !== false;
}

function patchState(patch) {
  const next = Object.assign({}, readState() || {}, patch);
  if (!writeState(next)) {
    log("写入持久化数据失败");
    return false;
  }
  return true;
}

function safeParse(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function trim(value) {
  return value == null ? "" : String(value).trim();
}

function preview(text) {
  const value = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  return value.length > RAW_SAMPLE_LIMIT ? `${value.slice(0, RAW_SAMPLE_LIMIT)}…` : value || "空响应";
}

function mask(value) {
  const text = String(value || "");
  if (text.length <= 8) return text ? `${text.slice(0, 2)}***` : "";
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function today() {
  const date = new Date();
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function log(message) {
  console.log(`[${SCRIPT_NAME}] ${message}`);
}

/* ------------------------------ MD5 ------------------------------ */

const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

function md5(input) {
  const bytes = utf8Bytes(String(input));
  const bitLength = bytes.length * 8;
  const padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  const low = bitLength >>> 0;
  const high = Math.floor(bitLength / 0x100000000) >>> 0;
  padded.push(low & 0xff, (low >>> 8) & 0xff, (low >>> 16) & 0xff, (low >>> 24) & 0xff);
  padded.push(high & 0xff, (high >>> 8) & 0xff, (high >>> 16) & 0xff, (high >>> 24) & 0xff);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const m = [];
    for (let i = 0; i < 16; i++) {
      const base = offset + i * 4;
      m.push((padded[base] | (padded[base + 1] << 8) | (padded[base + 2] << 16) | (padded[base + 3] << 24)) >>> 0);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_K[i] + m[g]) >>> 0;
      const shift = MD5_S[(i >> 4) * 4 + (i % 4)];
      b = (b + (((sum << shift) | (sum >>> (32 - shift))) >>> 0)) >>> 0;
      a = tmp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map(hexLE).join("");
}

function hexLE(value) {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

function utf8Bytes(text) {
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return out;
}

/* ------------------------------ 入口 ------------------------------ */

// Surge 的 http-request 脚本里 $request 存在；cron / BoxJS 手动执行时两者都不存在。
// 放在文件末尾，确保下面用到的常量与函数都已经初始化（const 存在暂时性死区）。
if (typeof $request !== "undefined") {
  captureRequest();
} else {
  runSignIn();
}
