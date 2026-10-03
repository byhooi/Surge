// 自动生成：请修改 lggov_sign.js 后运行 node scripts/build-lggov-refresh.cjs，不要直接编辑。
const SCRIPT_NAME = "龙岗图书馆签到";
const SCRIPT_VERSION = "1.1.0";
const ENTRY_MODE = "refresh-manual";
const ACCOUNTS_KEY = "byhooi_lggov_accounts";
const LOCK_KEY = "byhooi_lggov_lock";
const ORIGIN = "https://tsg.lggov.cn";
const INFO_PATH = "/userHub/opac/reader/info";
const SIGN_PATH = "/userHub/opac/login/points";
const CAPTURE_PATTERN = /^https:\/\/tsg\.lggov\.cn\/userHub\/opac\/(?:reader\/(?:info|login|cards\/switch)|login\/points)(?:\?.*)?$/;
const REQUEST_TIMEOUT = 12;
const RUN_BUDGET_MS = 90000;
const LOCK_TTL_MS = 150000;
const MAX_ACCOUNTS_PER_RUN = 30;

// 只解码 JWT 元数据用于分账号和到期提醒，不验证签名，也不修改凭证。
function parseToken(value) {
  if (typeof value !== "string") throw new Error("缺少登录 Token");
  const raw = value.trim().replace(/^Bearer\s+/i, "");
  const parts = raw.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_+/=-]+$/.test(part))) {
    throw new Error("Token 格式不支持，请重新登录捕获");
  }
  let claims;
  try {
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let buffer = 0;
    let bits = 0;
    let escaped = "";
    for (const char of encoded) {
      const digit = alphabet.indexOf(char);
      if (digit < 0) throw new Error();
      buffer = (buffer << 6) | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        escaped += "%" + ((buffer >> bits) & 255).toString(16).padStart(2, "0");
        buffer &= (1 << bits) - 1;
      }
    }
    claims = JSON.parse(decodeURIComponent(escaped));
  } catch (_) {
    throw new Error("无法解析 Token，请重新登录捕获");
  }
  if (!claims || typeof claims.cardno !== "string" || !claims.cardno.trim() ||
      claims.cardno.length > 128 || !Number.isFinite(claims.exp) || claims.exp <= 0) {
    throw new Error("Token 缺少读者证号或有效期，未保存");
  }
  return { token: `Bearer ${raw}`, cardno: claims.cardno, expiresAt: claims.exp * 1000 };
}

function getHeader(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function readAccounts() {
  const raw = $persistentStore.read(ACCOUNTS_KEY);
  if (!raw) return [];
  let accounts;
  try {
    accounts = JSON.parse(raw);
  } catch (_) {
    throw new Error("账号列表 JSON 损坏，请在 BoxJS 检查；原数据未覆盖");
  }
  if (!Array.isArray(accounts) || accounts.some((a) => !a || typeof a.cardno !== "string") ||
      new Set(accounts.map((a) => a.cardno)).size !== accounts.length) {
    throw new Error("账号列表格式错误或读者证重复；原数据未覆盖");
  }
  return accounts;
}

function writeAccounts(accounts) {
  if (!$persistentStore.write(JSON.stringify(accounts), ACCOUNTS_KEY)) {
    throw new Error("账号数据保存失败，请检查 Surge 存储");
  }
}

function label(account) {
  return `读者证 ****${account.cardno.slice(-4)}`;
}

function dateInChina(time = Date.now()) {
  return new Date(time + 8 * 3600000).toISOString().slice(0, 10);
}

function timeInChina(time) {
  return new Date(time + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ") + "（北京时间）";
}

function log(message) {
  console.log(`[${SCRIPT_NAME} v${SCRIPT_VERSION}] ${message}`);
}

function patchAccount(cardno, patch) {
  // 每次写入前重读，避免异步网络请求结束时覆盖刚捕获的其他账号。
  const accounts = readAccounts();
  const account = accounts.find((item) => item.cardno === cardno);
  if (!account) return;
  Object.assign(account, patch);
  writeAccounts(accounts);
}

function saveToken(info, allowAdd, expectedToken) {
  const accounts = readAccounts();
  let account = accounts.find((item) => item.cardno === info.cardno);
  const added = !account;
  if (!account) {
    if (!allowAdd) return false;
    account = { cardno: info.cardno, enabled: true, capturedAt: Date.now() };
    accounts.push(account);
  }
  // 旧请求的迟到响应不能覆盖用户刚重新登录得到的凭证。
  if (expectedToken && account.token !== expectedToken) return false;
  if (Number(account.expiresAt) > info.expiresAt) return false;
  Object.assign(account, info, { updatedAt: Date.now() });
  writeAccounts(accounts);
  return added;
}

function captureToken() {
  if (typeof $response === "undefined" || !CAPTURE_PATTERN.test($request.url || "")) return;
  const status = Number($response.status || $response.statusCode);
  if (status < 200 || status >= 300 || !Number.isFinite(status)) return;
  let token = getHeader($response.headers, "Authorization");
  // 切换/登录响应缺少新凭证时，不能把请求中的旧账号当成新账号。
  if (!token && /\/(?:reader\/info|login\/points)(?:\?.*)?$/.test($request.url)) {
    token = getHeader($request.headers, "Authorization");
  }
  if (!token) return;
  const info = parseToken(token);
  if (info.expiresAt <= Date.now()) return;
  const previous = readAccounts().find((item) => item.cardno === info.cardno);
  const added = saveToken(info, true);
  if (added || (previous && Number(previous.expiresAt) <= Date.now())) {
    $notification.post(SCRIPT_NAME, added ? "已添加签到账号" : "已更新失效凭证",
      `${label(info)}\nToken 到期：${timeInChina(info.expiresAt)}\n其他读者证请切换后进入“我的”页面。`);
  }
}

function http(method, token, path) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error("请求超时，未自动重试")), (REQUEST_TIMEOUT + 1) * 1000);
    function finish(error, response, body) {
      if (settled) return;
      settled = true;
      if (typeof clearTimeout === "function") clearTimeout(timer);
      if (error) reject(error);
      else resolve({ response, body });
    }
    const options = {
      url: ORIGIN + path,
      headers: { Authorization: token, Accept: "application/json", Referer: ORIGIN + "/ilg/" },
      timeout: REQUEST_TIMEOUT,
      "auto-redirect": false,
      "auto-cookie": false,
    };
    try {
      $httpClient[method](options, (error, response, body) => {
        // 网络错误和服务端正文可能包含凭证，不直接输出。
        finish(error ? new Error("网络请求失败，未自动重试") : null, response, body);
      });
    } catch (_) {
      finish(new Error("无法发送请求，请检查 Surge 脚本环境"));
    }
  });
}

