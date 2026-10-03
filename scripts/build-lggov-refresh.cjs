const fs = require("node:fs");
const path = require("node:path");

function buildRefreshSource(source) {
  const marker = 'const ENTRY_MODE = "sign";';
  if (source.split(marker).length !== 2) throw new Error("签到脚本入口标记不存在或不唯一");
  return "// 自动生成：请修改 lggov_sign.js 后运行 node scripts/build-lggov-refresh.cjs，不要直接编辑。\n" +
    source.replace(marker, 'const ENTRY_MODE = "refresh-manual";');
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "Script/lggov_sign.js"), "utf8");
  fs.writeFileSync(path.join(root, "Script/lggov_refresh.js"), buildRefreshSource(source), "utf8");
  console.log("已生成 Script/lggov_refresh.js");
}

module.exports = { buildRefreshSource };
