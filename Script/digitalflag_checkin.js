const SCRIPT_VERSION = "2026.05.26.5";
const STORE_KEY = "digitalflag.checkin.request";
const CHECKIN_URL = "https://www.digitalflag.cn/gateway/for-c/checkin";

function log(message) {
  if (typeof console !== "undefined" && console.log) {
    console.log("[钧濠签到] " + message);
  }
}

function readStore() {
  const raw = $persistentStore.read(STORE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeStore(value) {
  return $persistentStore.write(JSON.stringify(value), STORE_KEY);
}

function getHeader(headers, name) {
  const target = name.toLowerCase();
  for (const key in headers || {}) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return "";
}

function decodeBase64(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let str = String(input || "").replace(/=+$/, "");
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < str.length; i++) {
    const value = chars.indexOf(str.charAt(i));
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  try {
    return decodeURIComponent(escape(output));
  } catch (e) {
    return output;
  }
}

function decodeJwtPayload(token) {
  const jwt = (token || "").replace(/^Bearer\s+/i, "");
  const parts = jwt.split(".");
  if (parts.length < 2) return null;

  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    return JSON.parse(decodeBase64(payload));
  } catch (e) {
    return null;
  }
}

function formatTime(seconds) {
  if (!seconds) return "unknown";
  const date = new Date(seconds * 1000);
  const pad = n => {
    const value = String(n);
    return value.length < 2 ? "0" + value : value;
  };
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
}

function captureRequest() {
  try {
    const headers = $request.headers || {};
    const authorization = getHeader(headers, "Authorization");
    const previous = readStore();

    if (!authorization) {
      log("capture skipped, Authorization missing: " + $request.url);
      return;
    }

    const payload = decodeJwtPayload(authorization);
    if (!payload || !payload.exp) {
      log("capture skipped, Authorization is not a valid JWT: " + $request.url);
      return;
    }

    const saved = {
      url: CHECKIN_URL,
      method: "GET",
      capturedFrom: $request.url,
      capturedAt: new Date().toISOString(),
      headers: {
        "Authorization": authorization,
        "X-Currently-Group-Code": getHeader(headers, "X-Currently-Group-Code"),
        "X-Currently-Mall-Id": getHeader(headers, "X-Currently-Mall-Id"),
        "X-Currently-Tenant-Code": getHeader(headers, "X-Currently-Tenant-Code"),
        "content-type": getHeader(headers, "content-type") || "application/json;charset=UTF-8",
        "User-Agent": getHeader(headers, "User-Agent"),
        "Referer": getHeader(headers, "Referer"),
        "Accept-Encoding": "gzip,deflate"
      }
    };

    const ok = writeStore(saved);
    const expText = "exp: " + formatTime(payload.exp);
    const changed = !previous || !previous.headers || previous.headers.Authorization !== authorization;

    if (ok) {
      log("request headers updated, " + expText + ", source: " + $request.url);
      if (changed) {
        $notification.post("钧濠签到", "已获取令牌", expText);
      }
    } else {
      log("failed to write request headers to persistent store");
    }
  } catch (e) {
    log("capture error: " + String(e));
  } finally {
    $done({});
  }
}

function runCheckin() {
  try {
    const saved = readStore();
    if (!saved || !saved.headers || !saved.headers.Authorization) {
      log("missing saved request headers");
      $notification.post("钧濠签到", "未找到令牌", "请先打开小程序");
      return;
    }

    const payload = decodeJwtPayload(saved.headers.Authorization);
    if (!payload || !payload.exp) {
      log("saved Authorization is not a valid JWT");
      $notification.post("钧濠签到", "令牌无效", "请重新打开小程序获取");
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      log("Authorization expired at " + formatTime(payload.exp));
      $notification.post("钧濠签到", "令牌已过期", formatTime(payload.exp));
      return;
    }

    const headers = {};
    Object.keys(saved.headers).forEach(key => {
      if (saved.headers[key]) headers[key] = saved.headers[key];
    });

    const options = {
      url: CHECKIN_URL,
      method: "GET",
      headers
    };

    log("sending checkin request, version: " + SCRIPT_VERSION + ", token exp: " + formatTime(payload.exp) + ", captured: " + (saved.capturedAt || "unknown"));

    $httpClient.get(options, (error, response, data) => {
      try {
        if (error) {
          log("request failed: " + String(error));
          $notification.post("钧濠签到", "请求失败", String(error));
          return;
        }

        const status = response ? response.status || response.statusCode : "no status";
        log("response status: " + status + ", body: " + (data || ""));
        if (status === 401 || status === 403) {
          $notification.post("钧濠签到", "令牌被拒", "HTTP " + status);
          return;
        }

        let title = "签到成功";
        let message = "";
        try {
          const body = JSON.parse(data || "{}");
          if (body.code && body.code !== "100000") {
            title = "签到失败";
          }
          message = body.message || body.msg || "";
        } catch (e) {
          message = data || "";
        }

        $notification.post("钧濠签到", title, message);
      } catch (e) {
        log("callback error: " + String(e));
      } finally {
        $done();
      }
    });
  } catch (e) {
    log("checkin error: " + String(e));
    $notification.post("钧濠签到", "脚本出错", String(e));
    $done();
  }
}

if (typeof $request !== "undefined") {
  captureRequest();
} else {
  runCheckin();
}
