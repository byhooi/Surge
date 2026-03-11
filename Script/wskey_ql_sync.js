// 青龙面板 WSKEY 同步脚本 v1.8.4
const SCRIPT_NAME = '青龙 WSKEY 同步';
const SCRIPT_VERSION = '1.8.5';
const QL_API = {
  LOGIN: '/open/auth/token',
  ENVS: '/open/envs',
  ENV_UPDATE: '/open/envs'
};
const DEFAULT_TOKEN_VALIDITY_MS = 6.5 * 24 * 60 * 60 * 1000;
const REQUEST_INTERVAL = 300;
const PT_PIN_REGEX = /pt_pin=([^=;]+)(?=;|$)/i;
const PIN_REGEX = /pin=([^=;]+)(?=;|$)/i;

function wait(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractPtPin(source) {
  if (typeof source !== 'string' || source.length === 0) return '';
  const match = source.match(PT_PIN_REGEX) || source.match(PIN_REGEX);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function resolveTokenExpiration(data = {}) {
  const now = Date.now();
  const absoluteKeys = ['expiration', 'expiration_time', 'expirationTime', 'exp'];
  for (const key of absoluteKeys) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      if (String(value).trim().length >= 13 || num > 1e12) {
        return num;
      }
      if (num > 1e6) {
        return now + num;
      }
      return now + num * 1000;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  const relativeKeys = ['expires_in', 'expiresIn', 'expire_in', 'exp_in', 're_expire_in'];
  for (const key of relativeKeys) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      if (num > 1e6) {
        return now + num;
      }
      return now + num * 1000;
    }
  }

  return now + DEFAULT_TOKEN_VALIDITY_MS;
}

