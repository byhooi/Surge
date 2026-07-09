/**
 * 为快捷指令提供读取和清理发票的 API
 */
const CACHE_KEY = "meituan_invoices_batch";
const url = $request.url;

if (url.includes("/get")) {
    let invoicesStr = $persistentStore.read(CACHE_KEY) || "[]";
    $done({
        response: {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: invoicesStr
        }
    });
} else if (url.includes("/clear")) {
    $persistentStore.write("[]", CACHE_KEY);
    $done({
        response: {
            status: 200,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ message: "已清空发票列表" })
        }
    });
} else {
    $done({});
}
