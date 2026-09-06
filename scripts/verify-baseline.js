const { spawnSync } = require("child_process");
const steps = [
  ["npm", ["test"]],
  [process.execPath, ["--check", "LinuxDo-Bookmarks-to-Notion.user.js"]],
  [process.execPath, ["scripts/validate-userscript-ui.js"]]
];
for (const [cmd, args] of steps) {
  console.log("\n==> " + cmd + " " + args.join(" "));
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status) process.exit(r.status || 1);
}
console.log("\n[PASS] verify:baseline");
