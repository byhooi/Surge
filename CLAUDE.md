# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 Surge 脚本和模块的集合仓库，提供 HTTP 拦截、数据提取和自动化同步功能。主要用于：
1. **京东账号管理** - 自动获取 WSKEY/Cookie 并同步到青龙面板
2. **跳绳统计** - 分析运动数据并判定考核结果
3. **通用 Token 管理** - 自动捕获和存储 HTTP 请求中的 Token

核心设计模式：`Surge 拦截 → 数据提取 → 持久化存储 (BoxJS) → 远程同步 (可选)`

## 核心架构

### 1. 目录结构

- **Module/** - Surge 模块文件 (`.sgmodule`)，定义 HTTP 拦截规则和脚本绑定
- **Script/** - JavaScript 脚本文件，实现具体业务逻辑
- **boxjs/** - BoxJS 配置文件 (`byhooi.boxjs.json`)，提供 Web UI 配置界面
- **Rule/** - Surge/Clash 规则列表文件
- **icon/** - 图标资源
- **Backup/** - 各目录下的旧版本或备用脚本（不再维护）

### 2. 工作流程

```
Surge 拦截请求 (.sgmodule)
    ↓
提取凭证 (wskey.js / jdcookie.js)
    ↓
存储到 BoxJS ($persistentStore)
    ↓
同步到青龙面板 (*_ql_sync.js)
```

### 3. 主要功能模块

#### A. WSKEY 管理流程（京东账号管理）
1. **wskey.sgmodule** - 定义拦截规则:
   - `blackhole.m.jd.com/bypass` - 获取 wskey
   - `mars.jd.com/log/sdk/v2` - 获取 pt_pin
2. **wskey.js** - 从请求中提取并存储 WSKEY
   - 使用缓存机制 (`jd_temp`) 收集分散在不同请求中的数据
   - 数据完整后自动组合为完整 Cookie
3. **wskey_ql_sync.js** - 同步到青龙面板 (环境变量名: `JD_WSCK`)
4. **wskey_ql_token.js** - 管理青龙 API Token
5. **wskey_clear.js** - 清空本地存储

#### B. Cookie 管理流程（京东 Cookie 同步）
1. **jdcookie.sgmodule** - 定义拦截规则
2. **jdcookie.js** - 提取并存储 Cookie
3. **jdcookie_ql_sync.js** - 同步到青龙面板 (环境变量名: `JD_COOKIE`)
4. **jdcookie_ql_token.js** - Token 管理
5. **jdcookie_clear.js** - 清空操作

#### C. VideoUrl 跳绳统计（独立功能）
1. **VideoUrl.sgmodule** - 拦截 `a.yufanai.cn/cloudSports/recordsByPage` 响应
2. **VideoUrl.js** - 分析运动记录并判定考核结果
   - 从 BoxJS 读取自定义阈值（可选，有默认值）
   - 计算总跳绳数、总时间、合格次数
   - 判定规则：有优秀成绩可减少 1 次合格要求
   - 通过 `$notification.post()` 推送结果

#### D. 通用 Token 捕获（bsh.js）
- 自动检测 HTTP 请求头中的 `token` 字段变化
- 持久化存储到 BoxJS 的 `token` key

### 4. 青龙面板集成

**API 架构** (QLPanel 类):
- `/open/auth/token` - 获取访问令牌 (有效期 7 天)
- `/open/envs` - CRUD 环境变量

**同步逻辑**:
1. 检查 Token 有效性，过期则自动刷新
2. 查询现有环境变量 (通过 `searchValue` 参数过滤)
3. 根据 `pt_pin` 判断是新增还是更新:
   - 新用户 → POST 创建新变量
   - 已存在且值变化 → PUT 更新变量 (使用 `_id`)
   - 值未变化 → 跳过

**环境变量格式**:
- WSKEY: `pin=用户名; wskey=xxxxx;` (备注: `用户名 - 由 Surge 同步`)
- Cookie: `pt_key=xxx;pt_pin=xxx;` (备注: `用户名 - 由 Surge 同步`)

### 5. BoxJS 配置系统

**byhooi.boxjs.json** 定义四个应用:
- `byhooi_jdcookie_ql` - Cookie 同步配置
- `byhooi_wskey_ql` - WSKEY 同步配置
- `byhooi_videourl_config` - 跳绳统计阈值配置
- `bsh_token_manager` - 伴生活 Token 管理

**京东同步应用的共享配置项**:
- `ql_url` - 青龙面板地址
- `ql_client_id` / `ql_client_secret` - API 凭证
- `auto_sync_*` - 自动同步开关
- `*_sync_interval` - 同步间隔 (分钟)

**VideoUrl 配置项**:
- `DEFAULT_REQUIRED_QUALIFIED_COUNT` - 默认合格次数 (默认: 3)
- `QUALIFIED_THRESHOLD` - 达标阈值 (默认: 195)
- `EXCELLENT_THRESHOLD` - 优秀阈值 (默认: 200)

**配置读取机制**:
- 所有脚本通过 `$persistentStore.read(key)` 读取 BoxJS 配置
- 支持 fallback 机制：BoxJS 不可用时使用脚本内硬编码的默认值
- 跨平台兼容：同时支持 Surge (`$persistentStore`) 和 Quantumult X (`$prefs`)

## 开发指南

### Git 提交规范

根据最近提交历史，使用以下前缀:
- `feat:` - 新功能
- `fix:` - Bug 修复
- `refactor:` - 代码重构
- `debug:` - 调试相关
- `chore:` - 构建/工具相关

### 脚本开发规范

#### 1. 代码组织结构
所有脚本遵循统一的文件组织：
```javascript
// 1. 常量定义（顶部）
const SCRIPT_NAME = '脚本名称';
const SCRIPT_VERSION = '版本号';
const CONFIG_KEY = 'config_key';

// 2. 工具函数/类定义
function Env(name, options = {}) { /* ... */ }
class QLPanel { /* ... */ }

