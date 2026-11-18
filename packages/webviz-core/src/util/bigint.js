// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

// ROS 2 CDR decoding keeps int64/uint64 fields as native BigInt (the ROS 1 path
// yields Numbers). Flow 0.110 and ESLint 5 predate the "bigint" typeof result,
// so the check is isolated here.
export function isBigInt(value: mixed): boolean {
  // $FlowFixMe - Flow 0.110 does not know the bigint typeof result.
  return typeof value === "bigint"; // eslint-disable-line valid-typeof
}

// JSON.stringify throws on BigInt. Use as its replacer to keep the exact digits as a string.
export function bigIntJsonReplacer(_key: string, value: mixed): mixed {
  return isBigInt(value) ? String(value) : value;
}
