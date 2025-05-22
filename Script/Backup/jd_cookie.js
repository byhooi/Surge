// JD Cookie Monitor
// 用于监控京东 Cookie 变化并进行通知
// 使用方法：浏览器打开 https://m.jd.com/ 登录后获取 Cookie

const $ = new Env('JD Cookie Monitor');

async function main() {
    try {
        const cookie = $request.headers['Cookie'];
        if (!cookie) return;

        // 提取 pt_key 和 pt_pin
        const pt_key_match = cookie.match(/pt_key=([^;]*)/);
        const pt_pin_match = cookie.match(/pt_pin=([^;]*)/);

        if (!pt_key_match || !pt_pin_match) return;

        const pt_key = pt_key_match[1];
        const pt_pin = pt_pin_match[1];

        $.log(`pt_key=${pt_key}; pt_pin=${pt_pin}; `);

        const oldCookie = $.getdata('JD_COOKIE');
        const newCookie = `pt_key=${pt_key};pt_pin=${pt_pin};`;

        if (newCookie !== oldCookie) {
            $.setdata(newCookie, 'JD_COOKIE');
            await notify('京东 Cookie 已更新', 
                `账号: ${decodeURIComponent(pt_pin)}\n` +
                `更新时间: ${new Date().toLocaleString('zh-CN', {hour12: false})}\n` +
                `Cookie: ${newCookie}`
            );
        } else {
            $.log('Cookie 未发生变化');
        }

    } catch (e) {
        $.log('错误:', e);
        await notify('京东 Cookie 处理异常', e.message);
    }
}

async function notify(title, content) {
    $.msg(title, '', content);
}

function Env(name) {
    this.name = name;
    
    this.log = (msg) => {
        console.log(`[${this.name}] ${msg}`);
    };
    
    this.setdata = (val, key) => {
        try {
            $persistentStore.write(val, key);
            return true;
        } catch (e) {
            return false;
        }
    };
    
    this.getdata = (key) => {
        try {
            return $persistentStore.read(key);
        } catch (e) {
            return null;
        }
    };
    
    this.msg = (title, subtitle, body) => {
        $notification.post(title, subtitle, body);
    };
}

!(async () => {
    await main();
})().catch(e => $.log('执行异常:', e))