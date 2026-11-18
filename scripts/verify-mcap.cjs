// Reproducible local/CI checks. Own the temporary server; never reuse/stop a user's server.
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, "..");
const directory = path.join(root, ".cache/verify-mcap");
const browser = !process.argv.includes("--no-browser");
const report = { status: "running", browser, steps: [], node: process.version, started: new Date().toISOString() };
fs.mkdirSync(directory, { recursive: true });
const save = () => fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
const env = {
  ...process.env,
  XDG_CACHE_HOME: path.join(root, ".cache"),
  BROWSER_PATH: process.env.BROWSER_PATH || "/usr/bin/google-chrome",
};
async function step(name, command, args, extraEnv = {}) {
  const logfile = path.join(directory, `${name}.log`);
  const output = fs.createWriteStream(logfile);
  const item = { name, status: "running", log: logfile, started: new Date().toISOString() };
  report.steps.push(item);
  save();
  console.log(`Checking ${name}; log: ${logfile}`);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        env: { ...env, ...extraEnv },
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
  item.finished = new Date().toISOString();
  item.result = result;
  item.status = result.code === 0 ? "passed" : "failed";
  save();
  if (result.code !== 0) throw new Error(`${name} failed (${result.code ?? result.signal}). See ${logfile}`);
  console.log(`PASS ${name}`);
}
async function main() {
  let server;
  try {
    assert.ok(
      typeof require("zlib").zstdCompressSync === "function",
      "Full MCAP checks require Node >=22.15 for native zstd fixtures"
    );
    if (browser)
      assert.ok(
        fs.existsSync(env.BROWSER_PATH),
        `Chrome was not found: ${env.BROWSER_PATH}. Set BROWSER_PATH or pass --no-browser.`
      );
    await step("build", "npm", ["run", "build"], { NODE_ENV: "production" });
    await step("helpers", "npm", ["run", "test:mcap:helpers"]);
    await step("regression", "npm", ["run", "test:mcap:regression"]);
    await step("lint", "npm", ["run", "lint"]);
    await step("flow", "npm", ["run", "flow"]);
    if (browser) {
      server = require("http-server").createServer({ root: path.join(root, "docs/public"), cache: -1 });
      await new Promise((resolve, reject) => {
        server.server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = `http://127.0.0.1:${server.server.address().port}/app/`;
      report.server = { address, owned: true, closed: false };
      save();
      const status = await new Promise((resolve, reject) => {
        http
          .get(address, (response) => {
            response.resume();
            resolve(response.statusCode);
          })
          .once("error", reject);
      });
      assert.equal(status, 200, "the freshly built app is served");
      await step("browser", process.execPath, [path.join(root, "scripts/smoke-mcap-compression.cjs")], {
        WEBVIZ_SMOKE_URL: address,
        MCAP_ONLY_FAILURES: "0",
        MCAP_COMPRESSION: "",
      });
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failure = error.message;
    throw error;
  } finally {
    if (server?.server.listening) {
      server.server.closeAllConnections();
      await new Promise((resolve) => server.server.close(resolve));
      report.server.closed = true;
    }
    report.finished = new Date().toISOString();
    save();
  }
  console.log(
    `PASS MCAP verification${browser ? " including browser" : " (browser explicitly skipped)"}. Report: ${path.join(
      directory,
      "report.json"
    )}`
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
