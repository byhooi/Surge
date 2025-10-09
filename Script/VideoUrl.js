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

function readPersistentCount(key) {
    const rawValue = $persistentStore.read(key);
    if (rawValue === null || rawValue === undefined || rawValue === '') {
        $persistentStore.write('0', key);
        return 0;
    }
    const parsed = parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        console.log(`[v${SCRIPT_VERSION}] 发现无效的 ${key} 持久化值: ${rawValue}，已重置为 0`);
        $persistentStore.write('0', key);
        return 0;
    }
    return parsed;
}

function writePersistentCount(key, value) {
    const normalized = Math.max(0, Number.isFinite(value) ? value : 0);
    $persistentStore.write(String(normalized), key);
    return normalized;
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
const requiredQualifiedCount = Math.max(0, parseInt(args.requiredCount, 10) || DEFAULT_REQUIRED_QUALIFIED_COUNT);
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
        
        if (sportTimeMs <= 60000 && record.sportCount >= QUALIFIED_THRESHOLD) {
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
    const adjustedRequiredCount = Math.max(0, requiredQualifiedCount - (hasExcellent ? 1 : 0));
    const isQualified = qualifiedCount >= adjustedRequiredCount;
    let qualificationStatus;
    if (isQualified) {
        qualificationStatus = hasExcellent ? excellentLabel : qualifiedLabel;
    } else {
        qualificationStatus = failLabel;
    }
    
    console.log(`考核结果（v${SCRIPT_VERSION}）：${qualificationStatus}`);
    let totalQualifiedStored = readPersistentCount(TOTAL_QUALIFIED_KEY);
    let normalQualifiedStored = readPersistentCount(NORMAL_QUALIFIED_KEY);
    let excellentQualifiedStored = readPersistentCount(EXCELLENT_QUALIFIED_KEY);
    if (isQualified) {
        totalQualifiedStored = writePersistentCount(TOTAL_QUALIFIED_KEY, totalQualifiedStored + 1);
        if (hasExcellent) {
            excellentQualifiedStored = writePersistentCount(EXCELLENT_QUALIFIED_KEY, excellentQualifiedStored + 1);
        } else {
            normalQualifiedStored = writePersistentCount(NORMAL_QUALIFIED_KEY, normalQualifiedStored + 1);
        }
        console.log(`[v${SCRIPT_VERSION}] 合格统计已更新 -> 总合格: ${totalQualifiedStored}, 普通合格: ${normalQualifiedStored}, 优秀合格: ${excellentQualifiedStored}`);
    } else {
        console.log(`[v${SCRIPT_VERSION}] 本次未达到合格标准，统计数据未更新 -> 总合格: ${totalQualifiedStored}, 普通合格: ${normalQualifiedStored}, 优秀合格: ${excellentQualifiedStored}`);
    }
    
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