async function callApi(cardno, method, path) {
  const account = readAccounts().find((item) => item.cardno === cardno);
  if (!account || account.enabled === false) throw new Error("账号已删除或停用");
  const info = parseToken(account.token);
  if (info.cardno !== cardno) throw new Error("账号与 Token 不匹配，请重新捕获");
  if (info.expiresAt <= Date.now()) throw new Error("Token 已过期，请重新登录并进入“我的”页面");
  const { response, body } = await http(method, info.token, path);
  const status = Number(response && (response.status || response.statusCode));
  if (status === 401 || status === 403) throw new Error("登录失效或无权访问，请重新登录捕获 Token");
  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    throw new Error(`HTTP ${Number.isFinite(status) ? status : "异常"}，未自动重试`);
  }
  let result;
  try {
    result = JSON.parse(body);
  } catch (_) {
    throw new Error("响应不是 JSON，请检查网站状态");
  }
  if (!result || result.code !== 0) {
    if (result && (result.code === 401 || result.code === 403)) {
      throw new Error("登录状态失效，请重新登录捕获 Token");
    }
    throw new Error("接口返回业务错误，请在网页检查账号状态");
  }
  if (path === INFO_PATH && result.data && result.data.cardno != null && result.data.cardno !== cardno) {
    throw new Error("个人信息与当前账号不匹配，已停止处理");
  }
  const updated = getHeader(response.headers, "Authorization");
  if (updated) {
    const next = parseToken(updated);
    if (next.cardno !== cardno) throw new Error("响应 Token 属于其他读者证，未覆盖当前账号");
    if (next.expiresAt <= Date.now()) throw new Error("服务端返回过期 Token，请重新登录");
    saveToken(next, false, account.token);
  }
  return result;
}

async function refreshAccount(cardno) {
  const result = await callApi(cardno, "get", INFO_PATH);
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    throw new Error("个人信息响应格式异常");
  }
  const patch = { lastRefreshAt: Date.now() };
  if (typeof result.data.total_points === "number" && Number.isFinite(result.data.total_points)) {
    patch.totalPoints = result.data.total_points;
  }
  patchAccount(cardno, patch);
  return patch;
}

