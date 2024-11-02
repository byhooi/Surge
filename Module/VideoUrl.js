// Surge Script - 获取 sportCount 最大的 videoUrl 和 sportCount
// Surge 规则配置: [Script] 部分添加规则
// 示例: https://app130229.eapps.dingtalkcloud.com/studentTask/sport/record url script-response-body 获取最大sportCount.js

let body = $response.body;
let jsonData;

try {
    jsonData = JSON.parse(body);
} catch (error) {
    console.log("响应解析失败: " + error);
    $done({});
}

// 初始化最大值查找变量
let maxSportCountRecord = null;

if (jsonData && jsonData.data && jsonData.data[0].sportRecordDTOS) {
    jsonData.data[0].sportRecordDTOS.forEach(record => {
        if (!maxSportCountRecord || record.sportCount > maxSportCountRecord.sportCount) {
            maxSportCountRecord = record;
        }
    });
}

// 输出最大 sportCount 和对应的 videoUrl
if (maxSportCountRecord) {
    console.log("最大 sportCount: " + maxSportCountRecord.sportCount);
    console.log("对应的 videoUrl: " + maxSportCountRecord.videoUrl);

    // 以通知形式输出 sportCount 和 videoUrl
    $notification.post(
        "最大 sportCount 记录",
        "sportCount: " + maxSportCountRecord.sportCount,
        "videoUrl: " + maxSportCountRecord.videoUrl
    );
} else {
    console.log("未找到符合条件的记录");
}

// 返回修改后的响应体（保持原始内容）
$done({ body });
