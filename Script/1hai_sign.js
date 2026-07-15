const SCRIPT_NAME = "一嗨租车签到";
const SCRIPT_VERSION = "1.0.0";
const REQUEST_KEY = "byhooi_1hai_sign_request";

if (typeof $request !== "undefined") {
  captureRequest();
} else {
  replayRequest();
}

function captureRequest() {
  try {
    const request = {
      url: $request.url,
      method: $request.method || "POST",
      headers: sanitizeHeaders($request.headers || {}),
      body: typeof $request.body === "string" ? $request.body : "",
      capturedAt: new Date().toISOString(),
      version: SCRIPT_VERSION,
    };

    if (!request.body) {
      throw new Error("未捕获到加密请求体，请确认模块已启用 requires-body");
    }

    const previous = readJson(REQUEST_KEY);
    const saved = $persistentStore.write(JSON.stringify(request), REQUEST_KEY);
    if (!saved) {
      throw new Error("写入持久化数据失败");
    }

    const action = previous ? "已更新" : "已获取";
    $notification.post(
      SCRIPT_NAME,
      `${action}签到请求`,
      "已保存动态凭证和加密请求体，可等待定时任务测试。"
    );
  } catch (error) {
    console.log(`[${SCRIPT_NAME}] 捕获失败：${error.message || error}`);
    $notification.post(SCRIPT_NAME, "获取签到请求失败", String(error.message || error));
  } finally {
    $done({});
  }
}

function replayRequest() {
  const saved = readJson(REQUEST_KEY);
  if (!saved || !saved.url || !saved.headers || !saved.body) {
    $notification.post(
      SCRIPT_NAME,
      "缺少签到请求",
      "请打开一嗨租车 App，进入签到页面并手动签到一次。"
    );
    $done();
    return;
  }

  const options = {
    url: saved.url,
    method: saved.method || "POST",
    headers: sanitizeHeaders(saved.headers),
    body: saved.body,
    timeout: 30,
  };

  console.log(`[${SCRIPT_NAME}] 重放捕获于 ${saved.capturedAt || "未知时间"} 的请求`);
  $httpClient.post(options, (error, response, data) => {
    try {
      if (error) {
        throw new Error(error);
      }

      const status = response && (response.status || response.statusCode);
      if (Number(status) < 200 || Number(status) >= 300) {
        throw new Error(`HTTP ${status || "未知"}：${preview(data)}`);
      }

      const result = safeParse(data);
      if (!result || typeof result.Result !== "string") {
        throw new Error(`响应格式异常：${preview(data)}`);
      }

      console.log(`[${SCRIPT_NAME}] HTTP ${status}`);
      console.log(`[${SCRIPT_NAME}] 加密响应：${preview(result.Result)}`);
      $notification.post(
        SCRIPT_NAME,
        "签到请求已完成",
        "服务器返回了加密结果，请在一嗨租车 App 中核对签到状态。"
      );
    } catch (requestError) {
      const message = String(requestError.message || requestError);
      console.log(`[${SCRIPT_NAME}] 执行失败：${message}`);
      $notification.post(
        SCRIPT_NAME,
        "签到请求失败",
        `${message}\n可能是随机数、签名或请求体已经过期，请重新手动签到抓取。`
      );
    } finally {
      $done();
    }
  });
}

function sanitizeHeaders(headers) {
  const ignored = {
    host: true,
    connection: true,
    "content-length": true,
    "accept-encoding": true,
    "proxy-connection": true,
  };
  const output = {};

  Object.keys(headers || {}).forEach((name) => {
    if (!ignored[name.toLowerCase()]) {
      output[name] = headers[name];
    }
  });
  return output;
}

function readJson(key) {
  const value = $persistentStore.read(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.log(`[${SCRIPT_NAME}] 持久化数据解析失败：${error.message || error}`);
    return null;
  }
}

function safeParse(value) {
  try {
    return JSON.parse(value || "");
  } catch (error) {
    return null;
  }
}

function preview(value) {
  const text = String(value || "").replace(/\s+/g, " ");
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}
