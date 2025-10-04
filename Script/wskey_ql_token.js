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

async function getToken() {
  const $ = new Env(SCRIPT_NAME);
  const messages = [];

  try {
    const baseUrl = ($.getdata('ql_url') || '').replace(/\/$/, '');
    const clientId = $.getdata('ql_client_id') || '';
    const clientSecret = $.getdata('ql_client_secret') || '';

    if (!baseUrl || !clientId || !clientSecret) {
      throw new Error('❌ 青龙面板配置不完整');
    }

    $.log('🔑 正在获取 Token...');

    const options = {
      url: `${baseUrl}/open/auth/token?client_id=${clientId}&client_secret=${clientSecret}`,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    };

    $httpClient.get(options, (error, response, data) => {
      try {
        if (error) {
          throw error;
        }

        const result = JSON.parse(data);

        if (result.code === 200 && result.data?.token) {
          const token = result.data.token;
          const expires = Date.now() + (6.5 * 24 * 60 * 60 * 1000);

          $.setdata(token, 'ql_token');
          $.setdata(String(expires), 'ql_token_expires');

          messages.push('✅ Token 获取成功');
          messages.push(`📅 有效期至: ${new Date(expires).toLocaleString()}`);
        } else {
          throw new Error(result.message || '获取失败');
        }
      } catch (err) {
        messages.push(`❌ 获取失败: ${err.message || err}`);
      } finally {
        const msg = messages.join('\n');
        $.log(msg);
        $notification.post(SCRIPT_NAME, '', msg);
        $.done();
      }
    });

  } catch (error) {
    const msg = `❌ ${error.message}`;
    $.log(msg);
    $notification.post(SCRIPT_NAME, '', msg);
    $.done();
  }
}

getToken();
