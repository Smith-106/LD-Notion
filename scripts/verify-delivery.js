const { spawnSync } = require("child_process");
const steps = [
  "verify:baseline",
  "build",
  "build:extension",
  "verify:extension:bunded",
  "verify:bridge-extension",
  "verify:extension:surfaces",
  "verify:equivalence",
];
for (const s of steps) {
  console.log("\n==> npm run " + s);
  const r = spawnSync("npm", ["run", s], { stdio: "inherit" });
  if (r.status) process.exit(r.status || 1);
}
console.log("\n✄ verify:delivery all passed");
