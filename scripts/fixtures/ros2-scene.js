// @noflow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

/* global BigInt */

// Shared Node/Jest fixture. Encode CDR independently of the decoder under test.
const { createRequire } = require("module");
const path = require("path");

const coreRequire = createRequire(path.resolve(__dirname, "../../packages/webviz-core/package.json"));
const { McapWriter } = coreRequire("@mcap/core");
const { compressionOptions } = require("./compression");

const START_SEC = 1700000100;
const BILLION = BigInt(1000000000);
const section = (name, fields) => `\n${"=".repeat(80)}\nMSG: ${name}\n${fields}\n`;
const header = section("std_msgs/Header", "builtin_interfaces/Time stamp\nstring frame_id");
const time = section("builtin_interfaces/Time", "int32 sec\nuint32 nanosec");
const vector = section("geometry_msgs/Vector3", "float64 x\nfloat64 y\nfloat64 z");
const quaternion = section("geometry_msgs/Quaternion", "float64 x\nfloat64 y\nfloat64 z\nfloat64 w");
const tfSchema = `geometry_msgs/TransformStamped[] transforms\n${section(
  "geometry_msgs/TransformStamped",
  "std_msgs/Header header\nstring child_frame_id\ngeometry_msgs/Transform transform"
)}${header}${time}${section(
  "geometry_msgs/Transform",
  "geometry_msgs/Vector3 translation\ngeometry_msgs/Quaternion rotation"
)}${vector}${quaternion}`;
// Includes the texture/embedded mesh fields from common_interfaces 4.2.0.
// Empty values test wire compatibility; rendering those resources is not covered.
const markerFields = `int32 CUBE=1
int32 ADD=0
int32 DELETE=2
int32 DELETEALL=3
std_msgs/Header header
string ns
int32 id
int32 type
int32 action
geometry_msgs/Pose pose
geometry_msgs/Vector3 scale
std_msgs/ColorRGBA color
builtin_interfaces/Duration lifetime
bool frame_locked
geometry_msgs/Point[] points
std_msgs/ColorRGBA[] colors
string texture_resource
sensor_msgs/CompressedImage texture
visualization_msgs/UVCoordinate[] uv_coordinates
string text
string mesh_resource
visualization_msgs/MeshFile mesh_file
bool mesh_use_embedded_materials
`;
const markerDependencies =
  header +
  time +
  section("geometry_msgs/Pose", "geometry_msgs/Point position\ngeometry_msgs/Quaternion orientation") +
  section("geometry_msgs/Point", "float64 x\nfloat64 y\nfloat64 z") +
  quaternion +
  vector +
  section("std_msgs/ColorRGBA", "float32 r\nfloat32 g\nfloat32 b\nfloat32 a") +
  section("builtin_interfaces/Duration", "int32 sec\nuint32 nanosec") +
  section("sensor_msgs/CompressedImage", "std_msgs/Header header\nstring format\nuint8[] data") +
  section("visualization_msgs/UVCoordinate", "float32 u\nfloat32 v") +
  section("visualization_msgs/MeshFile", "string filename\nuint8[] data");
const markerSchema = markerFields + markerDependencies;
const markerArraySchema = `visualization_msgs/Marker[] markers\n${section(
  "visualization_msgs/msg/Marker",
  markerFields
)}${markerDependencies}`;

class Cdr {
  constructor() {
    this.bytes = Buffer.alloc(65536);
    this.bytes[1] = 1;
    this.offset = 4;
  }
  align(size) {
    this.offset += (size - ((this.offset - 4) % size)) % size;
  }
  i32(value) {
    this.align(4);
    this.bytes.writeInt32LE(value, this.offset);
    this.offset += 4;
  }
  u32(value) {
    this.align(4);
    this.bytes.writeUInt32LE(value, this.offset);
    this.offset += 4;
  }
  f64(value) {
    this.align(8);
    this.bytes.writeDoubleLE(value, this.offset);
    this.offset += 8;
  }
  f32(value) {
    this.align(4);
    this.bytes.writeFloatLE(value, this.offset);
    this.offset += 4;
  }
  bool(value) {
    this.bytes[this.offset++] = value ? 1 : 0;
  }
  string(value) {
    const bytes = Buffer.from(value, "utf8");
    this.u32(bytes.length + 1);
    bytes.copy(this.bytes, this.offset);
    this.offset += bytes.length + 1;
  }
  time(sec, nsec = 0) {
    this.i32(sec);
    this.u32(nsec);
  }
  header(frame, sec = 0) {
    this.time(sec);
    this.string(frame);
  }
  vector(values) {
    values.forEach((value) => this.f64(value));
  }
  array(values, write) {
    this.u32(values.length);
    values.forEach(write);
  }
  finish() {
    return this.bytes.subarray(0, this.offset);
  }
}

