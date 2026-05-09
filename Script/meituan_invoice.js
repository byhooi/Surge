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
    
    // 如果还没记录过这张，加入列表
    if (!invoices.includes(url)) {
        invoices.push(url);
        $persistentStore.write(JSON.stringify(invoices), CACHE_KEY);
        
        // 极短冷却时间防连发 Bug，但不影响手动一张张查看的反馈
        let lastTime = parseInt($persistentStore.read(TIME_KEY) || "0");
        let now = Date.now();
        if (now - lastTime > 500) {
            $persistentStore.write(now.toString(), TIME_KEY);
            const shortcutName = encodeURIComponent("批量保存发票");
            const openUrl = `shortcuts://run-shortcut?name=${shortcutName}`;
            
            $notification.post(
                "🧾 发票已加入批量队列", 
                `当前已累积 ${invoices.length} 张发票`, 
                "您可以返回美团继续查看下一张。\n攒够后，点击任意一条此类通知即可一键全存！",
                { 
                    "url": openUrl,
                    "media-url": url 
                }
            );
        }
    }
}
$done({});