async function signAccount(account) {
  const today = dateInChina();
  if (account.lastSignDate === today) return "今日已确认签到，跳过";
  const result = await callApi(account.cardno, "post", SIGN_PATH);
  let message;
  if (result.data === true || result.data === 1 || result.data === "1") {
    message = "签到成功";
    patchAccount(account.cardno, { lastSignDate: today });
  } else if (result.data === false || result.data === 0 || result.data === "0") {
    message = "未发放积分（可能今日已签到，未确认为成功）";
  } else {
    throw new Error("签到返回值未知，未确认为成功，请查看网页积分明细");
  }
  try {
    const info = await refreshAccount(account.cardno);
    if (info.totalPoints != null) message += `，总积分 ${info.totalPoints}`;
  } catch (error) {
    message += `；查询积分失败：${error.message}`;
  }
  return message;
}

function acquireLock() {
  const raw = $persistentStore.read(LOCK_KEY);
  if (raw) {
    let previous;
    try { previous = JSON.parse(raw); } catch (_) { throw new Error("任务锁数据损坏，请在 BoxJS 清空任务锁"); }
    if (previous && previous.until > Date.now()) return null;
  }
  const lock = { id: `${Date.now()}-${Math.random()}`, until: Date.now() + LOCK_TTL_MS };
  if (!$persistentStore.write(JSON.stringify(lock), LOCK_KEY)) throw new Error("无法保存任务锁");
  return lock;
}

async function runTask() {
  const manualRefresh = ENTRY_MODE === "refresh-manual";
  const mode = manualRefresh ? "refresh" : (typeof $argument === "string" && $argument.trim() ? $argument.trim() : "sign");
  if (mode !== "sign" && mode !== "refresh") throw new Error("不支持的任务参数");
  const lock = acquireLock();
  if (!lock) {
    log("其他签到/续期任务正在运行，本次跳过");
    if (manualRefresh) $notification.post(SCRIPT_NAME, "续期暂未执行", "其他签到/续期任务正在运行，请稍后再试。");
    return;
  }
  try {
    const accounts = readAccounts().filter((item) => item.enabled !== false)
      .sort((a, b) => (Number(a.lastRunAt) || 0) - (Number(b.lastRunAt) || 0));
    if (!accounts.length) {
      if (mode === "sign" || manualRefresh) $notification.post(SCRIPT_NAME, "没有启用的账号", "请逐个登录或切换读者证，进入“我的”页面捕获 Token。");
      return;
    }
    const started = Date.now();
    const messages = [];
    const warnings = [];
    for (let index = 0; index < accounts.length; index++) {
      const account = accounts[index];
      let message;
      // 为一个账号的签到和积分查询预留完整时间，避免整个脚本被强制终止。
      // 原生引擎没有 clearTimeout；每轮最多 60 个计时器，低于 Surge 的 64 个上限。
      if (index >= MAX_ACCOUNTS_PER_RUN || Date.now() - started > RUN_BUDGET_MS - 2 * (REQUEST_TIMEOUT + 1) * 1000) {
        message = "本轮时间或账号配额不足，未处理；请稍后手动执行";
        warnings.push(`${label(account)}：${message}`);
      } else {
        try {
          if (mode === "refresh") {
            const before = parseToken(account.token).expiresAt;
            await refreshAccount(account.cardno);
            const latest = readAccounts().find((item) => item.cardno === account.cardno);
            if (!latest) throw new Error("账号已删除");
            message = `凭证到期：${timeInChina(latest.expiresAt)}`;
            if (latest.expiresAt <= before) {
              message = `访问成功但未观察到续期，${message}；必要时重新登录`;
              warnings.push(`${label(account)}：${message}`);
            } else {
              message = `已续期，${message}`;
            }
          } else {
            message = await signAccount(account);
          }
          patchAccount(account.cardno, { lastRunAt: Date.now(), lastResult: message });
        } catch (error) {
          message = error.message;
          warnings.push(`${label(account)}：${message}`);
          patchAccount(account.cardno, { lastRunAt: Date.now(), lastResult: message });
        }
      }
      const line = `${label(account)}：${message}`;
      messages.push(line);
      log(line);
    }
    if (mode === "sign") $notification.post(SCRIPT_NAME, `每日任务：${accounts.length} 个账号`, messages.join("\n"));
    else if (manualRefresh) $notification.post(SCRIPT_NAME, `手动续期：${accounts.length} 个账号`, messages.join("\n"));
    else if (warnings.length) $notification.post(SCRIPT_NAME, "续期需要关注", warnings.join("\n"));
  } finally {
    const current = $persistentStore.read(LOCK_KEY);
    if (current === JSON.stringify(lock) && !$persistentStore.write("", LOCK_KEY)) log("任务锁清理失败，150 秒后自动失效");
  }
}

(async () => {
  if (typeof $request !== "undefined") captureToken();
  else await runTask();
})().catch((error) => {
  log(error.message);
  $notification.post(SCRIPT_NAME, "任务未完成", error.message);
}).finally(() => $done(typeof $request !== "undefined" ? {} : undefined));
