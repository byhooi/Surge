// 常量配置
const SCRIPT_NAME = '京东 Cookie';
const SCRIPT_VERSION = '1.9.3';
const JD_COOKIE_TEMP_KEY = 'jd_cookie_temp';
const JD_COOKIE_KEY = 'jdCookieList';
const JD_COOKIE_NOTIFY_LOCK_KEY = 'jd_cookie_notify_lock';
const AUTO_SYNC_QL_KEY = 'auto_sync_jdcookie_ql';
const DEFAULT_QL_TOKEN_VALIDITY_MS = 6.5 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RESP_TYPE = 'body';
const CACHE_EXPIRE_TIME = 15000;
const PIN_KEY_PAIR_MAX_GAP = 3000;
const NOTIFY_DEDUP_WINDOW = 5000;
const CONCURRENCY_SETTLE_TIME = 500;
const LOG_SEPARATOR = "\n";
const PT_PIN_REGEX = /pt_pin=([^=;]+?);/;
const PT_KEY_REGEX = /pt_key=([^=;]+?);/;

// Env 环境类
function Env(name, options = {}) {
  this.name = name || SCRIPT_NAME;
  this.logs = [];
  this.isMute = false;
  this.logSeparator = LOG_SEPARATOR;
  this.startTime = Date.now();

  Object.assign(this, options);
  const versionSuffix = this.version ? ` v${this.version}` : '';
  this.log("", `🔔${this.name}${versionSuffix}, 开始!`);
}

Env.prototype.log = function (...messages) {
  if (messages.length === 0) return;
  this.logs.push(...messages);
  console.log(messages.join(this.logSeparator));
};

Env.prototype.logErr = function (err) {
  const errorMessage = err?.stack || err?.message || String(err);
  this.log("", `❗️${this.name}, 错误!`, errorMessage);
};

Env.prototype.get = function (url, callback) {
  if (!callback || typeof callback !== 'function') {
    throw new Error('Callback is required for HTTP GET request');
  }
  $httpClient.get(url, callback);
};

Env.prototype.post = function (url, callback) {
  if (!callback || typeof callback !== 'function') {
    throw new Error('Callback is required for HTTP POST request');
  }
  $httpClient.post(url, callback);
};

Env.prototype.getdata = function (key) {
  if (!key || typeof key !== 'string') {
    this.log('警告: getdata 需要有效的 key 参数');
    return null;
  }
  return $persistentStore.read(key);
};

Env.prototype.setdata = function (val, key) {
  if (!key || typeof key !== 'string') {
    this.log('警告: setdata 需要有效的 key 参数');
    return false;
  }
  return $persistentStore.write(val, key);
};

Env.prototype.wait = function (time) {
  return new Promise(resolve => setTimeout(resolve, time));
};

Env.prototype.toObj = function (jsonString, defaultValue = null) {
  if (typeof jsonString !== 'string') {
    return defaultValue;
  }
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    this.log(`JSON 解析失败: ${error.message}`);
    return defaultValue;
  }
};

Env.prototype.toStr = function (obj, defaultValue = null) {
  if (obj === null || obj === undefined) {
    return defaultValue;
  }
  try {
    return JSON.stringify(obj);
  } catch (error) {
    this.log(`JSON 序列化失败: ${error.message}`);
    return defaultValue;
  }
};

Env.prototype.setjson = function (obj, key) {
  return this.setdata(this.toStr(obj), key);
};

Env.prototype.getjson = function (key, defaultValue = null) {
  return this.toObj(this.getdata(key), defaultValue);
};

Env.prototype.time = function (format) {
  const date = new Date();
  const map = {
    'M+': date.getMonth() + 1,
    'd+': date.getDate(),
    'H+': date.getHours(),
    'm+': date.getMinutes(),
    's+': date.getSeconds(),
    'q+': Math.floor((date.getMonth() + 3) / 3),
    S: date.getMilliseconds()
  };
  if (/(y+)/.test(format)) {
    format = format.replace(RegExp.$1, (date.getFullYear() + "").substr(4 - RegExp.$1.length));
  }
  for (let k in map) {
    if (new RegExp(`(${k})`).test(format)) {
      format = format.replace(RegExp.$1, RegExp.$1.length === 1 ? map[k] : ("00" + map[k]).substr(("" + map[k]).length));
    }
  }
  return format;
};

