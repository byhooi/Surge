/**
 * 为快捷指令提供读取和清理京东发票列表的 API
 */
const CACHE_KEY = "jd_invoices_batch";
const url = $request.url;

function response(body) {
    return {
        response: {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body
        }
    };
}

if (url.includes("/get")) {
    let invoicesStr = $persistentStore.read(CACHE_KEY) || "[]";
    try {
        const invoices = JSON.parse(invoicesStr);
        invoicesStr = JSON.stringify(Array.isArray(invoices) ? invoices : []);
    } catch (e) {
        invoicesStr = "[]";
    }

    $done(response(invoicesStr));
} else if (url.includes("/clear")) {
    $persistentStore.write("[]", CACHE_KEY);
    $done(response(JSON.stringify({ message: "已清空京东发票列表" })));
} else {
    $done({});
}
