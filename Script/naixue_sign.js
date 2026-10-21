const SCRIPT_NAME = "奈雪点单签到";
const SCRIPT_VERSION = "1.2.0";
const STATE_KEY = "byhooi_naixue_state";
const SIGN_KEY_OVERRIDE = "byhooi_naixue_sign_key";

const ORIGIN = "https://tm-web.pin-dao.cn";
const PATH_SAVE = "/user/sign/save";
const PATH_CONDITION = "/user/sign/condition";
const PATH_RECORDS = "/user/sign/records";

// 抓取 pattern 与模块保持一致：
//   http-request  ^https:\/\/tm-web\.pin-dao\.cn\/(?:user|naixue|chayuan|coupon)\/
//   http-response ^https:\/\/tm-web\.pin-dao\.cn\/user\/sign\/(?:condition|records)$

// 小程序前端固定 openId 与签名密钥，属于公开前端常量，不是账号凭证。
const OPEN_ID = "QL6ZOftGzbziPlZwfiXM";
const SIGN_KEY_NAIXUE = "sArMTldQ9tqU19XIRDMWz7BO5WaeBnrezA";
const SIGN_KEY_DEFAULT = "iYkcDMF8Eti255hti5M629RQTQ4Z2XihG";
const NAIXUE_BRANDS = [26000252, 26000254];

const CHECK_TIMEOUT = 12;
const SAVE_TIMEOUT = 18;
const TOTAL_BUDGET_MS = 45000;
const RAW_SAMPLE_LIMIT = 800;

