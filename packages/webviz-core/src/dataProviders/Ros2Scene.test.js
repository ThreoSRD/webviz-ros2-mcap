// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

// Exercise decoded ROS 2 messages in the actual TF hook and scene builder.
// $FlowFixMe: Node Blob is newer than the Flow definitions.
import { Blob } from "buffer";
import { groupBy } from "lodash";
import { renderHook, act } from "react-hooks-testing-library";

import McapDataProvider from "./McapDataProvider";
import Ros2ToBobjectDataProvider from "./Ros2ToBobjectDataProvider";
import { getGlobalHooks } from "webviz-core/src/loadWebviz";
import useBlocksByTopicWithFallback from "webviz-core/src/PanelAPI/useBlocksByTopicWithFallback";
import CompactRos2MarkerMessages from "webviz-core/src/panels/ThreeDimensionalViz/Layout/compactRos2MarkerMessages";
import SceneBuilder from "webviz-core/src/panels/ThreeDimensionalViz/SceneBuilder";
import Transforms from "webviz-core/src/panels/ThreeDimensionalViz/Transforms";
import useTransformsNear from "webviz-core/src/panels/ThreeDimensionalViz/Transforms/useTransformsNear";
import { deepParse, wrapJsObject } from "webviz-core/src/util/binaryObjects";
import sendNotification from "webviz-core/src/util/sendNotification";

const { makeSceneRecording, START_SEC } = require("../../../../scripts/fixtures/ros2-scene");

jest.mock("webviz-core/src/PanelAPI/useBlocksByTopicWithFallback", () => jest.fn());
jest.mock("webviz-core/src/panels/ThreeDimensionalViz/Transforms/useStaticTransformsData", () => ({
  __esModule: true,
  default: () => [],
}));

const extensionPoint = {
  progressCallback: () => {},
  reportMetadataCallback: () => {},
  notifyPlayerManager: async () => {},
};
const at = (seconds) => ({ sec: START_SEC + Math.floor(seconds), nsec: Math.round((seconds % 1) * 1e9) });
let provider;
let info;
let messages;
let blocks;

beforeAll(async () => {
  const child = new McapDataProvider({ file: new Blob([await makeSceneRecording()]) }, []);
  provider = new Ros2ToBobjectDataProvider({}, [{ name: "McapDataProvider", args: {}, children: [] }], () => child);
  info = await provider.initialize(extensionPoint);
  const result = await provider.getMessages(at(0), at(6), { bobjects: info.topics.map((topic) => topic.name) });
  messages = result.bobjects;
  blocks = [groupBy(messages, "topic")];
});
afterAll(async () => provider.close());
beforeEach(() => {
  // $FlowFixMe: Jest mock metadata.
  useBlocksByTopicWithFallback.mockReturnValue(blocks);
});

function transformsAt(time) {
  const { result, unmount } = renderHook(() => useTransformsNear(at(time)));
  const transforms = new Transforms(result.current);
  unmount();
  return transforms;
}
function scene(time = 0) {
  const builder = new SceneBuilder(getGlobalHooks().perPanelHooks().ThreeDimensionalViz.sceneBuilderHooks);
  builder.setTopics(info.topics.filter((topic) => ["/markers", "/marker_array", "/unconnected"].includes(topic.name)));
  builder.setSelectedNamespacesByTopic({});
  builder.setSettingsByKey({});
  builder.setTransforms(transformsAt(time), "map");
  return builder;
}
function consume(builder, time, topics = ["/markers", "/marker_array"], compactor) {
  builder.setCurrentTime(at(time));
  builder.setTransforms(transformsAt(time), "map");
  const frame = groupBy(
    messages
      .filter(
        (message) =>
          topics.includes(message.topic) &&
          message.receiveTime.sec === at(time).sec &&
          message.receiveTime.nsec === at(time).nsec
      )
      .map((message) => (compactor ? compactor.compact(message) : message)),
    "topic"
  );
  builder.setFrame(frame);
  builder.render();
}
function expectFrameWarnings(topics) {
  expect(sendNotification).toHaveBeenCalledTimes(topics.length);
  for (const topic of topics) {
    expect(sendNotification).toHaveBeenCalledWith(
      `Topic ${topic} has bad frame`,
      expect.stringContaining("Non-root transforms"),
      "user",
      "warn"
    );
  }
  sendNotification.expectCalledDuringTest();
}
function markerById(markers, id): any {
  const found = markers.find((marker) => marker.id === id);
  if (!found) {
    throw new Error(`expected rendered marker ${id}`);
  }
  return found;
}
function rendered(builder) {
  const result = [];
  const collector: any = new Proxy({}, { get: (_, kind) => (marker) => result.push({ kind, ...marker }) });
  builder.renderMarkers(collector);
  return result;
}

