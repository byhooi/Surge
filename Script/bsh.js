// Surge Script - Token变更检测和持久化存储
// 用于检测HTTP请求头中的token变化并自动更新存储

// 常量配置
const TOKEN_HEADER_KEY = 'token';
const STORAGE_KEY = 'token';
const NOTIFICATION_TITLE = 'Token更新通知';
const NOTIFICATION_SUBTITLE = '新的Token已捕获';

// 工具函数
function isValidToken(token) {
    return token && typeof token === 'string' && token.trim().length > 0;
}

function logTokenInfo(message, token) {
    console.log(`${message}: ${token || 'null'}`);
}

// 获取当前Token
const headers = $request.headers;
const currentToken = headers[TOKEN_HEADER_KEY];

logTokenInfo('当前捕获的Token', currentToken);

// 获取之前保存的Token
const previousToken = $persistentStore.read(STORAGE_KEY);

logTokenInfo('上一次保存的Token', previousToken);

// 检查Token变化并处理
if (isValidToken(currentToken)) {
    if (currentToken !== previousToken) {
        try {
            const writeSuccess = $persistentStore.write(currentToken, STORAGE_KEY);
            
            if (writeSuccess !== false) {
                logTokenInfo('检测到Token变更，已更新。新Token', currentToken);
                $notification.post(NOTIFICATION_TITLE, NOTIFICATION_SUBTITLE, currentToken);
            } else {
                console.log('Token存储失败');
            }
        } catch (error) {
            console.log('Token更新过程中发生错误: ' + error.message);
        }
    } else {
        console.log('Token未变更，无需更新');
    }
} else {
    console.log('未检测到有效Token或Token为空');
}

// 结束脚本
$done({});
