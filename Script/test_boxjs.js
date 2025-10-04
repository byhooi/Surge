// BoxJS 测试脚本
const msg = '✅ BoxJS 脚本执行成功！\n\n当前时间: ' + new Date().toLocaleString('zh-CN');

console.log(msg);
$notification.post('BoxJS 测试', '', msg);
$done();
