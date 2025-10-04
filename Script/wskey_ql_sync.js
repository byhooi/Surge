// 青龙面板 WSKEY 同步脚本
const SCRIPT_NAME = '青龙 WSKEY 同步';
const QL_API = {
  LOGIN: '/open/auth/token',
  ENVS: '/open/envs',
  ENV_UPDATE: '/open/envs'
};

class QLPanel {
  constructor($) {
    this.$ = $;
    this.baseUrl = $.getdata('ql_url') || '';
    this.clientId = $.getdata('ql_client_id') || '';
    this.clientSecret = $.getdata('ql_client_secret') || '';
    this.token = $.getdata('ql_token') || '';
    this.tokenExpires = parseInt($.getdata('ql_token_expires') || '0');
  }

  // 检查配置是否完整
  checkConfig() {
    if (!this.baseUrl || !this.clientId || !this.clientSecret) {
      throw new Error('❌ 青龙面板配置不完整，请检查配置');
    }
    // 移除末尾的斜杠
    this.baseUrl = this.baseUrl.replace(/\/$/, '');
  }

  // 检查 Token 是否有效
  isTokenValid() {
    return this.token && this.tokenExpires > Date.now();
  }

  // 获取 Token
  async getToken() {
    this.$.log('🔑 正在获取青龙面板 Token...');

    const options = {
      url: `${this.baseUrl}${QL_API.LOGIN}?client_id=${this.clientId}&client_secret=${this.clientSecret}`,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    };

    try {
      const response = await this.request(options);

      if (response?.code === 200 && response?.data?.token) {
        this.token = response.data.token;
        // Token 有效期为 7 天，这里设置为 6.5 天后过期
        this.tokenExpires = Date.now() + (6.5 * 24 * 60 * 60 * 1000);

        this.$.setdata(this.token, 'ql_token');
        this.$.setdata(String(this.tokenExpires), 'ql_token_expires');

        this.$.log('✅ Token 获取成功');
        return true;
      } else {
        throw new Error(response?.message || '获取 Token 失败');
      }
    } catch (error) {
      this.$.log(`❌ 获取 Token 失败: ${error.message}`);
      throw error;
    }
  }

  // 确保 Token 有效
  async ensureToken() {
    if (!this.isTokenValid()) {
      await this.getToken();
    }
  }

  // 获取环境变量列表
  async getEnvs(searchValue = '') {
    await this.ensureToken();

    const options = {
      url: `${this.baseUrl}${QL_API.ENVS}?searchValue=${encodeURIComponent(searchValue)}`,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    };

    try {
      const response = await this.request(options);
      if (response?.code === 200) {
        return response.data || [];
      }
      throw new Error(response?.message || '获取环境变量失败');
    } catch (error) {
      this.$.log(`❌ 获取环境变量失败: ${error.message}`);
      throw error;
    }
  }

  // 添加环境变量
  async addEnv(name, value, remarks = '') {
    await this.ensureToken();

    const options = {
      url: `${this.baseUrl}${QL_API.ENVS}`,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify([{
        name: name,
        value: value,
        remarks: remarks
      }])
    };

    try {
      const response = await this.request(options, 'POST');
      if (response?.code === 200) {
        return true;
      }
      throw new Error(response?.message || '添加环境变量失败');
    } catch (error) {
      this.$.log(`❌ 添加环境变量失败: ${error.message}`);
      throw error;
    }
  }

  // 更新环境变量
  async updateEnv(envItem, name, value, remarks = '') {
    await this.ensureToken();

    // 调试日志：打印原始数据
    this.$.log(`🔍 调试 - 原始 envItem: ${JSON.stringify(envItem)}`);

    // 青龙更新接口需要发送完整的环境变量对象
    const payload = {
      value: value,
      name: name,
      remarks: remarks || ''
    };

    const identifier = envItem && typeof envItem === 'object' ? envItem : null;

    // 优先使用 _id（MongoDB ObjectId），否则使用 id（数值型）
    if (identifier) {
      if (identifier._id) {
        // 使用 _id（字符串格式的 MongoDB ObjectId）
        payload._id = String(identifier._id);
      } else if (identifier.id !== undefined && identifier.id !== null) {
        // 使用 id（数值或字符串）
        const idValue = identifier.id;
        if (typeof idValue === 'number') {
          payload.id = idValue;
        } else if (typeof idValue === 'string') {
          const trimmed = idValue.trim();
          // 如果是纯数字字符串，转为数字
          if (/^\d+$/.test(trimmed)) {
            payload.id = Number(trimmed);
          } else {
            payload.id = trimmed;
          }
        }
      }
    } else if (envItem !== undefined && envItem !== null) {
      if (typeof envItem === 'string') {
        const trimmed = envItem.trim();
        if (/^[0-9a-fA-F]{24}$/.test(trimmed)) {
          payload._id = trimmed;
        } else if (/^\d+$/.test(trimmed)) {
          payload.id = Number(trimmed);
        } else if (trimmed) {
          payload.id = trimmed;
        }
      } else if (typeof envItem === 'number') {
        payload.id = envItem;
      } else if (envItem !== null) {
        payload.id = String(envItem);
      }
    }

    if (!payload._id && payload.id === undefined) {
      throw new Error('❌ 更新环境变量失败: 未找到变量 ID');
    }

    // 调试日志：打印完整的 payload
    this.$.log(`🔍 调试 - 更新 payload: ${JSON.stringify(payload)}`);

    const options = {
      url: `${this.baseUrl}${QL_API.ENV_UPDATE}`,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify(payload)
    };

    try {
      const response = await this.request(options, 'PUT');
      this.$.log(`🔍 调试 - 响应: ${JSON.stringify(response)}`);
      if (response?.code === 200) {
        return true;
      }
      throw new Error(response?.message || '更新环境变量失败');
    } catch (error) {
      this.$.log(`❌ 更新失败详情: ${error.message}`);
      this.$.log(`🔍 调试 - 错误对象: ${JSON.stringify(error)}`);
      throw error;
    }
  }

