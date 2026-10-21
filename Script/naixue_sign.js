const SCRIPT_NAME = "奈雪点单签到";
const SCRIPT_VERSION = "1.0.0";
const STATE_KEY = "byhooi_naixue_state";
const SIGN_KEY_OVERRIDE = "byhooi_naixue_sign_key";

const ORIGIN = "https://tm-web.pin-dao.cn";
const SIGN_PATH = "/user/sign/save";

// 命中即保存凭证：签到页、签到状态/记录、账号信息与下单页都会带上 Authorization。
// 模块中的抓取 pattern 使用前缀匹配：^https:\/\/tm-web\.pin-dao\.cn\/(?:user|naixue|chayuan|coupon)\/

// 小程序前端固定 openId 与签名密钥，属于公开前端常量，不是账号凭证。
const OPEN_ID = "QL6ZOftGzbziPlZwfiXM";
const SIGN_KEY_NAIXUE = "sArMTldQ9tqU19XIRDMWz7BO5WaeBnrezA";
const SIGN_KEY_DEFAULT = "iYkcDMF8Eti255hti5M629RQTQ4Z2XihG";
const NAIXUE_BRANDS = [26000252, 26000254];

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

if (typeof $request !== "undefined") {
  captureState();
} else {
  signIn();
}

/* ------------------------------ 抓取凭证 ------------------------------ */

function captureState() {
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
    const next = {
      token,
      capturedAt: new Date().toISOString(),
      version: SCRIPT_VERSION,
      common: pickCommon(Object.assign({}, (previous && previous.common) || {}, (body && body.common) || {})),
      params: mergeParams(previous && previous.params, body && body.params),
      headers: pickRequestHeaders(headers, previous && previous.headers),
    };

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

/* ------------------------------ 定时签到 ------------------------------ */

function signIn() {
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

  const common = Object.assign({}, DEFAULT_COMMON, state.common || {});
  const signDate = todayInChina();
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Math.floor(Math.random() * 1e6);
  const signature = signRequest({ nonce, timestamp, common, params });
  const body = {
    common: Object.assign({}, common, { openId: OPEN_ID, timestamp, nonce, signature }),
    params: Object.assign({}, params, { signDate }),
  };

  const options = {
    url: ORIGIN + SIGN_PATH,
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh-Hans;q=0.9",
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Referer: (state.headers && state.headers.Referer) || `${ORIGIN}/naixue/sign-in`,
      "User-Agent": (state.headers && state.headers["User-Agent"]) || DEFAULT_USER_AGENT,
      Authorization: `Bearer ${state.token}`,
    },
    body: JSON.stringify(body),
    timeout: 30,
  };

  log(`v${SCRIPT_VERSION} 开始签到，signDate=${signDate}，${describeParams(params)}`);
  $httpClient.post(options, (error, response, data) => {
    try {
      if (error) throw new Error(String(error));
      const status = Number((response && (response.status || response.statusCode)) || 0);
      const text = typeof data === "string" ? data : String(data == null ? "" : data);
      const result = safeParse(text);

      if (status === 401 || status === 403) throw new Error("accessToken 已失效，请重新打开小程序抓取");
      if (status === 400) throw new Error(`请求被拒绝：${preview(text)}`);
      if (!result) throw new Error(`HTTP ${status || "未知"}：${preview(text)}`);

      if (result.code === 0) {
        const summary = summarizeSign(result.data);
        log(`签到成功：${summary.replace(/\n/g, " / ")}`);
        patchState({ lastResult: summary, lastSignDate: signDate, lastRunAt: Date.now() });
        $notification.post(SCRIPT_NAME, "签到成功 ✅", summary);
        return;
      }

      const message = String(result.message || "").trim() || preview(text);
      if (ALREADY_SIGNED_PATTERN.test(message)) {
        log(`今日已签到：${message}`);
        patchState({ lastResult: `今日已签到：${message}`, lastSignDate: signDate, lastRunAt: Date.now() });
        $notification.post(SCRIPT_NAME, "今日已签到", message);
        return;
      }
      if (result.code === 1500000 || TOKEN_INVALID_PATTERN.test(message)) {
        throw new Error(`accessToken 已失效（${message}），请重新打开小程序抓取`);
      }
      throw new Error(`code ${result.code}：${message}`);
    } catch (requestError) {
      const message = String((requestError && requestError.message) || requestError);
      log(`签到失败：${message}`);
      patchState({ lastResult: `失败：${message}`, lastRunAt: Date.now() });
      $notification.post(SCRIPT_NAME, "签到失败", message);
    } finally {
      $done();
    }
  });
}

function summarizeSign(data) {
  const details = [];
  if (data && data.flag === true) details.push("签到成功，获得奈雪币");
  const infos = data && Array.isArray(data.infos) ? data.infos : [];
  infos.slice(0, 3).forEach((item) => {
    if (item && typeof item.info === "string" && item.info.trim()) details.push(item.info.trim());
  });
  return details.length ? details.join("\n") : "签到请求已提交";
}

/* ------------------------------ 签名 ------------------------------ */

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

  const byteLength = length * 8;
  const high = Math.floor(byteLength / 0x100000000);
  const low = byteLength >>> 0;
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

function todayInChina() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}-${day}`;
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
