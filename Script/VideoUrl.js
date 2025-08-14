// Surge Script - 获取 sportCount 最大的 videoUrl 并统计总的 sportCount 和实际运动时间
// Surge 规则配置: [Script] 部分添加规则
// 示例: https://app130229.eapps.dingtalkcloud.com/studentTask/sport/record url script-response-body 获取统计.js

// 常量定义
const QUALIFIED_THRESHOLD = 195;
const REQUIRED_QUALIFIED_COUNT = 3;
const EXCELLENT_THRESHOLD = 200;

let body = $response.body;
let jsonData;

try {
    jsonData = JSON.parse(body);
} catch (error) {
    console.log("响应解析失败: " + error);
    $done({});
}

// 工具函数
function formatTime(milliseconds) {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}分钟${seconds}秒`;
}

function isValidSportRecord(record) {
    return record && 
           typeof record.sportCount === 'number' && 
           typeof record.sportTime === 'number' &&
           typeof record.videoUrl === 'string';
}

function validateResponseData(jsonData) {
    return jsonData && 
           jsonData.data && 
           Array.isArray(jsonData.data) && 
           jsonData.data.length > 0 &&
           jsonData.data[0].sportRecordDTOS &&
           Array.isArray(jsonData.data[0].sportRecordDTOS);
}

// 初始化变量
let maxSportCountRecord = null;
let totalSportCount = 0;
let totalSportTime = 0;
let qualifiedCount = 0;
let hasExcellent = false;

if (validateResponseData(jsonData)) {
    const sportRecords = jsonData.data[0].sportRecordDTOS;
    
    sportRecords.forEach(record => {
        if (!isValidSportRecord(record)) {
            console.log("跳过无效记录:", record);
            return;
        }
        
        totalSportCount += record.sportCount;
        totalSportTime += record.sportTime;
        
        if (record.sportTime <= 60000 && record.sportCount >= QUALIFIED_THRESHOLD) {
            qualifiedCount++;
        }
        
        if (record.sportCount >= EXCELLENT_THRESHOLD) {
            hasExcellent = true;
        }

        if (!maxSportCountRecord || record.sportCount > maxSportCountRecord.sportCount) {
            maxSportCountRecord = record;
        }
    });
}

// 格式化总运动时间
const formattedTotalTime = formatTime(totalSportTime);

// 输出结果
if (maxSportCountRecord) {
    const adjustedRequiredCount = hasExcellent ? REQUIRED_QUALIFIED_COUNT - 1 : REQUIRED_QUALIFIED_COUNT;
    const isQualified = qualifiedCount >= adjustedRequiredCount;
    let qualificationStatus;
    if (isQualified) {
        qualificationStatus = hasExcellent ? "✅ 优秀合格" : "✅ 普通合格";
    } else {
        qualificationStatus = "❌ 不合格";
    }
    
    console.log("考核结果：" + qualificationStatus);
    
    $notification.post(
        `结果: ${qualificationStatus}`,
        `一分钟最多: ${maxSportCountRecord.sportCount}个`,
        `总跳绳数: ${totalSportCount}个, 总跳绳时间: ${formattedTotalTime}`
    );

    console.log("一分钟最多: " + maxSportCountRecord.sportCount + "个");
    console.log("对应的 videoUrl: " + maxSportCountRecord.videoUrl);
    console.log("总跳绳数: " + totalSportCount + "个");
    console.log(`总跳绳时间：${formattedTotalTime}`);
} else {
    console.log("未找到符合条件的记录");
}

// 返回原始响应体
$done({ body });
