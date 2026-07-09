/**
 * 为快捷指令提供读取和清空发票列表的通用 API
 * 存储 key 通过模块 [Script] 规则的 argument 参数传入，
 * 如 argument=jd_invoices_batch、argument=meituan_invoices_batch
 */
const SCRIPT_NAME = "发票列表API";
const SCRIPT_VERSION = "1.0.0";

const cacheKey = typeof $argument === "string" ? $argument.trim() : "";
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

if (!cacheKey) {
    console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION}: 模块规则缺少 argument 配置`);
    $done(response(JSON.stringify({ error: "缺少 argument 配置，无法确定存储 key" })));
} else if (url.includes("/get")) {
    let invoicesStr = $persistentStore.read(cacheKey) || "[]";
    try {
        const invoices = JSON.parse(invoicesStr);
        invoicesStr = JSON.stringify(Array.isArray(invoices) ? invoices : []);
    } catch (e) {
        invoicesStr = "[]";
    }

    $done(response(invoicesStr));
} else if (url.includes("/clear")) {
    $persistentStore.write("[]", cacheKey);
    $done(response(JSON.stringify({ message: "已清空发票列表" })));
} else {
    $done({});
}
