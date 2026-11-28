const SCRIPT_NAME = "同程旅行签到";
const SCRIPT_VERSION = "1.0.0";
const STATE_KEY = "byhooi_tongcheng_state";

const ORIGIN = "https://wx.17u.cn";
const PATH_CALENDAR = "/wxmpsign/sign/signCalendar";
const PATH_INFO = "/wxmpsign/sign/getSignInfo";
const PATH_SIGN = "/wxmpsign/sign/saveSignInfo";

// 与模块里的 http-request pattern 保持一致。
const CAPTURE_PATTERN = /^https:\/\/wx\.17u\.cn\/wxmpsign\//;

// 小程序固定前端常量，仅作兜底；捕获到真实请求头后优先使用捕获值。
const DEFAULT_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Mobile/15E148 MicroMessenger/8.0.80(0x18005037) NetType/WIFI Language/zh_CN";
const DEFAULT_TC_VERSION = "8.4.3";
const DEFAULT_TC_REFERER = "page%2FAC%2Fsign%2Fmsindex%2Fmsindex";

const CHECK_TIMEOUT = 12;
const SIGN_TIMEOUT = 18;
const RUN_BUDGET_MS = 45000;
const RAW_SAMPLE_LIMIT = 300;

const ALREADY_SIGNED_PATTERN = /已签到|已经签到|重复签到|今日已签/i;
const TOKEN_INVALID_PATTERN = /token|请重新登录|重新登录|登录(?:已)?(?:失效|过期)|未登录|未授权/i;

// Surge 的 http-request 脚本里 $request 存在；cron / BoxJS 手动执行时两者都不存在。
if (typeof $request !== "undefined") {
  captureRequest();
} else {
  runSignIn();
}

/* ------------------------------ 抓取凭证 ------------------------------ */

function captureRequest() {
  try {
    const url = String($request && $request.url ? $request.url : "");
    if (!CAPTURE_PATTERN.test(url)) {
      $done({});
      return;
    }

    const headers = ($request && $request.headers) || {};
    // 登录态同时出现在 TC-MALL-USER-TOKEN 与 secToken，两者同值；优先前者。
    const token = trim(getHeader(headers, "TC-MALL-USER-TOKEN") || getHeader(headers, "secToken"));
    if (!token) {
      // 未登录的请求（例如首次打开签到页）没有凭证，直接放行。
      $done({});
      return;
    }

    const previous = readState() || {};
    const secTk = trim(getHeader(headers, "TCSecTk")) || previous.secTk || "";
    const apmat = trim(getHeader(headers, "apmat"));
    const openId = parseApmat(apmat) || bodyOpenId($request && $request.body) || previous.openId || "";

    const next = Object.assign({}, previous, {
      token,
      secTk,
      openId,
      userAgent: trim(getHeader(headers, "User-Agent")) || previous.userAgent || DEFAULT_UA,
      referer: trim(getHeader(headers, "Referer")) || previous.referer || "",
      tcVersion: trim(getHeader(headers, "TCxcxVersion")) || previous.tcVersion || DEFAULT_TC_VERSION,
      osType: trim(getHeader(headers, "osType")) || previous.osType || "1",
      tcReferer: trim(getHeader(headers, "TCReferer")) || previous.tcReferer || DEFAULT_TC_REFERER,
      capturedAt: new Date().toISOString(),
      version: SCRIPT_VERSION,
    });

    const tokenChanged = !previous.token || previous.token !== token;
    const secTkChanged = !previous.secTk || previous.secTk !== secTk;
    if (!tokenChanged && !secTkChanged) {
      $done({});
      return;
    }

    if (!writeState(next)) throw new Error("写入持久化数据失败");
    log(`已保存登录凭证 ${mask(token)}${openId ? `，openId ${mask(openId)}` : ""}`);
    if (tokenChanged) {
      $notification.post(SCRIPT_NAME, "已获取登录凭证", "定时签到可正常执行。");
    }
  } catch (error) {
    const message = String((error && error.message) || error);
    log(`捕获失败：${message}`);
    $notification.post(SCRIPT_NAME, "获取凭证失败", message);
  } finally {
    $done({});
  }
}

function parseApmat(value) {
  if (!value) return "";
  const openId = String(value).split("|")[0].trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(openId) ? openId : "";
}

function bodyOpenId(body) {
  const json = safeParse(body);
  if (!json || typeof json !== "object") return "";
  const common = json.common && typeof json.common === "object" ? json.common : {};
  const candidate = json.openId || common.openId || "";
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(candidate)) ? String(candidate) : "";
}

/* ------------------------------ 签到主流程 ------------------------------ */