function snapshotMessage(ids, seconds, frameId = "/base_link", overrides = {}) {
  const template = deepParse(
    messages
      .find((message) => message.topic === "/marker_array")
      .message.markers()
      .get(0)
  );
  return {
    topic: "/marker_array",
    receiveTime: at(seconds),
    message: wrapJsObject(info.messageDefinitions.datatypes, "visualization_msgs/MarkerArray", {
      markers: ids.map((id) => ({
        ...template,
        id,
        ns: "changing-ids",
        action: 0,
        header: { frame_id: frameId, stamp: at(seconds) },
        lifetime: { sec: 0, nsec: 0 },
        ...overrides,
      })),
    }),
  };
}

function snapshotScene(snapshot = true) {
  const builder = scene();
  builder.setTransforms(new Transforms([]), "base_link");
  builder.setSettingsByKey({ "t:/marker_array": { markerArrayMode: snapshot ? "snapshot" : "incremental" } });
  return builder;
}

function renderSnapshots(builder, seconds, frameMessages) {
  // Match LayoutWorker's ordering: frame arrives before the new clock.
  builder.setFrame({ "/marker_array": frameMessages });
  builder.setCurrentTime(at(seconds));
  builder.render();
  return rendered(builder).map((marker) => marker.id);
}

test("complete snapshots replace changing IDs, shrink, and clear on empty arrays", () => {
  const builder = snapshotScene();
  expect(renderSnapshots(builder, 0, [snapshotMessage([1, 2, 3], 0)])).toEqual([1, 2, 3]);
  expect(renderSnapshots(builder, 1, [snapshotMessage([4, 5], 1)])).toEqual([4, 5]);
  expect(renderSnapshots(builder, 2, [snapshotMessage([], 2)])).toEqual([]);
  expect(builder.hasErrors()).toBe(false);
});

test("complete snapshots use the last message in a batch and survive settings serialization", () => {
  const builder = snapshotScene();
  builder.setSettingsByKey(JSON.parse(JSON.stringify({ "t:/marker_array": { markerArrayMode: "snapshot" } })));
  expect(renderSnapshots(builder, 2, [snapshotMessage([1, 2], 0), snapshotMessage([3], 1)])).toEqual([3]);
  expect(renderSnapshots(builder, 3, [snapshotMessage([4], 2), snapshotMessage([], 3)])).toEqual([]);
});

test("incremental mode retains IDs and switching modes clears accumulated geometry while paused", () => {
  const builder = snapshotScene(false);
  expect(renderSnapshots(builder, 0, [snapshotMessage([1, 2], 0)])).toEqual([1, 2]);
  expect(renderSnapshots(builder, 1, [snapshotMessage([3], 1)])).toEqual([1, 2, 3]);
  builder.setSettingsByKey({ "t:/marker_array": { markerArrayMode: "snapshot" } });
  builder.render();
  expect(rendered(builder).map((marker) => marker.id)).toEqual([3]);
  builder.setSettingsByKey({});
  builder.render();
  expect(rendered(builder).map((marker) => marker.id)).toEqual([3]);
});

test("backward seeks do not resurrect future snapshots and replay uses the earlier snapshot", () => {
  const builder = snapshotScene();
  renderSnapshots(builder, 2, [snapshotMessage([20], 2)]);
  builder.setFrame({});
  builder.setCurrentTime(at(0));
  builder.render();
  expect(rendered(builder)).toEqual([]);
  expect(renderSnapshots(builder, 1, [snapshotMessage([10], 1)])).toEqual([10]);
  expect(renderSnapshots(builder, 2, [snapshotMessage([20], 2)])).toEqual([20]);
});

