/**
 * 自动捕获京东商品发票 PDF 链接并加入批量列表
 */
const SCRIPT_NAME = "京东发票提取";
const SCRIPT_VERSION = "1.1.0";
const CACHE_KEY = "jd_invoices_batch";
const TIME_KEY = "jd_invoices_time";
const MAX_INVOICES = 50;
const GOODS_PDF_URL_RE = /https?:\/\/oss\.cn-north-1\.jcloudcs\.com\/pop-einvoice\/[^\s"'<>\\]+?\.pdf(?:\?[^\s"'<>\\]*)?/gi;

function readInvoices() {
    const invoicesStr = $persistentStore.read(CACHE_KEY);
    if (!invoicesStr) return [];

    try {
        const invoices = JSON.parse(invoicesStr);
        return Array.isArray(invoices) ? invoices : [];
    } catch (e) {
        return [];
    }
}

function normalizeInvoiceUrl(url) {
    return String(url).split("#")[0].split("?")[0];
}

function collectPdfUrls(value, output) {
    if (typeof value === "string") {
        const text = value.replace(/\\\//g, "/").replace(/&amp;/g, "&");
        const matches = text.match(GOODS_PDF_URL_RE);
        if (matches) output.push(...matches);
        return;
    }

    if (Array.isArray(value)) {
        value.forEach(item => collectPdfUrls(item, output));
        return;
    }

    if (value && typeof value === "object") {
        Object.keys(value).forEach(key => collectPdfUrls(value[key], output));
    }
}

function uniquePdfUrls(urls) {
    const seen = {};
    const result = [];

    urls.forEach(url => {
        const key = normalizeInvoiceUrl(url);
        if (!key || seen[key]) return;
        seen[key] = true;
        result.push(url);
    });

    return result;
}

function notify(invoices, addedCount) {
    const lastTime = parseInt($persistentStore.read(TIME_KEY) || "0", 10);
    const now = Date.now();
    if (now - lastTime <= 500) return;

    $persistentStore.write(now.toString(), TIME_KEY);
    const shortcutName = encodeURIComponent("批量保存京东发票");
    const openUrl = `shortcuts://run-shortcut?name=${shortcutName}`;

    $notification.post(
        "🧾 京东发票已加入批量列表",
        `新增 ${addedCount} 张，当前共 ${invoices.length} 张待保存`,
        "",
        { "url": openUrl }
    );
}

function savePdfUrls(urls) {
    const newUrls = uniquePdfUrls(urls);
    if (newUrls.length === 0) return;

    const invoices = readInvoices();
    const indexByKey = {};
    invoices.forEach((savedUrl, index) => {
        indexByKey[normalizeInvoiceUrl(savedUrl)] = index;
    });

    let addedCount = 0;
    let changed = false;
    newUrls.forEach(url => {
        const key = normalizeInvoiceUrl(url);
        if (!key) return;

        const existingIndex = indexByKey[key];
        if (existingIndex !== undefined) {
            // 已存在的发票原位替换为新链接，刷新可能过期的签名
            if (invoices[existingIndex] !== url) {
                invoices[existingIndex] = url;
                changed = true;
            }
            return;
        }

        indexByKey[key] = invoices.length;
        invoices.push(url);
        addedCount += 1;
        changed = true;
    });

    if (!changed) return;

    // 超出上限时丢弃最旧的
    if (invoices.length > MAX_INVOICES) {
        invoices.splice(0, invoices.length - MAX_INVOICES);
    }

    $persistentStore.write(JSON.stringify(invoices), CACHE_KEY);
    if (addedCount > 0) notify(invoices, addedCount);
}

try {
    const urls = [];

    if (typeof $response !== "undefined" && $response && $response.body) {
        // 正则已限定发票域名和路径，直接对整个响应体递归扫描
        try {
            collectPdfUrls(JSON.parse($response.body), urls);
        } catch (e) {
            collectPdfUrls($response.body, urls);
        }
    } else if (typeof $request !== "undefined" && $request && $request.url) {
        collectPdfUrls($request.url, urls);
    }

    savePdfUrls(urls);
} catch (e) {
    console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION} 提取失败: ${e}`);
}

$done({});