Env.prototype.done = function () {
  const endTime = Date.now();
  const duration = ((endTime - this.startTime) / 1000).toFixed(2);
  const versionSuffix = this.version ? ` v${this.version}` : '';
  this.log("", `🔔${this.name}${versionSuffix}, 结束! 🕛 ${duration} 秒`);
  $done();
};

// 工具函数
function isValidString(str) {
  return typeof str === 'string' && str.trim().length > 0;
}

function extractFromCookie(cookie, regex) {
  if (!isValidString(cookie)) return '';
  const match = cookie.match(regex);
  return match ? match[1] : '';
}

function isCacheExpired(timestamp, expireTime = CACHE_EXPIRE_TIME) {
  return timestamp && Date.now() - timestamp >= expireTime;
}

function createCookie(ptPin, ptKey) {
  if (!ptPin || !ptKey) return '';
  return `pt_pin=${ptPin};pt_key=${ptKey};`;
}

// 脚本配置和初始化
const $ = new Env(SCRIPT_NAME, { version: SCRIPT_VERSION });
const IS_DEBUG = $.getdata('is_debug') || 'false';
$.Messages = [];
$.cookie = '';
$.pendingPin = '';

// 脚本执行入口
!(async () => {
  if (typeof $request !== 'undefined') {
    await getCookie();
    if ($.cookie) {
      // 先落盘，保证同一批并发实例后续读取时能拿到最新值
      persistCookie($.pendingPin, $.cookie);

      const shouldPush = await shouldNotify($.cookie);
      if (shouldPush) {
        $.Messages.push(`🎉 京东 Cookie 获取成功\n${$.cookie}`);

        // 自动同步到青龙
        const autoSync = $.getdata(AUTO_SYNC_QL_KEY);
        const isAutoSync = autoSync === null || autoSync === undefined || autoSync === true || autoSync === 'true';
        if (isAutoSync) {
          await syncToQingLong($.pendingPin, $.cookie);
        }
      } else {
        $.log('🔁 该 Cookie 已通知过或存在并发实例，跳过重复推送');
      }
    }
  }
})()
  .catch(e => $.Messages.push(e.message || e) && $.logErr(e))
  .finally(async () => {
    await sendMsg($.Messages.join('\n').trim());
    $.done();
  });

// 获取用户数据
async function getCookie() {
  try {
    if (!$request?.headers) {
      throw new Error('请求头信息不存在');
    }

    debug($request.headers);
    const headers = objectKeys2LowerCase($request.headers);

    if (!headers?.cookie) {
      $.log('⚠️ 请求中未找到 cookie 信息');
      return;
    }

    const ptPin = extractFromCookie(headers.cookie, PT_PIN_REGEX);
    const ptKey = extractFromCookie(headers.cookie, PT_KEY_REGEX);

    // 初始化数据
    $.jd_cookie_temp = $.getjson(JD_COOKIE_TEMP_KEY) || {};
    $.jdCookieList = $.getjson(JD_COOKIE_KEY) || [];

    // 清理过期缓存
    if (isCacheExpired($.jd_cookie_temp?.ts)) {
      $.log('🆑 清理过期缓存数据');
      $.jd_cookie_temp = {};
    }

    // 更新临时数据
    let hasUpdate = false;
    const now = Date.now();

    if (isValidString(ptPin)) {
      // 账号切换保护：pt_pin 变化时丢弃上一个账号的 pt_key，避免拼出错误组合
      if ($.jd_cookie_temp.pt_pin && $.jd_cookie_temp.pt_pin !== ptPin) {
        $.log(`🔄 检测到用户切换: ${$.jd_cookie_temp.pt_pin} → ${ptPin}，已丢弃旧账号凭证`);
        $.jd_cookie_temp = {};
      }
      $.jd_cookie_temp.pt_pin = ptPin;
      $.jd_cookie_temp.pt_pin_ts = now;
      $.jd_cookie_temp.ts = now;
      hasUpdate = true;
    }

    if (isValidString(ptKey)) {
      $.jd_cookie_temp.pt_key = ptKey;
      $.jd_cookie_temp.pt_key_ts = now;
      $.jd_cookie_temp.ts = now;
      hasUpdate = true;
    }

    if (hasUpdate) {
      $.setjson($.jd_cookie_temp, JD_COOKIE_TEMP_KEY);
    }

    // 处理完整的 Cookie
    await processCookie();

  } catch (error) {
    $.log('❌ 用户数据获取失败');
    $.logErr(error);
  }
}

