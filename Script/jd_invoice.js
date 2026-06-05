/**
 * 自动捕获京东商品发票 PDF 链接并加入批量列表
 */
const CACHE_KEY = "jd_invoices_batch";
const TIME_KEY = "jd_invoices_time";
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

function notify(invoices, addedCount, firstUrl) {
    const lastTime = parseInt($persistentStore.read(TIME_KEY) || "0", 10);
    const now = Date.now();
    if (now - lastTime <= 500) return;

    $persistentStore.write(now.toString(), TIME_KEY);
    const shortcutName = encodeURIComponent("批量保存发票");
    const openUrl = `shortcuts://run-shortcut?name=${shortcutName}`;

    $notification.post(
        "京东商品发票已加入批量列表",
        `新增 ${addedCount} 张，当前共 ${invoices.length} 张待保存`,
        "",
        {
            "url": openUrl,
            "media-url": firstUrl
        }
    );
}

function savePdfUrls(urls) {
    const newUrls = uniquePdfUrls(urls);
    if (newUrls.length === 0) return;

    const invoices = readInvoices();
    const known = {};
    invoices.forEach(url => {
        known[normalizeInvoiceUrl(url)] = true;
    });

    let addedCount = 0;
    let firstUrl = "";
    newUrls.forEach(url => {
        const key = normalizeInvoiceUrl(url);
        if (!key || known[key]) return;
        known[key] = true;
        invoices.push(url);
        addedCount += 1;
        if (!firstUrl) firstUrl = url;
    });

    if (addedCount === 0) return;

    $persistentStore.write(JSON.stringify(invoices), CACHE_KEY);
    notify(invoices, addedCount, firstUrl);
}

try {
    const urls = [];

    if (typeof $response !== "undefined" && $response && $response.body) {
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
    console.log(`京东发票提取失败: ${e}`);
}

$done({});
