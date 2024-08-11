const $ = new Env('999会员中心');
const notify = $.isNode() ? require('./sendNotify') : '';

// 从环境变量或者持久化存储中获取授权令牌
let jjjck = $.isNode() ? (process.env.jjjck ? process.env.jjjck.split('#') : []) : ($.getdata('jjjck') ? $.getdata('jjjck').split('#') : []);

// 获取当前日期
const today = new Date().toISOString().split('T')[0];

// 主函数
!(async () => {
  if (typeof $request !== 'undefined') {
    await getCookie();
  } else {
    await signIn();
  }
})()
  .catch((e) => $.logErr(e))
  .finally(() => $.done());

// 获取Cookie
async function getCookie() {
  if ($request && $request.headers && $request.headers['Authorization']) {
    const auth = $request.headers['Authorization'];
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
}

// 签到主函数
async function signIn() {
  for (let i = 0; i < jjjck.length; i++) {
    const Authorization = jjjck[i];
    const headers = {
      "Host": "mc.999.com.cn",
      "Connection": "keep-alive",
      "locale": "zh_CN",
      "Authorization": Authorization,
      "content-type": "application/json",
      "Accept-Encoding": "gzip,compress,br,deflate",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.48(0x18003030) NetType/WIFI Language/zh_CN"
    };

    try {
      // 获取用户信息
      const resp_user = await $.http.get({
        url: 'https://mc.999.com.cn/zanmall_diy/ma/personal/user/info',
        headers: headers
      });
      const phone = JSON.parse(resp_user.body).data.phone;
      console.log(`开始账号: ${phone} 打卡`);

      // 打卡任务
      const checkInCodeList = [
        { checkInCode: "mtbbs", checkInMeaning: "每天八杯水" },
        { checkInCode: "zs", checkInMeaning: "早睡" },
        { checkInCode: "ydswfz", checkInMeaning: "运动15分钟" },
        { checkInCode: "zq", checkInMeaning: "早起" }
      ];

      for (const item of checkInCodeList) {
        const data = {
          type: "daily_health_check_in",
          params: {
            checkInCode: item.checkInCode,
            checkInTime: today
          }
        };
        const response = await $.http.post({
          url: 'https://mc.999.com.cn/zanmall_diy/ma/client/pointTaskClient/finishTask',
          headers: headers,
          body: JSON.stringify(data)
        });
        const result = JSON.parse(response.body).data;
        if (result.success) {
          console.log(`打卡内容${item.checkInMeaning}---打卡完成 获得积分${result.point}`);
        } else {
          console.log(`打卡内容${item.checkInMeaning}---请勿重复打卡`);
        }
      }

      // 阅读文章
      for (let i = 0; i < 5; i++) {
        console.log('开始阅读');
        const data_read = { 
          type: "explore_health_knowledge", 
          params: { articleCode: String(Math.floor(Math.random() * 20) + 1) }
        };
        const resp_read = await $.http.post({
          url: 'https://mc.999.com.cn/zanmall_diy/ma/client/pointTaskClient/finishTask',
          headers: headers,
          body: JSON.stringify(data_read)
        });
        const point = JSON.parse(resp_read.body).data.point;
        console.log(`阅读成功！获得${point}积分`);
      }

      // 体检任务
      for (let i = 0; i < 3; i++) {
        const h_test = {
          gender:"1", age:"17", height:"188", weight:"50", waist:"55", hip:"55",
          food: { breakfast:"1", dietHabits:["1"], foodPreference:"1" },
          life: { livingCondition:["1"], livingHabits:["1"] },
          exercise: { exerciseTimesWeekly:"1" },
          mental: { mentalState:["2"] },
          body: { bodyStatus:["2"], oralStatus:"1", fruitReact:"1", skinCondition:["1"], afterMealReact:"2", defecation:"2" },
          sick: { bloating:"2", burp:"2", fart:"3", gurgle:"3", stomachache:"2", behindSternum:"4", ThroatOrMouthAcid:"4", FoodReflux:"4", auseaOrVomiting:"4" },
          other: { familyProducts:["5"] }
        };
        const resp_htest = await $.http.post({
          url: 'https://mc.999.com.cn/zanmall_diy/ma/health/add',
          headers: headers,
          body: JSON.stringify(h_test)
        });
        const referNo = JSON.parse(resp_htest.body).data.referNo;
        console.log(referNo);
        const data_h_test = { 
          type: "complete_health_testing", 
          params: { testCode: referNo }
        };
        const resp_h_test = await $.http.post({
          url: 'https://mc.999.com.cn/zanmall_diy/ma/client/pointTaskClient/finishTask',
          headers: headers,
          body: JSON.stringify(data_h_test)
        });
        const point = JSON.parse(resp_h_test.body).data.point;
        console.log(`体检成功！获得${point}积分`);
        await $.wait(5000);
      }

      // 获取总积分
      const resp = await $.http.get({
        url: 'https://mc.999.com.cn/zanmall_diy/ma/personal/point/pointInfo',
        headers: headers
      });
      const totalpoints = JSON.parse(resp.body).data;
      console.log(`当前拥有总积分:${totalpoints}`);

    } catch (e) {
      console.log(e.message);
      const msg = '账号可能失效！';
      if ($.isNode()) await notify.sendNotify("999会员中心", msg);
    }
    console.log('*'.repeat(30));
  }
}

// Env函数
function Env(t,e){"undefined"!=typeof process&&JSON.stringify(process.env).indexOf("GITHUB")>-1&&process.exit(0);class s{constructor(t){this.env=t}send(t,e="GET"){t="string"==typeof t?{url:t}:t;let s=this.get;return"POST"===e&&(s=this.post),new Promise((e,i)=>{s.call(this,t,(t,s,r)=>{t?i(t):e(s)})})}get(t){return this.send.call(this.env,t)}post(t){return this.send.call(this.env,t,"POST")}}return new class{constructor(t,e){this.name=t,this.http=new s(this),this.data=null,this.dataFile="box.dat",this.logs=[],this.isMute=!1,this.isNeedRewrite=!1,this.logSeparator="\n",this.startTime=(new Date).getTime(),Object.assign(this,e),this.log("",`🔔${this.name}, 开始!`)}isNode(){return"undefined"!=typeof module&&!!module.exports}isQuanX(){return"undefined"!=typeof $task}isSurge(){return"undefined"!=typeof $httpClient&&"undefined"==typeof $loon}isLoon(){return"undefined"!=typeof $loon}toObj(t,e=null){try{return JSON.parse(t)}catch{return e}}toStr(t,e=null){try{return JSON.stringify(t)}catch{return e}}getjson(t,e){let s=e;const i=this.getdata(t);if(i)try{s=JSON.parse(this.getdata(t))}catch{}return s}setjson(t,e){try{return this.setdata(JSON.stringify(t),e)}catch{return!1}}getScript(t){return new Promise(e=>{this.get({url:t},(t,s,i)=>e(i))})}runScript(t,e){return new Promise(s=>{let i=this.getdata("@chavy_boxjs_userCfgs.httpapi");i=i?i.replace(/\n/g,"").trim():i;let r=this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout");r=r?1*r:20,r=e&&e.timeout?e.timeout:r;const[o,h]=i.split("@"),n={url:`http://${h}/v1/scripting/evaluate`,body:{script_text:t,mock_type:"cron",timeout:r},headers:{"X-Key":o,Accept:"*/*"}};this.post(n,(t,e,i)=>s(i))}).catch(t=>this.logErr(t))}loaddata(){if(!this.isNode())return{};{this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e);if(!s&&!i)return{};{const i=s?t:e;try{return JSON.parse(this.fs.readFileSync(i))}catch(t){return{}}}}}writedata(){if(this.isNode()){this.fs=this.fs?this.fs:require("fs"),this.path=this.path?this.path:require("path");const t=this.path.resolve(this.dataFile),e=this.path.resolve(process.cwd(),this.dataFile),s=this.fs.existsSync(t),i=!s&&this.fs.existsSync(e),r=JSON.stringify(this.data);s?this.fs.writeFileSync(t,r):i?this.fs.writeFileSync(e,r):this.fs.writeFileSync(t,r)}}lodash_get(t,e,s){const i=e.replace(/\[(\d+)\]/g,".$1").split(".");let r=t;for(const t of i)if(r=Object(r)[t],void 0===r)return s;return r}lodash_set(t,e,s){return Object(t)!==t?t:(Array.isArray(e)||(e=e.toString().match(/[^.[\]]+/g)||[]),e.slice(0,-1).reduce((t,s,i)=>Object(t[s])===t[s]?t[s]:t[s]=Math.abs(e[i+1])>>0==+e[i+1]?[]:{},t)[e[e.length-1]]=s,t)}getdata(t){let e=this.getval(t);if(/^@/.test(t)){const[,s,i]=/^@(.*?)\.(.*?)$/.exec(t),r=s?this.getval(s):"";if(r)try{const t=JSON.parse(r);e=t?this.lodash_get(t,i,""):e}catch(t){e=""}}return e}setdata(t,e){let s=!1;if(/^@/.test(e)){const[,i,r]=/^@(.*?)\.(.*?)$/.exec(e),o=this.getval(i),h=i?"null"===o?null:o||"{}":"{}";try{const e=JSON.parse(h);this.lodash_set(e,r,t),s=this.setval(JSON.stringify(e),i)}catch(e){const o={};this.lodash_set(o,r,t),s=this.setval(JSON.stringify(o),i)}}else s=this.setval(t,e);return s}getval(t){return this.isSurge()||this.isLoon()?$persistentStore.read(t):this.isQuanX()?$prefs.valueForKey(t):this.isNode()?(this.data=this.loaddata(),this.data[t]):this.data&&this.data[t]||null}setval(t,e){return this.isSurge()||this.isLoon()?$persistentStore.write(t,e):this.isQuanX()?$prefs.setValueForKey(t,e):this.isNode()?(this.data=this.loaddata(),this.data[e]=t,this.writedata(),!0):this.data&&this.data[e]||null}initGotEnv(t){this.got=this.got?this.got:require("got"),this.cktough=this.cktough?this.cktough:require("tough-cookie"),this.ckjar=this.ckjar?this.ckjar:new this.cktough.CookieJar,t&&(t.headers=t.headers?t.headers:{},void 0===t.headers.Cookie&&void 0===t.cookieJar&&(t.cookieJar=this.ckjar))}get(t,e=(()=>{})){t.headers&&(delete t.headers["Content-Type"],delete t.headers["Content-Length"]),this.isSurge()||this.isLoon()?(this.isSurge()&&this.isNeedRewrite&&(t.headers=t.headers||{},Object.assign(t.headers,{"X-Surge-Skip-Scripting":!1})),$httpClient.get(t,(t,s,i)=>{!t&&s&&(s.body=i,s.statusCode=s.status),e(t,s,i)})):this.isQuanX()?(this.isNeedRewrite&&(t.opts=t.opts||{},Object.assign(t.opts,{hints:!1})),$task.fetch(t).