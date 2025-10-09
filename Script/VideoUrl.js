// Surge Script - 获取 sportCount 最大的 videoUrl 并统计总的 sportCount 和实际运动时间
// Surge 规则配置: [Script] 部分添加规则
// 示例: https://app130229.eapps.dingtalkcloud.com/studentTask/sport/record url script-response-body 获取统计.js

// 常量定义
const QUALIFIED_THRESHOLD = 195;
const DEFAULT_REQUIRED_QUALIFIED_COUNT = 3;
const EXCELLENT_THRESHOLD = 200;
const DEFAULT_QUALIFIED_LABEL = '✅ 普通合格';
const DEFAULT_EXCELLENT_LABEL = '✅ 优秀合格';
const DEFAULT_FAIL_LABEL = '❌ 不合格';
const SCRIPT_VERSION = '1.0.0';
const TOTAL_QUALIFIED_KEY = 'videourl_total_qualified';
const NORMAL_QUALIFIED_KEY = 'videourl_normal_qualified';
const EXCELLENT_QUALIFIED_KEY = 'videourl_excellent_qualified';

const body = typeof $response?.body === 'string' ? $response.body : '';
let jsonData;

try {
    jsonData = JSON.parse(body);
} catch (error) {
    console.log("响应解析失败: " + error);
    return $done({ body });
}

// 工具函数
function parseArguments(argumentString) {
    if (typeof argumentString !== 'string' || argumentString.trim().length === 0) {
        return {};
    }
    return argumentString.split('&').reduce((acc, pair) => {
        if (!pair) return acc;
        const [rawKey, rawValue = ''] = pair.split('=');
        if (!rawKey) return acc;
        const key = decodeURIComponent(rawKey);
        const value = decodeURIComponent(rawValue);
        acc[key] = value;
        return acc;
    }, {});
}

function formatTime(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
        return "0秒";
    }
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}小时`);
    if (minutes > 0) parts.push(`${minutes}分钟`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`);
    return parts.join('');
}

function isValidSportRecord(record) {
    return record && 
           typeof record.sportCount === 'number' && 
           typeof record.sportTime === 'number' &&
           typeof record.videoUrl === 'string';
}

function readNumberSetting(key, defaultValue) {
    const rawValue = $persistentStore.read(key);
    if (rawValue === null || rawValue === undefined || rawValue === '') {
        return defaultValue;
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
        console.log(`[v${SCRIPT_VERSION}] 发现无效的 ${key} 配置值: ${rawValue}，已使用默认值 ${defaultValue}`);
        return defaultValue;
    }
    return parsed;
}

function validateResponseData(jsonData) {
    return jsonData && 
           jsonData.data && 
           Array.isArray(jsonData.data) && 
           jsonData.data.some(item => Array.isArray(item?.sportRecordDTOS));
}

// 初始化变量
let maxSportCountRecord = null;
let totalSportCount = 0;
let totalSportTime = 0;
let qualifiedCount = 0;
let hasExcellent = false;

const args = parseArguments(typeof $argument === 'string' ? $argument : '');
const storedRequiredQualifiedCount = readNumberSetting(TOTAL_QUALIFIED_KEY, DEFAULT_REQUIRED_QUALIFIED_COUNT);
const storedQualifiedThreshold = readNumberSetting(NORMAL_QUALIFIED_KEY, QUALIFIED_THRESHOLD);
const storedExcellentThreshold = readNumberSetting(EXCELLENT_QUALIFIED_KEY, EXCELLENT_THRESHOLD);
const requiredQualifiedCount = Math.max(0, parseInt(args.requiredCount, 10) || storedRequiredQualifiedCount);
const qualifiedLabel = args.qualifiedLabel || DEFAULT_QUALIFIED_LABEL;
const excellentLabel = args.excellentLabel || DEFAULT_EXCELLENT_LABEL;
const failLabel = args.failLabel || DEFAULT_FAIL_LABEL;

console.log(`[v${SCRIPT_VERSION}] 判定参数 -> 最低合格次数: ${requiredQualifiedCount}, 普通阈值: ${storedQualifiedThreshold}, 优秀阈值: ${storedExcellentThreshold}`);

if (validateResponseData(jsonData)) {
    const sportRecords = jsonData.data
        .flatMap(item => Array.isArray(item?.sportRecordDTOS) ? item.sportRecordDTOS : [])
        .filter(Boolean);
    
    sportRecords.forEach(record => {
        if (!isValidSportRecord(record)) {
            console.log("跳过无效记录:", record);
            return;
        }
        
        totalSportCount += record.sportCount;
        const sportTimeMs = record.sportTime >= 1000 ? record.sportTime : record.sportTime * 1000;
        totalSportTime += sportTimeMs;
        
        if (sportTimeMs <= 60000 && record.sportCount >= storedQualifiedThreshold) {
            qualifiedCount++;
        }

        if (record.sportCount >= storedExcellentThreshold) {
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
    const adjustedRequiredCount = Math.max(0, requiredQualifiedCount - (hasExcellent ? 1 : 0));
    const isQualified = qualifiedCount >= adjustedRequiredCount;
    let qualificationStatus;
    if (isQualified) {
        qualificationStatus = hasExcellent ? excellentLabel : qualifiedLabel;
    } else {
        qualificationStatus = failLabel;
    }
    
    console.log(`考核结果（v${SCRIPT_VERSION}）：${qualificationStatus}`);
    
    $notification.post(
        `结果: ${qualificationStatus}`,
        `一分钟最多: ${maxSportCountRecord.sportCount}个`,
        `总跳绳数: ${totalSportCount}个, 总跳绳时间: ${formattedTotalTime}`
    );

    console.log(`[v${SCRIPT_VERSION}] 一分钟最多: ${maxSportCountRecord.sportCount}个`);
    console.log(`[v${SCRIPT_VERSION}] 对应的 videoUrl: ${maxSportCountRecord.videoUrl}`);
    console.log(`[v${SCRIPT_VERSION}] 总跳绳数: ${totalSportCount}个`);
    console.log(`[v${SCRIPT_VERSION}] 总跳绳时间：${formattedTotalTime}`);
} else {
    console.log(`未找到符合条件的记录（v${SCRIPT_VERSION}）`);
}

// 返回原始响应体
$done({ body });
