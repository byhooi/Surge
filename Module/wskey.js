const $ = new Env('京东 WSKEY');
$.jd_tempKey = 'jd_temp', $.wskeyKey = 'wskeyList';  // 缓存键名
$.is_debug = $.getdata('is_debug') || 'false';  // 调试模式
$.autoSubmit = $.getdata('WSKEY_AUTO_UPLOAD') || 'true';  // 是否自动提交
$.Messages = [], $.cookie = '';  // 初始化数据

// 脚本执行入口
!(async () => {
  if (typeof $request !== `undefined`) {
    await GetCookie();
    if ($.cookie) {
      $.Messages.push(`🎉 WSKEY 获取成功\n${$.cookie}`);
      $.setjson($.wskeyList, $.wskeyKey);  // 写入数据持久化
      await sendMsg($.Messages.join('\n').trimStart().trimEnd());  // 推送通知
    }
  }
})()
  .catch((e) => $.Messages.push(e.message || e) && $.logErr(e))
  .finally(() => {
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

// 发送消息
async function sendMsg(message) {
  if (!message) return;
  try {
    $.msg($.name, '', message);
  } catch (e) {
    $.log(`\n\n----- ${$.name} -----\n${message}`);
  }
}

// prettier-ignore
function Env(t, e) {
  return new class {
    constructor(t, e) {
      this.name = t;
      this.logLevel = "info"; // 默认日志级别为 info
      this.logs = [];
      this.log("", `🔔${this.name}, 开始!`);
    }

    // 简化后的日志方法
    log(...t) {
      t.length > 0 && (this.logs = [...this.logs, ...t]);
      console.log(t.join("\n"));
    }

    // 简化后的网络请求方法，只保留 Surge 环境所需的
    get(t) {
      return this.send(t);
    }

    post(t) {
      return this.send(t, "POST");
    }

    send(t, e = "GET") {
      t = "string" == typeof t ? { url: t } : t;
      return new Promise((e, o) => {
        $httpClient[e.toLowerCase()](t, (t, s, r) => {
          t ? o(t) : e(s);
        });
      });
    }

    // 简化后的数据存储与读取方法
    getdata(t) {
      return $persistentStore.read(t);
    }

    setdata(t, e) {
      return $persistentStore.write(t, e);
    }

    // 简化后的结束方法
    done(t = {}) {
      const e = (new Date).getTime(), s = (e - this.startTime) / 1e3;
      this.log("", `🔔${this.name}, 结束! 🕛 ${s} 秒`);
      $done(t);
    }
  }(t, e);
}
