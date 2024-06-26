// 获取HTTP请求头中的token
let headers = $request.headers;
let currentToken = headers['token'];

// 输出当前捕获的Token
console.log("当前捕获的Token: " + currentToken);

// 从Surge的持久化存储中读取上一次保存的Token
let previousToken = $persistentStore.read("token");

// 输出上一次保存的Token
console.log("上一次保存的Token: " + previousToken);

// 检查Token是否有变化
if (currentToken && currentToken !== previousToken) {
    // 如果Token不同，更新存储中的Token，并发送通知
    $persistentStore.write(currentToken, "token");
    console.log("检测到Token变更，已更新。新Token: " + currentToken);
    // 发送通知
    $notification.post("Token更新通知", "新的Token已捕获", currentToken);
} else {
    // 如果Token相同或未捕获到Token，不做任何操作
    console.log("Token未变更，无需更新。");
}

// 结束脚本
$done({});