test("clearing or replacing the player removes persistent snapshots", () => {
  const builder = snapshotScene();
  renderSnapshots(builder, 1, [snapshotMessage([10], 1)]);
  builder.clear();
  expect(rendered(builder)).toEqual([]);
  renderSnapshots(builder, 2, [snapshotMessage([20], 2)]);
  builder.setPlayerId("replacement");
  builder.setFrame({});
  builder.render();
  expect(rendered(builder)).toEqual([]);
});

test("leading slash aliases do not warn in either root direction", () => {
  for (const [root, frameId] of [["base_link", "/base_link"], ["/base_link", "base_link"]]) {
    const builder = snapshotScene();
    builder.setTransforms(new Transforms([]), root);
    expect(renderSnapshots(builder, 0, [snapshotMessage([1], 0, frameId)])).toEqual([1]);
    expect(builder.hasErrors()).toBe(false);
  }
  expect(sendNotification).not.toHaveBeenCalled();
});

test("Z layer selection filters whole lines and switches layers while paused without losing state", () => {
  const builder = snapshotScene(false);
  const line = (id, z, extra = {}) =>
    snapshotMessage([id], 0, "/base_link", {
      type: 4,
      points: [{ x: 0, y: 0, z }, { x: 1, y: 0, z }],
      ...extra,
    });
  renderSnapshots(builder, 0, [
    line(1, 0),
    line(2, 0.5),
    line(3, -1),
    line(4, 0.00001),
    line(5, 0, { points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }] }),
    line(6, 0, { type: 1 }),
  ]);
  const select = (layer) => {
    builder.setSettingsByKey({ "t:/marker_array": { markerArrayMode: "incremental", markerZLayer: layer } });
    builder.render();
    return rendered(builder).map((marker) => marker.id);
  };
  expect(select(0)).toEqual([1, 4, 6]);
  expect(select(0.5)).toEqual([2, 6]);
  expect(select(-1)).toEqual([3, 6]);
  expect(select(undefined)).toEqual([1, 2, 3, 4, 5, 6]);

  // A hidden marker must still process a delete and an update to a different layer.
  select(0);
  renderSnapshots(builder, 1, [line(2, 0.5, { action: 2 }), line(3, 0)]);
  expect(select(0.5)).toEqual([6]);
  expect(select(0)).toEqual([1, 3, 4, 6]);
});

test("snapshot layers can be changed while paused without materializing hidden lines", () => {
  const builder = snapshotScene();
  const template = deepParse(snapshotMessage([0], 0).message).markers[0];
  const line = (id, z) => ({
    ...template,
    id,
    type: 4,
    points: [{ x: 0, y: 0, z }, { x: 1, y: 0, z }],
  });
  const message = {
    topic: "/marker_array",
    receiveTime: at(0),
    message: wrapJsObject(info.messageDefinitions.datatypes, "visualization_msgs/MarkerArray", {
      markers: [line(1, 0), line(2, -1), line(3, 0.5)],
    }),
  };
  const select = (layer, mode = "snapshot") => {
    builder.setSettingsByKey({ "t:/marker_array": { markerArrayMode: mode, markerZLayer: layer } });
    builder.render();
    return rendered(builder).map((marker) => marker.id);
  };
  builder.setSettingsByKey({ "t:/marker_array": { markerArrayMode: "snapshot", markerZLayer: 0 } });
  expect(renderSnapshots(builder, 0, [message])).toEqual([1]);
  expect(builder.collectors["/marker_array"].getMessages()).toHaveLength(1);
  expect(builder.getScene().minZ).toBe(-1);
  expect(select(-1)).toEqual([2]);
  expect(select(null)).toEqual([1, 2, 3]);
  expect(select(0)).toEqual([1]);
  // Incremental mode needs to retain all layers for updates in later arrays.
  expect(select(0, "incremental")).toEqual([1]);
  expect(builder.collectors["/marker_array"].getMessages()).toHaveLength(3);
  expect(select(0.5, "incremental")).toEqual([3]);
});

