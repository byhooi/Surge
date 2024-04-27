const $ = new Env('京东 WSKEY');
$.jd_tempKey = 'jd_temp', $.wskeyKey = 'wskeyList';  // 缓存键名
$.Messages = [], $.cookie = '';  // 初始化数据

// 脚本执行入口
!(async () => {
  if (typeof $request !== `undefined`) {
    await GetCookie();
    if ($.cookie) {  // 检查是否成功获取到cookie
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
    debug($request.headers);
    const headers = ObjectKeys2LowerCase($request.headers);
    const [, wskey] = headers?.cookie.match(/wskey=([^=;]+?);/) || '';
    const [, pin] = headers?.cookie.match(/pin=([^=;]+?);/) || '';

    // 延迟读取缓存
    if ($request.url.includes('/getRule')) await $.wait(3e3);

    // 读取缓存数据
    $.jd_temp = $.getjson($.jd_tempKey) || {};  // 临时缓存
    $.wskeyList = $.getjson($.wskeyKey) || [];  // WSKEY 缓存

    // 清理过期缓存数据
    if ($.jd_temp?.['ts'] && Date.now() - $.jd_temp['ts'] >= 15e3) {
      $.log(`🆑 清理过期缓存数据`);
      $.jd_temp = {};
    }

    // 写入缓存
    if (wskey) {
      $.log(`wskey: ${wskey}`);
      $.jd_temp['wskey'] = wskey;
      $.jd_temp['ts'] = Date.now();
      $.setjson($.jd_temp, $.jd_tempKey); // 写入新的 wskey
    } else if (pin) {
      $.log(`pin: ${pin}`);
      $.jd_temp['pin'] = pin;
      $.jd_temp['ts'] = Date.now();
      $.setjson($.jd_temp, $.jd_tempKey); // 写入新的 pin
    }

    // 拼接 wskey
    if ($.jd_temp?.['wskey'] && $.jd_temp?.['pin']) {
      $.cookie = `wskey=${$.jd_temp['wskey']}; pin=${$.jd_temp['pin']};`;

      // 使用 find() 方法找到与 pin 匹配的对象，以新增或更新用户 WSKEY
      const user = $.wskeyList.find(user => user.userName === $.jd_temp['pin']);
      if (user) {
        if (user.cookie == $.cookie) {
          $.log(`⚠️ 当前 WSKEY 与缓存一致, 结束运行。`);
          $.done();  // WSKEY 无变化结束运行
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

/**
 * DEBUG
 * @param {*} content - 传入内容
 * @param {*} title - 标题
 */
function debug(content, title = "debug") {
  let start = `\n----- ${title} -----\n`;
  let end = `\n----- ${$.time('HH:mm:ss')} -----\n`;
  if ($.is_debug === 'true') {
    if (typeof content == "string") {
      $.log(start + content + end);
    } else if (typeof content == "object") {
      $.log(start + $.toStr(content) + end);
    }
  }
}

// 简化，仅支持 Surge
function Env(t, e) {
  return new class {
    constructor(t, e) {
      this.name = t;
      this.http = new class {
        send(t, e = "GET") {
          t = "string" == typeof t ? { url: t } : t;
          let s = this.get;
          return "POST" === e && (s = this.post), new Promise((e, o) => {
            s.call(this, t, (t, s, r) => {
              t ? o(t) : e(s)
            })
          })
        }
        get(t) {
          return this.send.call(this.env, t)
        }
        post(t) {
          return this.send.call(this.env, t, "POST")
        }
      }(this);
      this.data = null;
      this.logs = [], this.log("", `🔔${this.name}, 开始!`);
    }
    isSurge() {
      return "undefined" != typeof $httpClient;
    }
    log(...t) {
      t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join("\n"))
    }
    msg(e = t, s = "", o = "") {
      const i = {};
      if (this.isSurge()) $notification.post(e, s, o, i);
    }
    getdata(t) {
      let e = this.getval(t);
      if (/^@/.test(t)) {
        const [, s, o] = /^@(.*?)\.(.*?)$/.exec(t), r = s ? this.getval(s) : "";
        if (r) try {
          const t = JSON.parse(r);
          e = t ? this.lodash_get(t, o, "") : e
        } catch (t) {
          e = ""
        }
      }
      return e
    }
    setdata(t, e) {
      let s = !1;
      if (/^@/.test(e)) {
        const [, o, r] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(o), a = o ? "null" === i ? null : i || "{}" : "{}";
        try {
          const e = JSON.parse(a);
          this.lodash_set(e, r, t), s = this.setval(JSON.stringify(e), o)
        } catch (e) {
          const i = {};
          this.lodash_set(i, r, t), s = this.setval(JSON.stringify(i), o)
        }
      } else s = this.setval(t, e);
      return s
    }
    getval(t) {
      return $persistentStore.read(t);
    }
    setval(t, e) {
      return $persistentStore.write(t, e);
    }
	time(format) {
  // 这里可以根据需要实现时间格式化
  // 简单示例，返回当前的时间字符串
	  return new Date().toLocaleTimeString();
    }
    done(t = {}) {
      const e = (new Date).getTime(), s = (e - this.startTime) / 1e3;
      this.log("", `🔔${this.name}, 结束! 🕛 ${s} 秒`), this.log(), $done(t);
    }
  }(t, e)
}
