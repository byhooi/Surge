const $ = new Env('999会员中心获取Cookie');

!(async () => {
  if ($request && $request.headers && $request.headers['Authorization']) {
    const auth = $request.headers['Authorization'];
    let jjjck = $.getdata('jjjck') ? $.getdata('jjjck').split('#') : [];
    if (jjjck.indexOf(auth) === -1) {
      jjjck.push(auth);
      $.setdata(jjjck.join('#'), 'jjjck');
      $.msg($.name, '获取999会员中心Token: 成功', '');
      console.log(`获取999会员中心Token: 成功, Token: ${auth}`);
    } else {
      console.log('Token已存在，无需重复获取');
    }
  } else {
    $.msg($.name, '获取999会员中心Token: 失败', '请检查请求头是否包含Authorization');
    console.log(`获取999会员中心Token: 失败, 请检查请求头是否包含Authorization`);
  }
})()
  .catch((e) => $.logErr(e))
  .finally(() => $.done());

// Env函数（请在此处粘贴完整的Env函数）
function Env(t,e){...}