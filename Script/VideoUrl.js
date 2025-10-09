// Surge Script - 获取 sportCount 最大的 videoUrl 并统计总的 sportCount 和实际运动时间
// Surge 规则配置: [Script] 部分添加规则
// 示例: https://app130229.eapps.dingtalkcloud.com/studentTask/sport/record url script-response-body 获取统计.js

(function () {

// 常量定义
const DEFAULT_QUALIFIED_THRESHOLD = 195;
const DEFAULT_REQUIRED_QUALIFIED_COUNT = 3;
const DEFAULT_EXCELLENT_THRESHOLD = 200;
const DEFAULT_QUALIFIED_LABEL = '✅ 普通合格';
const DEFAULT_EXCELLENT_LABEL = '✅ 优秀合格';
const DEFAULT_FAIL_LABEL = '❌ 不合格';
const SCRIPT_VERSION = '1.1.0';

const configuredQualifiedThreshold = readNumberSetting('QUALIFIED_THRESHOLD', DEFAULT_QUALIFIED_THRESHOLD);
const configuredRequiredQualifiedCount = readNumberSetting('DEFAULT_REQUIRED_QUALIFIED_COUNT', DEFAULT_REQUIRED_QUALIFIED_COUNT);
const configuredExcellentThreshold = readNumberSetting('EXCELLENT_THRESHOLD', DEFAULT_EXCELLENT_THRESHOLD);

const body = typeof $response?.body === 'string' ? $response.body : '';
let jsonData;

try {
    jsonData = JSON.parse(body);
} catch (error) {
    console.log("响应解析失败: " + error);
    $done({ body });
    return;
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
const requiredQualifiedCount = Math.max(0, parseInt(args.requiredCount, 10) || configuredRequiredQualifiedCount);
const qualifiedLabel = args.qualifiedLabel || DEFAULT_QUALIFIED_LABEL;
const excellentLabel = args.excellentLabel || DEFAULT_EXCELLENT_LABEL;
const failLabel = args.failLabel || DEFAULT_FAIL_LABEL;

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
        
        if (sportTimeMs <= 60000 && record.sportCount >= configuredQualifiedThreshold) {
            qualifiedCount++;
        }

        if (record.sportCount >= configuredExcellentThreshold) {
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

function readNumberSetting(key, fallback) {
    const rawValue = readPersistentValue(key);
    if (rawValue === undefined || rawValue === null) {
        return fallback;
    }
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        return rawValue;
    }
    if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
        const parsed = Number(rawValue);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
}

function readPersistentValue(key) {
    try {
        if (typeof $persistentStore !== 'undefined' && typeof $persistentStore.read === 'function') {
            const value = $persistentStore.read(key);
            if (value !== null && value !== undefined) {
                return value;
            }
        }
        if (typeof $prefs !== 'undefined' && typeof $prefs.valueForKey === 'function') {
            const value = $prefs.valueForKey(key);
            if (value !== null && value !== undefined) {
                return value;
            }
        }
    } catch (error) {
        console.log('读取 BoxJS 配置失败: ' + error);
    }
    return null;
}

})();
