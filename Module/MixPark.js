// 用于自动签到和监控 Token 的 Surge 脚本
const $ = {
  name: 'Wox Auto SignIn',
  setdata: function(val, key) {
      return $persistentStore.write(val, key);
  },
  getdata: function(key) {
      return $persistentStore.read(key);
  },
  msg: function(title, subtitle, message) {
      $notification.post(title, subtitle, message);
  },
  log: function(msg) {
      console.log(`[${this.name}] ${msg}`);
  }
};

// 配置项
const config = {
  title: 'Wox签到',
  storage_key: 'wox_token_info',
  headers_key: 'wox_headers_info',
  host: 'wox2019.woxshare.com'
};

// Token 监控函数
async function tokenMonitor() {
  try {
      if ($request && $request.body) {
          // 第一次运行时保存固定的请求头信息
          if (!$.getdata(config.headers_key)) {
              const headers = {
                  'openid': $request.headers['openid'],
                  'content-type': $request.headers['content-type'],
                  'mkey': $request.headers['mkey'],
                  'version': $request.headers['version'],
                  'bid': $request.headers['bid'],
                  'oid': $request.headers['oid'],
                  'gid': $request.headers['gid']
              };
              $.setdata(JSON.stringify(headers), config.headers_key);
              $.log('已保存固定请求头信息');
          }
          
          // 解析并保存变化的请求体信息
          const requestBody = JSON.parse($request.body);
          const newTokenInfo = {
              token: requestBody.token || '',
              mkey: requestBody.mkey || '',
              mkeyUrl: requestBody.mkeyUrl || '',
              version: requestBody.version || '',
              bid: requestBody.bid || ''
          };
          
          let oldTokenInfo = $.getdata(config.storage_key);
          let isChanged = false;
          
          if (oldTokenInfo) {
              try {
                  oldTokenInfo = JSON.parse(oldTokenInfo);
                  if (oldTokenInfo.token !== newTokenInfo.token || 
                      oldTokenInfo.mkey !== newTokenInfo.mkey) {
                      isChanged = true;
                  }
              } catch (e) {
                  isChanged = true;
              }
          } else {
              isChanged = true;
          }
          
          if (isChanged) {
              $.setdata(JSON.stringify(newTokenInfo), config.storage_key);
              const notify_body = `Token已更新！\nToken: ${newTokenInfo.token.slice(0, 15)}...\nMkey: ${newTokenInfo.mkey.slice(0, 15)}...\n时间: ${new Date().toLocaleString()}`;
              $.msg(config.title, '令牌已更新', notify_body);
              $.log('Token信息已更新并通知');
          }
      }
  } catch (e) {
      $.log(`Token监控异常: ${e.message}`);
      $.msg(config.title, '❌ Token监控异常', e.message);
  } finally {
      $done({});
  }
}

// 签到函数
async function autoSignIn() {
  try {
      // 获取存储的token信息和请求头信息
      const tokenInfo = $.getdata(config.storage_key);
      const headersInfo = $.getdata(config.headers_key);
      
      if (!tokenInfo || !headersInfo) {
          throw new Error('未找到Token或请求头信息，请先运行一次签到以获取信息');
      }
      
      const tokenData = JSON.parse(tokenInfo);
      const headersData = JSON.parse(headersInfo);
      
      // 构建签到请求体
      const reqBody = {
          token: tokenData.token,
          version: tokenData.version,
          bid: tokenData.bid,
          mkeyUrl: tokenData.mkeyUrl,
          mkey: tokenData.mkey
      };
      
      // 构建请求头 (使用保存的固定请求头)
      const headers = {
          ...headersData,
          'ts': Math.floor(Date.now() / 1000),
          'token': tokenData.token  // token 需要使用最新的
      };
      
      // 发起签到请求
      const myRequest = {
          url: `https://${config.host}/clientApi/signInRecordAdd`,
          headers: headers,
          body: JSON.stringify(reqBody)
      };
      
      // 发送请求
      $httpClient.post(myRequest, (error, response, data) => {
          if (error) {
              $.msg(config.title, '❌ 签到失败', error);
              $.log(`签到失败: ${error}`);
              $done();
              return;
          }
          
          try {
              const result = JSON.parse(data);
              if (result.errCode === 0) {
                  const detail = result.detail;
                  const message = `签到成功！\n本次获得积分：${detail.integral}\n总积分：${detail.totalIntegral}\n连续签到：${detail.signDays}天`;
                  $.msg(config.title, '✅ 签到成功', message);
                  $.log(message);
              } else {
                  $.msg(config.title, '❌ 签到失败', result.errMsg);
                  $.log(`签到失败: ${result.errMsg}`);
              }
          } catch (e) {
              $.msg(config.title, '❌ 解析响应失败', e.message);
              $.log(`解析响应失败: ${e.message}`);
          }
          
          $done();
      });
      
  } catch (e) {
      $.msg(config.title, '❌ 签到异常', e.message);
      $.log(`签到异常: ${e.message}`);
      $done();
  }
}

// 脚本入口
!(async () => {
  if (typeof $request !== 'undefined') {
      await tokenMonitor();
  } else {
      await autoSignIn();
  }
})();