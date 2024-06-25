if (typeof $request !== 'undefined') {
  console.log("进入捕获 Mkey 和 Token 的逻辑");

  // 捕获 Mkey 和 Token
  const mkeyHeader = $request.headers['mkey'];
  const token = $request.headers['token'];

  console.log("请求头: ", JSON.stringify($request.headers));
  if (mkeyHeader && token) {
    console.log("捕获到的 Header Mkey: " + mkeyHeader);
    console.log("捕获到的 Token: " + token);

    // 将 Mkey 和 Token 存储到持久化存储中
    $persistentStore.write(mkeyHeader, "MkeyHeader");
    $persistentStore.write(token, "Token");
	
    // 设置标志位，避免重复通知
    const notified = $persistentStore.read("Notified");
    if (!notified) {
      // 发送通知
      $notification.post("捕获 Mkey 和 Token 成功", "Header Mkey: " + mkeyHeader, "Token: " + token);
      $persistentStore.write("true", "Notified");
    }
  } else {
    console.log("未能捕获到 Mkey 或 Token");
    $notification.post("捕获 Mkey 或 Token 失败", "未能捕获到 Mkey 或 Token", "");
  }

  $done();
} else {
  console.log("进入签到逻辑");

  // 签到逻辑
  const mkeyHeader = $persistentStore.read("MkeyHeader");
  const token = $persistentStore.read("Token");

  // 手动填写 mkeyBody
  const mkeyBody = "b9a6a896d765a02c624378ddad7a764c8af4a241"; // 请将 "your_manual_mkey_value" 替换为实际的 mkey 值

  console.log("读取到的 MkeyHeader: " + mkeyHeader);
  console.log("读取到的 Token: " + token);
  console.log("使用的 MkeyBody: " + mkeyBody);

  if (mkeyHeader && token && mkeyBody) {
    signIn(mkeyHeader, token, mkeyBody);
  } else {
    console.log("未能读取到 Mkey 或 Token 或未手动填写 mkeyBody");
    $notification.post("签到失败", "未能读取到 Mkey 或 Token 或未手动填写 mkeyBody", "");
    $done();
  }
}

function signIn(mkeyHeader, token, mkeyBody) {
  console.log("开始签到");

  const url = "https://wox2019.woxshare.com/clientApi/signInRecordAdd";
  const method = "POST";
  const ts = Math.floor(Date.now() / 1000); // 当前时间戳（秒）
  const headers = {
    "Content-Type": "application/json",
    "ts": ts.toString(),
    "mkey": mkeyHeader,
    "version": "4.10.79",
    "bid": "ejga",
    "oid": "1",
    "gid": "70",
    "token": token,
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x1800312f) NetType/WIFI Language/zh_CN",
    "Referer": "https://servicewechat.com/wxa1646a84b3995509/13/page-frame.html"
  };

  const body = JSON.stringify({
    "token": headers["token"],
    "version": headers["version"],
    "bid": headers["bid"],
    "mkeyUrl": "/clientApi/signInRecordAdd",
    "mkey": mkeyBody
  });

  const myRequest = {
    url: url,
    method: method,
    headers: headers,
    body: body
  };

  console.log("签到请求: ", JSON.stringify(myRequest));

  $httpClient.post(myRequest, function(error, response, data) {
    if (error) {
      console.log("MixPark签到请求失败: " + error);
      $notification.post("MixPark签到失败", "请求错误", error);
    } else {
      console.log("MixPark签到请求成功: " + data);
      const result = JSON.parse(data);
      if (result.errCode === 0) {
        const adjustedTotalIntegral = result.detail.totalIntegral - 5; // 累计积分减去5
        console.log("MixPark签到成功，当前积分: " + result.detail.integral);
        console.log("MixPark连续签到天数: " + result.detail.signDays);
        console.log("MixPark累计积分: " + adjustedTotalIntegral);
        $notification.post("MixPark签到成功", "当前积分: " + result.detail.integral, "累计积分: " + adjustedTotalIntegral + "，连续签到天数: " + result.detail.signDays);
      } else {
        console.log("MixPark签到失败，错误信息: " + result.errMsg);
        $notification.post("MixPark签到失败", "错误信息", result.errMsg);
      }
    }
    $done();
  });
}
