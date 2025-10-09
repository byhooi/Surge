// Surge Script - Token变更检测和持久化存储
// 用于检测HTTP请求头中的token变化并自动更新存储

// 常量配置
const TOKEN_HEADER_KEY = 'token';
const STORAGE_KEY = 'token';
const NOTIFICATION_TITLE = 'Token更新通知';
const NOTIFICATION_SUBTITLE = '新的Token已捕获';
const SCRIPT_VERSION = '1.1.0';

if (!$request?.headers || typeof $request.headers !== 'object') {
    console.log(`[v${SCRIPT_VERSION}] 未检测到请求头，结束脚本`);
    return $done({});
}

// 工具函数
function isValidToken(token) {
    return token && typeof token === 'string' && token.trim().length > 0;
}

function logTokenInfo(message, token) {
    console.log(`[v${SCRIPT_VERSION}] ${message}: ${token || 'null'}`);
}

function getHeaderValue(headers, key) {
    const targetKey = key.toLowerCase();
    for (const headerKey in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, headerKey)) {
            if (typeof headerKey === 'string' && headerKey.toLowerCase() === targetKey) {
                return headers[headerKey];
            }
        }
    }
    return undefined;
}

function writeTokenSafely(token, key) {
    try {
        const success = $persistentStore.write(token, key);
        if (success !== false) {
            return true;
        }
        console.log(`[v${SCRIPT_VERSION}] Token存储失败，准备重试一次`);
    } catch (error) {
        console.log(`[v${SCRIPT_VERSION}] Token写入异常: ${error.message}`);
    }

    try {
        const retrySuccess = $persistentStore.write(token, key);
        if (retrySuccess !== false) {
            console.log(`[v${SCRIPT_VERSION}] Token重试写入成功`);
            return true;
        }
    } catch (error) {
        console.log(`[v${SCRIPT_VERSION}] Token重试写入异常: ${error.message}`);
    }

    return false;
}

// 获取当前Token
const headers = $request.headers;
const currentToken = getHeaderValue(headers, TOKEN_HEADER_KEY);

logTokenInfo('当前捕获的Token', currentToken);

// 获取之前保存的Token
const previousToken = $persistentStore.read(STORAGE_KEY);

logTokenInfo('上一次保存的Token', previousToken);

// 检查Token变化并处理
if (isValidToken(currentToken)) {
    if (currentToken !== previousToken) {
        const writeSuccess = writeTokenSafely(currentToken, STORAGE_KEY);
        if (writeSuccess) {
            logTokenInfo('检测到Token变更，已更新。新Token', currentToken);
            $notification.post(NOTIFICATION_TITLE, NOTIFICATION_SUBTITLE, currentToken);
        } else {
            console.log(`[v${SCRIPT_VERSION}] 多次尝试后仍未成功写入Token，请检查持久化存储权限`);
        }
    } else {
        console.log(`[v${SCRIPT_VERSION}] Token未变更，无需更新`);
    }
} else {
    console.log(`[v${SCRIPT_VERSION}] 未检测到有效Token或Token为空`);
}

// 结束脚本
$done({});