// 3. 脚本初始化
const $ = new Env(SCRIPT_NAME, { version: SCRIPT_VERSION });

// 4. 主逻辑（IIFE 包裹）
!(async () => {
  // 业务逻辑
})()
  .catch(e => $.logErr(e))
  .finally(() => $.done());
```

#### 2. 环境抽象层（Env 类）
用于封装 Surge/Quantumult X API 差异：
- `getdata(key)` / `setdata(val, key)` - 持久化存储
- `getjson(key)` / `setjson(obj, key)` - JSON 存储
- `log()` / `logErr()` - 日志输出
- `wait(ms)` - 延迟执行
- `done()` - 脚本结束

**实现参考**: Script/wskey.js:14-132

#### 3. 青龙面板集成（QLPanel 类）
封装青龙 OpenAPI 交互逻辑：
- `checkConfig()` - 验证配置完整性
- `ensureToken()` - 自动刷新过期 Token
- `getEnvs(searchValue)` - 查询环境变量
- `createEnv(data)` - 创建环境变量
- `updateEnv(id, data)` - 更新环境变量

**关键方法**:
```javascript
async ensureToken() {
  if (!this.isTokenValid()) {
    await this.login(); // 自动刷新
  }
}
```

**实现参考**: Script/wskey_ql_sync.js:69-180

#### 4. 配置读取模式
脚本应支持无 BoxJS 运行，使用 fallback 机制：
```javascript
function readNumberSetting(key, fallback) {
  const rawValue = readPersistentValue(key);
  if (rawValue === undefined || rawValue === null) {
    return fallback; // 返回默认值
  }
  // 类型转换逻辑...
}
```

**实现参考**: Script/VideoUrl.js:151-186

### 关键注意事项

#### 1. 编码问题
`pt_pin` 值需要 URL 解码，避免双重编码：
```javascript
const decodedPin = decodeURIComponent(ptPin);
const cookie = `pin=${encodeURIComponent(decodedPin)}; wskey=${wskey};`;
```
**参考**: Script/wskey.js:149-154

#### 2. 青龙 API 格式
- PUT 更新使用 `_id` 字段（从 GET 查询结果中获取）
- 启用变量需设置 `status: 0`
- API 返回格式: `{ code, data, message }`
- Token 有效期 7 天，脚本设置 6.5 天自动刷新

#### 3. 缓存机制
京东脚本使用临时缓存收集分散数据：
```javascript
// wskey 和 pt_pin 可能来自不同的 HTTP 请求
$.jd_temp = { wskey: 'xxx', pt_pin: 'yyy', ts: Date.now() };
// 缓存有效期 15 秒
if (Date.now() - $.jd_temp.ts >= 15000) {
  $.jd_temp = {}; // 清理过期缓存
}
```
**参考**: Script/wskey.js:4-9, 206-209

#### 4. 脚本类型识别
- **type=http-request** - 拦截请求（如 wskey.js 提取请求头）
- **type=http-response** - 拦截响应（如 VideoUrl.js 分析响应体）
- **requires-body=1** - 需要完整请求/响应体

#### 5. 版本管理
所有脚本必须定义 `SCRIPT_VERSION` 常量，用于：
- 日志输出中的版本标识
- 用户通知中的版本显示
- 问题排查时的版本追溯

### 测试调试

#### 本地调试
1. 修改脚本中的 `is_debug` 配置启用详细日志：
   ```javascript
   const IS_DEBUG = $.getdata('is_debug') || 'false';
   ```
2. 在 BoxJS 中手动触发按钮测试同步功能
3. 查看 Surge 日志 (首页 → 最近请求) 了解 HTTP 拦截详情

#### 远程调试
- 修改脚本后需提交到 GitHub
- `.sgmodule` 和 `byhooi.boxjs.json` 引用的是 GitHub raw 链接
- 等待 CDN 缓存刷新（约 5 分钟）或使用版本参数强制刷新

## 文件引用和同步

### GitHub Raw 链接引用
脚本通过 GitHub raw 链接在 `.sgmodule` 和 `byhooi.boxjs.json` 中引用：
```
https://raw.githubusercontent.com/byhooi/Surge/main/Script/xxx.js
```

**重要提示**:
- 修改脚本后需提交到 GitHub 才能在 Surge 中生效
- Surge 会缓存远程脚本，修改后可能需要手动更新模块
- BoxJS 订阅链接也指向 GitHub raw 文件

### 模块配置格式
`.sgmodule` 文件包含三个关键部分：
1. **元信息** - `#!name`, `#!desc`, `#!category`, `#!system`
2. **[Script]** - 定义拦截规则和脚本绑定
3. **[MITM]** - 声明需要中间人拦截的域名