function runSignIn() {
  const state = readState();
  if (!state || !state.token) {
    const message = "请先在同程旅行小程序打开“签到”页面，脚本会自动捕获登录凭证。";
    log("缺少登录凭证");
    $notification.post(SCRIPT_NAME, "缺少登录凭证", message);
    $done();
    return;
  }

  const deadline = Date.now() + RUN_BUDGET_MS;
  log(`v${SCRIPT_VERSION} 开始签到${state.openId ? `，openId ${mask(state.openId)}` : ""}`);

  queryStatus(state, deadline, (current) => {
    if (current.tokenInvalid) {
      failAuth(state, current.message);
      return;
    }
    if (current.signed === true) {
      const patches = { lastCheck: true, lastSignDate: current.today || today(), checkedBeforeSign: true };
      finish(state, describeStatus("今日已签到", current), patches, "今日已签到", describeStatus("", current));
      return;
    }
    if (current.signed === null && current.error) {
      const message = `查询签到状态失败：${current.error}，请稍后重试或在小程序确认。`;
      finish(state, message, { lastCheck: null }, "签到状态未知", message);
      return;
    }
    if (current.canSign === 0) {
      const message = "当前不可签到（canSign=0），请在小程序查看活动状态。";
      finish(state, message, { lastCheck: false }, "当前不可签到", message);
      return;
    }

    log(`签到前状态：${current.signed === false ? "未签到" : "无法确认"}，提交签到`);
    signNow(state, deadline, current);
  });
}

function signNow(state, deadline, before) {
  sendJson(state, PATH_SIGN, {}, SIGN_TIMEOUT, (sign) => {
    const json = sign.json || {};
    const text = sign.text || "";

    if (sign.error) {
      const message = `网络请求失败：${sign.error}`;
      finish(state, message, { lastCheck: before.signed }, "签到失败", message);
      return;
    }
    if (isTokenInvalid(sign)) {
      failAuth(state, String(json.msg || text || "登录凭证已失效"));
      return;
    }
    if (Number(json.code) !== 200) {
      const reason = String(json.msg || "").trim() || preview(text);
      if (ALREADY_SIGNED_PATTERN.test(reason)) {
        // 服务端直接回“已签到”，不谎报为本次新签成功。
        const message = describeStatus("今日已签到", before);
        finish(state, message, { lastCheck: true, lastSignDate: today() }, "今日已签到", message);
        return;
      }
      const message = `签到失败：code ${json.code == null ? "未知" : json.code} ${reason}`;
      finish(state, message, { lastCheck: before.signed }, "签到失败", message);
      return;
    }

    log("签到请求已接受，复查状态");
    if (Date.now() > deadline) {
      const message = "签到请求已提交，但超出时间预算未复查，请在小程序确认。";
      finish(state, message, { lastCheck: null, lastSignDate: today() }, "签到已提交", message);
      return;
    }

    queryStatus(state, deadline, (after) => {
      if (after.signed === true) {
        const summary = describeStatus("签到成功", after, before);
        finish(state, summary, { lastCheck: true, lastSignDate: today() }, "签到成功 ✅", summary);
        return;
      }
      if (after.signed === false) {
        const message = "签到请求已提交，但状态复查仍为未签到，请在小程序确认。";
        finish(state, message, { lastCheck: false }, "签到未确认", message);
        return;
      }
      const detail = after.error ? `（${after.error}）` : "";
      const message = `签到请求已提交，状态复查失败${detail}，请在小程序确认。`;
      finish(state, message, { lastCheck: null }, "签到未确认", message);
    });
  });
}

function queryStatus(state, deadline, callback) {
  // getSignInfo 直接返回 todaySigned / signMileage / 连续天数，优先使用。
  sendJson(state, PATH_INFO, {}, CHECK_TIMEOUT, (info) => {
    if (isTokenInvalid(info)) {
      callback({ tokenInvalid: true, message: String((info.json && info.json.msg) || "登录凭证已失效") });
      return;
    }
    const parsed = parseSignInfo(info);
    if (parsed.signed !== null) {
      callback(parsed);
      return;
    }
    if (Date.now() > deadline) {
      callback(Object.assign({}, parsed, { error: parsed.error || "超出时间预算" }));
      return;
    }

    log(`getSignInfo 无法判定状态，改用签到日历复查`);
    sendJson(state, PATH_CALENDAR, calendarBody(), CHECK_TIMEOUT, (calendar) => {
      if (isTokenInvalid(calendar)) {
        callback({ tokenInvalid: true, message: String((calendar.json && calendar.json.msg) || "登录凭证已失效") });
        return;
      }
      const fallback = parseCalendar(calendar);
      if (fallback.signed === null) {
        fallback.error = fallback.error || parsed.error || preview(calendar.text);
      }
      callback(fallback);
    });
  });
}

function parseSignInfo(result) {
  const json = result && result.json;
  const data = json && json.data;
  if (!data || typeof data !== "object") {
    return { signed: null, error: result && result.error ? result.error : preview(result && result.text) };
  }
  return {
    signed: normalizeFlag(data.todaySigned),
    canSign: normalizeFlag(data.canSign) === false ? 0 : data.canSign,
    today: "",
    mileage: numberOrNull(data.signMileage),
    tomorrowMileage: numberOrNull(data.tomorrowMileage),
    streak: numberOrNull(data.periodContinuedSignDays),
    signDays: numberOrNull(data.signDays),
  };
}