test("hidden snapshot lines still replace IDs and honor delete actions", () => {
  const builder = snapshotScene();
  builder.setSettingsByKey({ "t:/marker_array": { markerArrayMode: "snapshot", markerZLayer: 0 } });
  const template = deepParse(snapshotMessage([0], 0).message).markers[0];
  const line = (id, z, action = 0) => ({
    ...template,
    id,
    action,
    type: 4,
    points: [{ x: 0, y: 0, z }, { x: 1, y: 0, z }],
  });
  const batch = (markers) => ({
    topic: "/marker_array",
    receiveTime: at(0),
    message: wrapJsObject(info.messageDefinitions.datatypes, "visualization_msgs/MarkerArray", { markers }),
  });
  expect(renderSnapshots(builder, 0, [batch([line(1, 0), line(1, 1)])])).toEqual([]);
  builder.setSettingsByKey({ "t:/marker_array": { markerArrayMode: "snapshot", markerZLayer: 1 } });
  builder.render();
  expect(rendered(builder).map((marker) => marker.id)).toEqual([1]);
  builder.setSettingsByKey({ "t:/marker_array": { markerArrayMode: "snapshot", markerZLayer: 0 } });
  expect(renderSnapshots(builder, 0, [batch([line(1, 0), line(1, 1, 2)])])).toEqual([]);
  expect(renderSnapshots(builder, 0, [batch([line(1, 0), line(2, 1, 3)])])).toEqual([]);
  const missingFrame = { ...line(1, 1), header: { ...template.header, frame_id: "" } };
  expect(renderSnapshots(builder, 0, [batch([line(1, 0), missingFrame])])).toEqual([1]);
  expect(builder.errorsByTopic["/marker_array"].join(" ")).toMatch(/missing frame id/);
});

test("identical text at one position collapses without losing updates, deletes or expiry", () => {
  const builder = snapshotScene(false);
  const label = (id, extra = {}) =>
    snapshotMessage([id], 0, "/base_link", {
      type: 9,
      text: "0 ,",
      ...extra,
    });
  expect(renderSnapshots(builder, 0, [label(1), label(2), label(3)])).toEqual([1]);
  expect(builder.collectors["/marker_array"].getMessages()).toHaveLength(3);
  builder.setSettingsByKey({ "t:/marker_array": { markerArrayMode: "incremental", showDuplicateText: true } });
  builder.render();
  expect(rendered(builder).map((m) => m.id)).toEqual([1, 2, 3]);
  builder.setSettingsByKey({ "t:/marker_array": { markerArrayMode: "incremental" } });
  expect(renderSnapshots(builder, 0.1, [label(1, { action: 2 })])).toEqual([2]);
  expect(renderSnapshots(builder, 0.2, [label(3, { text: "changed" })])).toEqual([2, 3]);
  renderSnapshots(builder, 0.3, [label(2, { lifetime: { sec: 0, nsec: 100000000 } })]);
  builder.setCurrentTime(at(1));
  expect(rendered(builder).map((m) => m.id)).toEqual([3]);
});

test("different positions, namespaces, colors and content keep separate text labels", () => {
  const builder = snapshotScene(false);
  const label = (id, extra = {}) => snapshotMessage([id], 0, "/base_link", { type: 9, text: "0 ,", ...extra });
  const original = deepParse(label(1).message).markers[0];
  expect(
    renderSnapshots(builder, 0, [
      label(1),
      label(2, { text: "1 ," }),
      label(3, { ns: "other" }),
      label(4, { color: { r: 1, g: 0, b: 0, a: 1 } }),
      label(5, { pose: { ...original.pose, position: { x: 100, y: 0, z: 0 } } }),
    ])
  ).toEqual([1, 2, 3, 4, 5]);
});

test("standard ROS 2 scene schemas expose Time, Duration, arrays, constants and UTF-8 to existing consumers", () => {
  const marker = messages.find((message) => message.topic === "/markers").message;
  expect(marker.CUBE()).toBe(1);
  expect(marker.header().frame_id()).toBe("sensor");
  expect(deepParse(marker.header().stamp())).toEqual(at(0));
  expect(marker.text()).toBe("中文 Marker");
  const array = messages.find((message) => message.topic === "/marker_array").message.markers();
  expect(array.length()).toBe(3);
  expect(deepParse(array.get(1).lifetime())).toEqual({ sec: 0, nsec: 500000000 });
  expect(deepParse(array.get(2).points())).toEqual([{ x: -2, y: -2, z: 0 }, { x: -2, y: 2, z: 0 }]);
  expect(deepParse(marker.mesh_file())).toEqual({ filename: "", data: new Uint8Array(0) });
  expect(info.topics.find((topic) => topic.name === "/tf_static").datatype).toBe("tf2_msgs/TFMessage");
});