const DEFAULT_COMMON = {
  platform: "wxapp",
  version: "6.0.86",
  imei: "",
  osn: "",
  sv: "",
  lat: "",
  lng: "",
  lang: "zh_CN",
  currency: "CNY",
  timeZone: "",
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Mobile/15E148 MicroMessenger/8.0.79(0x18004f2e) NetType/WIFI Language/zh_CN miniProgram/wxab7430e6e8b9a4ab";

const COMMON_KEEP_KEYS = ["platform", "version", "imei", "osn", "sv", "lat", "lng", "lang", "currency", "timeZone"];

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const ALREADY_SIGNED_PATTERN = /已签到|已经签到|重复签到|今日已签|already\s*sign/i;
const TOKEN_INVALID_PATTERN = /未登录|请登录|登录已|token|sign is not valid|expired|授权/i;

// Surge 的 http-response 脚本里 $request 同样存在，必须先判断 $response，否则会把响应抓取当成请求抓取。
if (typeof $response !== "undefined") {
  captureResponse();
} else if (typeof $request !== "undefined") {
  captureRequest();
} else {
  runSignIn();
}

/* ------------------------------ 抓取凭证 ------------------------------ */

function captureRequest() {
  const headers = $request.headers || {};
  const token = extractToken(headers, $request.url);
  if (!token) {
    // 未登录的请求（例如首次打开签到页）没有凭证，直接放行。
    $done({});
    return;
  }

  try {
    const body = safeParse($request.body);
    const previous = readState();
    const next = Object.assign({}, previous || {}, {
      token,
      capturedAt: new Date().toISOString(),
      version: SCRIPT_VERSION,
      common: pickCommon(Object.assign({}, (previous && previous.common) || {}, (body && body.common) || {})),
      params: mergeParams(previous && previous.params, body && body.params),
      headers: pickRequestHeaders(headers, previous && previous.headers),
    });

    if (!writeState(next)) throw new Error("写入持久化数据失败");

    const tokenChanged = !previous || previous.token !== token;
    const paramsChanged = !previous || JSON.stringify(previous.params) !== JSON.stringify(next.params);
    if (tokenChanged) {
      log(`已保存 accessToken：${maskToken(token)}`);
      $notification.post(SCRIPT_NAME, "已获取 accessToken", "凭证已更新，定时签到可正常执行。");
    } else if (paramsChanged) {
      log(`已更新签到参数：${describeParams(next.params)}`);
      $notification.post(SCRIPT_NAME, "已更新签到参数", describeParams(next.params) || "门店信息已保存。");
    } else {
      log("凭证与参数无变化，无需更新");
    }
  } catch (error) {
    const message = String((error && error.message) || error);
    log(`捕获失败：${message}`);
    $notification.post(SCRIPT_NAME, "获取凭证失败", message);
  } finally {
    $done({});
  }
}

// 保存签到状态接口的原始响应，用于核对字段名。只记录，不改写响应。
function captureResponse() {
  try {
    const text = typeof $response.body === "string" ? $response.body : "";
    const json = safeParse(text);
    if (!json || typeof json !== "object") {
      log(`跳过非 JSON 响应：${preview(text)}`);
      return;
    }

    const url = String($request && $request.url ? $request.url : "");
    const isRecords = url.indexOf(PATH_RECORDS) >= 0;
    const patch = {
      capturedAt: new Date().toISOString(),
      lastCheckAt: Date.now(),
    };
    patch[isRecords ? "lastRecordsRaw" : "lastConditionRaw"] = truncate(text, RAW_SAMPLE_LIMIT);
    patch[isRecords ? "lastRecordsAt" : "lastConditionAt"] = new Date().toISOString();
    patchState(patch);
    log(`${isRecords ? "records" : "condition"} 响应已记录：${preview(text)}`);
  } catch (error) {
    log(`记录响应失败：${error && error.message ? error.message : error}`);
  } finally {
    $done({});
  }
}

function extractToken(headers, url) {
  const authorization = getHeader(headers, "Authorization");
  if (authorization) {
    const token = String(authorization).trim().replace(/^Bearer\s+/i, "").trim();
    if (token) return token;
  }
  const matched = /[?&]accessToken=([^&\s]+)/.exec(String(url || ""));
  return matched ? decodeURIComponent(matched[1]) : "";
}

function pickCommon(source) {
  const output = {};
  COMMON_KEEP_KEYS.forEach((key) => {
    const value = source && source[key];
    if (value !== undefined && value !== null && value !== "") output[key] = value;
  });
  return output;
}

function mergeParams(previous, current) {
  const base = previous && typeof previous === "object" ? previous : {};
  const next = current && typeof current === "object" ? current : {};
  const merged = Object.assign({}, base, next);
  // signDate 每次都按当天重算，不沿用历史值。
  delete merged.signDate;
  delete merged.startDate;
  return merged;
}

function pickRequestHeaders(headers, previous) {
  const output = {};
  const userAgent = getHeader(headers, "User-Agent") || (previous && previous["User-Agent"]);
  const referer = getHeader(headers, "Referer") || (previous && previous.Referer);
  if (userAgent) output["User-Agent"] = userAgent;
  if (referer) output.Referer = String(referer).split("?")[0];
  return output;
}

function describeParams(params) {
  if (!params) return "";
  const parts = [];
  if (params.brand != null) parts.push(`brand=${params.brand}`);
  if (params.storeId != null) parts.push(`storeId=${params.storeId}`);
  if (params.stallType) parts.push(`stallType=${params.stallType}`);
  if (params.cityId != null) parts.push(`cityId=${params.cityId}`);
  return parts.join(" ");
}

/* ------------------------------ 签到主流程 ------------------------------ */

function runSignIn() {
  const state = readState();
  if (!state || !state.token) {
    log("缺少 accessToken");
    $notification.post(SCRIPT_NAME, "缺少 accessToken", "请在微信中打开奈雪点单小程序，进入“我的 - 签到”页面后重试。");
    $done();
    return;
  }

  const params = Object.assign({}, state.params || {});
  if (params.brand == null) {
    log("缺少门店参数");
    $notification.post(
      SCRIPT_NAME,
      "缺少门店参数",
      "请在小程序内进入签到页面或点单页重新抓取一次，以保存门店信息。"
    );
    $done();
    return;
  }

  const signDate = todayInChina();
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  log(`v${SCRIPT_VERSION} 开始，signDate=${signDate}，${describeParams(params)}`);

  // 第一步：先查今日状态。已签到就不再提交，避免重复请求。
  // 签到页（/naixue/sign-in）只会调用 records，condition 属于奈雪币商店页，因此以 records 为主。
  checkSigned(state, params, signDate, deadline, (check) => {
    const already = check.signed;
    if (already === true) {
      const summary = buildSummary("今日已签到", readSignCount(check), readSignInfos(check));
      finish(state, summary, { lastCheck: true, lastSignDate: signDate, checkedBeforeSign: true }, "今日已签到", summary);
      return;
    }

    log(`签到前状态：${already === false ? "未签到" : "无法确认"}，继续提交`);

    // 第二步：提交签到。
    sendJson(state, PATH_SAVE, params, { signDate }, SAVE_TIMEOUT, (save) => {
      const outcome = classifySave(save);
      if (!outcome.ok) {
        finish(state, `失败：${outcome.message}`, { lastCheck: already }, "签到失败", outcome.message);
        return;
      }
      log(`签到请求已接受：${preview(save.text)}`);

      // 服务端直接回“已签到”时无需复查，也不谎报为本次新签成功。
      if (outcome.alreadySigned) {
        const summary = buildSummary("今日已签到", 0, readSignInfos(save));
        finish(state, summary, { lastCheck: already, lastSignDate: signDate }, "今日已签到", summary);
        return;
      }

      // 第三步：复查状态，避免把“请求被接受”说成“签到成功”。
      if (Date.now() > deadline) {
        const message = "签到请求已提交，但超出时间预算未复查，请在小程序确认。";
        finish(state, message, { lastCheck: null, lastSignDate: signDate }, "签到已提交", message);
        return;
      }
      checkSigned(state, params, signDate, deadline, (verify) => {
        const verified = verify.signed;
        const signCount = readSignCount(verify);
        const infos = readSignInfos(verify);

        if (verified === true) {
          const summary = buildSummary("签到成功", signCount, infos);
          finish(state, summary, { lastCheck: true, lastSignDate: signDate }, "签到成功 ✅", summary);
          return;
        }
        if (verified === false) {
          const message = `签到请求已提交，但状态复查仍为未签到${signCount ? `（连签 ${signCount} 天）` : ""}，请稍后在小程序确认。`;
          finish(state, message, { lastCheck: false }, "签到未确认", message);
          return;
        }
        const message = `签到请求已提交，状态复查失败（${verify.error || preview(verify.text) || "无响应"}），请在小程序确认。`;
        finish(state, message, { lastCheck: null }, "签到未确认", message);
      });
    });
  });
}

// records 是签到页真正使用的状态接口：data.status 为今日是否已签，data.records[] 为每日明细。
// startDate 与前端一致，传当月（YYYY-M）。condition 只在奈雪币商店页出现，作为备用。
function checkSigned(state, params, signDate, deadline, callback) {
  const month = signDate.split("-").slice(0, 2).join("-");
  sendJson(state, PATH_RECORDS, params, { startDate: month }, CHECK_TIMEOUT, (records) => {
    const byRecords = readSigned(records);
    if (byRecords !== null) {
      callback(Object.assign({ source: "records" }, records, { signed: byRecords }));
      return;
    }
    if (Date.now() > deadline) {
      callback(Object.assign({ source: "records" }, records, { signed: null }));
      return;
    }
    log(`records 无法判定状态（${preview(records.text)}），改用 condition 复查`);
    sendJson(state, PATH_CONDITION, params, { signDate }, CHECK_TIMEOUT, (condition) => {
      callback(Object.assign({ source: "condition" }, condition, { signed: readSigned(condition) }));
    });
  });
}

function finish(state, logMessage, patch, title, body) {
  log(logMessage.replace(/\n/g, " / "));
  patchState(Object.assign({ lastResult: logMessage, lastRunAt: Date.now() }, patch));
  $notification.post(SCRIPT_NAME, title, body);
  $done();
}

function buildSummary(headline, signCount, infos) {
  const lines = [];
  if (signCount) lines.push(`${headline}，已连签 ${signCount} 天`);
  else lines.push(headline);
  infos.slice(0, 3).forEach((info) => lines.push(info));
  return lines.join("\n");
}

// status 语义来自小程序前端：
//   签到弹窗 `i && !i.status ? "立即签到" : "已签到"`（condition）
//   签到日历 `n.records && n.records.status`（records）
// 两者都是顶层 data.status。无法判定时返回 null，调用方按“未知”处理而不是当成已签。
function readSigned(result) {
  const data = result && result.json && result.json.data;
  if (!data || typeof data !== "object") return null;

  const direct = normalizeFlag(data.status);
  if (direct !== null) return direct;

  // 兜底：records 每日明细里查今天。date 形如 2026-10-21，可能不带补零。
  const records = Array.isArray(data.records) ? data.records : null;
  if (records) {
    const today = todayInChina();
    const key = normalizeDate(today);
    const hit = records.find((item) => item && normalizeDate(item.date) === key);
    if (hit) {
      const flag = normalizeFlag(hit.status);
      if (flag !== null) return flag;
    }
  }
  return null;
}

function normalizeFlag(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true" || text === "1") return true;
    if (text === "false" || text === "0" || text === "") return false;
  }
  return null;
}

