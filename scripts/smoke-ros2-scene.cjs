// Synthetic ROS 2 TF/Marker -> real workers -> rendered pixels, with no ROS install.
// Start npm run serve-local, then npm run smoke:mcap:scene.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { makeSceneRecording, START_SEC } = require("./fixtures/ros2-scene");
const root = path.resolve(__dirname, "..");
const compression = process.env.MCAP_COMPRESSION || "";
const artifacts = path.join(root, ".cache/mcap-scene", compression || ".");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const layout = {
  version: 19,
  layout: { direction: "row", first: "3D Panel!scene", second: "RawMessages!scene", splitPercentage: 75 },
  savedProps: {
    "3D Panel!scene": {
      checkedKeys: ["name:Topics", "t:/markers", "t:/marker_array"],
      expandedKeys: ["name:root", "name:Topics"],
      followTf: "map",
      followOrientation: false,
      cameraState: {
        targetOffset: [5, 0, 0],
        distance: 20,
        perspective: false,
        phi: 0,
        thetaOffset: 0,
        fovy: Math.PI / 4,
        near: 0.01,
        far: 5000,
      },
      settingsByKey: {},
    },
    "RawMessages!scene": { topicPath: "/scene_tick", diffEnabled: false },
  },
  globalVariables: {},
  userNodes: {},
  linkedGlobalVariables: [],
  playbackConfig: { speed: 1, messageOrder: "receiveTime" },
};

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const file = path.join(artifacts, "tf-markers.mcap");
  const missingStaticFile = path.join(artifacts, "missing-static.mcap");
  fs.writeFileSync(file, await makeSceneRecording({ compression }));
  fs.writeFileSync(missingStaticFile, await makeSceneRecording({ missingStatic: true, compression }));
  const report = { status: "running", checks: [], errors: [], notifications: [] };
  const save = () => fs.writeFileSync(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  const browser = await puppeteer.launch({
    executablePath: process.env.BROWSER_PATH || "/usr/bin/google-chrome",
    userDataDir: path.join(artifacts, "browser-profile"),
    env: { ...process.env, XDG_CACHE_HOME: path.join(root, ".cache") },
    headless: true,
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
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(process.env.WEBVIZ_SMOKE_URL || "http://127.0.0.1:18080/app/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.setPanelLayout === "function");
    await page.evaluate((value) => window.setPanelLayout(value), layout);
    const upload = async (filename) => {
      await page.evaluate(() => {
        const url = new URL(location.href);
        for (const name of ["seek-to", "seek-to-relative-ms", "seek-to-fraction"]) url.searchParams.delete(name);
        history.replaceState(history.state, "", url);
        const input = document.createElement("input");
        input.type = "file";
        input.id = "scene-upload";
        input.style.display = "none";
        document.body.appendChild(input);
      });
      const input = await page.$("#scene-upload");
      try {
        await input.uploadFile(filename);
        await page.evaluate(() => {
          const input = document.getElementById("scene-upload");
          const event = new Event("drop", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "dataTransfer", { value: { files: input.files } });
          document.dispatchEvent(event);
        });
      } finally {
        await input.dispose();
        await page.evaluate(() => document.getElementById("scene-upload")?.remove());
      }
      await page.waitForFunction(() => /data[\s:]*0\b/.test(document.body.innerText), { timeout: 30000 });
    };
    const seek = async (relative) => {
      const nanoseconds = BigInt(START_SEC) * BigInt(1000000000) + BigInt(Math.round(relative * 1e9));
      const text = `${nanoseconds / BigInt(1000000000)}.${String(nanoseconds % BigInt(1000000000)).padStart(9, "0")}`;
      await page.evaluate(() => document.querySelector('[data-test="PlaybackTime-text"]').click());
      await page.waitForFunction(() => !!document.querySelector('input[data-test="PlaybackTime-text"]'));
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.type(text);
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (target) => {
          const element = document.querySelector('[data-test="PlaybackTime-text"]');
          return element && Math.abs(Number(element.textContent) - target) < 0.002;
        },
        {},
        START_SEC + relative
      );
      await sleep(200);
    };
    const pixels = async (filename) => {
      const clip = await page.evaluate(() => {
        const canvas = document.getElementById("sceneViewerCanvas");
        const { x, y, width, height } = canvas.getBoundingClientRect();
        return { x, y, width, height };
      });
      const bytes = await page.screenshot({ clip });
      if (filename) fs.writeFileSync(path.join(artifacts, `${filename}.png`), bytes);
      // Read composited screenshot pixels, not the WebGL backbuffer (which may
      // be cleared between frames, and can live in an OffscreenCanvas worker).
      return page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const sums = {
          red: { count: 0, x: 0, y: 0 },
          green: { count: 0, x: 0, y: 0 },
          yellow: { count: 0, x: 0, y: 0 },
        };
        for (let i = 0; i < data.length; i += 4) {
          const x = (i / 4) % canvas.width;
          const y = Math.floor(i / 4 / canvas.width);
          // Exclude the control/error overlays along the viewport edges.
          if (x < 70 || x >= canvas.width - 70 || y < 60 || y >= canvas.height - 30) continue;
          const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
          const color =
            r > 65 && r > g * 1.6 && r > b * 1.6
              ? "red"
              : g > 65 && g > r * 1.6 && g > b * 1.6
              ? "green"
              : r > 65 && g > 65 && b < Math.min(r, g) * 0.5
              ? "yellow"
              : null;
          if (color) {
            sums[color].count++;
            sums[color].x += (i / 4) % canvas.width;
            sums[color].y += Math.floor(i / 4 / canvas.width);
          }
        }
        for (const value of Object.values(sums)) {
          value.x /= value.count || 1;
          value.y /= value.count || 1;
        }
        return sums;
      }, bytes.toString("base64"));
    };
    const check = async (name, condition) => {
      let actual;
      for (let attempt = 0; attempt < 40; attempt++) {
        actual = await pixels();
        if (condition(actual)) {
          await sleep(200);
          actual = await pixels(name);
          if (condition(actual)) {
            report.checks.push({ name, pixels: actual });
            save();
            console.log(`PASS ${name}`);
            return actual;
          }
        }
        await sleep(100);
      }
      throw new Error(`${name}: unexpected rendered pixels ${JSON.stringify(actual)}`);
    };
    const playUntil = async (relative) => {
      await page.evaluate(() => document.querySelector(".app-container").focus());
      await page.keyboard.press("Space");
      await page.waitForFunction(
        (target) => {
          const element = document.querySelector('[data-test="PlaybackTime-text"]');
          return element && Number(element.textContent) >= target;
        },
        { timeout: 10000 },
        START_SEC + relative
      );
      await page.keyboard.press("Space");
      await sleep(200);
    };
    await upload(file);
    await seek(0.01);
    const initial = await check(
      "initial-static-dynamic-chain",
      (p) => p.red.count > 80 && p.green.count > 80 && p.yellow.count > 20
    );
    await playUntil(0.85);
    await check("duration-expires-during-playback", (p) => p.green.count < 10 && p.red.count > 80);
    await seek(2.01);
    const moved = await check(
      "dynamic-transform-moves-marker",
      (p) => p.red.count > 80 && Math.hypot(p.red.x - initial.red.x, p.red.y - initial.red.y) > 40
    );
    await seek(3.01);
    await check("delete-removes-marker", (p) => p.red.count < 10);
    await seek(4.01);
    await check(
      "add-after-delete-static-tf-retained",
      (p) => p.red.count > 80 && Math.hypot(p.red.x - moved.red.x, p.red.y - moved.red.y) > 40
    );
    await seek(5.01);
    await check("deleteall-and-array-add", (p) => p.red.count < 10 && p.green.count > 80);
    await playUntil(5.7);
    await check("array-duration-expires", (p) => p.green.count < 10 && p.red.count < 10);
    await seek(0.01);
    await check(
      "backward-seek-to-add",
      (p) => p.red.count > 80 && p.green.count > 80 && Math.hypot(p.red.x - initial.red.x, p.red.y - initial.red.y) < 3
    );
    await upload(missingStaticFile);
    await seek(0.01);
    await check("missing-static-does-not-draw-untransformed-marker", (p) => p.red.count < 10 && p.green.count > 80);
    // Read the production notification and topic-tree state after the negative
    // case. This supplements pixel checks with actionable frame diagnostics.
    const diagnostics = await page.evaluate(() => {
      const element = document.querySelector(".app-container");
      let fiber = element[Object.keys(element).find((key) => key.startsWith("__reactInternalInstance"))];
      while (fiber.return) fiber = fiber.return;
      const queue = [fiber];
      const seen = new Set();
      const notifications = [];
      const sceneErrors = {};
      while (queue.length) {
        const item = queue.pop();
        if (!item || seen.has(item)) continue;
        seen.add(item);
        const instance = item.stateNode;
        if (instance?.toggleNotificationList && Array.isArray(instance.state?.notifications)) {
          notifications.push(
            ...instance.state.notifications.map(({ message, severity, details }) => ({
              message,
              severity,
              details: typeof details === "string" ? details : String(details),
            }))
          );
        }
        for (const key of ["sceneErrorsByKey", "sceneErrorsByTopicKey"]) {
          Object.assign(sceneErrors, item.memoizedProps?.[key] || {});
        }
        queue.push(item.child, item.sibling);
      }
      return { notifications, sceneErrors };
    });
    Object.assign(report, diagnostics);
    assert.ok(
      report.sceneErrors["t:/markers"]?.some((error) => /missing transform.*sensor/.test(error)),
      "missing static TF identifies the marker frame in the topic tree"
    );
    assert.deepStrictEqual(
      report.notifications.filter((item) => item.severity === "error"),
      [],
      "no error notifications"
    );
    assert.deepStrictEqual(report.errors, [], "no uncaught browser errors");
    report.workers = page.workers().map((worker) => new URL(worker.url()).pathname.split("/").pop());
    assert.ok(report.workers.includes("WorkerDataProvider.worker.js"), "real source worker is active");
    assert.ok(report.workers.includes("Layout.worker.js"), "real layout worker is active");
    report.status = "passed";
    save();
    console.log(`Artifacts: ${artifacts}`);
  } catch (error) {
    report.status = "failed";
    report.failure = error.message;
    if (page && !page.isClosed()) {
      report.text = await page.evaluate(() => document.body.innerText);
      await page.screenshot({ path: path.join(artifacts, "failure.png") });
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
