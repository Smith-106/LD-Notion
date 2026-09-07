const { spawnSync } = require("child_process");
const isWin = process.platform === "win32";
const npmCmd = isWin ? "npm.cmd" : "npm";
const steps = [
  [npmCmd, ["test"], { shell: isWin }],
  [process.execPath, ["--check", "LinuxDo-Bookmarks-to-Notion.user.js"], {}],
  [process.execPath, ["scripts/validate-userscript-ui.js"], {}],
  [process.execPath, ["tests/scan-dangling-refs.js"], {}]
];
for (const [cmd, args, opts] of steps) {
  console.log("\n==> " + cmd + " " + args.join(" "));
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.error || r.signal || r.status !== 0) process.exit(r.status || 1);
}
console.log("\n[PASS] verify:baseline");
