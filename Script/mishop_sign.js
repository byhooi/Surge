const SCRIPT_NAME = "小米商城签到";
const SCRIPT_VERSION = "1.2.0";
const ACCOUNTS_KEY = "byhooi_mishop_accounts";
const LOCK_KEY = "byhooi_mishop_lock";
const ORIGIN = "https://shop-api.retail.mi.com";
const SIGN_PATH = "/mtop/mf/act/infinite/done";
const CAPTURE_PATTERN = /^https:\/\/shop-api\.retail\.mi\.com\/mtop\/mf\/act\/infinite\/(?:do|done)(?:\?.*)?$/;
const ACT_ID_PATTERN = /^[0-9a-f]{24}$/i;
// actId 前 8 位与各自的奖品池同源，用它把活动映射成可读名称；未知活动退回前缀。
const ACTIVITY_NAMES = {
  "6af6cd34": "米家商城签到",
  "6706c069": "米金商城签到",
};
const TASK_TYPE = 110;
const REQUEST_TIMEOUT = 12;
const RUN_BUDGET_MS = 90000;
const LOCK_TTL_MS = 150000;
const MAX_ACCOUNTS_PER_RUN = 10;
const MAX_ACTIVITIES_PER_RUN = 20;
// 由 Surge 或目标连接决定，不进入重放模板，避免与原请求冲突。
const DROPPED_HEADERS = ["host", "content-length", "cookie", "connection", "accept-encoding"];

if (typeof $request !== "undefined") {
  captureRequest();
} else {
  runTask()
    .catch((error) => {
      log(error.message || error);
      $notification.post(SCRIPT_NAME, "任务未完成", String(error.message || error));
    })
    .finally(() => $done());
}

// 抓包时保存 serviceToken 与活动参数：签到请求里的 actId/taskToken 一活动一份，
// 换设备或换登录态后重新打开签到页即可自动更新。
function captureRequest() {
  try {
    const request = $request || {};
    if (!CAPTURE_PATTERN.test(request.url || "")) return;
    const headers = request.headers || {};
    const token = parseServiceToken(getHeader(headers, "Cookie"));
    if (!token) {
      log("请求未携带 serviceToken，已忽略");
      return;
    }
    const activity = parseActivity(request.body);
    if (!activity) {
      log("请求体未包含 actId/taskToken，已忽略");
      return;
    }
    const result = upsertAccount(token, sanitizeHeaders(headers), activity);
    if (result.changed) {
      const detail = result.added
        ? `已记录账号与活动，定时任务将对 ${result.activityCount} 个活动领取米金。`
        : `已记录新活动，当前共 ${result.activityCount} 个活动。`;
      log(`${detail} actId ${activity.actId}`);
      $notification.post(SCRIPT_NAME, result.added ? "已添加签到账号" : "已更新签到活动", detail);
    }
  } catch (error) {
    log(`捕获失败：${error.message || error}`);
    $notification.post(SCRIPT_NAME, "捕获签到参数失败", String(error.message || error));
  } finally {
    $done({});
  }
}

function parseServiceToken(cookie) {
  const match = /(?:^|;\s*)serviceToken=([^;\s]+)/.exec(String(cookie || ""));
  if (!match) return "";
  const token = match[1].trim();
  return token.length >= 16 ? token : "";
}

function parseActivity(body) {
  if (typeof body !== "string" || !body.trim()) return null;
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (_) {
    return null;
  }
  const items = Array.isArray(payload) ? payload : [payload];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const actId = typeof item.actId === "string" ? item.actId.trim() : "";
    const taskToken = typeof item.taskToken === "string" ? item.taskToken.trim() : "";
    if (!ACT_ID_PATTERN.test(actId) || !taskToken) continue;
    return { actId, taskToken };
  }
  return null;
}

function sanitizeHeaders(headers) {
  const kept = {};
  for (const name of Object.keys(headers || {})) {
    if (DROPPED_HEADERS.includes(name.toLowerCase())) continue;
    const value = headers[name];
    if (typeof value === "string" && value) kept[name] = value;
  }
  return kept;
}

function upsertAccount(token, headers, activity) {
  const accounts = readAccounts();
  let account = accounts.find((item) => item.token === token);
  const added = !account;
  if (!account) {
    account = { token, enabled: true, headers: {}, activities: [], capturedAt: Date.now() };
    accounts.push(account);
  }
  account.headers = headers;
  account.updatedAt = Date.now();
  let existing = account.activities.find((item) => item.actId === activity.actId);
  const isNewActivity = !existing;
  if (!existing) {
    existing = { actId: activity.actId, capturedAt: Date.now() };
    account.activities.push(existing);
  }
  existing.taskToken = activity.taskToken;
  existing.updatedAt = Date.now();
  writeAccounts(accounts);
  // 每次打开签到页都会重放同一个请求，只有新增账号或新增活动才值得打扰。
  return { added, changed: added || isNewActivity, activityCount: account.activities.length };
}

