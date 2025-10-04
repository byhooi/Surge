// 常量配置
const SCRIPT_NAME = '京东 Cookie';
const JD_COOKIE_TEMP_KEY = 'jd_cookie_temp';
const JD_COOKIE_KEY = 'jdCookieList';
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RESP_TYPE = 'body';
const CACHE_EXPIRE_TIME = 15000;
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
  this.log("", `🔔${this.name}, 开始!`);
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
  this.log("", `🔔${this.name}, 结束! 🕛 ${duration} 秒`);
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
  return `pt_pin=${ptPin};pt_key=${ptKey}`;
}

// 脚本配置和初始化
const $ = new Env(SCRIPT_NAME);
const IS_DEBUG = $.getdata('is_debug') || 'false';
$.Messages = [];
$.cookie = '';

// 脚本执行入口
!(async () => {
  if (typeof $request !== 'undefined') {
    await getCookie();
    if ($.cookie) {
      $.Messages.push(`🎉 京东 Cookie 获取成功\n${$.cookie}`);
      $.setjson($.jdCookieList, JD_COOKIE_KEY);

      // 自动同步到青龙
      const autoSync = $.getdata('auto_sync_jdcookie_ql') || 'false';
      if (autoSync === 'true') {
        await syncToQingLong();
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
    if (isValidString(ptPin)) {
      $.jd_cookie_temp.pt_pin = ptPin;
      $.jd_cookie_temp.ts = Date.now();
      hasUpdate = true;
    }

    if (isValidString(ptKey)) {
      $.jd_cookie_temp.pt_key = ptKey;
      $.jd_cookie_temp.ts = Date.now();
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

  $.cookie = createCookie($.jd_cookie_temp.pt_pin, $.jd_cookie_temp.pt_key);

  if (!$.cookie) {
    $.log('❌ Cookie 创建失败');
    return;
  }

  $.log(`🍪 获取到的完整 Cookie: ${$.cookie}`);

  const existingUser = $.jdCookieList.find(user => user.userName === $.jd_cookie_temp.pt_pin);

  if (existingUser) {
    if (existingUser.cookie === $.cookie) {
      $.log('⚠️ 当前 Cookie 与缓存一致, 结束运行。');
      return $.done();
    }
    $.log(`♻️ 更新用户 Cookie: ${$.cookie}`);
    existingUser.cookie = $.cookie;
  } else {
    $.log(`🆕 新增用户 Cookie: ${$.cookie}`);
    $.jdCookieList.push({
      userName: $.jd_cookie_temp.pt_pin,
      cookie: $.cookie
    });
  }
}

// 同步到青龙
async function syncToQingLong() {
  try {
    const qlUrl = $.getdata('ql_url');
    const qlClientId = $.getdata('ql_client_id');
    const qlClientSecret = $.getdata('ql_client_secret');

    if (!qlUrl || !qlClientId || !qlClientSecret) {
      $.log('⚠️ 青龙面板配置不完整，跳过同步');
      return;
    }

    // 获取 Token
    let token = $.getdata('ql_token');
    const tokenExpires = $.getdata('ql_token_expires');

    if (!token || !tokenExpires || Date.now() >= parseInt(tokenExpires)) {
      $.log('🔄 Token 已过期，重新获取...');
      token = await getQingLongToken(qlUrl, qlClientId, qlClientSecret);
      if (!token) {
        $.Messages.push('❌ 获取青龙 Token 失败');
        return;
      }
    }

    // 同步 Cookie
    for (const user of $.jdCookieList) {
      await syncCookieToQL(qlUrl, token, user.cookie, user.userName);
    }

    $.Messages.push('✅ Cookie 已同步到青龙面板');

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
        const expiration = result.data.expiration || 86400000; // 默认 24 小时
        const expiresAt = Date.now() + expiration;

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

// 同步单个 Cookie 到青龙
async function syncCookieToQL(qlUrl, token, cookie, userName) {
  try {
    // 查询现有环境变量
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
      if (result?.code === 200 && result?.data) {
        const existingEnv = result.data.find(env =>
          env.name === 'JD_COOKIE' && env.remarks === userName
        );

        if (existingEnv) {
          // 更新环境变量
          await updateQLEnv(qlUrl, token, existingEnv.id, cookie, userName);
        } else {
          // 新增环境变量
          await addQLEnv(qlUrl, token, cookie, userName);
        }
      }
    }
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
      remarks: userName
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
        $.log(`✅ 新增环境变量成功: ${userName}`);
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
async function updateQLEnv(qlUrl, token, envId, cookie, userName) {
  try {
    const url = `${qlUrl}/open/envs`;
    const body = JSON.stringify({
      id: envId,
      name: 'JD_COOKIE',
      value: cookie,
      remarks: userName
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
        $.log(`✅ 更新环境变量成功: ${userName}`);
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
