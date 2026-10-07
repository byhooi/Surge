// 清空京东 Cookie 列表的脚本
const SCRIPT_NAME = '清空 Cookie';

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

const $ = new Env(SCRIPT_NAME);

try {
  const jdCookieList = $.getjson('jdCookieList') || [];
  const count = jdCookieList.length;

  $.setjson([], 'jdCookieList');
  $.setdata('', 'jd_cookie_temp');
  $.setdata('', 'jd_cookie_notify_lock');

  const msg = `✅ 已清空 ${count} 个 Cookie`;
  $.log(msg);
  $notification.post(SCRIPT_NAME, '', msg);
} catch (error) {
  const msg = `❌ 清空失败: ${error.message}`;
  $.log(msg);
  $notification.post(SCRIPT_NAME, '', msg);
}

$.done();