// 处理 Cookie 的独立函数
async function processCookie() {
  if (!$.jd_cookie_temp?.pt_pin || !$.jd_cookie_temp?.pt_key) {
    $.log('⚠️ pt_pin 或 pt_key 数据不完整，等待后续请求');
    return;
  }

  const pinTs = Number($.jd_cookie_temp.pt_pin_ts || 0);
  const keyTs = Number($.jd_cookie_temp.pt_key_ts || 0);

  if (!pinTs || !keyTs) {
    $.log('⚠️ 缺少 pt_pin/pt_key 采集时间戳，等待下一次完整采集');
    return;
  }

  // 配对保护：两者采集时间相差过大时，可能来自不同账号
  const pairGap = Math.abs(pinTs - keyTs);
  if (pairGap > PIN_KEY_PAIR_MAX_GAP) {
    $.log(`⚠️ pt_pin 与 pt_key 采集间隔过大(${pairGap}ms)，丢弃旧数据防止串号`);
    if (pinTs > keyTs) {
      delete $.jd_cookie_temp.pt_key;
      delete $.jd_cookie_temp.pt_key_ts;
    } else {
      delete $.jd_cookie_temp.pt_pin;
      delete $.jd_cookie_temp.pt_pin_ts;
    }
    $.jd_cookie_temp.ts = Date.now();
    $.setjson($.jd_cookie_temp, JD_COOKIE_TEMP_KEY);
    return;
  }

  const cookie = createCookie($.jd_cookie_temp.pt_pin, $.jd_cookie_temp.pt_key);

  if (!cookie) {
    $.log('❌ Cookie 创建失败');
    return;
  }

  $.log(`🍪 获取到的完整 Cookie: ${cookie}`);

  const existingUser = $.jdCookieList.find(user => user.userName === $.jd_cookie_temp.pt_pin);

  if (existingUser) {
    if (existingUser.cookie === cookie) {
      $.log('⚠️ 当前 Cookie 与缓存一致, 跳过通知。');
      return;
    }
    $.log(`♻️ 更新用户 Cookie: ${cookie}`);
  } else {
    $.log(`🆕 新增用户 Cookie: ${cookie}`);
  }

  // 仅在新增或 Cookie 变化时设置，用于触发后续持久化与通知
  $.cookie = cookie;
  $.pendingPin = $.jd_cookie_temp.pt_pin;
}

// 持久化 Cookie：基于存储中的最新列表合并，避免并发实例互相覆盖
function persistCookie(pin, cookie) {
  if (!isValidString(pin) || !isValidString(cookie)) return;

  const list = $.getjson(JD_COOKIE_KEY) || [];
  const existingUser = list.find(user => user.userName === pin);

  if (existingUser) {
    existingUser.cookie = cookie;
  } else {
    list.push({ userName: pin, cookie: cookie });
  }

  $.setjson(list, JD_COOKIE_KEY);
}

// 通知去重：同一批并发实例只推送一条
async function shouldNotify(cookie) {
  const now = Date.now();
  const lock = $.getjson(JD_COOKIE_NOTIFY_LOCK_KEY) || {};

  // 同一 Cookie 在窗口期内已通知过，直接跳过
  if (lock.cookie === cookie && now - Number(lock.ts || 0) < NOTIFY_DEDUP_WINDOW) {
    return false;
  }

  const token = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  $.setjson({ cookie: cookie, ts: now, token: token }, JD_COOKIE_NOTIFY_LOCK_KEY);

  // 等待同一批并发实例完成写入，再二次确认自己是不是最后一个
  await $.wait(CONCURRENCY_SETTLE_TIME);

  const current = $.getjson(JD_COOKIE_NOTIFY_LOCK_KEY) || {};
  if (current.token !== token) {
    $.log('🔁 检测到并发实例，跳过重复通知');
    return false;
  }
  return true;
}

function resolveTokenExpiration(data = {}) {
  const now = Date.now();
  const absoluteKeys = ['expiration', 'expiration_time', 'expirationTime', 'exp'];
  for (const key of absoluteKeys) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      if (String(value).trim().length >= 13 || num > 1e12) {
        return num;
      }
      if (num > 1e6) {
        return now + num;
      }
      return now + num * 1000;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  const relativeKeys = ['expires_in', 'expiresIn', 'expire_in', 'exp_in', 're_expire_in'];
  for (const key of relativeKeys) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      if (num > 1e6) {
        return now + num;
      }
      return now + num * 1000;
    }
  }

  return now + DEFAULT_QL_TOKEN_VALIDITY_MS;
}

