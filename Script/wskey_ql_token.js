// 单独获取青龙 Token 的脚本
const SCRIPT_NAME = '获取青龙 Token';

function Env(name) {
  this.name = name;
  this.startTime = Date.now();
  this.log("", `🔔${this.name}, 开始!`);
}

Env.prototype.log = function (...messages) {
  console.log(messages.join('\n'));
};

Env.prototype.getdata = function (key) {
  return $persistentStore.read(key);
};

Env.prototype.setdata = function (val, key) {
  return $persistentStore.write(val, key);
};

Env.prototype.done = function () {
  const endTime = Date.now();
  const duration = ((endTime - this.startTime) / 1000).toFixed(2);
  this.log("", `🔔${this.name}, 结束! 🕛 ${duration} 秒`);
  $done();
};

const $ = new Env(SCRIPT_NAME);
const messages = [];

(async () => {
  try {
    const baseUrl = ($.getdata('ql_url') || '').replace(/\/$/, '');
    const clientId = $.getdata('ql_client_id') || '';
    const clientSecret = $.getdata('ql_client_secret') || '';

    if (!baseUrl || !clientId || !clientSecret) {
      messages.push('❌ 青龙面板配置不完整');
      messages.push('请填写：');
      messages.push('1. 青龙面板地址');
      messages.push('2. Client ID');
      messages.push('3. Client Secret');
      return;
    }

    $.log(`🔑 正在获取 Token...`);
    $.log(`📍 地址: ${baseUrl}`);

    const options = {
      url: `${baseUrl}/open/auth/token?client_id=${clientId}&client_secret=${clientSecret}`,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    };

    await new Promise((resolve) => {
      $httpClient.get(options, (error, response, data) => {
        try {
          if (error) {
            $.log(`❌ 网络错误: ${error}`);
            messages.push(`❌ 网络错误: ${error.message || error}`);
            resolve();
            return;
          }

          $.log(`📦 响应状态: ${response.status}`);
          $.log(`📄 响应数据: ${data}`);

          const result = JSON.parse(data);

          if (result.code === 200 && result.data?.token) {
            const token = result.data.token;
            const expires = Date.now() + (6.5 * 24 * 60 * 60 * 1000);

            $.setdata(token, 'ql_token');
            $.setdata(String(expires), 'ql_token_expires');

            messages.push('✅ Token 获取成功');
            messages.push(`📅 有效期至: ${new Date(expires).toLocaleString('zh-CN')}`);
            $.log('✅ Token 已保存');
          } else {
            messages.push(`❌ 获取失败: ${result.message || '未知错误'}`);
            messages.push(`📋 错误代码: ${result.code}`);
            if (result.code === 400) {
              messages.push('💡 提示: 请检查 Client ID 和 Secret 是否正确');
            }
          }
        } catch (err) {
          $.log(`❌ 解析错误: ${err}`);
          messages.push(`❌ 解析错误: ${err.message || err}`);
          messages.push(`原始数据: ${data}`);
        }
        resolve();
      });
    });

  } catch (error) {
    $.log(`❌ 脚本错误: ${error}`);
    messages.push(`❌ 脚本错误: ${error.message || error}`);
  }
})()
  .catch(err => {
    $.log(`❌ 执行错误: ${err}`);
    messages.push(`❌ 执行错误: ${err.message || err}`);
  })
  .finally(() => {
    const msg = messages.join('\n');
    $.log(`\n=== 最终结果 ===\n${msg}`);
    $notification.post(SCRIPT_NAME, '', msg);
    $.done();
  });
