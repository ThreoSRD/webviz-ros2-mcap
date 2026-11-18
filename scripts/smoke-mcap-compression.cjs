// Full compressed-MCAP check: Raw/Plot, mixed-codec TF/Marker pixels, and failures/recovery.
// Requires the production app to be served locally; all artifacts stay in .cache/.
const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const { createRequire } = require("module");
const path = require("path");
const puppeteer = require("puppeteer");
const { makeFixture } = require("./smoke-mcap.cjs");
const root = path.resolve(__dirname, "..");
const coreRequire = createRequire(path.join(root, "packages/webviz-core/package.json"));
const { McapIndexedReader } = coreRequire("@mcap/core");
const artifacts = path.join(root, ".cache/mcap-compression");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(script, compression) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script)], {
    cwd: root,
    env: { ...process.env, MCAP_COMPRESSION: compression },
    stdio: "inherit",
    timeout: 120000,
  });
  assert.equal(result.status, 0, `${script} (${compression || "uncompressed"}) must pass: ${result.error || ""}`);
}
async function corrupt(file, codec) {
  const bytes = fs.readFileSync(file);
  const reader = await McapIndexedReader.Initialize({
    readable: {
      size: async () => BigInt(bytes.length),
      read: async (offset, length) => bytes.subarray(Number(offset), Number(offset + length)),
    },
  });
  const chunk = reader.chunkIndexes.find((item) => item.compression === codec);
  assert.ok(chunk, "fixture contains a compressed chunk");
  // Chunk header: record header(9), timestamps(16), size(8), CRC(4),
  // compression string(4+n), records byte length(8), then the compressed frame.
  const offset = Number(chunk.chunkStartOffset) + 49 + Buffer.byteLength(codec);
  bytes.fill(0, offset, offset + 4); // Break only the frame magic, keeping indexes intact.
  const target = path.join(artifacts, `corrupt-${codec}.mcap`);
  fs.writeFileSync(target, bytes);
  return target;
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  if (process.env.MCAP_ONLY_FAILURES !== "1") {
    for (const compression of ["", "lz4", "zstd", "mixed"]) run("smoke-mcap.cjs", compression);
    run("smoke-ros2-scene.cjs", "mixed");
  }
  const codecWasmAssets = {};
  const dist = path.join(root, "docs/public/dist");
  for (const codec of ["lz4", "zstd"]) {
    const bytes = fs.readFileSync(
      path.join(path.dirname(coreRequire.resolve(`@foxglove/wasm-${codec}`)), `wasm-${codec}.wasm`)
    );
    const filename = fs
      .readdirSync(dist)
      .find(
        (file) =>
          file.startsWith(`wasm-${codec}-`) &&
          file.endsWith(".wasm") &&
          fs.readFileSync(path.join(dist, file)).equals(bytes)
      );
    assert.ok(filename, `production build emitted the ${codec} WASM asset`);
    codecWasmAssets[codec] = filename;
  }
  const report = { status: "running", checks: [], assets: [], pageErrors: [], codecWasmAssets };
  const save = () => fs.writeFileSync(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  const upstream = new URL(process.env.WEBVIZ_SMOKE_URL || "http://127.0.0.1:18080/app/");
  let blockZstd = false;
  const proxy = http.createServer((request, response) => {
    const asset = /\/dist\/(?:mcap-(?:zstd|lz4)\.js|wasm-(?:zstd|lz4)-.*\.wasm)/.test(request.url);
    const blocked = blockZstd && /\/wasm-zstd-.*\.wasm/.test(request.url);
    if (asset) report.assets.push({ url: request.url, blocked });
    if (blocked) {
      response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("codec asset missing (test injection)");
      return;
    }
    const remote = http.request(new URL(request.url, upstream), { method: request.method }, (result) => {
      response.writeHead(result.statusCode, { ...result.headers, "cache-control": "no-store" });
      result.pipe(response);
    });
    remote.on("error", (error) => {
      response.writeHead(502);
      response.end(error.message);
    });
    request.pipe(remote);
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  let browser;
  let page;
  let phase = "startup";
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.BROWSER_PATH || "/usr/bin/google-chrome",
      userDataDir: path.join(artifacts, "browser-profile"),
      headless: true,
      env: { ...process.env, XDG_CACHE_HOME: path.join(root, ".cache") },
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    page = await browser.newPage();
    page.on("pageerror", (error) => report.pageErrors.push({ phase, message: error.message }));
    await page.setViewport({ width: 1100, height: 750 });
    await page.goto(`http://127.0.0.1:${proxy.address().port}${upstream.pathname}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.setPanelLayout === "function");
    await page.evaluate(() =>
      window.setPanelLayout({
        version: 19,
        layout: "RawMessages!compression",
        savedProps: {
          "RawMessages!compression": { topicPath: "/sample", diffEnabled: false },
        },
        globalVariables: {},
        userNodes: {},
        linkedGlobalVariables: [],
        playbackConfig: { speed: 1, messageOrder: "receiveTime" },
      })
    );
    const upload = async (file) => {
      await page.evaluate(() => {
        const url = new URL(location.href);
        for (const key of ["seek-to", "seek-to-relative-ms", "seek-to-fraction"]) url.searchParams.delete(key);
        history.replaceState(history.state, "", url);
        document.querySelector("input[data-puppeteer-file-upload]").value = "";
      });
      const input = await page.$("input[data-puppeteer-file-upload]");
      try {
        await input.uploadFile(file);
      } finally {
        await input.dispose();
      }
    };
    const diagnostics = () =>
      page.evaluate(() => {
        const element = document.querySelector(".app-container");
        let fiber = element[Object.keys(element).find((key) => key.startsWith("__reactInternalInstance"))];
        while (fiber.return) fiber = fiber.return;
        fiber = fiber.stateNode?.current || fiber;
        const seen = new Set();
        const queue = [fiber];
        const notifications = [];
        let player;
        while (queue.length) {
          const item = queue.pop();
          if (!item || seen.has(item)) continue;
          seen.add(item);
          const state = item.memoizedProps?.value?.playerState;
          if (state)
            player = {
              isPresent: state.isPresent,
              showInitializing: state.showInitializing,
              showSpinner: state.showSpinner,
            };
          const instance = item.stateNode;
          if (instance?.toggleNotificationList && Array.isArray(instance.state?.notifications)) {
            notifications.push(
              ...instance.state.notifications.map(({ message, details, severity }) => ({
                message,
                severity,
                details:
                  typeof details === "string" ? details : details instanceof Error ? details.message : String(details),
              }))
            );
          }
          queue.push(item.child, item.sibling);
        }
        return { player, notifications };
      });
    const ready = async (count) => {
      await page.waitForFunction(
        (count) => new RegExp(`count[\\s:]*${count}\\b`).test(document.body.innerText),
        { timeout: 15000 },
        count
      );
      const state = await diagnostics();
      assert.equal(state.player?.isPresent, true, "the recovered source is present");
      report.checks.push({ phase, state });
      save();
      console.log(`PASS ${phase}`);
    };
    const failed = async (needle) => {
      let state;
      for (let i = 0; i < 100; i++) {
        state = await diagnostics();
        if (
          state.player?.isPresent === false &&
          state.notifications.some((n) => n.severity === "error" && n.details.includes(needle))
        )
          break;
        await sleep(100);
      }
      assert.equal(state.player?.isPresent, false, `${phase} must exit the active player state`);
      assert.equal(state.player.showInitializing, false, "failed source is not still initializing");
      assert.equal(state.player.showSpinner, false, "failed source leaves no playback spinner");
      assert.ok(
        state.notifications.some((n) => n.severity === "error" && n.details.includes(needle)),
        `actionable error includes ${needle}`
      );
      report.checks.push({ phase, state });
      await page.screenshot({ path: path.join(artifacts, `${phase}.png`) });
      save();
      console.log(`PASS ${phase}`);
    };
    phase = "uncompressed-no-codec-download";
    await upload(await makeFixture(path.join(artifacts, "plain")));
    await ready(42);
    assert.ok(
      !report.assets.some((asset) => Object.values(codecWasmAssets).some((name) => asset.url.includes(name))),
      "plain MCAP does not fetch either MCAP codec WASM asset"
    );
    for (const [index, codec] of ["lz4", "zstd"].entries()) {
      const count = 142 + index * 100;
      const good = await makeFixture(path.join(artifacts, codec), count, codec);
      phase = `corrupt-${codec}`;
      await upload(await corrupt(good, codec));
      await failed(`Cannot decompress MCAP ${codec} chunk`);
      phase = `recover-${codec}`;
      await upload(good);
      await ready(count);
    }
    const goodZstd = await makeFixture(path.join(artifacts, "asset"), 342, "zstd");
    phase = "missing-decoder-asset";
    blockZstd = true;
    await upload(goodZstd);
    await failed("Cannot load MCAP zstd decoder");
    assert.ok(report.assets.some((asset) => asset.blocked), "actually denied the WASM request");
    phase = "recover-decoder-asset";
    blockZstd = false;
    await upload(goodZstd);
    await ready(342);
    assert.deepStrictEqual(
      report.pageErrors.filter((error) => error.phase !== "missing-decoder-asset"),
      [],
      "no unexpected browser exceptions"
    );
    report.status = "passed";
    save();
  } catch (error) {
    report.status = "failed";
    report.failure = error.message;
    report.phase = phase;
    if (page && !page.isClosed()) {
      report.text = await page.evaluate(() => document.body.innerText);
      await page.screenshot({ path: path.join(artifacts, "failure.png") });
    }
    save();
    throw error;
  } finally {
    if (browser) await browser.close();
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