function readAccounts() {
  const raw = $persistentStore.read(ACCOUNTS_KEY);
  if (!raw) return [];
  let accounts;
  try {
    accounts = JSON.parse(raw);
  } catch (_) {
    throw new Error("账号数据损坏，请在 BoxJS 检查「小米商城账号」；原数据未覆盖");
  }
  if (!Array.isArray(accounts) || accounts.some((item) =>
    !item || typeof item.token !== "string" || !item.token ||
    !Array.isArray(item.activities))) {
    throw new Error("账号数据格式错误，请在 BoxJS 检查「小米商城账号」；原数据未覆盖");
  }
  return accounts;
}

function writeAccounts(accounts) {
  if (!$persistentStore.write(JSON.stringify(accounts), ACCOUNTS_KEY)) {
    throw new Error("账号数据保存失败，请检查 Surge 存储");
  }
}

function patchActivity(token, actId, patch) {
  // 每次写入前重读，避免并发请求结束时覆盖刚捕获的其他账号。
  const accounts = readAccounts();
  const account = accounts.find((item) => item.token === token);
  if (!account) return;
  const activity = account.activities.find((item) => item.actId === actId);
  if (!activity) return;
  Object.assign(activity, patch);
  writeAccounts(accounts);
}

function httpPost(account, payload) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({}, account.headers, {
      Cookie: "serviceToken=" + account.token,
      "Content-Type": "application/json",
    });
    if (!getHeader(headers, "User-Agent")) headers["User-Agent"] = "MiHome/11.10.200.360";
    const options = {
      url: ORIGIN + SIGN_PATH,
      headers,
      body: JSON.stringify(payload),
      timeout: REQUEST_TIMEOUT,
      "auto-redirect": false,
      "auto-cookie": false,
    };
    let settled = false;
    const finish = (error, response, body) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(new Error(`网络请求失败：${preview(error)}`));
        return;
      }
      const status = Number(response && (response.status || response.statusCode));
      if (!Number.isFinite(status) || status < 200 || status >= 300) {
        reject(new Error(`HTTP ${Number.isFinite(status) ? status : "异常"}`));
        return;
      }
      let result;
      try {
        result = JSON.parse(body || "");
      } catch (_) {
        reject(new Error(`响应不是 JSON：${preview(body)}`));
        return;
      }
      resolve(result);
    };
    try {
      $httpClient.post(options, finish);
    } catch (error) {
      finish(error);
    }
  });
}

// 返回 { skipped, message, awards, series }：message 用于日志与 lastResult，
// awards 用于标题合计，series 是连续签到天数（doneInSeriesCount）。
async function signActivity(account, activity) {
  const today = dateInChina();
  if (activity.lastSignDate === today) {
    const day = Number(activity.lastSeries);
    const dayText = Number.isFinite(day) && day > 0 ? `（连续签到第 ${day} 天）` : "";
    return { skipped: true, message: `今日已签到${dayText}`, awards: [] };
  }
  const result = await httpPost(account, [
    {},
    { taskToken: activity.taskToken, actId: activity.actId, taskType: TASK_TYPE },
  ]);
  const code = Number(result && result.code);
  if (code !== 0 || result.success === false) {
    const message = result.message || result.msg || `code ${Number.isFinite(code) ? code : "未知"}`;
    throw new Error(message);
  }
  const data = (result && result.data) || {};
  const awards = Array.isArray(data.awardList) ? data.awardList.filter((item) => item && item.success !== false) : [];
  if (!awards.length) throw new Error("接口返回成功但未发放奖励，未确认为签到成功");
  const gained = awards.map((item) => ({
    name: item.customAwardName || item.awardName || "奖励",
    value: item.awardValue,
  }));
  const series = Number(data.taskInfo && data.taskInfo.doneInSeriesCount);
  const day = Number.isFinite(series) && series > 0 ? series : 0;
  const text = gained.map((item) => `${item.name} +${item.value}`).join("、");
  return {
    skipped: false,
    message: day ? `${text}（连续签到第 ${day} 天）` : text,
    awards: gained,
    series: day,
  };
}

// 标题只给奖励合计，正文按活动逐行展示，便于看出每个活动签到到第几天。
function summarizeAwards(awards) {
  const bucket = new Map();
  for (const award of awards || []) {
    const entry = bucket.get(award.name) || { total: 0, count: 0, numeric: true, sample: "" };
    const numeric = Number(award.value);
    entry.count++;
    if (entry.numeric && Number.isFinite(numeric)) {
      entry.total = Math.round((entry.total + numeric) * 100) / 100;
    } else {
      entry.numeric = false;
      entry.sample = String(award.value);
    }
    bucket.set(award.name, entry);
  }
  return bucket;
}

