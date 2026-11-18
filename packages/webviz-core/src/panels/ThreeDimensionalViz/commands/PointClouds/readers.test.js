// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import { getReader } from "./readers";
import { DATATYPE } from "./types";

// Standard PointField enum values 1..8. Literal bytes avoid testing one
// implementation against another conversion of the same JS number.
test.each([
  [DATATYPE.int8, [0x80], -128],
  [DATATYPE.uint8, [0xff], 255],
  [DATATYPE.int16, [0x00, 0x80], -32768],
  [DATATYPE.uint16, [0xff, 0xff], 65535],
  [DATATYPE.int32, [0x00, 0x00, 0x00, 0x80], -2147483648],
  [DATATYPE.uint32, [0xff, 0xff, 0xff, 0xff], 4294967295],
  [DATATYPE.float32, [0x00, 0x00, 0xc0, 0x3f], 1.5],
  [DATATYPE.float64, [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f], 1.5],
])("reads PointField datatype %i at a nonzero point and field offset", (datatype, bytes, expected) => {
  const reader = getReader(datatype, 2);
  if (!reader) {
    throw new Error(`Missing reader for PointField datatype ${datatype}`);
  }
  const input = Uint8Array.from([99, 98, 97, ...bytes, 96]);
  expect(reader.read(input, 1)).toBe(expected);
  expect(reader.read(Array.from(input), 1)).toBe(expected);
});
