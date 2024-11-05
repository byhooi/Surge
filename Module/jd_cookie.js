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
        if (!cookie) return;

        // 提取 pt_key 和 pt_pin
        const pt_key_match = cookie.match(/pt_key=([^;]*)/);
        const pt_pin_match = cookie.match(/pt_pin=([^;]*)/);

        if (!pt_key_match || !pt_pin_match) {
            $.log('未找到必要的 Cookie 信息');
            return;
        }

        const pt_key = pt_key_match[1];
        const pt_pin = pt_pin_match[1];

        // 获取持久化存储的旧 Cookie
        const oldCookie = $.getdata('JD_COOKIE');
        const newCookie = `pt_key=${pt_key};pt_pin=${pt_pin};`;

        if (newCookie !== oldCookie) {
            // 存储新 Cookie
            $.setdata(newCookie, 'JD_COOKIE');
            
            // 推送通知
            await notify('京东 Cookie 已更新', 
                `账号: ${decodeURIComponent(pt_pin)}\n` +
                `更新时间: ${new Date().toLocaleString('zh-CN', {hour12: false})}\n` +
                `Cookie 已保存`
            );
            
            $.log('Cookie 已更新并通知');
        } else {
            $.log('Cookie 未发生变化');
        }

    } catch (e) {
        $.log('错误:', e);
        await notify('京东 Cookie 处理异常', e.message);
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
        this.logs.push(...args);
        console.log(...args);
    };
    
    // 持久化存储
    this.setdata = (val, key) => {
        try {
            $persistentStore.write(val, key);
            return true;
        } catch (e) {
            this.log(`写入持久化数据异常: ${e.message}`);
            return false;
        }
    };
    
    // 读取持久化数据
    this.getdata = (key) => {
        try {
            return $persistentStore.read(key);
        } catch (e) {
            this.log(`读取持久化数据异常: ${e.message}`);
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