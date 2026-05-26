const SCRIPT_VERSION = "2026.05.26.1";
const STORE_KEY = "digitalflag.checkin.request";
const CHECKIN_URL = "https://www.digitalflag.cn/gateway/for-c/checkin";

function log(message) {
  if (typeof console !== "undefined" && console.log) {
    console.log("[Digitalflag Checkin] " + message);
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

function setHeader(headers, name, value) {
  if (!value) return;
  for (const key in headers) {
    if (key.toLowerCase() === name.toLowerCase()) {
      headers[key] = value;
      return;
    }
  }
  headers[name] = value;
}

function decodeBase64(input) {
  if (typeof atob === "function") return atob(input);
  if (typeof Buffer !== "undefined") return Buffer.from(input, "base64").toString("utf8");
  throw new Error("No base64 decoder");
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
  const pad = n => String(n).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
}

function captureRequest() {
  const headers = $request.headers || {};
  const authorization = getHeader(headers, "Authorization");
  const previous = readStore();

  if (!authorization) {
    log("capture skipped, Authorization missing: " + $request.url);
    $done({});
    return;
  }

  const payload = decodeJwtPayload(authorization);
  if (!payload || !payload.exp) {
    log("capture skipped, Authorization is not a valid JWT: " + $request.url);
    $done({});
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
      "Accept-Encoding": "gzip,compress,br,deflate"
    }
  };

  const ok = writeStore(saved);
  const expText = "exp: " + formatTime(payload.exp);
  const changed = !previous || !previous.headers || previous.headers.Authorization !== authorization;

  if (ok) {
    log("request headers updated, " + expText + ", source: " + $request.url);
    if (changed) {
      $notification.post("Digitalflag Checkin", "Request headers updated", expText);
    }
  } else {
    log("failed to write request headers to persistent store");
  }

  $done({});
}

function runCheckin() {
  const saved = readStore();
  if (!saved || !saved.headers || !saved.headers.Authorization) {
    log("missing saved request headers");
    $notification.post("Digitalflag Checkin", "Missing request headers", "Open the mini-program first to capture Authorization.");
    $done();
    return;
  }

  const payload = decodeJwtPayload(saved.headers.Authorization);
  if (!payload || !payload.exp) {
    log("saved Authorization is not a valid JWT");
    $notification.post("Digitalflag Checkin", "Invalid Authorization", "Open the mini-program again to capture a fresh token.");
    $done();
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    log("Authorization expired at " + formatTime(payload.exp));
    $notification.post("Digitalflag Checkin", "Authorization expired", "expired at: " + formatTime(payload.exp));
    $done();
    return;
  }

  const headers = {};
  Object.keys(saved.headers).forEach(key => {
    if (saved.headers[key]) headers[key] = saved.headers[key];
  });

  setHeader(headers, "Connection", "keep-alive");

  const options = {
    url: CHECKIN_URL,
    method: "GET",
    headers
  };

  log("sending checkin request, version: " + SCRIPT_VERSION + ", token exp: " + formatTime(payload.exp) + ", captured: " + (saved.capturedAt || "unknown"));

  $httpClient.get(options, (error, response, data) => {
    if (error) {
      log("request failed: " + String(error));
      $notification.post("Digitalflag Checkin", "Request failed", String(error));
      $done();
      return;
    }

    const status = response ? response.status || response.statusCode : "no status";
    log("response status: " + status + ", body: " + (data || ""));
    let title = "Checkin request accepted";
    let message = data || "";
    const expText = "exp: " + formatTime(payload.exp);
    const capturedText = saved.capturedAt ? "captured: " + saved.capturedAt : "captured: unknown";

    if (status === 401 || status === 403) {
      $notification.post("Digitalflag Checkin", "Authorization rejected", "HTTP " + status + " | " + expText);
      $done();
      return;
    }

    try {
      const body = JSON.parse(data || "{}");
      if (body.code && body.code !== "100000") {
        title = "Checkin returned error";
      }
      message = (body.message || data || "HTTP " + status) + " | " + expText + " | " + capturedText;
    } catch (e) {
      message = (data || "HTTP " + status) + " | " + expText + " | " + capturedText;
    }

    $notification.post("Digitalflag Checkin", title, message);
    $done();
  });
}

if (typeof $request !== "undefined") {
  captureRequest();
} else {
  runCheckin();
}
