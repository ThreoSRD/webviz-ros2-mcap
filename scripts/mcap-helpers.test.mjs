import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Import the exact production helper source without changing this legacy
// CommonJS project's module mode or requiring the Babel/Jest dependency tree.
const source = await readFile(new URL("../packages/webviz-core/src/dataProviders/ros2/mcapUtils.js", import.meta.url), "utf8");
const { nanosecondsToTime, timeToNanoseconds, detectLocalBagFormat, createBlobReadable, panelTypeName, adaptDefinitions, normalizeRos2Definitions, estimateMessageBytes } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const magic = Uint8Array.from([0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a]);

test("epoch nanoseconds keep precision beyond Number.MAX_SAFE_INTEGER", () => {
  const value = 1793889370123456789n;
  assert.deepEqual(nanosecondsToTime(value), { sec: 1793889370, nsec: 123456789 });
  assert.equal(timeToNanoseconds(nanosecondsToTime(value)), value);
  assert.deepEqual(nanosecondsToTime(999999999n), { sec: 0, nsec: 999999999 });
  assert.deepEqual(nanosecondsToTime(1000000000n), { sec: 1, nsec: 0 });
  assert.throws(() => nanosecondsToTime(-1n), /outside/);
  assert.throws(() => timeToNanoseconds({ sec: 1.5, nsec: 0 }), /Invalid/);
  assert.throws(() => timeToNanoseconds({ sec: 1, nsec: 1000000000 }), /Invalid/);
});

test("file contents select the reader independently of the filename", async () => {
  assert.equal(await detectLocalBagFormat(new File([magic], "renamed.bag")), "mcap");
  assert.equal(await detectLocalBagFormat(new File(["#ROSBAG V2.0\n"], "renamed.mcap")), "bag");
  await assert.rejects(detectLocalBagFormat(new Blob(["not a recording"])), /Unsupported file/);
  await assert.rejects(detectLocalBagFormat(new Blob([magic.subarray(0, 7)])), /Unsupported file/);
});

test("Blob reader requests only the requested range and rejects invalid bounds", async () => {
  const blob = new Blob([Uint8Array.from([10, 20, 30, 40])]);
  const requests = [];
  const file = { size: blob.size, slice(start, end) { requests.push([start, end]); return blob.slice(start, end); } };
  const readable = createBlobReadable(file);
  assert.equal(await readable.size(), 4n);
  assert.deepEqual(await readable.read(1n, 2n), Uint8Array.from([20, 30]));
  assert.deepEqual(requests, [[1, 3]]);
  await assert.rejects(readable.read(-1n, 1n), /bounds/);
  await assert.rejects(readable.read(3n, 2n), /bounds/);
  await assert.rejects(readable.read(0n, -1n), /bounds/);
  await assert.rejects(createBlobReadable(file, () => true).read(0n, 1n), /closed/);
  await assert.rejects(createBlobReadable({ size: 4, slice: () => new Blob([]) }).read(0n, 1n), /Incomplete/);
});

test("closing a source while a range read is pending discards its result", async () => {
  let closed = false;
  let finish;
  const readable = createBlobReadable({ size: 1, slice: () => ({ arrayBuffer: () => new Promise((resolve) => { finish = resolve; }) }) }, () => closed);
  const pending = readable.read(0n, 1n);
  closed = true;
  finish(new ArrayBuffer(1));
  await assert.rejects(pending, /closed/);
});

test("panel aliases adapt builtin time definitions without rewriting arbitrary nanosec fields", () => {
  const definitions = [
    { definitions: [{ name: "stamp", type: "builtin_interfaces/msg/Time" }, { name: "nanosec", type: "uint32" }] },
    { name: "builtin_interfaces/msg/Time", definitions: [{ name: "sec", type: "int32" }, { name: "nanosec", type: "uint32" }] },
  ];
  const normalized = normalizeRos2Definitions([
    { definitions: [{ name: "inner", type: "custom_msgs/msg/Inner" }, { name: "label", type: "string", defaultValue: "leave/msg/unchanged" }] },
    { name: "custom_msgs/Inner", definitions: [] },
  ], "custom_msgs/msg/Sample");
  assert.equal(normalized[0].name, "custom_msgs/Sample");
  assert.equal(normalized[0].definitions[0].type, "custom_msgs/Inner");
  assert.equal(normalized[0].definitions[1].defaultValue, "leave/msg/unchanged");
  const adapted = adaptDefinitions(definitions, "custom_msgs/msg/Sample");
  assert.equal(panelTypeName("sensor_msgs/msg/PointCloud2"), "sensor_msgs/PointCloud2");
  assert.equal(adapted[0].name, "custom_msgs/Sample");
  assert.equal(adapted[0].definitions[0].type, "time");
  assert.equal(adapted[0].definitions[1].name, "nanosec");
  assert.equal(adapted[1].definitions[1].name, "nsec");
  assert.equal(definitions[1].definitions[1].name, "nanosec");
});

test("cache accounting includes retained backing buffers exactly once", () => {
  const buffer = new ArrayBuffer(1024 * 1024);
  const first = new Uint8Array(buffer, 0, 8);
  const second = new Uint8Array(buffer, 8, 8);
  const size = estimateMessageBytes({ first, second, label: "points", id: 18446744073709551615n });
  assert.ok(size >= buffer.byteLength);
  assert.ok(size < buffer.byteLength + 1024);
  assert.ok(estimateMessageBytes({ text: "x".repeat(1000) }) > 2000);
  const shared = { value: 1 }; shared.self = shared;
  assert.ok(Number.isFinite(estimateMessageBytes(shared)));
});
