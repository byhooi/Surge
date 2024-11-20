let body = $request.body;
let jsonBody;

try {
    jsonBody = JSON.parse(body);
    // 修改数据范围为 TODAY
    jsonBody.dataScope = "TODAY";
    
    // 将修改后的数据转回字符串
    body = JSON.stringify(jsonBody);
} catch (error) {
    console.log("请求体解析失败: " + error);
}

// 返回修改后的请求体
$done({ body }); 