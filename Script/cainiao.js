const url = $request.url;
if (!$response.body) $done({});
let obj = JSON.parse($response.body);

if (url.includes("mtop.cainiao.app.e2e.engine.page.fetch")) {
    // 首页
    if (obj.data?.data?.data?.mainSearch?.bizData?.searchContents) {
        delete obj.data.data.data.mainSearch.bizData.searchContents;
    }
    if (obj.data?.data?.data?.operationList) {
        delete obj.data.data.data.operationList;
    }
    
    // 我的
    if (obj.data?.data?.banner) {
        delete obj.data.data.banner;
    }
    if (obj.data?.data?.activity) {
        delete obj.data.data.activity;
    }
    if (obj.data?.data?.vip) {
        delete obj.data.data.vip;
    }
} else if (url.includes("mtop.com.cainiao.longquan.place.getpageresourcecontent.cn")) {
    // 发现页
    if (obj.data?.result?.placeContentMap?.["780001"]?.contentList) {
        delete obj.data.result.placeContentMap["780001"].contentList;
    }
} else if (url.includes("mtop.cainiao.guoguo.nbnetflow.ads")) {
    // 阻塞配置加载
    const materialId = obj.data?.result?.[0]?.materialId;
    if (materialId !== "39017") {
        obj.data = {};
    }
}

$done({ body: JSON.stringify(obj) });
