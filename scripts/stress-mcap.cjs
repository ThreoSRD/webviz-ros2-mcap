// Real sensor MCAP stability check. No recording or screenshots enter source control.
// Usage: npm run stress:mcap -- /absolute/path/to/recording.mcap
const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { createRequire } = require("module");
const puppeteer = require("puppeteer");
const { makeFixture } = require("./smoke-mcap.cjs");
const root = path.resolve(__dirname, "..");
const coreRequire = createRequire(path.join(root, "packages/webviz-core/package.json"));
const { McapIndexedReader } = coreRequire("@mcap/core");
const directory = path.join(root, ".cache/mcap-stress", process.env.MCAP_COMPRESSION || ".");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function inspect(filePath) {
  const file = await fsp.open(filePath, "r");
  try {
    const { size } = await file.stat();
    const reader = await McapIndexedReader.Initialize({
      readable: {
        size: async () => BigInt(size),
        read: async (offset, length) => {
          const buffer = Buffer.alloc(Number(length));
          const result = await file.read(buffer, 0, buffer.length, Number(offset));
          assert.equal(result.bytesRead, buffer.length, "complete MCAP metadata read");
          return buffer;
        },
      },
    });
    const find = (type) =>
      Array.from(reader.channelsById.values()).find(
        (channel) => reader.schemasById.get(channel.schemaId)?.name.replace(/\/msg\//g, "/") === type
      )?.topic;
    const imu = find("sensor_msgs/Imu");
    const image = find("sensor_msgs/CompressedImage");
    const cloud = find("sensor_msgs/PointCloud2");
    assert.ok(imu && image && cloud, "sensor stress scenario requires Imu, CompressedImage and PointCloud2 topics");
    const startNs = reader.chunkIndexes.reduce(
      (min, chunk) => (chunk.messageStartTime < min ? chunk.messageStartTime : min),
      reader.chunkIndexes[0].messageStartTime
    );
    const endNs = reader.chunkIndexes.reduce(
      (max, chunk) => (chunk.messageEndTime > max ? chunk.messageEndTime : max),
      startNs
    );
    return {
      filePath,
      size,
      imu,
      image,
      cloud,
      startNs: startNs.toString(),
      endNs: endNs.toString(),
      duration: Number(endNs - startNs) / 1e9,
    };
  } finally {
    await file.close();
  }
}

function realLayout(source) {
  return {
    version: 19,
    layout: {
      direction: "column",
      first: { direction: "row", first: "ImageViewPanel!stress", second: "RawMessages!stress" },
      second: { direction: "row", first: "3D Panel!stress", second: "Plot!stress" },
    },
    savedProps: {
      "ImageViewPanel!stress": { cameraTopic: source.image, enabledMarkerTopics: [], synchronize: false, mode: "fit" },
      "RawMessages!stress": { topicPath: source.imu, diffEnabled: false },
      "3D Panel!stress": {
        checkedKeys: ["name:Topics", `t:${source.cloud}`],
        expandedKeys: ["name:root", "name:Topics"],
        followTf: process.env.MCAP_FRAME || "base_link",
        cameraState: {
          targetOffset: [0, 0, 0],
          distance: 40,
          perspective: true,
          phi: 0.6,
          thetaOffset: 0,
          fovy: 0.7853981633974483,
          near: 0.01,
          far: 5000,
        },
        settingsByKey: {},
        followOrientation: false,
      },
      "Plot!stress": {
        paths: [{ value: `${source.imu}.linear_acceleration.x`, enabled: true, timestampMethod: "receiveTime" }],
        showLegend: true,
        xAxisVal: "timestamp",
      },
    },
    globalVariables: {},
    userNodes: {},
    linkedGlobalVariables: [],
    playbackConfig: { speed: 1, messageOrder: "receiveTime" },
  };
}
const syntheticLayout = {
  version: 19,
  layout: "RawMessages!synthetic",
  savedProps: { "RawMessages!synthetic": { topicPath: "/sample", diffEnabled: false } },
  globalVariables: {},
  userNodes: {},
  linkedGlobalVariables: [],
  playbackConfig: { speed: 1, messageOrder: "receiveTime" },
};

async function main() {
  const target = process.argv[2];
  assert.ok(target, "pass a local sensor MCAP path as the first argument");
  const source = await inspect(path.resolve(target));
  fs.mkdirSync(directory, { recursive: true });
  const synthetic = await makeFixture(directory);
  const alternateSynthetic = await makeFixture(directory, 142);
  const report = { source, memory: [], seeks: [], errors: [], applicationErrors: [], phases: [], status: "running" };
  const save = () => fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  const browser = await puppeteer.launch({
    executablePath: process.env.BROWSER_PATH || "/usr/bin/google-chrome",
    userDataDir: path.join(directory, "browser-profile"),
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
  let page;
  try {
    page = await browser.newPage();
    let slowReadMs = 0;
    const delayWorkerReads = async (worker) => {
      if (!slowReadMs || !worker.url().includes("WorkerDataProvider.worker")) return;
      try {
        await worker.evaluate((delay) => {
          if (!self.__mcapStressOriginalRead) {
            self.__mcapStressOriginalRead = Blob.prototype.arrayBuffer;
            Blob.prototype.arrayBuffer = async function() {
              if (self.__mcapStressReadDelay)
                await new Promise((resolve) => setTimeout(resolve, self.__mcapStressReadDelay));
              return self.__mcapStressOriginalRead.call(this);
            };
          }
          self.__mcapStressReadDelay = delay;
        }, slowReadMs);
      } catch {
        /* A correctly canceled source can terminate while instrumentation attaches. */
      }
    };
    page.on("workercreated", delayWorkerReads);
    const client = await page.target().createCDPSession();
    // Puppeteer 7 does not expose a browser Target with current Chrome. Its
    // existing browser connection can still query process metrics.
    const system = browser._connection;
    await page.setViewport({ width: 1400, height: 900 });
    page.on("pageerror", (e) => report.errors.push(e.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /MemoryCacheDataProvider|Error initializing|Failed to|No ROS 2 schema|MCAP source|Cannot decode|ApiCheckerDataProvider/.test(
          message.text()
        ) &&
        !/Failed to load resource/.test(message.text())
      )
        report.applicationErrors.push(message.text());
    });
    const phase = (name) => {
      report.phases.push({ name, at: new Date().toISOString() });
      save();
      console.log(name);
    };
    const notifications = async () => {
      // The production notification UI does not log every notification. Read
      // its displayed state so a successful run cannot hide panel errors.
      report.notifications = await page.evaluate(() => {
        const element = document.querySelector(".app-container");
        let fiber = element[Object.keys(element).find((key) => key.startsWith("__reactInternalInstance"))];
        while (fiber.return) fiber = fiber.return;
        const queue = [fiber];
        const seen = new Set();
        while (queue.length) {
          const item = queue.pop();
          if (!item || seen.has(item)) continue;
          seen.add(item);
          const instance = item.stateNode;
          if (instance?.toggleNotificationList && Array.isArray(instance.state?.notifications)) {
            return instance.state.notifications.map(({ severity, message, details }) => ({
              severity,
              message,
              details:
                typeof details === "string"
                  ? details
                  : details instanceof Error
                  ? details.message
                  : "(structured details)",
            }));
          }
          queue.push(item.child, item.sibling);
        }
        throw new Error("notification display was not found");
      });
      save();
      assert.deepStrictEqual(
        report.notifications.filter((item) => item.severity === "error"),
        [],
        "no errors in notification UI"
      );
    };
    const layout = async (value) => page.evaluate((value) => window.setPanelLayout(value), value);
    const upload = async (file) => {
      // A preceding seek writes an absolute bookmark into the URL. Each source
      // cycle intentionally opens at its own default start, with a different epoch.
      await page.evaluate(() => {
        const url = new URL(location.href);
        for (const key of ["seek-to", "seek-to-relative-ms", "seek-to-fraction"]) url.searchParams.delete(key);
        history.replaceState(history.state, "", url);
      });
      // Keep the automation upload input outside the React tree. Chrome can
      // save a file input in navigation/form history, retaining old React fibers
      // and their effect dependencies. Dispatch the same document drop used by
      // a person, then remove the temporary input.
      await page.evaluate(() => {
        const input = document.createElement("input");
        input.type = "file";
        input.id = "mcap-stress-upload";
        input.style.display = "none";
        document.body.appendChild(input);
      });
      const input = await page.$("#mcap-stress-upload");
      try {
        await input.uploadFile(file);
        await page.evaluate(() => {
          const input = document.getElementById("mcap-stress-upload");
          const event = new Event("drop", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "dataTransfer", { value: { files: input.files } });
          document.dispatchEvent(event);
        });
      } finally {
        await input.dispose();
        await page.evaluate(() => document.getElementById("mcap-stress-upload")?.remove());
      }
    };
    const readyReal = async () => {
      await page.waitForFunction(
        (bounds) => {
          const time = Number(document.querySelector('[data-test="PlaybackTime-text"]')?.textContent);
          return time >= bounds[0] && time <= bounds[1];
        },
        { timeout: 30000 },
        [Number(BigInt(source.startNs)) / 1e9, Number(BigInt(source.endNs)) / 1e9]
      );
      await seek(0.5, false); // Ensure the selected topic has a message, even if the first file timestamp has none.
    };
    const readySynthetic = async (firstCount = 42) =>
      page.waitForFunction(
        (first) => {
          const match = /count[\s:]*(\d+)/.exec(document.body.innerText);
          return match && Number(match[1]) >= first && Number(match[1]) <= first + 2;
        },
        { timeout: 30000 },
        firstCount
      );
    async function memory(label) {
      // Console/inspector history can retain previously inspected DOM nodes.
      // Errors are already copied into the report; exclude debugger retention
      // before measuring application objects.
      await client.send("Runtime.discardConsoleEntries");
      await client.send("HeapProfiler.collectGarbage");
      const heap = await client.send("Runtime.getHeapUsage");
      const { processInfo } = await system.send("SystemInfo.getProcessInfo");
      const rssByType = {};
      for (const info of processInfo) {
        try {
          const status = await fsp.readFile(`/proc/${info.id}/status`, "utf8");
          const match = /VmRSS:\s+(\d+) kB/.exec(status);
          if (match) rssByType[info.type] = (rssByType[info.type] || 0) + Number(match[1]) * 1024;
        } catch {
          /* A process may exit between the two CDP/OS snapshots. */
        }
      }
      const workers = page.workers().map((worker) => new URL(worker.url()).pathname.split("/").pop());
      const value = { label, heap, rssByType, workers };
      report.memory.push(value);
      save();
      console.log(
        JSON.stringify({
          label,
          heapMiB: Math.round(heap.usedSize / 1048576),
          buffersMiB: Math.round((heap.backingStorageSize || 0) / 1048576),
          rendererRssMiB: Math.round((rssByType.renderer || 0) / 1048576),
          workers: workers.length,
        })
      );
      return value;
    }
    async function seek(relative, record = true) {
      const targetNs = BigInt(source.startNs) + BigInt(Math.round(relative * 1e9));
      const time = `${targetNs / BigInt(1000000000)}.${(targetNs % BigInt(1000000000)).toString().padStart(9, "0")}`;
      const begin = Date.now();
      await page.evaluate(() => document.querySelector('[data-test="PlaybackTime-text"]').click());
      const inputReady = await page.waitForFunction(
        () => !!document.querySelector('input[data-test="PlaybackTime-text"]')
      );
      await inputReady.dispose(); // A boolean wait avoids adopting detached React inputs into the debugger realm.
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.type(time);
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (expected) => {
          const current = document.querySelector('[data-test="PlaybackTime-text"]');
          const message = /sensor_msgs\/Imu @ ([\d.]+)/.exec(document.body.innerText);
          return (
            current &&
            Math.abs(Number(current.textContent) - expected) < 0.002 &&
            message &&
            Number(message[1]) <= expected + 0.001 &&
            Number(message[1]) >= expected - 0.15
          );
        },
        { timeout: 15000 },
        Number(targetNs) / 1e9
      );
      const item = { relative, ms: Date.now() - begin };
      if (record) report.seeks.push(item);
      save();
      return item;
    }
    await page.goto(process.env.WEBVIZ_SMOKE_URL || "http://127.0.0.1:18080/app/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.setPanelLayout === "function");
    await layout(syntheticLayout);
    await upload(synthetic);
    await readySynthetic();
    await (await page.waitForFunction(() => !document.getElementById("loadingLogo"))).dispose();
    const empty = await memory("synthetic-baseline");
    await layout(realLayout(source));
    await upload(source.filePath);
    await readyReal();
    await (await page.waitForFunction(() => !document.getElementById("loadingLogo"))).dispose();
    await sleep(3000);
    phase("warm-real");
    const warm = await memory("warm-real");
    const baselineProviders = warm.workers.filter((name) => name === "WorkerDataProvider.worker.js").length;
    phase("repeated-seeks");
    for (let round = 0; round < Number(process.env.MCAP_SEEK_ROUNDS || 3); round++) {
      for (const position of [
        0.5,
        source.duration * 0.75,
        source.duration * 0.25,
        source.duration - 0.25,
        source.duration * 0.5,
        1,
      ])
        await seek(position);
      await memory(`seek-round-${round + 1}`);
    }
    phase("switch-during-playback");
    for (let round = 0; round < 4; round++) {
      await page.evaluate(() => document.querySelector(".app-container").focus());
      await page.keyboard.press("Space");
      await layout(syntheticLayout);
      const firstCount = round % 2 ? 142 : 42;
      await upload(firstCount === 42 ? synthetic : alternateSynthetic);
      await readySynthetic(firstCount);
      await layout(realLayout(source));
      await upload(source.filePath);
      await readyReal();
      await sleep(2500);
      const state = await memory(`source-round-${round + 1}`);
      assert.ok(
        state.workers.filter((name) => name === "WorkerDataProvider.worker.js").length <= baselineProviders,
        "source replacement must not accumulate data-provider workers"
      );
      assert.equal(
        state.workers.filter((name) => name === "Layout.worker.js").length,
        1,
        "exactly the visible 3D panel owns a layout worker"
      );
    }
    phase("rapid-source-switches");
    // Add bounded worker I/O latency only in this phase to reproduce a user
    // changing files before initialization finishes. Performance timings above
    // use normal reads; this is a lifecycle fault-injection check.
    slowReadMs = 150;
    await Promise.all(page.workers().map(delayWorkerReads));
    await layout(syntheticLayout);
    for (let round = 0; round < 6; round++) {
      await upload(source.filePath);
      await sleep(50);
      const firstCount = round % 2 ? 142 : 42;
      await upload(firstCount === 42 ? synthetic : alternateSynthetic);
      await readySynthetic(firstCount);
    }
    slowReadMs = 0;
    await Promise.all(
      page.workers().map((worker) =>
        worker
          .evaluate(() => {
            self.__mcapStressReadDelay = 0;
          })
          .catch(() => {})
      )
    );
    await sleep(1500);
    const cleared = await memory("synthetic-after-rapid-switches");
    if (process.env.MCAP_HEAP_SNAPSHOT === "1") {
      const fd = fs.openSync(path.join(directory, "synthetic.heapsnapshot"), "w");
      const onChunk = ({ chunk }) => fs.writeSync(fd, chunk);
      client.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
      try {
        await client.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
      } finally {
        client.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
        fs.closeSync(fd);
      }
    }

    assert.ok(
      cleared.workers.filter((name) => name === "WorkerDataProvider.worker.js").length <= baselineProviders,
      "opening another file during initialization must release abandoned workers"
    );
    assert.equal(
      cleared.workers.filter((name) => name === "Layout.worker.js").length,
      0,
      "closed 3D panels release their layout workers"
    );
    assert.ok(
      cleared.heap.backingStorageSize <= empty.heap.backingStorageSize + 32 * 1048576,
      "replacing the recording with a tiny fixture releases its retained backing storage"
    );
    assert.deepStrictEqual(report.errors, [], "no uncaught browser errors");
    assert.deepStrictEqual(report.applicationErrors, [], "no application errors from canceled sources");
    await notifications();
    if (process.env.MCAP_SKIP_PLAYBACK !== "1") {
      await layout(realLayout(source));
      await upload(source.filePath);
      await readyReal();
      await seek(0.5);
      phase("full-playback");
      await page.evaluate(() => document.querySelector(".app-container").focus());
      await page.keyboard.press("Space");
      const playSeconds = Math.min(source.duration - 0.5, Number(process.env.MCAP_PLAY_SECONDS || 60));
      assert.ok(Number.isFinite(playSeconds) && playSeconds > 0, "positive playback duration");
      const targetTime = Math.min(
        Number(BigInt(source.endNs)) / 1e9,
        Number(BigInt(source.startNs)) / 1e9 + 0.5 + playSeconds
      );
      const playStarted = Date.now();
      const reached = page.waitForFunction(
        (targetTime) => {
          const element = document.querySelector('[data-test="PlaybackTime-text"]');
          return element && Number(element.textContent) >= targetTime - 0.001;
        },
        { timeout: Math.ceil(playSeconds * 1500 + 15000) },
        targetTime
      );
      while (true) {
        let timer;
        let finished;
        try {
          finished = await Promise.race([
            reached.then(() => true),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(false), 10000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        if (finished) break;
        const time = await page.$eval('[data-test="PlaybackTime-text"]', (el) => Number(el.textContent));
        console.log(JSON.stringify({ phase: "playback", time }));
      }
      await page.evaluate(() => document.querySelector(".app-container").focus());
      await page.keyboard.press("Space");
      // Let an already-rendering frame finish before measuring the paused clock.
      await sleep(250);
      const pausedTime = await page.$eval('[data-test="PlaybackTime-text"]', (el) => Number(el.textContent));
      await sleep(250);
      const stillPaused = await page.$eval('[data-test="PlaybackTime-text"]', (el) => Number(el.textContent));
      assert.ok(Math.abs(stillPaused - pausedTime) < 0.002, "pause must stop the playback clock");
      report.playback = { playSeconds, wallMs: Date.now() - playStarted, targetTime, pausedTime };
      await memory("playback-end");
      await page.screenshot({ path: path.join(directory, "playback.png") });
      await layout(syntheticLayout);
      await upload(synthetic);
      await readySynthetic();
      await sleep(1500);
      const afterPlayback = await memory("synthetic-after-playback");
      assert.ok(
        afterPlayback.heap.backingStorageSize <= empty.heap.backingStorageSize + 32 * 1048576,
        "closing full playback releases the recording backing storage"
      );
      assert.equal(
        afterPlayback.workers.filter((name) => name === "Layout.worker.js").length,
        0,
        "closing full playback releases the 3D layout worker"
      );
      assert.deepStrictEqual(report.errors, []);
      assert.deepStrictEqual(report.applicationErrors, []);
    }
    await notifications();
    report.status = "passed";
    save();
    await page.screenshot({ path: path.join(directory, "result.png") });
    phase("passed");
  } catch (error) {
    report.status = "failed";
    report.failure = error.message;
    report.url = page && page.url();
    if (page && !page.isClosed()) {
      report.failureText = (await page.evaluate(() => document.body.innerText)).slice(0, 8000);
      await page.screenshot({ path: path.join(directory, "failure.png") });
    }
    save();
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
