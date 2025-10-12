// 常量配置
const SCRIPT_NAME = '京东 WSKEY';
const SCRIPT_VERSION = '1.8.7';
const JD_TEMP_KEY = 'jd_temp';
const WSKEY_KEY = 'wskeyList';
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RESP_TYPE = 'body';
const CACHE_EXPIRE_TIME = 15000;
const WAIT_TIME_FOR_RULE = 3000;
const LOG_SEPARATOR = "\n";
const WSKEY_REGEX = /wskey=([^=;]+?);/;
const PT_PIN_REGEX = /pt_pin=([^=;]+?);/;

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

function createCookie(ptPin, wskey) {
  if (!ptPin || !wskey) return '';
  // 先解码可能已经被编码的 ptPin，再重新编码，避免双重编码
  const decodedPin = decodeURIComponent(ptPin);
  return `pin=${encodeURIComponent(decodedPin)}; wskey=${wskey};`;
}

// 脚本配置和初始化
const $ = new Env(SCRIPT_NAME, { version: SCRIPT_VERSION });
const IS_DEBUG = $.getdata('is_debug') || 'false';
$.Messages = [];
$.cookie = '';

// 脚本执行入口
!(async () => {
  if (typeof $request !== 'undefined') {
    const cookieUpdated = await getCookie();
    if (cookieUpdated && $.cookie) {
      $.Messages.push(`🎉 WSKEY 获取成功\n${$.cookie}`);
      $.setjson($.wskeyList, WSKEY_KEY);
    }
  }
})()
  .catch(e => $.Messages.push(e.message || e) && $.logErr(e))
  .finally(async () => {
    await sendMsg($.Messages.join('\n').trim());
    $.done();
  });

// 获取用户数据 - 优化版本
async function getCookie() {
  try {
    if (!$request?.headers) {
      throw new Error('请求头信息不存在');
    }
    
    debug($request.headers);
    const headers = objectKeys2LowerCase($request.headers);
    
    if (!headers?.cookie) {
      $.log('⚠️ 请求中未找到 cookie 信息');
      return false;
    }
    
    const wskey = extractFromCookie(headers.cookie, WSKEY_REGEX);
    const ptPin = extractFromCookie(headers.cookie, PT_PIN_REGEX);
    
    // 等待规则请求
    if (typeof $request.url === 'string' && $request.url.includes('/getRule')) {
      await $.wait(WAIT_TIME_FOR_RULE);
    }
    
    // 初始化数据
    $.jd_temp = $.getjson(JD_TEMP_KEY) || {};
    $.wskeyList = $.getjson(WSKEY_KEY) || [];
    
    // 清理过期缓存
    if (isCacheExpired($.jd_temp?.ts)) {
      $.log('🆑 清理过期缓存数据');
      $.jd_temp = {};
    }
    
    // 更新临时数据
    let hasUpdate = false;
    if (isValidString(wskey)) {
      $.jd_temp.wskey = wskey;
      $.jd_temp.ts = Date.now();
      hasUpdate = true;
    }

    if (isValidString(ptPin)) {
      // 如果 pt_pin 变化，清空缓存，避免使用上一个用户的 wskey
      if ($.jd_temp.pt_pin && $.jd_temp.pt_pin !== ptPin) {
        $.log(`🔄 检测到用户切换: ${$.jd_temp.pt_pin} → ${ptPin}`);
        $.jd_temp = { pt_pin: ptPin, ts: Date.now() };
      } else {
        $.jd_temp.pt_pin = ptPin;
        $.jd_temp.ts = Date.now();
      }
      hasUpdate = true;
    }
    
    if (hasUpdate) {
      $.setjson($.jd_temp, JD_TEMP_KEY);
    }
    
    // 处理完整的 WSKEY
    return await processCookie();
    
  } catch (error) {
    $.log('❌ 用户数据获取失败');
    $.logErr(error);
    return false;
  }
}

// 处理 Cookie 的独立函数
async function processCookie() {
  if (!$.jd_temp?.wskey || !$.jd_temp?.pt_pin) {
    $.log('⚠️ WSKEY 或 pt_pin 数据不完整，等待后续请求');
    return false;
  }

  $.cookie = createCookie($.jd_temp.pt_pin, $.jd_temp.wskey);

  if (!$.cookie) {
    $.log('❌ Cookie 创建失败');
    return false;
  }

  $.log(`🍪 获取到的完整 Cookie: ${$.cookie}`);

  // 标准化 pt_pin 用于用户查找（统一解码后比较）
  const normalizedPin = decodeURIComponent($.jd_temp.pt_pin);
  const existingUser = $.wskeyList.find(user => {
    const existingPin = decodeURIComponent(user.userName);
    return existingPin === normalizedPin;
  });

  if (existingUser) {
    // 提取 wskey 值进行比较（已通过 pin 匹配用户，只需比较 wskey 是否变化）
    const newWskey = extractFromCookie($.cookie, WSKEY_REGEX);
    const existingWskey = extractFromCookie(existingUser.cookie, WSKEY_REGEX);

    $.log(`🔍 比较 WSKEY:`);
    $.log(`  新值: ${newWskey}`);
    $.log(`  旧值: ${existingWskey}`);
    $.log(`  相等: ${existingWskey === newWskey}`);

    if (existingWskey === newWskey) {
      $.log('⚠️ 当前 WSKEY 与缓存一致，无需更新。');
      return false;
    }
    $.log(`♻️ 更新用户 WSKEY: ${$.cookie}`);
    existingUser.userName = normalizedPin;
    existingUser.cookie = $.cookie;
    return true;
  } else {
    $.log(`🆕 新增用户 WSKEY: ${$.cookie}`);
    $.wskeyList.push({
      userName: normalizedPin,
      cookie: $.cookie
    });
    return true;
  }
}

function objectKeys2LowerCase(obj) {
  const _lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  return new Proxy(_lower, {
    get(target, propKey, receiver) {
      if (typeof propKey !== 'string') {
        return Reflect.get(target, propKey, receiver);
      }
      return Reflect.get(target, propKey.toLowerCase(), receiver);
    },
    set(target, propKey, value, receiver) {
      if (typeof propKey !== 'string') {
        return Reflect.set(target, propKey, value, receiver);
      }
      return Reflect.set(target, propKey.toLowerCase(), value, receiver);
    }
  });
}

// HTTP 请求函数 - 增强版本
async function request(options) {
  try {
    // 参数验证
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
    
    const methodName = method.toLowerCase();
    const requester = $[methodName];
    
    if (typeof requester !== 'function') {
      throw new Error(`不支持的请求方法: ${method}`);
    }
    
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      
      const timer = setTimeout(() => {
        finish(reject, new Error(`请求超时: ${options.url}`));
      }, timeout);
      
      const callback = (error, response, data) => {
        clearTimeout(timer);
        if (settled) return;
        debug(response, '[Response]');
        
        if (error) {
          $.logErr(error);
          return finish(reject, error);
        }
        
        if (respType === 'all') {
          return finish(resolve, response);
        }
        
        let result;
        if (respType === 'body') {
          result = data !== undefined ? data : response?.body;
        } else {
          result = response?.[respType];
        }
        finish(resolve, $.toObj(result, result));
      };
      
      debug(options, '[Request]');
      try {
        requester.call($, options, callback);
      } catch (invokeError) {
        clearTimeout(timer);
        finish(reject, invokeError);
      }
    });
    
  } catch (error) {
    $.logErr(error);
    throw error;
  }
}

// 发送消息通知 - 增强版本
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

// 调试输出函数 - 优化版本
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
