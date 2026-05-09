/**
 * 自动提取美团发票并提示保存到相册
 */
const url = $request.url;

// 提取发票ID用于去重
const invoiceIdMatch = url.match(/common-invoice-file\/([a-zA-Z0-9-]+)\.png/);
const invoiceId = invoiceIdMatch ? invoiceIdMatch[1] : null;

if (invoiceId) {
    // 检查是否已经处理过此发票
    const hasProcessed = $persistentStore.read("invoice_" + invoiceId);
    
    if (!hasProcessed) {
        // 方案一：直接点击通知在 Safari 打开图片，然后长按保存
        // let openUrl = url;
        
        // 方案二（推荐）：配合 iOS 快捷指令实现“点击即保存”
        // 需提前创建一个名为“保存发票”的快捷指令：接收文本(URL) -> 获取URL内容 -> 保存到相册
        const shortcutName = encodeURIComponent("保存发票");
        const openUrl = `shortcuts://run-shortcut?name=${shortcutName}&input=text&text=${encodeURIComponent(url)}`;
        
        $notification.post(
            "🧾 发现美团发票", 
            "点击此通知自动保存到相册", 
            "发票 ID: " + invoiceId.substring(0, 8) + "...\n(请确保已安装配套的快捷指令)",
            { 
                "url": openUrl,
                "media-url": url // 在通知中显示发票缩略图
            }
        );
        
        // 标记为已处理，避免重复通知
        $persistentStore.write("true", "invoice_" + invoiceId);
    }
}

$done({});
