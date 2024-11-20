// Surge Script - 获取 sportCount 最大的 videoUrl 并统计总的 sportCount 和实际运动时间
// Surge 规则配置: [Script] 部分添加规则
// 示例: https://app130229.eapps.dingtalkcloud.com/studentTask/sport/record url script-response-body 获取统计.js

let body = $response.body;
let jsonData;

try {
    jsonData = JSON.parse(body);
} catch (error) {
    console.log("响应解析失败: " + error);
    $done({});
}

// 初始化变量
let maxSportCountRecord = null;
let totalSportCount = 0;
let totalSportTime = 0;
let qualifiedCount = 0; // 记录185及以上的次数
let superQualifiedCount = 0; // 新增：记录190及以上的次数

if (jsonData && jsonData.data && jsonData.data[0].sportRecordDTOS) {
    jsonData.data[0].sportRecordDTOS.forEach(record => {
        // 累计总 sportCount
        totalSportCount += record.sportCount;
        
        // 累计总 sportTime
        totalSportTime += record.sportTime;
        
        // 判断单次是否合格
        if (record.sportTime <= 60000) {
            if (record.sportCount >= 190) {
                superQualifiedCount++;
                qualifiedCount++;
            } else if (record.sportCount >= 185) {
                qualifiedCount++;
            }
        }

        // 查找 sportCount 最大的记录
        if (!maxSportCountRecord || record.sportCount > maxSportCountRecord.sportCount) {
            maxSportCountRecord = record;
        }
    });
}

// 将总运动时间转换为分钟
let totalExerciseTimeInMinutes = Math.floor(totalSportTime / 60000); // 将毫秒转换为分钟
let remainingSeconds = Math.floor((totalSportTime % 60000) / 1000); // 秒部分

// 输出结果
if (maxSportCountRecord) {
    // 判断合格类型
    let isQualified190 = superQualifiedCount >= 3;
    let isQualified185 = qualifiedCount >= 5;
    let qualificationStatus = (isQualified190 || isQualified185) ? "✅ 合格" : "❌ 不合格";
    
    // 根据合格类型显示不同的统计信息
    let countDisplay = isQualified190 ? 
        `190及以上次数 ${superQualifiedCount}次` : 
        `185及以上次数 ${qualifiedCount}次`;
    
    console.log("考核结果：" + qualificationStatus);
    console.log("合格类型: " + countDisplay);
    
    // 修改通知内容
    $notification.post(
        "跳绳统计 " + qualificationStatus,
        `一分钟最快: ${maxSportCountRecord.sportCount}个\n` +
        `${countDisplay}`,
        `总跳绳数: ${totalSportCount}个`
    );

    console.log("一分钟最快: " + maxSportCountRecord.sportCount + "个");
    console.log("对应的 videoUrl: " + maxSportCountRecord.videoUrl);
    console.log("总跳绳数: " + totalSportCount + "个");
    console.log(`总运动时间：${totalExerciseTimeInMinutes}分钟${remainingSeconds}秒`);
} else {
    console.log("未找到符合条件的记录");
}

// 返回原始响应体
$done({ body });
