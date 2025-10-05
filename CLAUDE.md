# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 Surge 脚本和模块的集合仓库，主要用于京东账号管理和自动化同步。核心功能是通过 Surge 拦截京东请求获取 WSKEY 和 Cookie，并自动同步到青龙面板进行任务管理。

## 核心架构

### 1. 目录结构

- **Module/** - Surge 模块文件 (`.sgmodule`)，定义 HTTP 拦截规则和脚本绑定
- **Script/** - JavaScript 脚本文件，实现具体业务逻辑
- **boxjs/** - BoxJS 配置文件，提供 Web UI 配置界面
- **Rule/** - Surge/Clash 规则列表文件
- **icon/** - 图标资源
- **Backup/** - 各目录下的旧版本或备用脚本

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

#### WSKEY 管理流程
1. **wskey.sgmodule** - 定义拦截规则:
   - `blackhole.m.jd.com/bypass` - 获取 wskey
   - `mars.jd.com/log/sdk/v2` - 获取 pt_pin
2. **wskey.js** - 从请求中提取并存储 WSKEY
3. **wskey_ql_sync.js** - 同步到青龙面板 (环境变量名: `JD_WSCK`)
4. **wskey_ql_token.js** - 管理青龙 API Token
5. **wskey_clear.js** - 清空本地存储

#### Cookie 管理流程
1. **jdcookie.sgmodule** - 定义拦截规则
2. **jdcookie.js** - 提取并存储 Cookie
3. **jdcookie_ql_sync.js** - 同步到青龙面板 (环境变量名: `JD_COOKIE`)
4. **jdcookie_ql_token.js** - Token 管理
5. **jdcookie_clear.js** - 清空操作

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

**byhooi.boxjs.json** 定义两个应用:
- `byhooi_jdcookie_ql` - Cookie 同步配置
- `byhooi_wskey_ql` - WSKEY 同步配置

**共享配置项**:
- `ql_url` - 青龙面板地址
- `ql_client_id` / `ql_client_secret` - API 凭证
- `auto_sync_*` - 自动同步开关
- `*_sync_interval` - 同步间隔 (分钟)

## 开发指南

### Git 提交规范

根据最近提交历史，使用以下前缀:
- `feat:` - 新功能
- `fix:` - Bug 修复
- `refactor:` - 代码重构
- `debug:` - 调试相关
- `chore:` - 构建/工具相关

### 脚本开发规范

1. **环境抽象** - 使用 `Env` 类封装 Surge API:
   ```javascript
   function Env(name, options = {}) {
     this.getdata = (key) => $persistentStore.read(key);
     this.setdata = (val, key) => $persistentStore.write(val, key);
     // ...
   }
   ```

2. **青龙集成** - 使用 `QLPanel` 类处理 API 交互:
   ```javascript
   class QLPanel {
     constructor($) { /* 初始化配置 */ }
     async ensureToken() { /* 自动刷新 Token */ }
     async getEnvs(searchValue) { /* 查询环境变量 */ }
     async createEnv(data) { /* 创建环境变量 */ }
     async updateEnv(id, data) { /* 更新环境变量 */ }
   }
   ```

3. **常量定义** - 在脚本顶部声明配置:
   ```javascript
   const SCRIPT_NAME = '脚本名称';
   const SCRIPT_VERSION = '版本号';
   ```

### 关键注意事项

1. **编码问题**: `pt_pin` 值需要 URL 解码，避免双重编码
2. **API 格式**:
   - PUT 更新使用 `_id` 字段
   - 启用变量需设置 `status: 0`
3. **Token 管理**: Token 有效期 7 天，脚本设置 6.5 天自动刷新
4. **错误处理**: 青龙 API 返回格式为 `{ code, data, message }`

### 测试调试

- 临时启用调试日志: 在脚本中添加 `console.log()` 输出
- 查看 Surge 日志了解 HTTP 请求详情
- 在 BoxJS 中手动触发同步按钮测试

## 文件同步

主要脚本通过 GitHub raw 链接在 `.sgmodule` 和 `byhooi.boxjs.json` 中引用:
```
https://raw.githubusercontent.com/byhooi/Surge/main/Script/xxx.js
```

修改脚本后需提交到 GitHub 才能在 Surge 中生效。