  // HTTP 请求封装
  async request(options, method = 'GET') {
    return new Promise((resolve, reject) => {
      options.method = method;

      const callback = (error, response, data) => {
        if (error) {
          reject(error);
        } else {
          try {
            const result = typeof data === 'string' ? JSON.parse(data) : data;
            resolve(result);
          } catch (e) {
            resolve(data);
          }
        }
      };

      if (method === 'GET') {
        this.$.$httpClient.get(options, callback);
      } else if (method === 'POST') {
        this.$.$httpClient.post(options, callback);
      } else if (method === 'PUT') {
        options.method = 'PUT';
        this.$.$httpClient.post(options, callback);
      }
    });
  }
}

// Env 环境类（复用 wskey.js 中的）
function Env(name) {
  this.name = name;
  this.logs = [];
  this.startTime = Date.now();
  this.$httpClient = $httpClient;
  this.log("", `🔔${this.name}, 开始!`);
}

Env.prototype.log = function (...messages) {
  if (messages.length === 0) return;
  this.logs.push(...messages);
  console.log(messages.join('\n'));
};

Env.prototype.logErr = function (err) {
  const errorMessage = err?.stack || err?.message || String(err);
  this.log("", `❗️${this.name}, 错误!`, errorMessage);
};

Env.prototype.getdata = function (key) {
  return $persistentStore.read(key);
};

Env.prototype.setdata = function (val, key) {
  return $persistentStore.write(val, key);
};

Env.prototype.getjson = function (key, defaultValue = null) {
  const data = this.getdata(key);
  if (!data) return defaultValue;
  try {
    return JSON.parse(data);
  } catch {
    return defaultValue;
  }
};

Env.prototype.setjson = function (obj, key) {
  try {
    return this.setdata(JSON.stringify(obj), key);
  } catch {
    return false;
  }
};

Env.prototype.done = function () {
  const endTime = Date.now();
  const duration = ((endTime - this.startTime) / 1000).toFixed(2);
  this.log("", `🔔${this.name}, 结束! 🕛 ${duration} 秒`);
  $done();
};

// 主函数
async function main() {
  const $ = new Env(SCRIPT_NAME);
  const messages = [];

  try {
    // 获取 WSKEY 列表
    const wskeyList = $.getjson('wskeyList') || [];

    if (!wskeyList || wskeyList.length === 0) {
      messages.push('⚠️ 没有需要同步的 WSKEY');
      return;
    }

    $.log(`📦 共有 ${wskeyList.length} 个 WSKEY 需要同步`);

    // 初始化青龙面板客户端
    const ql = new QLPanel($);
    ql.checkConfig();

    // 获取现有的环境变量
    $.log('🔍 正在查询青龙面板中的现有变量...');
    const existingEnvs = await ql.getEnvs('JD_WSCK');

    let addCount = 0;
    let updateCount = 0;
    let skipCount = 0;

    // 遍历同步每个 WSKEY
    for (const item of wskeyList) {
      const { userName, cookie } = item;

      if (!userName || !cookie) {
        $.log(`⚠️ 跳过无效数据: ${JSON.stringify(item)}`);
        skipCount++;
        continue;
      }

      const envName = 'JD_WSCK';
      const envValue = cookie;
      const envRemarks = `${userName} - 由 Surge 同步`;

      // 查找是否存在相同 pt_pin 的环境变量
      const existingEnv = existingEnvs.find(env =>
        env.remarks && env.remarks.includes(userName)
      );

      if (existingEnv) {
        // 检查值是否相同
        if (existingEnv.value === envValue) {
          $.log(`⏭️ 跳过 ${userName}: 值未变化`);
          skipCount++;
        } else {
          // 更新环境变量
          $.log(`🔄 更新 ${userName}...`);
          await ql.updateEnv(existingEnv, envName, envValue, envRemarks);
          $.log(`✅ 更新成功: ${userName}`);
          updateCount++;
        }
      } else {
        // 添加新的环境变量
        $.log(`➕ 添加 ${userName}...`);
        await ql.addEnv(envName, envValue, envRemarks);
        $.log(`✅ 添加成功: ${userName}`);
        addCount++;
      }

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 统计结果
    messages.push('🎉 同步完成!');
    messages.push(`📊 新增: ${addCount} | 更新: ${updateCount} | 跳过: ${skipCount}`);

  } catch (error) {
    $.logErr(error);
    messages.push(`❌ 同步失败: ${error.message}`);
  } finally {
    // 发送通知
    if (messages.length > 0) {
      const msg = messages.join('\n');
      $.log(msg);
      $notification.post(SCRIPT_NAME, '', msg);
    }
    $.done();
  }
}

// 执行脚本
main().catch(err => {
  console.log(`❌ 脚本执行出错: ${err.message || err}`);
  $done();
});