示例 (Module/wskey.sgmodule):
```ini
#!name=京东 Wskey
#!desc=自动获取京东 Wskey
#!category=🎈 Bingo
#!system=ios

[Script]
京东 WSKEY = type=http-request,pattern=^https:\/\/blackhole\.m\.jd\.com\/bypass,requires-body=1,script-path=https://raw.githubusercontent.com/byhooi/Surge/main/Script/wskey.js

[MITM]
hostname = %APPEND% blackhole.m.jd.com, mars.jd.com
```

### BoxJS 应用配置
`byhooi.boxjs.json` 的 `apps` 数组定义应用：
- **id** - 唯一标识符
- **name** - 显示名称
- **keys** - 持久化存储的 key 列表
- **settings** - 用户可配置项（type: text/number/boolean/textarea）
- **scripts** - 手动触发按钮（name + script URL）

**配置项类型**:
- `text` - 单行文本输入
- `number` - 数字输入
- `boolean` - 开关
- `textarea` - 多行文本（支持 `autoGrow` 和 `rows` 属性）

## 常见开发任务

### 创建新的拦截脚本
1. 在 `Script/` 目录创建 `.js` 文件
2. 在 `Module/` 目录创建对应 `.sgmodule` 文件
3. 在 `byhooi.boxjs.json` 的 `apps` 数组添加配置项（如需 Web UI）
4. 提交到 GitHub
5. 在 Surge 中安装模块测试

### 修改青龙同步逻辑
青龙相关代码集中在 `*_ql_sync.js` 和 `QLPanel` 类中：
- 修改 API 交互逻辑 → 更新 `QLPanel` 类方法
- 修改环境变量格式 → 更新 `syncToQL()` 函数
- 修改 Token 刷新策略 → 更新 `ensureToken()` 方法

### 修改 BoxJS 配置
1. 编辑 `boxjs/byhooi.boxjs.json`
2. 添加/修改 `settings` 数组中的配置项
3. 在脚本中使用 `$.getdata(key)` 读取新配置
4. 提交到 GitHub
5. 用户在 BoxJS 中重新订阅以获取最新配置

### 调整拦截规则
1. 找到对应的 `.sgmodule` 文件
2. 修改 `pattern` 正则表达式
3. 确认 `hostname` 包含目标域名
4. 提交后在 Surge 中重新加载模块
