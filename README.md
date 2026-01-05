# Surge 脚本与模块集合

> 自动化 HTTP 拦截、数据提取和远程同步工具集

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Surge-orange.svg)](https://nssurge.com/)

## 项目简介

这是一个基于 Surge 的脚本和模块集合仓库，提供以下核心功能：

- 🛒 **京东账号管理** - 自动获取 WSKEY/Cookie 并同步到青龙面板
- 🏃 **跳绳统计分析** - 运动数据分析和考核结果判定
- 🔐 **通用 Token 管理** - 自动捕获和存储 HTTP 请求中的 Token
- 🔄 **多服务拦截** - 支持美团、高德地图等多个服务的数据拦截

**核心设计模式**：`Surge 拦截 → 数据提取 → 持久化存储 (BoxJS) → 远程同步 (可选)`

## 快速开始

### 1. 安装 BoxJS 订阅

在 BoxJS 中添加以下订阅地址：

```
https://raw.githubusercontent.com/byhooi/Surge/main/boxjs/byhooi.boxjs.json
```

### 2. 安装 Surge 模块

在 Surge 中添加所需模块，例如：

**京东 WSKEY 获取**：
```
https://raw.githubusercontent.com/byhooi/Surge/main/Module/wskey.sgmodule
```

**京东 Cookie 获取**：
```
https://raw.githubusercontent.com/byhooi/Surge/main/Module/jdcookie.sgmodule
```

**跳绳统计**：
```
https://raw.githubusercontent.com/byhooi/Surge/main/Module/VideoUrl.sgmodule
```

### 3. 配置青龙面板（可选）

如需自动同步到青龙面板：

1. 登录青龙面板 → **系统设置** → **应用设置**
2. 创建新应用，选择环境变量权限（查看、新增、更新）
3. 获取 `Client ID` 和 `Client Secret`
4. 在 BoxJS 对应应用中填写青龙面板配置

详细配置步骤请查看 [BoxJS 使用说明](boxjs/README.md)

## 主要功能

### 京东账号管理

| 功能 | 模块 | 脚本 | 说明 |
|------|------|------|------|
| WSKEY 获取 | `wskey.sgmodule` | `wskey.js` | 拦截京东 APP 请求获取 WSKEY |
| WSKEY 同步 | - | `wskey_ql_sync.js` | 同步到青龙面板（环境变量：`JD_WSCK`） |
| Cookie 获取 | `jdcookie.sgmodule` | `jdcookie.js` | 获取完整京东 Cookie |
| Cookie 同步 | - | `jdcookie_ql_sync.js` | 同步到青龙面板（环境变量：`JD_COOKIE`） |

**特点**：
- ✅ 自动判断新增/更新/跳过，避免重复
- ✅ 内置 Token 自动刷新机制（有效期 7 天）
- ✅ 支持多账号管理
- ✅ 按 `pt_pin` 自动识别用户

### 跳绳统计分析

**模块**：`VideoUrl.sgmodule`
**脚本**：`VideoUrl.js`

**功能**：
- 自动分析运动记录数据
- 计算总跳绳数、总时间、合格次数
- 判定考核结果（有优秀成绩可减少 1 次合格要求）
- 推送通知并记录日志到 BoxJS

**可配置参数**（通过 BoxJS）：
- 默认合格次数（默认：3）
- 达标阈值（默认：195）
- 优秀阈值（默认：200）

### 其他功能模块

- **美团买菜** (`meituan.sgmodule`) - 买菜币相关数据获取
- **高德地图** (`amap.sgmodule`) - 地图相关数据拦截
- **GitHub 优化** (`github429.sgmodule`) - 解决 GitHub 429 错误
- **Google 搜索** (`googlesearch.sgmodule`) - 搜索体验优化
- **伴生活 Token** (`bsh.sgmodule` + `bsh.js`) - 自动捕获 Token

查看 [完整模块列表](Module/)

## 目录结构

```
.
├── Module/          # Surge 模块文件 (.sgmodule) - 15 个模块
├── Script/          # JavaScript 脚本 - 8 个核心脚本
├── boxjs/           # BoxJS 配置文件
│   ├── byhooi.boxjs.json  # 订阅配置
│   └── README.md           # 详细使用说明
├── icon/            # 图标资源
├── Rule/            # 规则列表文件
├── Backup/          # 备份文件
└── CLAUDE.md        # 开发者文档
```

## 技术架构

### 工作流程

```
Surge 拦截请求 (.sgmodule)
    ↓
提取凭证/数据 (*.js)
    ↓
存储到 BoxJS ($persistentStore)
    ↓
同步到青龙面板 (*_ql_sync.js) [可选]
```

### 核心组件

1. **Env 类** - 封装 Surge/Quantumult X API 差异
2. **QLPanel 类** - 封装青龙面板 OpenAPI 交互
3. **配置读取机制** - 支持 BoxJS 配置与脚本内 fallback

### 关键特性

- 🔄 **跨平台兼容** - 支持 Surge 和 Quantumult X
- 🔐 **自动 Token 管理** - 青龙 Token 自动刷新，无需手动操作
- 💾 **持久化存储** - BoxJS 提供 Web UI 管理界面
- 📊 **日志记录** - 自动记录运行日志便于排查问题
- 🔧 **可配置化** - 所有阈值和参数均可通过 BoxJS 配置

## 开发指南

### 环境要求

- Surge iOS/Mac 版本（支持 MITM 和脚本功能）
- BoxJS（用于配置管理和数据存储）
- 青龙面板（可选，用于远程同步）

### 本地开发

1. **克隆仓库**
   ```bash
   git clone https://github.com/byhooi/Surge.git
   cd Surge
   ```

2. **本地调试**
   - 在 Surge 中使用本地文件路径：`file:///path/to/script.js`
   - 修改后立即生效，无需等待 CDN

3. **提交到 GitHub**
   ```bash
   git add .
   git commit -m "feat: 功能描述"
   git push
   ```

4. **生效流程**
   - GitHub 更新 → CDN 刷新（约 5 分钟）→ Surge 重新加载模块

### Git 提交规范

- `feat:` - 新功能
- `fix:` - Bug 修复
- `refactor:` - 代码重构
- `docs:` - 文档更新
- `chore:` - 构建/工具相关

### 脚本开发规范

所有脚本遵循统一结构：

```javascript
// 1. 常量定义
const SCRIPT_NAME = '脚本名称';
const SCRIPT_VERSION = '版本号';

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

详细开发文档请查看 [CLAUDE.md](CLAUDE.md)

## 常见问题

### Q: 同步到青龙失败怎么办？

1. 检查青龙面板地址和端口是否正确
2. 验证 Client ID 和 Client Secret
3. 确认应用权限包含环境变量的查看、新增、更新
4. 查看 Surge 日志了解详细错误

### Q: WSKEY 会重复添加吗？

不会。脚本根据 `pt_pin` 自动判断：
- 新用户 → 创建新环境变量
- 已存在且值变化 → 更新变量
- 值未变化 → 跳过

### Q: 如何强制刷新远程脚本缓存？

在 URL 后添加随机参数：
```
?v=20260105
```

或在 Surge 中手动更新模块。

### Q: 支持哪些平台？

- ✅ Surge iOS
- ✅ Surge Mac
- ✅ Quantumult X（部分功能）

## 更新日志

查看 [Commits](https://github.com/byhooi/Surge/commits/main) 了解最新更新。

### 近期更新

- **2024-12** - 移除"获取青龙 Token"按钮，Token 完全自动管理
- **2024-12** - 优化 WSKEY 和 Cookie 同步逻辑
- **2024-12** - 新增跳绳统计日志应用
- **2024-01** - 新增美团买菜定时任务

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m "feat: 添加新功能"`
4. 推送到分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

## 致谢

- 参考了 [@Sliverkiss](https://github.com/Sliverkiss) 的青龙同步配置
- 感谢 Surge 和 BoxJS 开发团队
- 感谢京东脚本开发者们的贡献

## 许可证

[MIT License](LICENSE)

## 免责声明

本项目仅供学习交流使用，请勿用于非法用途。使用本项目所产生的一切后果由使用者自行承担。

---

**⭐ 如果这个项目对你有帮助，请给一个 Star！**
