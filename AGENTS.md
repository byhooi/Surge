# Repository Guidelines

## 项目结构与模块组织

本仓库是 Surge 脚本、模块和规则集合。`Module/` 存放 `.sgmodule` 模块文件，负责声明拦截规则、脚本路径和 MITM 域名；`Script/` 存放对应的 JavaScript 业务逻辑，例如 `jdcookie.js`、`wskey_ql_sync.js`。`boxjs/byhooi.boxjs.json` 定义 BoxJS 订阅、配置项和手动触发脚本；`Rule/` 存放 Surge/Clash 分流规则；`icon/` 存放 BoxJS 或模块展示图标。各目录下的 `Backup/` 仅作历史备份，除非明确需要恢复旧逻辑，否则不要作为主要维护目标。

## 模块专项维护指南

涉及龙岗图书馆签到或续期时，必须先阅读 [龙岗图书馆多账号签到](docs/lggov_sign.md)。适用范围包括 `Script/lggov_sign.js`、`Script/lggov_refresh.js`、`Module/lggov_sign.sgmodule`、`scripts/build-lggov-refresh.cjs`、`tests/lggov_sign.test.cjs`，以及 `boxjs/byhooi.boxjs.json` 中的龙岗图书馆配置。

- `Script/lggov_refresh.js` 是自动生成的入口，不要直接编辑；业务逻辑只修改 `Script/lggov_sign.js`，随后运行 `node scripts/build-lggov-refresh.cjs`，两个入口文件一起发布。
- 修改后按专项文档“本地验证”执行语法检查和自动化测试；行为、配置或操作步骤变化时，同步更新 `docs/lggov_sign.md`。
- 安装、Token 续期边界、结果判定、账号安全和实机验收等详细说明保留在专项文档，不在本指南重复维护。

## 构建、测试与本地开发命令

本项目没有统一的 npm、make 或打包流程，文件提交后通过 GitHub raw 链接被 Surge/BoxJS 加载。龙岗图书馆模块有独立的入口生成脚本，相关命令见专项文档“本地验证”。常用命令：

```bash
git status
git diff
rg "SCRIPT_VERSION" Script
node --check Script/jdcookie.js
```

`git status` 和 `git diff` 用于检查待提交改动；`rg` 用于快速查找脚本常量或配置键；`node --check` 只做 JavaScript 语法检查，不能替代 Surge 运行测试。

## 编码风格与命名约定

JavaScript 使用 2 空格缩进，优先保持现有文件风格。脚本顶部集中定义常量，例如 `SCRIPT_NAME`、`SCRIPT_VERSION`、`*_KEY`；持久化数据通过 `$persistentStore` 或兼容封装读写。新增功能通常需要同名配套文件：`Module/example.sgmodule` 对应 `Script/example.js`。`.sgmodule` 中的 `script-path` 应指向 `https://raw.githubusercontent.com/byhooi/Surge/main/Script/...`，并同步维护 `[MITM] hostname`。

## 测试指南

龙岗图书馆模块已有 Node 内置测试，使用 `node --test tests/lggov_sign.test.cjs` 运行，完整验证步骤见专项文档“本地验证”；其他脚本按各自已有的验证方式执行。提交前至少执行相关脚本的 `node --check`，并在 Surge 中用本地路径或 raw 链接验证拦截规则、通知输出和 BoxJS 写入结果，自动化测试不能替代实机验收。修改 `.sgmodule` 时检查 `pattern`、`requires-body`、`timeout` 和 MITM 域名是否匹配目标请求。涉及青龙同步时，使用测试账号或临时配置验证新增、更新和跳过逻辑。

## 提交与 Pull Request 规范

提交历史主要使用 `feat:` 和 `fix`，建议统一采用 `feat:`、`fix:`、`docs:`、`refactor:`、`chore:` 前缀，例如 `feat: 添加京东发票提取模块`。PR 应说明变更的模块/脚本、影响的域名或配置键、验证步骤，以及涉及通知、BoxJS 页面或 Surge 行为变化时的截图或日志摘要。

## 安全与配置提示

不要提交 Cookie、WSKEY、青龙 `Client ID`、`Client Secret`、Token 或真实用户数据。新增 BoxJS 配置时提供安全默认值，并避免在日志中输出完整凭证。
