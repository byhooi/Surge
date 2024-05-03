const $ = new Env('京东 WSKEY');
$.jd_tempKey = 'jd_temp', $.wskeyKey = 'wskeyList';  // 缓存键名
$.is_debug = $.getdata('is_debug') || 'false';  // 调试模式
$.Messages = [], $.cookie = '';  // 初始化数据

// 脚本执行入口
!(async () => {
  if ($.getEnv() !== "Surge") {
    console.log("此脚本仅支持Surge应用");
    return;
  }

  if (typeof $request !== `undefined`) {
    await GetCookie();
    if ($.cookie) {
      $.Messages.push(`🎉 WSKEY 获取成功\n${$.cookie}`);
      $.setjson($.wskeyList, $.wskeyKey);  // 写入数据持久化
    }
  }
})()
  .catch((e) => $.Messages.push(e.message || e) && $.logErr(e))
  .finally(async () => {
    await sendMsg($.Messages.join('\n').trimStart().trimEnd());  // 推送通知
    $.done();
  });

// 获取用户数据
async function GetCookie() {
  try {
    const headers = ObjectKeys2LowerCase($request.headers);
    const [, wskey] = headers?.cookie.match(/wskey=([^=;]+?);/) || '';
    const [, pin] = headers?.cookie.match(/pin=([^=;]+?);/) || '';

    $.jd_temp = $.getjson($.jd_tempKey) || {};  // 临时缓存
    $.wskeyList = $.getjson($.wskeyKey) || [];  // WSKEY 缓存

    if ($.jd_temp?.['ts'] && Date.now() - $.jd_temp['ts'] >= 15e3) {
      $.log(`🆑 清理过期缓存数据`);
      $.jd_temp = {};
    }

    if (wskey) {
      $.log(`wskey: ${wskey}`);
      $.jd_temp['wskey'] = wskey;
      $.jd_temp['ts'] = Date.now();
      $.setjson($.jd_temp, $.jd_tempKey);
    } else if (pin) {
      $.log(`pin: ${pin}`);
      $.jd_temp['pin'] = pin;
      $.jd_temp['ts'] = Date.now();
      $.setjson($.jd_temp, $.jd_tempKey);
    }

    if ($.jd_temp?.['wskey'] && $.jd_temp?.['pin']) {
      $.cookie = `wskey=${$.jd_temp['wskey']}; pin=${$.jd_temp['pin']};`;
      const user = $.wskeyList.find(user => user.userName === $.jd_temp['pin']);
      if (user) {
        if (user.cookie == $.cookie) {
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
    $.log("❌ 用户数据获取失败"), $.log(e);
  }
}

/**
 * 对象属性转小写
 * @param {object} obj - 传入 $request.headers
 * @returns {object} 返回转换后的对象
 */
function ObjectKeys2LowerCase(obj) {
  const _lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]))
  return new Proxy(_lower, {
    get: function (target, propKey, receiver) {
      return Reflect.get(target, propKey.toLowerCase(), receiver)
    },
    set: function (target, propKey, value, receiver) {
      return Reflect.set(target, propKey.toLowerCase(), value, receiver)
    }
  })
}

function Env(t, e) {
    this.name = t;
    this.data = {};

    this.log = function(d) {
        console.log(d);
    };

    this.done = (val = {}) => {
        $done(val);
    };

    this.getdata = function(key) {
        return this.data[key];
    };

    this.setdata = function(val, key) {
        this.data[key] = val;
    };

    // Surge 环境判断
    this.isSurge = () => {
        return typeof $httpClient !== 'undefined';
    };

    // 获取环境名称
    this.getEnv = () => {
        return "Surge";
    };
}
