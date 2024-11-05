// JD Cookie Monitor
// 用于监控京东 Cookie 变化并进行通知
// Surge 模块配置:
// [Script]
// JD Cookie = type=http-request,pattern=^https:\/\/mars\.jd\.com\/log\/sdk\/v2,script-path=jd-cookie-monitor.js
// [MITM]
// hostname = mars.jd.com

const $ = new Env('JD Cookie Monitor');

// 主函数
async function main() {
    try {
        const cookie = $request.headers['Cookie'];
        if (!cookie) {
            $.log('请求中未找到 Cookie');
            return;
        }

        $.log('获取到完整请求 Cookie:', cookie);

        // 提取 pt_key 和 pt_pin
        const pt_key_match = cookie.match(/pt_key=([^;]*)/);
        const pt_pin_match = cookie.match(/pt_pin=([^;]*)/);

        if (!pt_key_match || !pt_pin_match) {
            $.log('未找到必要的 Cookie 信息');
            return;
        }

        const pt_key = pt_key_match[1];
        const pt_pin = pt_pin_match[1];

        $.log('提取的 Cookie 信息:');
        $.log('pt_key:', pt_key);
        $.log('pt_pin:', pt_pin);

        // 获取持久化存储的旧 Cookie
        const oldCookie = $.getdata('JD_COOKIE');
        const newCookie = `pt_key=${pt_key};pt_pin=${pt_pin};`;

        $.log('持久化存储的旧 Cookie:', oldCookie || '无');
        $.log('准备存储的新 Cookie:', newCookie);

        if (newCookie !== oldCookie) {
            // 存储新 Cookie
            const saveResult = $.setdata(newCookie, 'JD_COOKIE');
            $.log('Cookie 存储操作:', saveResult ? '成功' : '失败');
            
            // 推送通知
            const notifyText = 
                `账号: ${decodeURIComponent(pt_pin)}\n` +
                `更新时间: ${new Date().toLocaleString('zh-CN', {hour12: false})}\n` +
                `Cookie: ${newCookie}`;
            
            await notify('京东 Cookie 已更新', notifyText);
            $.log('已发送更新通知:', notifyText);
        } else {
            $.log('Cookie 未发生变化，保持原值');
        }

    } catch (e) {
        $.log('遇到错误:', e);
        await notify('京东 Cookie 处理异常', e.toString());
    }
}

// 通知函数
async function notify(title, content) {
    $.msg(title, '', content);
}

// 环境变量类
function Env(name) {
    // 构造函数
    this.name = name;
    this.data = null;
    this.logs = [];
    
    // 打印日志
    this.log = (...args) => {
        const msg = args.join(' ');
        this.logs.push(msg);
        console.log(`[${this.name}] ${msg}`);
    };
    
    // 持久化存储
    this.setdata = (val, key) => {
        try {
            $persistentStore.write(val, key);
            return true;
        } catch (e) {
            this.log(`持久化存储异常: ${e}`);
            return false;
        }
    };
    
    // 读取持久化数据
    this.getdata = (key) => {
        try {
            return $persistentStore.read(key);
        } catch (e) {
            this.log(`读取持久化数据异常: ${e}`);
            return null;
        }
    };
    
    // 发送通知
    this.msg = (title, subtitle, body) => {
        $notification.post(title, subtitle, body);
    };
}

// 执行主函数
!(async () => {
    await main();
})().catch(e => $.log('执行异常:', e))