// 用于监控微信小程序 Token 变化的 Surge 脚本
const $ = new Env('WoxToken Monitor');

// 配置项
const config = {
    title: 'Token变更通知',
    storage_key: 'wox_token_info'
};

// 主函数
async function main() {
    try {
        if ($request && $request.body) {
            // 解析请求体
            const requestBody = JSON.parse($request.body);
            
            // 提取关键信息
            const newTokenInfo = {
                token: requestBody.token || '',
                mkey: requestBody.mkey || ''
            };
            
            // 获取存储的旧数据
            let oldTokenInfo = $.getdata(config.storage_key);
            let isChanged = false;
            
            if (oldTokenInfo) {
                oldTokenInfo = JSON.parse(oldTokenInfo);
                
                // 检查是否有变化
                if (oldTokenInfo.token !== newTokenInfo.token || 
                    oldTokenInfo.mkey !== newTokenInfo.mkey) {
                    isChanged = true;
                }
            } else {
                // 首次运行
                isChanged = true;
            }
            
            // 如果有变化，发送通知
            if (isChanged) {
                // 保存新数据
                $.setdata(JSON.stringify(newTokenInfo), config.storage_key);
                
                // 构建通知内容
                const notify_body = `
MixPark Mkey已更新！
Token: ${newTokenInfo.token.slice(0, 15)}...
Mkey: ${newTokenInfo.mkey.slice(0, 15)}...
时间: ${new Date().toLocaleString()}`;
                
                // 发送通知
                $.msg(config.title, '', notify_body);
                
                $.log('Token信息已更新并通知');
            } else {
                $.log('Token信息未发生变化');
            }
            
            // 输出日志
            $.log(`当前Token信息：${JSON.stringify(newTokenInfo, null, 2)}`);
        }
    } catch (e) {
        $.log(`脚本运行异常: ${e.message}`);
        $.msg(config.title, '❌ 运行异常', e.message);
    }
}

// 执行主函数
!(async () => {
    await main();
})().catch((e) => {
    $.log(`❌ 脚本异常: ${e.message}`);
    $.msg(config.title, '❌ 执行异常', e.message);
}).finally(() => {
    $.done();
});

// Surge Env 类
function Env(t,e){class s{constructor(t){this.env=t}send(t,e="GET"){t="string"==typeof t?{url:t}:t;let s=this.get;return"POST"===e&&(s=this.post),new Promise((e,i)=>{s.call(this,t,(t,s,r)=>{t?i(t):e(s)})})}get(t){return this.send.call(this.env,t)}post(t){return this.send.call(this.env,t,"POST")}}return new class{constructor(t,e){this.name=t,this.http=new s(this),this.data=null,this.dataFile="box.dat",this.logs=[],this.isMute=!1,this.isNeedRewrite=!1,this.logSeparator="\n",this.encoding="utf-8",Object.assign(this,e)}getdata(t){let e=this.getval(t);if(/^@/.test(t)){const[,s,i]=/^@(.*?)\.(.*?)$/.exec(t),r=s?this.getval(s):"";if(r)try{const t=JSON.parse(r);e=t?this.lodash_get(t,i,""):e}catch(t){e=""}}return e}setdata(t,e){let s=!1;if(/^@/.test(e)){const[,i,r]=/^@(.*?)\.(.*?)$/.exec(e),o=this.getval(i),h=i?"null"===o?null:o||"{}":"{}";try{const e=JSON.parse(h);this.lodash_set(e,r,t),s=this.setval(JSON.stringify(e),i)}catch(e){const o={};this.lodash_set(o,r,t),s=this.setval(JSON.stringify(o),i)}}else s=this.setval(t,e);return s}getval(t){return this.isSurge()||this.isLoon()?$persistentStore.read(t):this.isQuanX()?$prefs.valueForKey(t):this.isNode()?(this.data=this.loaddata(),this.data[t]):this.data&&this.data[t]||null}setval(t,e){return this.isSurge()||this.isLoon()?$persistentStore.write(t,e):this.isQuanX()?$prefs.setValueForKey(t,e):this.isNode()?(this.data=this.loaddata(),this.data[e]=t,this.writedata(),!0):this.data&&this.data[e]||null}msg(e=t,s="",i="",r){const o=t=>{if(!t)return t;if("string"==typeof t)return this.isLoon()?t:this.isQuanX()?{"open-url":t}:this.isSurge()?{url:t}:void 0;if("object"==typeof t){if(this.isLoon()){let e=t.openUrl||t.url||t["open-url"],s=t.mediaUrl||t["media-url"];return{openUrl:e,mediaUrl:s}}if(this.isQuanX()){let e=t["open-url"]||t.url||t.openUrl,s=t["media-url"]||t.mediaUrl,i=t["update-pasteboard"]||t.updatePasteboard;return{"open-url":e,"media-url":s,"update-pasteboard":i}}if(this.isSurge()){let e=t.url||t.openUrl||t["open-url"];return{url:e}}}};if(this.isMute||(this.isSurge()||this.isLoon()?$notification.post(e,s,i,o(r)):this.isQuanX()&&$notify(e,s,i,o(r))),!this.isMuteLog){let t=["","==============\ud83d\udce3\u7cfb\u7edf\u901a\u77e5\ud83d\udce3=============="];t.push(e),s&&t.push(s),i&&t.push(i),console.log(t.join("\n")),this.logs=this.logs.concat(t)}}log(...t){t.length>0&&(this.logs=[...this.logs,...t]),console.log(t.join(this.logSeparator))}logErr(t,e){const s=!this.isSurge()&&!this.isQuanX()&&!this.isLoon();s?this.log("",`\u2757\ufe0f${this.name}, \u9519\u8bef!`,t.stack):this.log("",`\u2757\ufe0f${this.name}, \u9519\u8bef!`,t)}wait(t){return new Promise(e=>setTimeout(e,t))}done(t={}){const e=(new Date).getTime(),s=(e-this.startTime)/1e3;this.log("",`\ud83d\udd14${this.name}, \u7ed3\u675f! \ud83d\udd5b ${s} \u79d2`),this.log(),(this.isSurge()||this.isQuanX()||this.isLoon())&&$done(t)}}(t,e)}