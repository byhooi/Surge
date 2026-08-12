const SCRIPT_NAME = "华住会签到";
const SCRIPT_VERSION = "1.0.0";
const TOKEN_KEY = "byhooi_huazhu_token";

const SIGN_URL = "https://appgw.huazhu.com/game/sign_in";

if (typeof $request !== "undefined") {
  captureToken();
} else {
  signIn();
}

function captureToken() {
  try {
    const headers = $request.headers || {};
    const cookie = getHeader(headers, "Cookie");
    const match = /userToken=([^;\s]+)/.exec(cookie || "");
    if (!match) {
      $done({});
      return;
    }

    const token = match[1];
    const previous = $persistentStore.read(TOKEN_KEY);
    if (token === previous) {
      $done({});
      return;
    }

    const saved = $persistentStore.write(token, TOKEN_KEY);
    if (!saved) {
      throw new Error("写入持久化数据失败");
    }

    const action = previous ? "已更新" : "已获取";
    console.log(`[${SCRIPT_NAME}] ${action} userToken：${preview(token)}`);
    $notification.post(
      SCRIPT_NAME,
      `${action} userToken`,
      "凭证已保存，定时签到任务可正常执行。"
    );
  } catch (error) {
    console.log(`[${SCRIPT_NAME}] 捕获失败：${error.message || error}`);
    $notification.post(SCRIPT_NAME, "获取 userToken 失败", String(error.message || error));
  } finally {
    $done({});
  }
}

function signIn() {
  const token = $persistentStore.read(TOKEN_KEY);
  if (!token) {
    $notification.post(
      SCRIPT_NAME,
      "缺少 userToken",
      "请在微信中打开华住会小程序并浏览任意页面以捕获凭证。"
    );
    $done();
    return;
  }

  const options = {
    url: `${SIGN_URL}?date=${Math.floor(Date.now() / 1000)}`,
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh-Hans;q=0.9",
      "Client-Platform": "WX-MP",
      Origin: "https://cdn.huazhu.com",
      Referer: "https://cdn.huazhu.com/",
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.75(0x18004b46) NetType/WIFI Language/zh_CN miniProgram/wx286efc12868f2559",
      Cookie: `userToken=${token}`,
    },
    timeout: 30,
  };

  console.log(`[${SCRIPT_NAME}] v${SCRIPT_VERSION} 开始签到`);
  $httpClient.get(options, (error, response, data) => {
    try {
      if (error) {
        throw new Error(error);
      }

      const status = response && (response.status || response.statusCode);
      if (Number(status) < 200 || Number(status) >= 300) {
        throw new Error(`HTTP ${status || "未知"}：${preview(data)}`);
      }

      const result = safeParse(data);
      if (!result) {
        throw new Error(`响应格式异常：${preview(data)}`);
      }

      const content = result.content || {};
      if (result.code === 200 && content.signResult === true) {
        const details = [];
        if (content.point != null) details.push(`积分 +${content.point}`);
        if (content.activityPoints != null) details.push(`活动积分 +${content.activityPoints}`);
        if (content.yearSignInCount != null) details.push(`今年已签到 ${content.yearSignInCount} 天`);
        const body = details.join("，") || "签到成功";
        console.log(`[${SCRIPT_NAME}] 签到成功：${body}`);
        $notification.post(SCRIPT_NAME, "签到成功 ✅", body);
        return;
      }

      const message = result.message || result.responseDes || preview(data);
      if (result.code === 200) {
        console.log(`[${SCRIPT_NAME}] 今日可能已签到：${preview(data)}`);
        $notification.post(SCRIPT_NAME, "今日已签到或无需签到", message || "signResult 为 false");
        return;
      }

      throw new Error(`code ${result.code}：${message}`);
    } catch (requestError) {
      const text = String(requestError.message || requestError);
      console.log(`[${SCRIPT_NAME}] 签到失败：${text}`);
      $notification.post(
        SCRIPT_NAME,
        "签到失败",
        `${text}\n若提示未登录，请重新打开华住会小程序刷新凭证。`
      );
    } finally {
      $done();
    }
  });
}

function getHeader(headers, name) {
  const lower = name.toLowerCase();
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === lower);
  return key ? headers[key] : undefined;
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
