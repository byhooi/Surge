/**
 * 自动捕获发票并加入批量列表
 */
const url = $request.url;
const CACHE_KEY = "meituan_invoices_batch";
const TIME_KEY = "meituan_invoices_time";

// 提取发票 ID 用于去重
const match = url.match(/common-invoice-file\/([a-zA-Z0-9-]+)\.png/);
if (match) {
    let invoicesStr = $persistentStore.read(CACHE_KEY);
    let invoices = [];
    if (invoicesStr) {
        try { invoices = JSON.parse(invoicesStr); } catch (e) {}
    }
    
    let invoiceId = match[1];
    // 使用核心 ID 去重，防止 URL 参数（如 S3 Signature）改变导致重复
    let hasDuplicate = invoices.some(savedUrl => savedUrl.includes(invoiceId));
    
    // 如果还没记录过这张，加入列表
    if (!hasDuplicate) {
        invoices.push(url);
        $persistentStore.write(JSON.stringify(invoices), CACHE_KEY);
        
        // 极短冷却时间防连发 Bug
        let lastTime = parseInt($persistentStore.read(TIME_KEY) || "0");
        let now = Date.now();
        if (now - lastTime > 500) {
            $persistentStore.write(now.toString(), TIME_KEY);
            const shortcutName = encodeURIComponent("批量保存美团发票");
            const openUrl = `shortcuts://run-shortcut?name=${shortcutName}`;
            
            $notification.post(
                "🧾 发票已加入批量队列", 
                `当前共积攒 ${invoices.length} 张发票待保存`, 
                "",
                { 
                    "url": openUrl,
                    "media-url": url 
                }
            );
        }
    }
}
$done({});