// 同步到青龙
async function syncToQingLong(targetPin, targetCookie) {
  try {
    let qlUrl = $.getdata('ql_url');
    const qlClientId = $.getdata('ql_client_id');
    const qlClientSecret = $.getdata('ql_client_secret');

    if (!qlUrl || !qlClientId || !qlClientSecret) {
      $.log('⚠️ 青龙面板配置不完整，跳过自动同步');
      return;
    }
    qlUrl = qlUrl.trim().replace(/\/$/, '');

    // 获取 Token
    let token = $.getdata('ql_token');
    const tokenExpires = $.getdata('ql_token_expires');

    if (!token || !tokenExpires || Date.now() >= parseInt(tokenExpires)) {
      $.log('🔄 青龙 Token 已过期或不存在，重新获取...');
      token = await getQingLongToken(qlUrl, qlClientId, qlClientSecret);
      if (!token) {
        $.Messages.push('❌ 获取青龙 Token 失败');
        return;
      }
    }

    // 优先同步本次抓取并更新的账号，避免全量请求造成超时
    const syncTasks = (targetPin && targetCookie)
      ? [{ userName: targetPin, cookie: targetCookie }]
      : ($.getjson(JD_COOKIE_KEY) || []);

    let syncSuccessCount = 0;
    for (const user of syncTasks) {
      if (!user.userName || !user.cookie) continue;
      const ok = await syncCookieToQL(qlUrl, token, user.cookie, user.userName);
      if (ok) syncSuccessCount++;
    }

    if (syncSuccessCount > 0) {
      const pinDesc = targetPin ? ` (${targetPin})` : '';
      $.Messages.push(`✅ 已自动同步 Cookie${pinDesc} 到青龙面板`);
    }

  } catch (error) {
    $.logErr(error);
    $.Messages.push(`❌ 同步到青龙失败: ${error.message}`);
  }
}

// 获取青龙 Token
async function getQingLongToken(qlUrl, clientId, clientSecret) {
  try {
    const url = `${qlUrl}/open/auth/token?client_id=${clientId}&client_secret=${clientSecret}`;
    const response = await request({
      url: url,
      _respType: 'all'
    });

    if (response?.body) {
      const result = $.toObj(response.body);
      if (result?.code === 200 && result?.data?.token) {
        const token = result.data.token;
        const expiresAt = resolveTokenExpiration(result.data);

        $.setdata(token, 'ql_token');
        $.setdata(String(expiresAt), 'ql_token_expires');
        $.log('✅ 青龙 Token 获取成功');
        return token;
      }
    }

    throw new Error('Token 响应格式异常');
  } catch (error) {
    $.logErr(error);
    return null;
  }
}

// 启用青龙环境变量
async function enableQLEnv(qlUrl, token, envId) {
  try {
    const url = `${qlUrl}/open/envs/enable`;
    const response = await request({
      url: url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([envId]),
      _method: 'put',
      _respType: 'all'
    });

    if (response?.body) {
      const result = $.toObj(response.body);
      if (result?.code === 200) {
        $.log(`✅ 已重新启用环境变量: ID ${envId}`);
        return true;
      }
    }
  } catch (error) {
    $.log(`⚠️ 启用环境变量失败: ${error.message}`);
  }
  return false;
}

// 同步单个 Cookie 到青龙
async function syncCookieToQL(qlUrl, token, cookie, userName) {
  try {
    // 查询现有环境变量，搜索用户名
    const searchUrl = `${qlUrl}/open/envs?searchValue=${encodeURIComponent(userName)}`;
    const searchResp = await request({
      url: searchUrl,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      _respType: 'all'
    });

    if (searchResp?.body) {
      const result = $.toObj(searchResp.body);
      if (result?.code === 200 && Array.isArray(result?.data)) {
        // 兼容多格式匹配：备注匹配 或 值中包含 pt_pin/pin
        const existingEnv = result.data.find(env =>
          env.name === 'JD_COOKIE' &&
          ((env.remarks && (env.remarks === userName || env.remarks.includes(userName))) ||
           (env.value && (env.value.includes(`pt_pin=${userName};`) || env.value.includes(`pin=${userName};`))))
        );

        if (existingEnv) {
          const envId = existingEnv.id || existingEnv._id;
          const envRemarks = existingEnv.remarks || `${userName} - 由 Surge 同步`;

          // 如果值一致且未被禁用，跳过更新
          if (existingEnv.value === cookie) {
            $.log(`⏭️ 青龙环境变量值未变化: ${userName}`);
            if (existingEnv.status === 1) {
              await enableQLEnv(qlUrl, token, envId);
            }
            return true;
          }

          // 更新环境变量
          const ok = await updateQLEnv(qlUrl, token, envId, cookie, envRemarks, userName);
          if (ok && existingEnv.status === 1) {
            await enableQLEnv(qlUrl, token, envId);
          }
          return ok;
        } else {
          // 新增环境变量
          return await addQLEnv(qlUrl, token, cookie, userName);
        }
      }
    }
    return false;
  } catch (error) {
    $.logErr(error);
    throw error;
  }
}