function formatAwards(bucket) {
  const parts = [];
  for (const [name, entry] of bucket) {
    parts.push(entry.numeric ? `${name} +${entry.total}` : `${name} +${entry.sample}×${entry.count}`);
  }
  return parts.join("、");
}

function notifyResult(lines, failures, awards, budgetHit) {
  const gained = formatAwards(summarizeAwards(awards));
  let title = "今日已签到";
  if (failures.length && gained) title = `部分成功 · ${gained} · 失败 ${failures.length}`;
  else if (failures.length) title = `签到失败 · ${failures.length} 项`;
  else if (gained) title = `签到成功 · ${gained}`;
  const body = lines.slice();
  if (failures.length) {
    body.push("失败：");
    for (const item of failures) body.push(`· ${item}`);
  }
  if (budgetHit) body.push("本轮时间或活动配额不足，剩余活动请稍后手动执行");
  $notification.post(SCRIPT_NAME, title, body.join("\n") || "没有需要处理的活动");
}

async function runTask() {
  const lock = acquireLock();
  if (!lock) {
    log("其他签到任务正在运行，本次跳过");
    return;
  }
  try {
    const accounts = readAccounts();
    if (!accounts.length) {
      $notification.post(
        SCRIPT_NAME,
        "没有已捕获的账号",
        "请在米家 App 打开「小米商城 → 签到」页一次，用于捕获 serviceToken 与活动参数。"
      );
      return;
    }
    const started = Date.now();
    const lines = [];
    const failures = [];
    const awards = [];
    let processed = 0;
    let budgetHit = false;
    let accountCount = 0;
    for (let index = 0; index < accounts.length; index++) {
      const account = accounts[index];
      if (account.enabled === false) continue;
      if (accountCount >= MAX_ACCOUNTS_PER_RUN) {
        budgetHit = true;
        break;
      }
      accountCount++;
      const accountLabel = label(index);
      if (!account.activities.length) {
        failures.push(`${accountLabel}：未捕获到活动，请重新打开签到页`);
      }
      for (const activity of account.activities) {
        if (processed >= MAX_ACTIVITIES_PER_RUN || Date.now() - started > RUN_BUDGET_MS) {
          budgetHit = true;
          break;
        }
        processed++;
        const tag = `${accountLabel} · ${activityName(activity.actId)}`;
        let message;
        try {
          if (!activity.taskToken) throw new Error("缺少 taskToken，请重新打开签到页捕获");
          const outcome = await signActivity(account, activity);
          message = outcome.message;
          if (!outcome.skipped) {
            for (const award of outcome.awards) awards.push(award);
            const patch = { lastSignDate: dateInChina(), lastResult: message, lastRunAt: Date.now() };
            if (outcome.series) patch.lastSeries = outcome.series;
            patchActivity(account.token, activity.actId, patch);
          }
          lines.push(`${tag}：${message}`);
        } catch (error) {
          message = `失败：${error.message || error}`;
          failures.push(`${tag}：${error.message || error}`);
          patchActivity(account.token, activity.actId, { lastResult: message, lastRunAt: Date.now() });
        }
        log(`${tag}：${message}`);
      }
      if (budgetHit) break;
    }
    notifyResult(lines, failures, awards, budgetHit);
  } finally {
    releaseLock(lock);
  }
}

function acquireLock() {
  const raw = $persistentStore.read(LOCK_KEY);
  if (raw) {
    let previous;
    try {
      previous = JSON.parse(raw);
    } catch (_) {
      throw new Error("任务锁数据损坏，请在 BoxJS 清空任务锁");
    }
    if (previous && previous.until > Date.now()) return null;
  }
  const lock = { id: `${Date.now()}-${Math.random()}`, until: Date.now() + LOCK_TTL_MS };
  if (!$persistentStore.write(JSON.stringify(lock), LOCK_KEY)) throw new Error("无法保存任务锁");
  return lock;
}

function releaseLock(lock) {
  const current = $persistentStore.read(LOCK_KEY);
  if (current === JSON.stringify(lock) && !$persistentStore.write("", LOCK_KEY)) {
    log("任务锁清理失败，150 秒后自动失效");
  }
}

function getHeader(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function label(index) {
  return `账号${index + 1}`;
}

function activityName(actId) {
  const key = String(actId || "").slice(0, 8).toLowerCase();
  return ACTIVITY_NAMES[key] || `活动 ${key || "未知"}`;
}

function dateInChina(time = Date.now()) {
  return new Date(time + 8 * 3600000).toISOString().slice(0, 10);
}

function log(message) {
  console.log(`[${SCRIPT_NAME} v${SCRIPT_VERSION}] ${message}`);
}

function preview(value) {
  const text = String(value && value.message ? value.message : value || "")
    .replace(/serviceToken=[^;\s]+/gi, "serviceToken=***")
    .replace(/\s+/g, " ");
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}