class QLPanel {
  constructor($) {
    this.$ = $;
    this.baseUrl = $.getdata('ql_url') || '';
    this.clientId = $.getdata('ql_client_id') || '';
    this.clientSecret = $.getdata('ql_client_secret') || '';
    this.token = $.getdata('ql_token') || '';
    this.tokenExpires = parseInt($.getdata('ql_token_expires') || '0', 10);
    this.lastRequestTime = 0;
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

  invalidateToken() {
    this.token = '';
    this.tokenExpires = 0;
    this.$.setdata('', 'ql_token');
    this.$.setdata('0', 'ql_token_expires');
  }

  async applyRequestThrottle() {
    if (REQUEST_INTERVAL <= 0) return;
    const now = Date.now();
    const waitTime = this.lastRequestTime + REQUEST_INTERVAL - now;
    if (waitTime > 0) {
      await wait(waitTime);
    }
    this.lastRequestTime = Date.now();
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
        this.tokenExpires = Math.floor(resolveTokenExpiration(response.data));

        this.$.setdata(this.token, 'ql_token');
        this.$.setdata(String(this.tokenExpires), 'ql_token_expires');

        const expireInHours = ((this.tokenExpires - Date.now()) / (60 * 60 * 1000)).toFixed(1);
        this.$.log(`✅ Token 获取成功，有效期约 ${expireInHours} 小时`);
        return true;
      } else {
        throw new Error(response?.message || '获取 Token 失败');
      }
    } catch (error) {
      this.invalidateToken();
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
      const response = await this.request(options, 'GET', false);
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
      const response = await this.request(options, 'POST', false);
      if (response?.code === 200) {
        return true;
      }
      throw new Error(response?.message || '添加环境变量失败');
    } catch (error) {
      this.$.log(`❌ 添加环境变量失败: ${error.message}`);
      throw error;
    }
  }

  // 更新环境变量 - 使用 PUT 方法直接更新
  async updateEnv(envItem, name, value, remarks = '') {
    await this.ensureToken();

    if (!envItem || typeof envItem !== 'object') {
      throw new Error('❌ 更新环境变量失败: envItem 必须是对象');
    }

    const envId = envItem.id || envItem._id;

    try {
      // 根据官方文档，请求体必须包含 id, name, value, remarks
      // status: 0 表示启用，确保更新后变量自动启用
      const updateBody = {
        id: envId,        // 必须使用 id 字段（不是 _id）
        name,
        value,
        remarks,
        status: 0
      };

      const options = {
        url: `${this.baseUrl}${QL_API.ENV_UPDATE}`,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        body: JSON.stringify(updateBody)  // 单个对象，不是数组
      };

      const response = await this.request(options, 'PUT', false);

      if (response?.code === 200) {
        // 更新成功后，如果变量被禁用，则启用它
        if (envItem.status === 1) {
          await this.enableEnv([envId]);
        }
        return true;
      }
      throw new Error(response?.message || '更新环境变量失败');
    } catch (error) {
      this.$.log(`❌ 更新环境变量失败: ${error.message}`);
      throw error;
    }
  }

  // 删除环境变量
  async deleteEnv(envItems) {
    await this.ensureToken();

    // 确保是数组格式
    const items = Array.isArray(envItems) ? envItems : [envItems];

    // 构造删除请求体: ID 字符串数组
    const deleteBody = items
      .map(item => {
        if (typeof item === 'object' && item !== null) {
          // 提取 _id 或 id
          const id = item._id || item.id;
          if (!id) {
            return null;
          }
          return String(id);
        }
        if (typeof item === 'string' && item) {
          return item;
        }
        return null;
      })
      .filter(Boolean);

    if (deleteBody.length === 0) {
      throw new Error('❌ 删除环境变量失败: 未找到有效的 ID');
    }

    const options = {
      url: `${this.baseUrl}${QL_API.ENVS}`,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify(deleteBody)
    };

    try {
      const response = await this.request(options, 'DELETE', false);
      if (response?.code === 200) {
        return true;
      }
      throw new Error(response?.message || '删除环境变量失败');
    } catch (error) {
      this.$.log(`❌ 删除环境变量失败: ${error.message}`);
      throw error;
    }
  }

  // 启用环境变量
  async enableEnv(envIds) {
    await this.ensureToken();

    // 确保是数组格式
    const ids = Array.isArray(envIds) ? envIds : [envIds];

    const options = {
      url: `${this.baseUrl}${QL_API.ENVS}/enable`,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify(ids)
    };

    try {
      const response = await this.request(options, 'PUT', false);
      if (response?.code === 200) {
        return true;
      }
      throw new Error(response?.message || '启用环境变量失败');
    } catch (error) {
      this.$.log(`❌ 启用环境变量失败: ${error.message}`);
      throw error;
    }
  }

  // HTTP 请求封装
  async request(options, method = 'GET', debug = false, allowRetry = true) {
    const requestOptions = {
      ...options,
      method
    };
    requestOptions.headers = {
      ...(options.headers || {})
    };

    const methodName = method.toLowerCase();
    const requester = this.$.$httpClient[methodName];
    if (typeof requester !== 'function') {
      throw new Error(`❌ 不支持的请求方法: ${method}`);
    }

    if (debug) {
      this.$.log(`🔍 调试 - 请求方法: ${method}, URL: ${requestOptions.url}`);
      if (requestOptions.body) {
        this.$.log(`🔍 调试 - 请求 Body: ${requestOptions.body}`);
      }
    }

    await this.applyRequestThrottle();

    const { status, body, rawBody } = await new Promise((resolve, reject) => {
      const callback = (error, response, data) => {
        if (error) {
          return reject(error);
        }

        let parsed = data;
        if (typeof data === 'string') {
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
        }

        if (debug) {
          this.$.log(`🔍 调试 - 响应状态: ${response?.status || response?.statusCode || '未知'}`);
          this.$.log(`🔍 调试 - 响应数据: ${typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed)}`);
        }

        resolve({
          status: response?.status ?? response?.statusCode ?? 0,
          body: parsed,
          rawBody: data
        });
      };

      try {
        requester.call(this.$.$httpClient, requestOptions, callback);
      } catch (invokeError) {
        reject(invokeError);
      }
    }).catch(error => {
      if (debug) {
        this.$.log(`🔍 调试 - 请求异常: ${error.message || JSON.stringify(error)}`);
      } else {
        this.$.log(`❌ 请求失败: ${error.message || error}`);
      }
      throw error;
    });

    const code = (body && typeof body === 'object') ? body.code : undefined;
    const hadToken = Boolean(this.token);
    if ((status && [400, 401].includes(status)) || [400, 401].includes(code)) {
      if (allowRetry && hadToken) {
        this.$.log('🔄 检测到 Token 失效，尝试重新获取...');
        this.invalidateToken();
        await this.ensureToken();
        if (this.token) {
          requestOptions.headers.Authorization = `Bearer ${this.token}`;
          return this.request(requestOptions, method, debug, false);
        }
      }
      if (!hadToken) {
        this.$.log('⚠️ 青龙认证失败，请确认 Client ID 与 Client Secret 配置是否正确');
      }
      this.invalidateToken();
      const message = (body && typeof body === 'object' && body.message) ? body.message : '请求未授权';
      const error = new Error(message);
      error.status = status;
      error.response = body ?? rawBody;
      throw error;
    }

    if (code && code !== 200 && !debug) {
      this.$.log(`⚠️ 接口返回异常 code=${code}: ${body?.message || '未知错误'}`);
    }

    return body;
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

  $.log(`📌 脚本版本: ${SCRIPT_VERSION}`);

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
      const pinFromCookie = extractPtPin(envValue);
      const compareKey = pinFromCookie || userName;
      const envRemarks = `${compareKey || userName} - 由 Surge 同步`;

      // 查找是否存在相同 pt_pin 的环境变量
      const existingEnv = existingEnvs.find(env => {
        const envKey = extractPtPin(env.value) || extractPtPin(env.remarks) || (typeof env.remarks === 'string' ? env.remarks.split(' - ')[0] : '');
        return envKey && compareKey && envKey === compareKey;
      });

      if (existingEnv) {
        // 检查值是否相同
        if (existingEnv.value === envValue) {
          $.log(`⏭️ 跳过 ${compareKey}: 值未变化`);
          skipCount++;
        } else {
          // 更新环境变量
          $.log(`🔄 更新 ${compareKey}...`);
          await ql.updateEnv(existingEnv, envName, envValue, envRemarks);
          $.log(`✅ 更新成功: ${compareKey}`);
          updateCount++;
        }
      } else {
        // 添加新的环境变量
        $.log(`➕ 添加 ${compareKey}...`);
        await ql.addEnv(envName, envValue, envRemarks);
        $.log(`✅ 添加成功: ${compareKey}`);
        addCount++;
      }

      // 避免请求过快
      await wait(500);
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
