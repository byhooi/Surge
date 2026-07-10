/**
 * 自动捕获票易通 (XForcePlus) 电子发票 PDF 链接并加入批量列表
 */
const SCRIPT_NAME = "票易通发票提取";
const SCRIPT_VERSION = "1.0.0";
const CACHE_KEY = "xforceplus_invoices_batch";
const TIME_KEY = "xforceplus_invoices_time";
const MAX_INVOICES = 50;
// 提取 /a/ 后的完整文档路径（base64 段）作为去重依据，排除可能的查询参数
const INVOICE_ID_RE = /\/a\/([^?#]+)/;

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

function extractInvoiceId(url) {
    const match = String(url).match(INVOICE_ID_RE);
    return match ? match[1] : "";
}

function notify(invoices, addedCount) {
    const lastTime = parseInt($persistentStore.read(TIME_KEY) || "0", 10);
    const now = Date.now();
    if (now - lastTime <= 500) return;

    $persistentStore.write(now.toString(), TIME_KEY);
    const shortcutName = encodeURIComponent("批量保存票易通发票");
    const openUrl = `shortcuts://run-shortcut?name=${shortcutName}`;

    $notification.post(
        "🧾 票易通发票已加入批量列表",
        `新增 ${addedCount} 张，当前共 ${invoices.length} 张待保存`,
        "",
        { "url": openUrl }
    );
}

try {
    const url = $request.url;
    const invoiceId = extractInvoiceId(url);

    if (invoiceId) {
        const invoices = readInvoices();
        const existingIndex = invoices.findIndex(savedUrl => extractInvoiceId(savedUrl) === invoiceId);

        if (existingIndex !== -1) {
            // 已存在的发票原位替换为新链接，刷新可能过期的访问参数
            if (invoices[existingIndex] !== url) {
                invoices[existingIndex] = url;
                $persistentStore.write(JSON.stringify(invoices), CACHE_KEY);
            }
        } else {
            invoices.push(url);
            // 超出上限时丢弃最旧的
            if (invoices.length > MAX_INVOICES) {
                invoices.splice(0, invoices.length - MAX_INVOICES);
            }
            $persistentStore.write(JSON.stringify(invoices), CACHE_KEY);
            notify(invoices, 1);
        }
    }
} catch (e) {
    console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION} 失败: ${e}`);
}

$done({});
