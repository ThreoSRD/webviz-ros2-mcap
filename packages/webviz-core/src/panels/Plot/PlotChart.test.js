// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import { getDatasetsAndTooltips } from "./PlotChart";

// Flow 0.110 cannot represent native bigint; isolate that test boundary.
const toBigInt: (value: string) => any = BigInt;

describe("getDatasetsAndTooltips", () => {
  it("plots ROS 2 int64/uint64 BigInt values and keeps the exact value in the tooltip", () => {
    const path = { value: "/counter.count", enabled: true, timestampMethod: "receiveTime" };
    const item = (sec, value) => ({
      queriedData: [{ value, path: "/counter.count", constantName: undefined }],
      receiveTime: { sec, nsec: 0 },
      headerStamp: undefined,
    });
    const { datasets, tooltips } = getDatasetsAndTooltips(
      [path],
      { [path.value]: [[item(1, toBigInt("5")), item(2, toBigInt("18446744073709551615"))]] },
      { sec: 0, nsec: 0 },
      "timestamp"
    );
    expect(datasets[0].data.map(({ x, y }) => [x, y])).toEqual([[1, 5], [2, 18446744073709551615]]);
    expect(tooltips.map(({ value }) => value)).toEqual(["5", "18446744073709551615"]);
  });
});
