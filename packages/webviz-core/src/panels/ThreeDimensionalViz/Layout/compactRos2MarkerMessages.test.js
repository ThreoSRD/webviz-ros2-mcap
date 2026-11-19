// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import CompactRos2MarkerMessages from "./compactRos2MarkerMessages";
import { deepParse, wrapJsObject, wrapRos2DecodedObject } from "webviz-core/src/util/binaryObjects";
import { getSourceData } from "webviz-core/src/util/binaryObjects/messageDefinitionUtils";

const datatype = "visualization_msgs/MarkerArray";
const datatypes = {
  [datatype]: {
    fields: [{ name: "markers", type: "visualization_msgs/Marker", isArray: true }],
  },
  "visualization_msgs/Marker": {
    fields: [
      { name: "id", type: "int32" },
      { name: "ns", type: "string" },
      { name: "action", type: "uint8" },
      { name: "lifetime", type: "duration" },
      { name: "points", type: "geometry_msgs/Point", isArray: true },
      { name: "data", type: "uint8", isArray: true },
    ],
  },
  "geometry_msgs/Point": {
    fields: [{ name: "x", type: "float64" }, { name: "z", type: "float64" }],
  },
};
const decoded = {
  markers: [
    {
      id: 4,
      ns: "constructor",
      action: 0,
      lifetime: { sec: 0, nsec: 200 },
      points: [{ x: 1.5, z: -1 }],
      data: new Uint8Array([0, 255]),
    },
    {
      id: 5,
      ns: "__proto__",
      action: 2,
      lifetime: { sec: 0, nsec: 0 },
      points: [],
      data: new Uint8Array(0),
    },
    {
      id: 6,
      ns: "路标",
      action: 3,
      lifetime: { sec: 1, nsec: 0 },
      points: [],
      data: new Uint8Array(0),
    },
  ],
};
const receiveTime = { sec: 3, nsec: 17 };

function hasBinaryBacking(message) {
  return !!getSourceData(Object.getPrototypeOf(message).constructor)?.buffer;
}

test("compacts decoded ROS 2 MarkerArrays without changing marker values or the original message", () => {
  const compactor = new CompactRos2MarkerMessages();
  const original = {
    topic: "/markers",
    receiveTime,
    message: wrapRos2DecodedObject(datatypes, datatype, decoded, 1000),
  };
  const compact = compactor.compact(original);
  expect(compact).not.toBe(original);
  expect(compact.topic).toBe(original.topic);
  expect(compact.receiveTime).toEqual(receiveTime);
  expect(hasBinaryBacking(compact.message)).toBe(true);
  expect(deepParse(compact.message)).toEqual(decoded);
  expect(hasBinaryBacking(original.message)).toBe(false);
  expect(deepParse(original.message)).toEqual(decoded);
  compactor.clear();
});

test("does not compact generic bobjects or schemas with 64-bit integers", () => {
  const compactor = new CompactRos2MarkerMessages();
  const generic = {
    topic: "/markers",
    receiveTime,
    message: wrapJsObject(datatypes, datatype, decoded),
  };
  expect(compactor.compact(generic)).toBe(generic);
  const withUint64 = {
    ...datatypes,
    [datatype]: {
      fields: [...datatypes[datatype].fields, { name: "counter", type: "uint64" }],
    },
  };
  const value = { ...decoded, counter: BigInt("18446744073709551615") };
  const message = {
    topic: "/markers",
    receiveTime,
    message: wrapRos2DecodedObject(withUint64, datatype, value, 1000),
  };
  expect(compactor.compact(message)).toBe(message);
  expect(deepParse(message.message).counter).toBe(value.counter);
});

test("preserves typed numeric arrays by using the original transport", () => {
  const withFloats = {
    ...datatypes,
    [datatype]: { fields: [...datatypes[datatype].fields, { name: "samples", type: "float32", isArray: true }] },
  };
  const value = { ...decoded, samples: new Float32Array([1.5, 2.5]) };
  const message = { topic: "/markers", receiveTime, message: wrapRos2DecodedObject(withFloats, datatype, value, 1000) };
  const compact = new CompactRos2MarkerMessages().compact(message);
  expect(compact).toBe(message);
  expect(deepParse(compact.message).samples).toBeInstanceOf(Float32Array);
  expect(Array.from(deepParse(compact.message).samples)).toEqual([1.5, 2.5]);
});

test("preserves time fields that cannot fit in the binary representation", () => {
  const value = {
    markers: [{ ...decoded.markers[0], lifetime: { sec: 0, nsec: 2147483648 } }],
  };
  const message = { topic: "/markers", receiveTime, message: wrapRos2DecodedObject(datatypes, datatype, value, 1000) };
  const compact = new CompactRos2MarkerMessages().compact(message);
  expect(compact).toBe(message);
  expect(deepParse(compact.message).markers[0].lifetime.nsec).toBe(2147483648);
});

test("keeps the original message if compaction cannot encode a value", () => {
  const compactor = new CompactRos2MarkerMessages();
  const invalid = Object.defineProperty({}, "markers", {
    get: () => {
      throw new Error("invalid message");
    },
  });
  const message = {
    topic: "/markers",
    receiveTime,
    message: wrapRos2DecodedObject(datatypes, datatype, invalid, 1000),
  };
  expect(compactor.compact(message)).toBe(message);
});