// 添加青龙环境变量
async function addQLEnv(qlUrl, token, cookie, userName) {
  try {
    const url = `${qlUrl}/open/envs`;
    const body = JSON.stringify([{
      name: 'JD_COOKIE',
      value: cookie,
      remarks: `${userName} - 由 Surge 同步`
    }]);

    const response = await request({
      url: url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: body,
      _method: 'post',
      _respType: 'all'
    });

    if (response?.body) {
      const result = $.toObj(response.body);
      if (result?.code === 200) {
        $.log(`✅ 新增青龙环境变量成功: ${userName}`);
        return true;
      }
    }

    throw new Error('添加环境变量失败');
  } catch (error) {
    $.logErr(error);
    return false;
  }
}

// 更新青龙环境变量
async function updateQLEnv(qlUrl, token, envId, cookie, remarks, userName) {
  try {
    const url = `${qlUrl}/open/envs`;
    const body = JSON.stringify({
      id: envId,
      name: 'JD_COOKIE',
      value: cookie,
      remarks: remarks || `${userName} - 由 Surge 同步`
    });

    const response = await request({
      url: url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: body,
      _method: 'put',
      _respType: 'all'
    });

    if (response?.body) {
      const result = $.toObj(response.body);
      if (result?.code === 200) {
        $.log(`✅ 更新青龙环境变量成功: ${userName}`);
        return true;
      }
    }

    throw new Error('更新环境变量失败');
  } catch (error) {
    $.logErr(error);
    return false;
  }
}

function objectKeys2LowerCase(obj) {
  const _lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  return new Proxy(_lower, {
    get(target, propKey, receiver) {
      return Reflect.get(target, propKey.toLowerCase(), receiver);
    },
    set(target, propKey, value, receiver) {
      return Reflect.set(target, propKey.toLowerCase(), value, receiver);
    }
  });
}

// HTTP 请求函数
async function request(options) {
  try {
    if (!options) {
      throw new Error('请求参数不能为空');
    }

    options = options.url ? options : { url: options };

    if (!options.url) {
      throw new Error('请求 URL 不能为空');
    }

    const method = options._method || (options.body ? 'post' : 'get');
    const respType = options._respType || DEFAULT_RESP_TYPE;
    const timeout = options._timeout || DEFAULT_TIMEOUT;

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`请求超时: ${options.url}`)), timeout)
    );

    const requestPromise = new Promise((resolve, reject) => {
      debug(options, '[Request]');

      const callback = (error, response, data) => {
        debug(response, '[Response]');

        if (error) {
          $.logErr(error);
          return reject(error);
        }

        if (respType === 'all') {
          resolve(response);
        } else {
          const result = response?.[respType];
          resolve($.toObj(result, result));
        }
      };

      $[method.toLowerCase()](options, callback);
    });

    return await Promise.race([timeoutPromise, requestPromise]);

  } catch (error) {
    $.logErr(error);
    throw error;
  }
}

// 发送消息通知
async function sendMsg(message) {
  if (!isValidString(message)) {
    $.log('⚠️ 消息内容为空，跳过通知发送');
    return;
  }

  try {
    $notification.post($.name, '', message);
    $.log('📮 通知发送成功');
  } catch (error) {
    $.log(`通知发送失败，使用日志输出: ${error.message}`);
    $.log(`\n\n----- ${$.name} -----\n${message}`);
  }
}

// 调试输出函数
function debug(content, title = 'debug') {
  if (IS_DEBUG !== 'true') return;

  const timestamp = $.time('HH:mm:ss');
  const start = `\n----- ${title} -----\n`;
  const end = `\n----- ${timestamp} -----\n`;

  let debugContent;
  if (typeof content === 'string') {
    debugContent = content;
  } else if (typeof content === 'object') {
    debugContent = $.toStr(content) || '[无法序列化的对象]';
  } else {
    debugContent = String(content);
  }

  $.log(start + debugContent + end);
}