function transformPayload(transforms) {
  const cdr = new Cdr();
  cdr.array(transforms, ({ parent, child, position, orientation = [0, 0, 0, 1], stamp = 0 }) => {
    cdr.header(parent, stamp);
    cdr.string(child);
    cdr.vector(position);
    cdr.vector(orientation);
  });
  return cdr.finish();
}
function writeMarker(
  cdr,
  {
    id = 1,
    action = 0,
    type = 1,
    frame = "sensor",
    ns = "demo",
    stamp = START_SEC,
    position = [1, 0, 0],
    color = [1, 0, 0, 1],
    lifetime = [0, 0],
    points = [],
    text = "中文 Marker",
  }
) {
  cdr.header(frame, stamp);
  cdr.string(ns);
  cdr.i32(id);
  cdr.i32(type);
  cdr.i32(action);
  cdr.vector(position);
  cdr.vector([0, 0, 0, 1]);
  cdr.vector([0.8, 0.8, 0.8]);
  color.forEach((value) => cdr.f32(value));
  cdr.time(...lifetime);
  cdr.bool(false);
  cdr.array(points, (point) => cdr.vector(point));
  cdr.array([], () => {});
  cdr.string(""); // texture_resource
  cdr.header(""); // texture.header
  cdr.string(""); // texture.format
  cdr.u32(0); // texture.data
  cdr.u32(0); // uv_coordinates
  cdr.string(text);
  cdr.string(""); // mesh_resource
  cdr.string(""); // mesh_file.filename
  cdr.u32(0); // mesh_file.data
  cdr.bool(false);
}
function markerPayload(markers, array = false) {
  const cdr = new Cdr();
  if (array) {
    cdr.array(markers, (marker) => writeMarker(cdr, marker));
  } else {
    writeMarker(cdr, markers[0]);
  }
  return cdr.finish();
}

async function makeSceneRecording({ missingStatic = false, compression = "" } = {}) {
  const parts = [];
  let position = BigInt(0);
  const writer = new McapWriter({
    ...compressionOptions(compression),
    chunkSize: 1, // Separate chunks exercise history reads, not just one lucky chunk.
    writable: {
      write: async (bytes) => {
        parts.push(Buffer.from(bytes));
        position += BigInt(bytes.length);
      },
      position: () => position,
    },
  });
  await writer.start({ profile: "ros2", library: "webviz-ros2-scene-fixture" });
  const channels = {};
  for (const [name, schemaName, data] of [
    ["/tf", "tf2_msgs/msg/TFMessage", tfSchema],
    ["/tf_static", "tf2_msgs/msg/TFMessage", tfSchema],
    ["/markers", "visualization_msgs/msg/Marker", markerSchema],
    ["/marker_array", "visualization_msgs/msg/MarkerArray", markerArraySchema],
    ["/unconnected", "visualization_msgs/msg/Marker", markerSchema],
    ["/scene_tick", "std_msgs/msg/UInt32", "uint32 data\n"],
  ]) {
    const schemaId = await writer.registerSchema({ name: schemaName, encoding: "ros2msg", data: Buffer.from(data) });
    channels[name] = await writer.registerChannel({
      schemaId,
      topic: name,
      messageEncoding: "cdr",
      metadata: new Map(),
    });
  }
  const messages = [];
  const add = (topic, seconds, data) => messages.push({ topic, seconds, data });
  const staticTransforms = [
    { parent: "map", child: "odom", position: [2, 0, 0] },
    { parent: "base_link", child: "sensor", position: [0, 1, 0], orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
  ];
  if (!missingStatic) {
    add("/tf_static", 0, transformPayload(staticTransforms));
  }
  for (const seconds of [0, 2, 4, 6]) {
    add(
      "/tf",
      seconds,
      transformPayload([
        { parent: "odom", child: "base_link", position: [2 * seconds, 0, 0], stamp: START_SEC + seconds },
      ])
    );
  }
  add("/markers", 0, markerPayload([{}]));
  add("/unconnected", 0, markerPayload([{ frame: "disconnected" }]));
  add(
    "/marker_array",
    0,
    markerPayload(
      [
        { id: 10, position: [1, -2, 0], color: [0, 0, 1, 1] },
        { id: 11, frame: "map", position: [0, -2, 0], color: [0, 1, 0, 1], lifetime: [0, 500000000], type: 2 },
        { id: 12, frame: "map", position: [0, 0, 0], color: [1, 1, 0, 1], type: 4, points: [[-2, -2, 0], [-2, 2, 0]] },
      ],
      true
    )
  );
  add("/markers", 2, markerPayload([{ stamp: START_SEC + 2 }]));
  add("/marker_array", 2, markerPayload([{ id: 10, action: 2 }], true));
  add("/markers", 3, markerPayload([{ action: 2 }]));
  add(
    "/marker_array",
    3,
    markerPayload([{ action: 3, ns: "" }, { id: 14, frame: "map", position: [0, 0, 0], color: [0, 0, 1, 1] }], true)
  );
  add("/markers", 4, markerPayload([{ id: 2, stamp: START_SEC + 4 }]));
  add("/marker_array", 4, markerPayload([{ action: 3, ns: "" }], true));
  add("/markers", 5, markerPayload([{ action: 3, ns: "" }]));
  add(
    "/marker_array",
    5,
    markerPayload(
      [{ id: 15, frame: "map", position: [0, -2, 0], color: [0, 1, 0, 1], lifetime: [0, 300000000], type: 2 }],
      true
    )
  );
  for (let i = 0; i <= 60; i++) {
    const cdr = new Cdr();
    cdr.u32(i);
    add("/scene_tick", i / 10, cdr.finish());
  }
  messages.sort((a, b) => a.seconds - b.seconds);
  for (let sequence = 0; sequence < messages.length; sequence++) {
    const message = messages[sequence];
    const logTime = BigInt(START_SEC) * BILLION + BigInt(Math.round(message.seconds * 1e9));
    await writer.addMessage({
      channelId: channels[message.topic],
      sequence,
      logTime,
      publishTime: logTime,
      data: message.data,
    });
  }
  await writer.end();
  return Buffer.concat(parts);
}

module.exports = { makeSceneRecording, START_SEC };
