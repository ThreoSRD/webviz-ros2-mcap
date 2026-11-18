// Copy source (no dependencies/builds/recordings) inside this project and verify it.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, "..");
const cache = path.join(root, ".cache");
fs.mkdirSync(cache, { recursive: true });
const directory = fs.mkdtempSync(path.join(cache, "clean-install-"));
const workspace = path.join(directory, "workspace");
const report = { status: "running", directory, workspace, node: process.version, started: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
const excluded = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".npm-cache",
  ".npm",
  "dist",
  "lib",
  "coverage",
  "build",
  "__static_webviz__",
  ".reg",
  ".agents",
  ".codex",
  ".aws",
  "local-data",
  "__screenshots__",
]);
function include(source) {
  if (source === root) return true;
  const name = path.basename(source);
  if (excluded.has(name) || name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return false;
  return !/\.mcap(?:\.|$)|\.db3(?:-|$)|\.log$|\.tgz$/.test(name);
}
function inputHashes() {
  const result = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", ".cache"].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (["package.json", "package-lock.json"].includes(entry.name)) {
        result[path.relative(workspace, file)] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex");
      }
    }
  }
  visit(workspace);
  return result;
}
async function run(name, args) {
  const logfile = path.join(directory, `${name}.log`);
  const output = fs.createWriteStream(logfile);
  console.log(`Checking clean ${name} in ${workspace}; log: ${logfile}`);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const child = spawn("npm", args, {
        cwd: workspace,
        env: { ...process.env, MCAP_ONLY_FAILURES: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.pipe(
        output,
        { end: false }
      );
      child.stderr.pipe(
        output,
        { end: false }
      );
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    await new Promise((resolve) => output.end(resolve));
  }
  report[name] = { ...result, log: logfile };
  save();
  if (result.code !== 0) throw new Error(`Clean ${name} failed (${result.code ?? result.signal}); see ${logfile}`);
}
async function main() {
  try {
    // Relative source symlinks, including app/index.html, keep their meaning.
    fs.mkdirSync(workspace);
    for (const name of fs.readdirSync(root)) {
      const source = path.join(root, name);
      if (include(source)) {
        fs.cpSync(source, path.join(workspace, name), {
          recursive: true,
          dereference: false,
          verbatimSymlinks: true,
          filter: include,
        });
      }
    }
    assert.ok(!fs.existsSync(path.join(workspace, "node_modules")), "source copy has no installed dependencies");
    assert.ok(!fs.existsSync(path.join(workspace, "docs/public/dist")), "source copy has no app build");
    report.before = inputHashes();
    // Cache reuse is allowed; dependencies and compiled packages are installed fresh.
    fs.mkdirSync(path.join(workspace, ".cache"), { recursive: true });
    fs.symlinkSync(path.join(cache, "npm"), path.join(workspace, ".cache/npm"), "dir");
    save();
    await run("install", ["run", "install-ci"]);
    report.afterInstall = inputHashes();
    assert.deepStrictEqual(
      report.afterInstall,
      report.before,
      "CI install preserves every source manifest and lockfile"
    );
    await run("verify", ["run", "verify:mcap", "--", ...process.argv.slice(2)]);
    report.afterVerify = inputHashes();
    assert.deepStrictEqual(report.afterVerify, report.before, "verification preserves every manifest and lockfile");
    report.verification = JSON.parse(fs.readFileSync(path.join(workspace, ".cache/verify-mcap/report.json")));
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failure = error.message;
    throw error;
  } finally {
    report.finished = new Date().toISOString();
    save();
  }
  console.log(`PASS clean install and verification. Report: ${path.join(directory, "report.json")}`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
