// Exercise the browser's real file -> worker -> CDR -> Raw Messages/Plot path.
// Start a local Webviz server, then run npm run smoke:mcap.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const puppeteer = require("puppeteer");
const root = path.resolve(__dirname, "..");
const coreRequire = createRequire(path.join(root, "packages/webviz-core/package.json"));
const { McapWriter } = coreRequire("@mcap/core");
const { compressionOptions } = require("./fixtures/compression");
const compression = process.env.MCAP_COMPRESSION || "";
const artifacts = path.join(root, ".cache/mcap-smoke", compression || ".");

async function makeFixture(directory = artifacts, firstCount = 42, codec = "") {
  fs.mkdirSync(directory, { recursive: true });
  const parts = [];
  let position = BigInt(0);
  const writer = new McapWriter({
    chunkSize: 1,
    ...compressionOptions(codec),
    writable: {
      write: async (bytes) => {
        parts.push(Buffer.from(bytes));
        position += BigInt(bytes.byteLength);
      },
      position: () => position,
    },
  });
  await writer.start({ profile: "ros2", library: "webviz-browser-smoke" });
  const schemaId = await writer.registerSchema({
    name: "custom_msgs/msg/Sample",
    encoding: "ros2msg",
    data: Buffer.from("uint32 count\nbuiltin_interfaces/Time stamp\nuint8[] data\nuint64 id\n"),
  });
  const channelId = await writer.registerChannel({
    schemaId,
    topic: "/sample",
    messageEncoding: "cdr",
    metadata: new Map(),
  });
  for (let i = 0; i < 3; i++) {
    const data = new Uint8Array(36);
    const view = new DataView(data.buffer);
    data[1] = 1;
    view.setUint32(4, firstCount + i, true);
    view.setInt32(8, 123, true);
    view.setUint32(12, 456, true);
    view.setUint32(16, 3, true);
    data.set([11, 22, 33], 20);
    view.setBigUint64(28, BigInt("18446744073709551615"), true);
    const logTime = BigInt("1700000000000000000") + BigInt(i) * BigInt(1000000000);
    await writer.addMessage({ channelId, sequence: i, logTime, publishTime: logTime, data });
  }
  await writer.end();
  const target = path.join(directory, firstCount === 42 ? "synthetic.mcap" : `synthetic-${firstCount}.mcap`);
  fs.writeFileSync(target, Buffer.concat(parts));
  return target;
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const fixture = await makeFixture(artifacts, 42, compression);
  const browser = await puppeteer.launch({
    executablePath: process.env.BROWSER_PATH || "/usr/bin/google-chrome",
    userDataDir: path.join(artifacts, "browser-profile"),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader"],
    env: { ...process.env, XDG_CACHE_HOME: path.join(root, ".cache") },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewport({ width: 1280, height: 800 });
  try {
    await page.goto(process.env.WEBVIZ_SMOKE_URL || "http://127.0.0.1:18080/app/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.setPanelLayout === "function", { timeout: 30000 });
    await page.evaluate(() =>
      window.setPanelLayout({
        version: 19,
        layout: { direction: "row", first: "RawMessages!smoke", second: "Plot!smoke" },
        savedProps: {
          "RawMessages!smoke": { topicPath: "/sample", diffEnabled: false },
          "Plot!smoke": {
            paths: [{ value: "/sample.count", enabled: true, timestampMethod: "receiveTime" }],
            showLegend: true,
            xAxisVal: "timestamp",
          },
        },
        globalVariables: {},
        userNodes: {},
        linkedGlobalVariables: [],
        playbackConfig: { speed: 1, messageOrder: "receiveTime" },
      })
    );
    const upload = await page.$("input[data-puppeteer-file-upload]");
    assert.ok(upload, "file input exists");
    try {
      await upload.uploadFile(fixture);
    } finally {
      await upload.dispose();
    }
    await page.waitForFunction(() => /count[\s:]*42/.test(document.body.innerText), { timeout: 30000 });
    await page.waitForSelector("#loadingLogo", { hidden: true });
    await page.focus(".app-container");
    await page.keyboard.press("Space");
    await page.waitForFunction(() => /count[\s:]*44/.test(document.body.innerText), { timeout: 10000 });
    // Editing the time pauses playback and exercises an actual middle seek.
    await page.click('[data-test="PlaybackTime-text"]');
    const editor = await page.waitForSelector('input[data-test="PlaybackTime-text"]');
    await editor.dispose();
    await page.focus('input[data-test="PlaybackTime-text"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.type("1700000001.000000000");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /count[\s:]*43/.test(document.body.innerText), { timeout: 10000 });
    const text = await page.evaluate(() => document.body.innerText);
    assert.ok(text.includes("18446744073709551615"), "uint64 renders exactly in Raw Messages");
    const canvases = await page.$$("canvas");
    assert.ok(canvases.length > 0, "Plot canvas renders");
    await Promise.all(canvases.map((canvas) => canvas.dispose()));
    assert.deepStrictEqual(errors, [], "no uncaught browser errors");
    await page.screenshot({ path: path.join(artifacts, "result.png") });
    fs.writeFileSync(path.join(artifacts, "result.txt"), text);
    console.log("PASS: local MCAP -> worker -> CDR -> Raw Messages/Plot, playback and seek; uint64 remains exact.");
    console.log(`Artifacts: ${artifacts}`);
  } catch (error) {
    fs.writeFileSync(
      path.join(artifacts, "failure.txt"),
      JSON.stringify(
        { error: error.message, errors, text: await page.evaluate(() => document.body.innerText) },
        null,
        2
      )
    );
    await page.screenshot({ path: path.join(artifacts, "failure.png") });
    throw error;
  } finally {
    await browser.close();
  }
}
module.exports = { makeFixture };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