test("TF hook keeps zero-stamped static links and chooses dynamic data in both seek directions", () => {
  const hook = renderHook(({ time }) => useTransformsNear(at(time)), { initialProps: { time: 0.01 } });
  for (const seconds of [0.01, 2.01, 4.01, 0.01]) {
    act(() => hook.rerender({ time: seconds }));
    const transforms = new Transforms(hook.result.current);
    const pose = { position: { x: 1, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
    const result = transforms.apply(
      { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      pose,
      "sensor",
      "map"
    );
    expect(result).not.toBeNull();
    if (!result) {
      throw new Error("expected a connected frame chain");
    }
    // map -> odom translates +2; dynamic odom -> base translates 2*t;
    // static base -> sensor translates +1Y and rotates local +X to +Y.
    expect(result.position.x).toBeCloseTo(2 + 4 * Math.floor(seconds / 2), 5);
    expect(result.position.y).toBeCloseTo(2, 5);
  }
  hook.unmount();
});

test("Marker and MarkerArray render through a static/dynamic frame chain", () => {
  const builder = scene();
  consume(builder, 0);
  const markers = rendered(builder);
  const cube = markerById(markers, 1);
  expect(cube.kind).toBe("cube");
  expect(cube.pose.position.x).toBeCloseTo(2, 5);
  expect(cube.pose.position.y).toBeCloseTo(2, 5);
  expect(markerById(markers, 10).pose.position.x).toBeCloseTo(4, 5);
  expect(markerById(markers, 12).kind).toBe("lineStrip");
  expect(builder.errorsByTopic).toEqual({});
  expectFrameWarnings(["/markers", "/marker_array"]);
});

test("ADD replaces an id, DELETE removes it, and DELETEALL is applied before following array entries", () => {
  const builder = scene();
  consume(builder, 0);
  consume(builder, 2);
  let markers = rendered(builder);
  expect(markers.filter((marker) => marker.id === 1)).toHaveLength(1);
  expect(markerById(markers, 1).pose.position.x).toBeCloseTo(6, 5);
  expect(markers.some((marker) => marker.id === 10)).toBe(false);
  consume(builder, 3);
  markers = rendered(builder);
  expect(markers.map((marker) => marker.id)).toEqual([14]);
  consume(builder, 4);
  expect(rendered(builder).map((marker) => marker.id)).toEqual([2]);
  consume(builder, 5);
  expect(rendered(builder).map((marker) => marker.id)).toEqual([15]);
  expectFrameWarnings(["/markers", "/marker_array"]);
});

test("compacted ROS 2 MarkerArrays retain 3D lifetime and delete behavior", () => {
  const compactor = new CompactRos2MarkerMessages();
  const original = messages.find((message) => message.topic === "/marker_array");
  expect(compactor.compact(original)).not.toBe(original);
  const builder = scene();
  consume(builder, 0, undefined, compactor);
  builder.setCurrentTime({ sec: START_SEC, nsec: 500000001 });
  expect(rendered(builder).some((marker) => marker.id === 11)).toBe(false);
  consume(builder, 2, undefined, compactor);
  expect(rendered(builder).some((marker) => marker.id === 10)).toBe(false);
  consume(builder, 3, undefined, compactor);
  expect(rendered(builder).map((marker) => marker.id)).toEqual([14]);
  consume(builder, 4, undefined, compactor);
  expect(rendered(builder).map((marker) => marker.id)).toEqual([2]);
  consume(builder, 5, undefined, compactor);
  expect(rendered(builder).map((marker) => marker.id)).toEqual([15]);
  expectFrameWarnings(["/markers", "/marker_array"]);
});

test("ROS 2 Duration expires markers on the existing receive-time clock, including the nanosecond boundary", () => {
  const builder = scene();
  consume(builder, 0);
  builder.setCurrentTime(at(0.5));
  expect(rendered(builder).some((marker) => marker.id === 11)).toBe(true);
  builder.setCurrentTime({ sec: START_SEC, nsec: 500000001 });
  const markers = rendered(builder);
  expect(markers.some((marker) => marker.id === 11)).toBe(false);
  expect(markers.some((marker) => marker.id === 1)).toBe(true); // Zero duration is infinite.
  // The real 3D panel can re-send the last frame on a clock/camera change.
  // Re-consuming that same recorded message must not restart its lifetime.
  const original = messages.find((message) => message.topic === "/marker_array");
  builder.setCurrentTime(at(0.9));
  builder.setFrame({ "/marker_array": [original] });
  builder.render();
  expect(rendered(builder).some((marker) => marker.id === 11)).toBe(false);
  // A newly received update of the same id does restart its lifetime.
  builder.setFrame({ "/marker_array": [{ ...original, receiveTime: at(0.9) }] });
  builder.render();
  expect(rendered(builder).some((marker) => marker.id === 11)).toBe(true);
  builder.setCurrentTime(at(1.5));
  expect(rendered(builder).some((marker) => marker.id === 11)).toBe(false);
  expectFrameWarnings(["/markers", "/marker_array"]);
});

test("an unconnected ROS 2 marker reports a missing transform instead of drawing at a false origin", () => {
  const builder = scene();
  consume(builder, 0, ["/unconnected"]);
  expect(rendered(builder)).toEqual([]);
  expect(builder.errorsByTopic["/unconnected"].join(" ")).toMatch(/disconnected/);
  const known = transformsAt(0).rawTransforms;
  const pose = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  builder.setTransforms(new Transforms([...known, { parentFrame: "map", childFrame: "disconnected", pose }]), "map");
  builder.setFrame({ "/unconnected": messages.filter((message) => message.topic === "/unconnected") });
  builder.render();
  expect(rendered(builder)).toHaveLength(1);
  expect(builder.errorsByTopic["/unconnected"]).toBeUndefined();
  expectFrameWarnings(["/unconnected"]);
});

test("planning arrays appearing late stay on the current layer and bound namespace growth", () => {
  const topic = "/planning/virtual_map_polygon3d";
  const builder = snapshotScene();
  builder.setTopics([{ name: topic, datatype: "visualization_msgs/MarkerArray" }]);
  // Existing saved settings contain no markerZLayer.
  builder.setSettingsByKey({ [`t:${topic}`]: { markerArrayMode: "snapshot" } });
  const onForceUpdate = jest.fn();
  builder.setOnForceUpdate(onForceUpdate);
  const batch = (seconds, size, ground) => {
    const template = deepParse(snapshotMessage([0], seconds).message).markers[0];
    return {
      topic,
      receiveTime: at(seconds),
      message: wrapJsObject(info.messageDefinitions.datatypes, "visualization_msgs/MarkerArray", {
        markers: Array.from({ length: size }, (_, id) => ({
          ...template,
          id,
          ns: `3dMap_marker${id}`,
          type: 4,
          points: [{ x: id, y: 0, z: id < ground ? 0 : 0.5 }, { x: id + 1, y: 0, z: id < ground ? 0 : 0.5 }],
        })),
      }),
    };
  };
  const update = (seconds, frame) => {
    builder.setFrame(frame);
    builder.setCurrentTime(at(seconds));
    builder.render();
  };
  update(0, {});
  expect(rendered(builder)).toHaveLength(0);
  update(1, { [topic]: [batch(1, 3000, 27)] });
  expect(rendered(builder)).toHaveLength(27);
  expect(builder.collectors[topic].getMessages()).toHaveLength(27);
  expect(builder.allNamespaces).toHaveLength(27);
  expect(onForceUpdate).toHaveBeenCalledTimes(1);
  update(2, { [topic]: [batch(2, 2000, 15)] });
  expect(rendered(builder)).toHaveLength(15);
  expect(builder.allNamespaces).toHaveLength(15);
  builder.setSettingsByKey({ [`t:${topic}`]: { markerZLayer: null } });
  builder.render();
  expect(rendered(builder)).toHaveLength(2000);
  expect(builder.allNamespaces).toHaveLength(2000);
  builder.setSettingsByKey({});
  builder.render();
  expect(rendered(builder)).toHaveLength(15);
  expect(builder.allNamespaces).toHaveLength(15);
  update(0, {});
  expect(rendered(builder)).toHaveLength(0);
  expect(builder.allNamespaces).toHaveLength(0);
});
