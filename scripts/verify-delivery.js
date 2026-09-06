const { spawnSync } = require("child_process");
const isWin = process.platform === "win32";
const npmCmd = isWin ? "npm.cmd" : "npm";
const env = { ...process.env, LD_VERIFY_STRICT: "1" };
const steps = [
  "verify:baseline",
  "verify:build",
  "build:extension",
  "verify:extension:bounded",
  "verify:bridge-extension",
  "verify:extension:surfaces",
  "verify:equivalence",
];
for (const s of steps) {
  console.log("\n==> npm run " + s);
  const r = spawnSync(npmCmd, ["run", s], { stdio: "inherit", env, shell: isWin });
  if (r.error || r.signal || r.status !== 0) process.exit(r.status || 1);
}
console.log("\n✅ verify:delivery all passed");
