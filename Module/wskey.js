const $ = new Env('京东 WSKEY');
$.Messages = [], $.cookie = '';  // 初始化数据

// 脚本执行入口
!(async () => {
  if (typeof $request !== `undefined`) {
    await GetCookie();
    if ($.cookie) {
      $.Messages.push(`🎉 WSKEY 获取成功\n${$.cookie}`);
    }
  }
})()
  .catch((e) => console.error(e))
  .finally(async () => {
    if ($.Messages.length > 0) {
      console.log($.Messages.join('\n').trim());  // 本地输出
    }
  });

// 获取用户数据
async function GetCookie() {
  try {
    console.log($request.headers);  // 调试输出请求头
    const headers = ObjectKeys2LowerCase($request.headers);
    const [, wskey] = headers?.cookie.match(/wskey=([^=;]+?);/) || '';
    const [, pin] = headers?.cookie.match(/pin=([^=;]+?);/) || '';

    if (wskey && pin) {
      $.cookie = `pin=${pin};wskey=${wskey}`;
      console.log(`获取到的WSKEY: ${wskey}`);  // 调试输出
    }
  } catch (e) {
    console.error("❌ 用户数据获取失败", e);
  }
}

/**
 * 对象属性转小写
 * @param {object} obj - 传入 $request.headers
 * @returns {object} 返回转换后的对象
 */
function ObjectKeys2LowerCase(obj) {
  const _lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  return new Proxy(_lower, {
    get: function (target, propKey, receiver) {
      return Reflect.get(target, propKey.toLowerCase(), receiver);
    },
    set: function (target, propKey, value, receiver) {
      return Reflect.set(target, propKey.toLowerCase(), value, receiver);
    }
  });
}

/**
 * 环境类，用于创建和管理脚本环境
 */
function Env(t) {
  this.name = t;
  this.log = console.log;
  this.logErr = console.error;
  this.done = () => {};
}

// 现在，脚本已经被简化，去除了数据持久化和远程消息发送的部分，只保留了获取WSKEY、转换为Cookie以及本地输出的基本功能。
