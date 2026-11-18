// @noflow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

// Shared browser/worker helpers. Keep this module free of dependencies so the
// precision, range-read and compatibility checks can also run with Node alone.
const BILLION = BigInt(1000000000);
const ZERO = BigInt(0);
const MCAP_MAGIC = [0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a];
const BAG_MAGIC = Array.from("#ROSBAG V2.0\n", (char) => char.charCodeAt(0));

export function nanosecondsToTime(value) {
  if (value < ZERO || value / BILLION > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("MCAP timestamp is outside the supported playback range");
  }
  return { sec: Number(value / BILLION), nsec: Number(value % BILLION) };
}

export function timeToNanoseconds({ sec, nsec }) {
  if (!Number.isSafeInteger(sec) || sec < 0 || !Number.isInteger(nsec) || nsec < 0 || nsec >= 1000000000) {
    throw new Error("Invalid playback timestamp");
  }
  return BigInt(sec) * BILLION + BigInt(nsec);
}

export async function detectLocalBagFormat(file) {
  const bytes = new Uint8Array(await file.slice(0, BAG_MAGIC.length).arrayBuffer());
  if (MCAP_MAGIC.every((byte, i) => bytes[i] === byte)) {
    return "mcap";
  }
  if (BAG_MAGIC.every((byte, i) => bytes[i] === byte)) {
    return "bag";
  }
  throw new Error("Unsupported file. Open a ROS 1 .bag or an indexed ROS 2 .mcap recording.");
}

// Implements @mcap/core's IReadable using File/Blob range reads. No whole-file
// read or extra browser adapter dependency is needed.
export function createBlobReadable(file, isClosed = () => false) {
  return {
    size: async () => BigInt(file.size),
    read: async (offset, length) => {
      const end = offset + length;
      if (isClosed()) {
        throw new Error("MCAP source is closed");
      }
      if (offset < ZERO || length < ZERO || end > BigInt(file.size) || end > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("MCAP read is outside file bounds; the recording may be truncated");
      }
      const bytes = new Uint8Array(await file.slice(Number(offset), Number(end)).arrayBuffer());
      if (isClosed()) {
        throw new Error("MCAP source is closed");
      }
      if (BigInt(bytes.byteLength) !== length) {
        throw new Error("Incomplete MCAP read; the recording may be truncated");
      }
      return bytes;
    },
  };
}

// rosbag2 may use pkg/msg/Type in schema metadata and pkg/Type in embedded
// MSG sections. Normalize only AST type identifiers, never strings/defaults.
export function normalizeRos2Definitions(definitions, schemaName) {
  return definitions.map((definition, index) => ({
    ...definition,
    name: (index === 0 ? schemaName : definition.name).replace(/\/msg\//g, "/"),
    definitions: definition.definitions.map((field) => ({ ...field, type: field.type.replace(/\/msg\//g, "/") })),
  }));
}

export function panelTypeName(name) {
  const alias = name.replace(/\/msg\//g, "/");
  if (alias === "builtin_interfaces/Time") {
    return "time";
  }
  if (alias === "builtin_interfaces/Duration") {
    return "duration";
  }
  return alias;
}

export function adaptDefinitions(definitions, schemaName) {
  return definitions.map(({ name, definitions: fields }, index) => {
    const datatype = panelTypeName(index === 0 ? schemaName : name);
    return {
      name: datatype,
      definitions: fields.map((field) => ({
        ...field,
        type: panelTypeName(field.type),
        // Only builtin time definitions change; arbitrary user nanosec fields remain intact.
        name: (datatype === "time" || datatype === "duration") && field.name === "nanosec" ? "nsec" : field.name,
      })),
    };
  });
}

// Estimate retained JS storage, including an entire backing buffer when a view
// retains it. Byte arrays are never enumerated or copied.
export function estimateMessageBytes(object) {
  const seen = new WeakSet();
  const visit = (value) => {
    if (typeof value === "string") {
      return 16 + value.length * 2;
    }
    if (value == null || typeof value !== "object") {
      return 8;
    }
    if (seen.has(value)) {
      return 0;
    }
    seen.add(value);
    if (ArrayBuffer.isView(value)) {
      return 32 + visit(value.buffer);
    }
    if (value instanceof ArrayBuffer) {
      return 32 + value.byteLength;
    }
    return Object.keys(value).reduce((size, key) => size + key.length * 2 + 8 + visit(value[key]), 32);
  };
  return visit(object);
}