function parseCalendar(result) {
  const json = result && result.json;
  const data = json && json.data;
  if (!data || typeof data !== "object") {
    return { signed: null, error: result && result.error ? result.error : preview(result && result.text) };
  }
  const day = String(data.today || today());
  const list = Array.isArray(data.dateInfo) ? data.dateInfo : [];
  const hit = list.find((item) => item && normalizeDate(item.date) === normalizeDate(day));
  return {
    signed: normalizeFlag(data.todaySigned) !== null ? normalizeFlag(data.todaySigned) : hit ? normalizeFlag(hit.isSigned) : null,
    canSign: normalizeFlag(data.canSign) === false ? 0 : data.canSign,
    today: day,
    mileage: hit ? numberOrNull(hit.mileage) : null,
    tomorrowMileage: null,
    streak: null,
    signDays: null,
  };
}

function calendarBody() {
  const center = new Date();
  return { beginDate: shiftDate(center, -2), endDate: shiftDate(center, 2) };
}

function describeStatus(headline, after, before) {
  const parts = [];
  if (headline) parts.push(headline);
  if (after.streak) parts.push(`连续 ${after.streak} 天`);
  else if (after.signDays) parts.push(`累计 ${after.signDays} 天`);
  if (after.mileage != null) parts.push(`今日 +${after.mileage} 里程`);
  else if (before && before.mileage != null) parts.push(`今日 +${before.mileage} 里程`);
  if (after.tomorrowMileage != null) parts.push(`明日 +${after.tomorrowMileage} 里程`);
  return parts.join("，") || headline || "已签到";
}

function failAuth(state, reason) {
  const message = `登录凭证已失效（${reason}），请重新打开同程旅行小程序“签到”页面抓取。`;
  finish(state, message, { lastCheck: null }, "登录凭证已失效", message);
}

function finish(state, logMessage, patch, title, body) {
  log(String(logMessage).replace(/\n/g, " / "));
  patchState(Object.assign({ lastResult: logMessage, lastRunAt: Date.now(), version: SCRIPT_VERSION }, patch));
  $notification.post(SCRIPT_NAME, title, body || logMessage);
  $done();
}

/* ------------------------------ 请求 ------------------------------ */

function sendJson(state, path, body, timeoutSeconds, callback) {
  const options = {
    url: ORIGIN + path,
    headers: buildHeaders(state),
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

function buildHeaders(state) {
  const headers = {
    "content-type": "application/json",
    Accept: "application/json, text/plain, */*",
    "Accept-Encoding": "gzip,compress,br,deflate",
    "User-Agent": state.userAgent || DEFAULT_UA,
    platform: "WX_MP",
    osType: state.osType || "1",
    TCxcxVersion: state.tcVersion || DEFAULT_TC_VERSION,
    "TC-MALL-PLATFORM-CODE": "WX_MP",
    TCPrivacy: "1",
    TCReferer: state.tcReferer || DEFAULT_TC_REFERER,
    TCSecTk: state.secTk || state.token,
    secToken: state.token,
    "TC-MALL-USER-TOKEN": state.token,
  };
  if (state.referer) headers.Referer = state.referer;
  if (state.openId) headers.apmat = `${state.openId}|${localStamp()}|${Math.floor(Math.random() * 1000000)}`;
  return headers;
}

/* ------------------------------ 工具 ------------------------------ */

function isTokenInvalid(result) {
  if (!result || !result.json) return false;
  const code = Number(result.json.code);
  if (code === 50002 || code === 50006) return true;
  return TOKEN_INVALID_PATTERN.test(String(result.json.msg || ""));
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

function normalizeFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1") return true;
    if (text === "false" || text === "0") return false;
  }
  return null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDate(value) {
  const text = String(value == null ? "" : value).trim();
  const dashed = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (dashed) return `${dashed[1]}-${dashed[2].padStart(2, "0")}-${dashed[3].padStart(2, "0")}`;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return text;
}

function shiftDate(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return formatDate(next);
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function today() {
  return formatDate(new Date());
}

// 与小程序 apmat 头格式一致：openId|yyyyMMddHHmm|随机数。
function localStamp() {
  const date = new Date();
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function trim(value) {
  return value == null ? "" : String(value).trim();
}

function mask(value) {
  const text = String(value || "");
  if (text.length <= 8) return "****";
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function preview(value) {
  const text = String(value == null ? "" : value);
  return text.length > RAW_SAMPLE_LIMIT ? `${text.slice(0, RAW_SAMPLE_LIMIT)}...` : text;
}

function log(message) {
  console.log(`[${SCRIPT_NAME}] ${message}`);
}
