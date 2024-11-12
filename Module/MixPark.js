// 用于监控微信小程序 Token 变化的 Surge 脚本
const $ = {
    name: 'WoxToken Monitor',
    
    // 存储相关方法
    setdata: function(val, key) {
        return $persistentStore.write(val, key);
    },
    getdata: function(key) {
        return $persistentStore.read(key);
    },
    
    // 消息通知
    msg: function(title, subtitle, message) {
        $notification.post(title, subtitle, message);
    },
    
    // 日志方法
    log: function(msg) {
        console.log(`[${this.name}] ${msg}`);
    }
};

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
                try {
                    oldTokenInfo = JSON.parse(oldTokenInfo);
                    
                    // 检查是否有变化
                    if (oldTokenInfo.token !== newTokenInfo.token || 
                        oldTokenInfo.mkey !== newTokenInfo.mkey) {
                        isChanged = true;
                    }
                } catch (e) {
                    // 如果解析失败，视为首次运行
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
                const notify_body = `Token已更新！\nToken: ${newTokenInfo.token.slice(0, 15)}...\nMkey: ${newTokenInfo.mkey.slice(0, 15)}...\n时间: ${new Date().toLocaleString()}`;
                
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
    } finally {
        $done({});
    }
}

// 执行主函数
!(async () => {
    await main();
})().catch((e) => {
    $.log(`❌ 脚本异常: ${e.message}`);
    $.msg(config.title, '❌ 执行异常', e.message);
    $done({});
});