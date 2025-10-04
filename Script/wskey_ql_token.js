// 单独获取青龙 Token 的脚本
const SCRIPT_NAME = '获取青龙 Token';

// 获取配置
const baseUrl = ($persistentStore.read('ql_url') || '').replace(/\/$/, '');
const clientId = $persistentStore.read('ql_client_id') || '';
const clientSecret = $persistentStore.read('ql_client_secret') || '';

// 检查配置
if (!baseUrl || !clientId || !clientSecret) {
  const msg = '❌ 青龙面板配置不完整\n\n请在 BoxJS 中填写：\n1. 青龙面板地址\n2. Client ID\n3. Client Secret';
  console.log(msg);
  $notification.post(SCRIPT_NAME, '', msg);
  $done({});
} else {
  console.log(`🔑 开始获取 Token...`);
  console.log(`📍 青龙地址: ${baseUrl}`);

  // 构造请求
  const options = {
    url: `${baseUrl}/open/auth/token?client_id=${clientId}&client_secret=${clientSecret}`,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    }
  };

  // 发送请求
  $httpClient.get(options, function(error, response, data) {
    let msg = '';

    if (error) {
      msg = `❌ 网络错误\n\n${error}`;
      console.log(msg);
    } else {
      console.log(`📦 响应状态: ${response.status}`);
      console.log(`📄 响应数据: ${data}`);

      try {
        const result = JSON.parse(data);

        if (result.code === 200 && result.data && result.data.token) {
          const token = result.data.token;
          const expires = Date.now() + (6.5 * 24 * 60 * 60 * 1000);

          // 保存 Token
          $persistentStore.write(token, 'ql_token');
          $persistentStore.write(String(expires), 'ql_token_expires');

          const expireDate = new Date(expires).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });

          msg = `✅ Token 获取成功！\n\n📅 有效期至: ${expireDate}`;
          console.log(msg);
        } else {
          msg = `❌ 获取 Token 失败\n\n错误代码: ${result.code}\n错误信息: ${result.message || '未知错误'}`;

          if (result.code === 400) {
            msg += '\n\n💡 请检查:\n- Client ID 是否正确\n- Client Secret 是否正确\n- 应用权限是否包含"环境变量"';
          } else if (result.code === 401) {
            msg += '\n\n💡 认证失败，请检查 Client ID 和 Secret';
          }

          console.log(msg);
        }
      } catch (err) {
        msg = `❌ 解析响应失败\n\n错误: ${err.message || err}\n\n原始数据:\n${data}`;
        console.log(msg);
      }
    }

    // 发送通知
    $notification.post(SCRIPT_NAME, '', msg);
    $done({});
  });
}
