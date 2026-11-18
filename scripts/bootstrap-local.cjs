// Install complete manifests with project-local caches, then link the monorepo.
// Lerna 3 bootstrap rewrites temporary manifests and cannot enforce leaf locks.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const cache = path.join(root, ".cache");
const ci = process.argv.includes("--ci");
const env = {
  ...process.env,
  npm_config_cache: path.join(cache, "npm"),
  npm_config_devdir: path.join(cache, "node-gyp"),
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_maxsockets: "2",
  npm_config_fetch_timeout: "60000",
  npm_config_fetch_retries: "3",
  XDG_CACHE_HOME: cache,
  PUPPETEER_DOWNLOAD_PATH: path.join(cache, "puppeteer"),
  PUPPETEER_CACHE_DIR: path.join(cache, "puppeteer"),
  // Verification uses BROWSER_PATH/an existing Chrome; no legacy Chromium downloads.
  PUPPETEER_SKIP_DOWNLOAD: "true",
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: "true",
};
function packages() {
  const result = [];
  for (const name of fs.readdirSync(path.join(root, "packages")).sort()) {
    const base = path.join(root, "packages", name);
    if (name.startsWith("@")) {
      for (const child of fs.readdirSync(base).sort()) {
        const directory = path.join(base, child);
        if (fs.existsSync(path.join(directory, "package.json"))) result.push(directory);
      }
    } else if (fs.existsSync(path.join(base, "package.json"))) result.push(base);
  }
  return result;
}
const leaves = packages();
const directories = [root, ...leaves];
const hash = (file) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
const locks = new Map();
if (ci) {
  for (const directory of directories) {
    const file = path.join(directory, "package-lock.json");
    if (!fs.existsSync(file)) throw new Error(`Missing lockfile: ${file}`);
    locks.set(file, hash(file));
  }
}
function run(command, args, cwd) {
  console.log(`Installing/linking ${path.relative(root, cwd) || "."}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const directory of directories) {
  run("npm", [ci ? "ci" : "install", "--include=dev", "--legacy-peer-deps"], directory);
}
// One React identity is required with webpack's resolve.symlinks=false. Every
// direct leaf copy must match the pinned root version before we hoist it away.
for (const directory of leaves) {
  for (const name of ["react", "react-dom"]) {
    const local = path.join(directory, "node_modules", name);
    if (!fs.existsSync(local)) continue;
    const version = JSON.parse(fs.readFileSync(path.join(local, "package.json"))).version;
    const rootVersion = JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"))).version;
    if (version !== rootVersion) throw new Error(`Cannot hoist ${local}: ${version} differs from root ${rootVersion}`);
    fs.rmSync(local, { recursive: true, force: true });
  }
}
// Match compatible local package versions; keep explicitly different registry versions.
run(process.execPath, [path.join(root, "node_modules/lerna/cli.js"), "link"], root);
for (const [file, expected] of locks) {
  if (hash(file) !== expected) throw new Error(`CI install changed a lockfile: ${file}`);
}
console.log(`Installed root + ${leaves.length} packages${ci ? " with unchanged lockfiles" : ""}. Caches: ${cache}`);
