const $ = new Env('京东 WSKEY');
$.jd_tempKey = 'jd_temp', $.wskeyKey = 'wskeyList';  // 缓存键名
$.setdata('is_debug', 'true');  // 设置一个初始值
$.is_debug = $.getdata('is_debug') || 'false';  // 读取调试模式的值
console.log($.is_debug);  // 应该输出 'true'
$.Messages = [], $.cookie = '';  // 初始化数据

// 脚本执行入口
!(async () => {
  if (typeof $request !== `undefined`) {
    await GetCookie();
    if ($.cookie && $.autoSubmit != 'false') {
    } else if ($.cookie) {
      $.Messages.push(`🎉 WSKEY 获取成功\n${$.cookie}`);
      $.setjson($.wskeyList, $.wskeyKey);  // 写入数据持久化
    }
  }
})()
  .catch((e) => $.Messages.push(e.message || e) && $.logErr(e))
  .finally(async () => {
    await sendMsg($.Messages.join('\n').trimStart().trimEnd());  // 推送通知
    $.done();
  })

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

// prettier-ignore
function Env(name) {
  this.name = name;
  this.data = {};

  this.log = function (message) {
    console.log(`${this.name}: ${message}`);
  };

  this.getdata = function (key) {
    this.log(`读取数据: ${key}`);
    return this.data[key];
  };

  this.setdata = function (key, value) {
    this.log(`保存数据: ${key} = ${value}`);
    this.data[key] = value;
  };

  this.done = function () {
    this.log('脚本执行完成');
  };
}
