/**
 * 自动捕获麦当劳图片型 PDF 发票，并通过本地认证代理加入批量列表
 *
 * 麦当劳 downloadV2 接口返回 application/pdf，但 PDF 内部主要是图片。
 * 裸下载链接会返回未登录，因此仅在 Surge 本地保存该发票对应的 sid。
 */
const SCRIPT_NAME = "麦当劳发票提取";
const SCRIPT_VERSION = "1.0.0";
const CACHE_KEY = "mcd_invoices_batch";
const RECORDS_KEY = "mcd_invoice_records";
const TIME_KEY = "mcd_invoices_time";
const MAX_INVOICES = 50;
const REMOTE_HOST = "api.mcd.cn";
const REMOTE_PATH = "/bff/order/invoice/downloadV2";
const LOCAL_HOST = "mcd.invoice.local";

function jsonResponse(body, status) {
  return {
    response: {
      status: status || 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(body)
    }
  };
}

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

function readRecords() {
  const recordsStr = $persistentStore.read(RECORDS_KEY);
  if (!recordsStr) return {};

  try {
    const records = JSON.parse(recordsStr);
    return records && typeof records === "object" && !Array.isArray(records) ? records : {};
  } catch (e) {
    return {};
  }
}

function getHeader(headers, name) {
  const target = String(name).toLowerCase();
  const source = headers || {};
  const key = Object.keys(source).find(item => item.toLowerCase() === target);
  return key ? String(source[key] || "") : "";
}

function extractInvoiceId(url) {
  const match = String(url || "").match(/[?&]i=([^&#]+)/);
  if (!match) return "";

  try {
    return decodeURIComponent(match[1]);
  } catch (e) {
    return match[1];
  }
}

function localDownloadUrl(invoiceId) {
  return `http://${LOCAL_HOST}/download?i=${encodeURIComponent(invoiceId)}`;
}

function isRemoteCapture(url) {
  return String(url || "").startsWith(`https://${REMOTE_HOST}${REMOTE_PATH}`);
}

function notify(invoices) {
  const lastTime = parseInt($persistentStore.read(TIME_KEY) || "0", 10);
  const now = Date.now();
  if (now - lastTime <= 500) return;

  $persistentStore.write(now.toString(), TIME_KEY);
  const shortcutName = encodeURIComponent("批量保存麦当劳发票");
  const openUrl = `shortcuts://run-shortcut?name=${shortcutName}`;

  $notification.post(
    "🧾 麦当劳发票已加入批量列表",
    `当前共 ${invoices.length} 张待保存`,
    "发票实际为图片型 PDF，保存到相册时请在快捷指令中先转换为图像",
    { "url": openUrl }
  );
}

function captureInvoice() {
  const url = $request.url;
  const invoiceId = extractInvoiceId(url);
  const sid = getHeader($request.headers, "sid");

  if (!invoiceId) {
    console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION}: 下载请求缺少发票编号 i`);
    $done({});
    return;
  }

  if (!sid) {
    console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION}: 下载请求缺少 sid，无法建立本地认证代理`);
    $done({});
    return;
  }

  const invoices = readInvoices();
  const records = readRecords();
  const proxyUrl = localDownloadUrl(invoiceId);
  const existingIndex = invoices.findIndex(item => extractInvoiceId(item) === invoiceId);
  const isNew = existingIndex === -1;

  records[invoiceId] = {
    url,
    sid,
    updatedAt: Date.now()
  };

  if (isNew) {
    invoices.push(proxyUrl);
  } else if (invoices[existingIndex] !== proxyUrl) {
    invoices[existingIndex] = proxyUrl;
  }

  if (invoices.length > MAX_INVOICES) {
    const removed = invoices.splice(0, invoices.length - MAX_INVOICES);
    removed.forEach(item => {
      const removedId = extractInvoiceId(item);
      if (removedId && !invoices.some(saved => extractInvoiceId(saved) === removedId)) {
        delete records[removedId];
      }
    });
  }

  $persistentStore.write(JSON.stringify(invoices), CACHE_KEY);
  $persistentStore.write(JSON.stringify(records), RECORDS_KEY);
  if (isNew) notify(invoices);
  $done({});
}

function getInvoices() {
  $done(jsonResponse(readInvoices()));
}

function clearInvoices() {
  $persistentStore.write("[]", CACHE_KEY);
  $persistentStore.write("{}", RECORDS_KEY);
  $done(jsonResponse({ message: "已清空麦当劳发票列表和本地认证记录" }));
}

function downloadInvoice() {
  const invoiceId = extractInvoiceId($request.url);
  const records = readRecords();
  const record = invoiceId ? records[invoiceId] : null;

  if (!record || !record.url || !record.sid) {
    $done(jsonResponse({
      error: "未找到发票认证记录，请在麦当劳 App 中重新打开该发票"
    }, 404));
    return;
  }

  $httpClient.get({
    url: record.url,
    headers: {
      "Accept": "application/pdf",
      "sid": record.sid
    },
    timeout: 30,
    "binary-mode": true
  }, (error, response, data) => {
    if (error || !response) {
      console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION}: 代理下载失败: ${error || "无响应"}`);
      $done(jsonResponse({ error: "麦当劳发票下载失败，请稍后重试" }, 502));
      return;
    }

    const status = Number(response.status || response.statusCode || 0);
    const contentType = getHeader(response.headers, "content-type");
    if (status < 200 || status >= 300 || !contentType.toLowerCase().includes("application/pdf")) {
      console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION}: 认证可能已失效，状态 ${status}，类型 ${contentType || "未知"}`);
      $done(jsonResponse({
        error: "麦当劳登录状态可能已失效，请在 App 中重新打开任意发票后再试"
      }, 401));
      return;
    }

    const disposition = getHeader(response.headers, "content-disposition") ||
      `attachment; filename=mcd-invoice-${invoiceId}.pdf`;

    $done({
      response: {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": disposition,
          "Cache-Control": "no-store"
        },
        body: data
      }
    });
  });
}

try {
  const url = $request.url;

  if (isRemoteCapture(url)) {
    captureInvoice();
  } else if (url === `http://${LOCAL_HOST}/get`) {
    getInvoices();
  } else if (url === `http://${LOCAL_HOST}/clear`) {
    clearInvoices();
  } else if (url.startsWith(`http://${LOCAL_HOST}/download?`)) {
    downloadInvoice();
  } else {
    $done({});
  }
} catch (e) {
  console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION} 运行失败: ${e}`);
  $done(jsonResponse({ error: "麦当劳发票脚本运行失败" }, 500));
}
