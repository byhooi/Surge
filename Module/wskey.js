function Env(name, options) {
  this.name = name;
  this.logs = [];
  this.isMute = false;
  this.logSeparator = "\n";
  this.startTime = (new Date).getTime();
  Object.assign(this, options);
  this.log("", `🔔${this.name}, 开始!`);
}

Env.prototype.log = function (...messages) {
  this.logs = [...this.logs, ...messages];
  console.log(messages.join(this.logSeparator));
};

Env.prototype.logErr = function (err) {
  this.log("", `❗️${this.name}, 错误!`, err.stack);
};

Env.prototype.get = function (url, callback) {
  $httpClient.get(url, callback);
};

Env.prototype.post = function (url, callback) {
  $httpClient.post(url, callback);
};

Env.prototype.getdata = function (key) {
  return $persistentStore.read(key);
};

Env.prototype.setdata = function (val, key) {
  return $persistentStore.write(val, key);
};

Env.prototype.wait = function (time) {
  return new Promise(resolve => setTimeout(resolve, time));
};

Env.prototype.toObj = function (jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch {
    return defaultValue;
  }
};

Env.prototype.toStr = function (obj, defaultValue = null) {
  try {
    return JSON.stringify(obj);
  } catch {
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
  const endTime = (new Date).getTime();
  const duration = (endTime - this.startTime) / 1000;
  this.log("", `🔔${this.name}, 结束! 🕛 ${duration} 秒`);
  $done();
};

const $ = new Env('京东 WSKEY');
const JD_TEMP_KEY = 'jd_temp';
const WSKEY_KEY = 'wskeyList';
const IS_DEBUG = $.getdata('is_debug') || 'false';
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_RESP_TYPE = 'body';
$.Messages = [];
$.cookie = '';

// 脚本执行入口
!(async () => {
  if (typeof $request !== 'undefined') {
    await getCookie();
    if ($.cookie && $.autoSubmit !== 'false') {
      await submitCK();
    } else if ($.cookie) {
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

// 获取用户数据
async function getCookie() {
  try {
    debug($request.headers);
    const headers = objectKeys2LowerCase($request.headers);
    const [, wskey] = headers?.cookie.match(/wskey=([^=;]+?);/) || '';
    const [, pin] = headers?.cookie.match(/pin=([^=;]+?);/) || '';

    if ($request.url.includes('/getRule')) await $.wait(3000);

    $.jd_temp = $.getjson(JD_TEMP_KEY) || {};
    $.wskeyList = $.getjson(WSKEY_KEY) || [];

    if ($.jd_temp?.['ts'] && Date.now() - $.jd_temp['ts'] >= 15000) {
      $.log(`🆑 清理过期缓存数据`);
      $.jd_temp = {};
    }

    if (wskey) {
      $.log(`wskey: ${wskey}`);
      $.jd_temp['wskey'] = wskey;
      $.jd_temp['ts'] = Date.now();
      $.setjson($.jd_temp, JD_TEMP_KEY);
    } else if (pin) {
      $.log(`pin: ${pin}`);
      $.jd_temp['pin'] = pin;
      $.jd_temp['ts'] = Date.now();
      $.setjson($.jd_temp, JD_TEMP_KEY);
    }

    if ($.jd_temp?.['wskey'] && $.jd_temp?.['pin']) {
      $.cookie = `wskey=${$.jd_temp['wskey']}; pin=${$.jd_temp['pin']};`;

      const user = $.wskeyList.find(user => user.userName === $.jd_temp['pin']);
      if (user) {
        if (user.cookie === $.cookie) {
          $.log(`⚠️ 当前 WSKEY 与缓存一致, 结束运行。`);
          $.done();
        }
        $.log(`♻️ 更新用户 WSKEY: ${$.cookie}`);
        user.cookie = $.cookie;
      } else {
        $.log(`🆕 新增用户 WSKEY: ${$.cookie}`);
        $.wskeyList.push({ "userName": $.jd_temp?.['pin'], "cookie": $.cookie });
      }
    }
  } catch (e) {
    $.log("❌ 用户数据获取失败");
    $.log(e);
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

async function request(options) {
  try {
    options = options.url ? options : { url: options };
    const _method = options?._method || ('body' in options ? 'post' : 'get');
    const _respType = options?._respType || DEFAULT_RESP_TYPE;
    const _timeout = options?._timeout || DEFAULT_TIMEOUT;
    const _http = [
      new Promise((_, reject) => setTimeout(() => reject(`❌ 请求超时： ${options['url']}`), _timeout)),
      new Promise((resolve, reject) => {
        debug(options, '[Request]');
        $[_method.toLowerCase()](options, (error, response, data) => {
          debug(response, '[response]');
          error && $.log($.toStr(error));
          if (_respType !== 'all') {
            resolve($.toObj(response?.[_respType], response?.[_respType]));
          } else {
            resolve(response);
          }
        });
      })
    ];
    return await Promise.race(_http);
  } catch (err) {
    $.logErr(err);
  }
}

async function sendMsg(message) {
  if (!message) return;
  try {
    $notification.post($.name, '', message);
  } catch (e) {
    $.log(`\n\n----- ${$.name} -----\n${message}`);
  }
}

function debug(content, title = "debug") {
  const start = `\n----- ${title} -----\n`;
  const end = `\n----- ${$.time('HH:mm:ss')} -----\n`;
  if (IS_DEBUG === 'true') {
    if (typeof content === "string") {
      $.log(start + content + end);
    } else if (typeof content === "object") {
      $.log(start + $.toStr(content) + end);
    }
  }
}