// 把 2026-1-5 / 2026-01-05 / 20260105 统一成 2026-01-05 便于比较。
function normalizeDate(value) {
  const text = String(value == null ? "" : value).trim();
  const dashed = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (dashed) {
    return `${dashed[1]}-${dashed[2].padStart(2, "0")}-${dashed[3].padStart(2, "0")}`;
  }
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return text;
}

function readSignCount(result) {
  const data = result && result.json && result.json.data;
  if (!data || typeof data !== "object") return 0;
  const value = Number(data.signCount != null ? data.signCount : data.continueSignCount);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function readSignInfos(result) {
  const data = result && result.json && result.json.data;
  if (!data || typeof data !== "object") return [];
  const infos = Array.isArray(data.infos) ? data.infos : [];
  return infos
    .map((item) => (item && typeof item.info === "string" ? item.info.trim() : ""))
    .filter(Boolean);
}

function classifySave(save) {
  if (save.error) return { ok: false, message: `网络请求失败：${save.error}` };
  if (save.status === 401 || save.status === 403) {
    return { ok: false, message: "accessToken 已失效，请重新打开小程序抓取" };
  }
  if (save.status === 400) return { ok: false, message: `请求被拒绝：${preview(save.text)}` };
  if (!save.json) return { ok: false, message: `HTTP ${save.status || "未知"}：${preview(save.text)}` };

  if (save.json.code === 0) return { ok: true };

  const message = String(save.json.message || "").trim() || preview(save.text);
  if (ALREADY_SIGNED_PATTERN.test(message)) return { ok: true, alreadySigned: true };
  if (save.json.code === 1500000 || TOKEN_INVALID_PATTERN.test(message)) {
    return { ok: false, message: `accessToken 已失效（${message}），请重新打开小程序抓取` };
  }
  return { ok: false, message: `code ${save.json.code}：${message}` };
}

/* ------------------------------ 请求与签名 ------------------------------ */

function sendJson(state, path, storeParams, extraParams, timeoutSeconds, callback) {
  const common = Object.assign({}, DEFAULT_COMMON, state.common || {});
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Math.floor(Math.random() * 1e6);
  const params = Object.assign({}, storeParams, extraParams);
  const signature = signRequest({ nonce, timestamp, common, params });
  const body = {
    common: Object.assign({}, common, { openId: OPEN_ID, timestamp, nonce, signature }),
    params,
  };

  const options = {
    url: ORIGIN + path,
    headers: Object.assign(
      {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh-Hans;q=0.9",
        "Content-Type": "application/json",
        Origin: ORIGIN,
        Referer: (state.headers && state.headers.Referer) || `${ORIGIN}/naixue/sign-in`,
        "User-Agent": (state.headers && state.headers["User-Agent"]) || DEFAULT_USER_AGENT,
      },
      { Authorization: `Bearer ${state.token}` }
    ),
    body: JSON.stringify(body),
    timeout: timeoutSeconds,
  };

  log(`→ POST ${path} ${describeParams(params)}`);
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

function signRequest({ nonce, timestamp, common, params }) {
  const message = `nonce=${nonce}&openId=${OPEN_ID}&timestamp=${timestamp}`;
  // 前端用 encodeURI，等价于保留 URL 保留字符，仅转义其余字符。
  const encoded = encodeURIStrict(message);
  const key = pickSignKey(common, params);
  return base64Encode(hmacSha1(utf8Bytes(key), utf8Bytes(encoded)));
}

function pickSignKey(common, params) {
  const override = $persistentStore.read(SIGN_KEY_OVERRIDE);
  if (override && String(override).trim()) return String(override).trim();

  const brand = params ? Number(params.brand) : NaN;
  const platform = (common && common.platform) || "";
  const parts = String((common && common.version) || "").split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const versionOk = major > 4 || (major === 4 && minor >= 2) || (major === 4 && !parts[1]);
  if (NAIXUE_BRANDS.indexOf(brand) >= 0 && versionOk && platform === "wxapp") return SIGN_KEY_NAIXUE;
  return SIGN_KEY_DEFAULT;
}

function encodeURIStrict(input) {
  return String(input).replace(/[^A-Za-z0-9\-_.!~*'();/?:@&=+$,#]/g, (char) => {
    return utf8Bytes(char)
      .map((byte) => "%" + byte.toString(16).toUpperCase().padStart(2, "0"))
      .join("");
  });
}

function utf8Bytes(input) {
  const text = String(input);
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      i += 1;
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

function sha1(bytes) {
  const length = bytes.length;
  const total = Math.floor((length + 9 + 63) / 64) * 64;
  const buffer = new Uint8Array(total);
  for (let i = 0; i < length; i += 1) buffer[i] = bytes[i];
  buffer[length] = 0x80;

  const bitLength = length * 8;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  buffer[total - 8] = (high >>> 24) & 0xff;
  buffer[total - 7] = (high >>> 16) & 0xff;
  buffer[total - 6] = (high >>> 8) & 0xff;
  buffer[total - 5] = high & 0xff;
  buffer[total - 4] = (low >>> 24) & 0xff;
  buffer[total - 3] = (low >>> 16) & 0xff;
  buffer[total - 2] = (low >>> 8) & 0xff;
  buffer[total - 1] = low & 0xff;

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Array(80);

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const p = offset + i * 4;
      words[i] = ((buffer[p] << 24) | (buffer[p + 1] << 16) | (buffer[p + 2] << 8) | buffer[p + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i += 1) {
      words[i] = rotateLeft(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f;
      let k;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotateLeft(a, 5) + f + e + k + words[i]) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const output = new Uint8Array(20);
  [h0, h1, h2, h3, h4].forEach((value, index) => {
    output[index * 4] = (value >>> 24) & 0xff;
    output[index * 4 + 1] = (value >>> 16) & 0xff;
    output[index * 4 + 2] = (value >>> 8) & 0xff;
    output[index * 4 + 3] = value & 0xff;
  });
  return output;
}

function rotateLeft(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function hmacSha1(keyBytes, messageBytes) {
  const blockSize = 64;
  let key = keyBytes.slice();
  if (key.length > blockSize) key = Array.prototype.slice.call(sha1(key));

  const inner = new Array(blockSize + messageBytes.length);
  const outer = new Array(blockSize + 20);
  for (let i = 0; i < blockSize; i += 1) {
    const byte = i < key.length ? key[i] : 0;
    inner[i] = byte ^ 0x36;
    outer[i] = byte ^ 0x5c;
  }
  for (let i = 0; i < messageBytes.length; i += 1) inner[blockSize + i] = messageBytes[i];

  const innerHash = sha1(inner);
  for (let i = 0; i < innerHash.length; i += 1) outer[blockSize + i] = innerHash[i];
  return sha1(outer);
}

function base64Encode(bytes) {
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    output += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    output += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 0x3f] : "=";
    output += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 0x3f] : "=";
  }
  return output;
}

/* ------------------------------ 工具 ------------------------------ */

function getHeader(headers, name) {
  const lower = String(name).toLowerCase();
  const key = Object.keys(headers || {}).find((item) => String(item).toLowerCase() === lower);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

// 与小程序前端一致：`${year}-${month}-${day}`，月日不补零（例如 2026-1-5）。
function todayInChina() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;
}

function readState() {
  const raw = $persistentStore.read(STATE_KEY);
  if (!raw) return null;
  const state = safeParse(raw);
  if (!state || typeof state !== "object" || typeof state.token !== "string" || !state.token) return null;
  return state;
}

function writeState(state) {
  return $persistentStore.write(JSON.stringify(state), STATE_KEY) !== false;
}

function patchState(patch) {
  const state = readState();
  if (!state) return;
  writeState(Object.assign({}, state, patch));
}

function safeParse(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function truncate(value, limit) {
  const text = String(value == null ? "" : value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function maskToken(token) {
  const text = String(token || "");
  if (text.length <= 10) return "***";
  return `${text.slice(0, 4)}...${text.slice(-4)}（长度 ${text.length}）`;
}

function preview(value) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ");
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

function log(message) {
  console.log(`[${SCRIPT_NAME}] ${message}`);
}
