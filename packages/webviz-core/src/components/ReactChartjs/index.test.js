// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import { mount } from "enzyme";
import Hammer from "hammerjs";
import React from "react";

import ChartComponent, { DEFAULT_PROPS } from ".";

jest.mock("../MessagePipeline", () => ({
  useMessagePipeline: () => ({ pauseFrame: () => () => {} }),
}));
jest.mock("webviz-core/src/util/supportsOffscreenCanvas", () => () => true);
jest.mock("webviz-core/src/util/WebWorkerManager", () =>
  jest.fn().mockImplementation(() => ({
    registerWorkerListener: () => ({ send: () => Promise.resolve([]) }),
    unregisterWorkerListener: jest.fn(),
  }))
);

it("releases window gesture listeners when a chart is removed", async () => {
  const destroy = jest.spyOn(Hammer.Manager.prototype, "destroy");
  // $FlowFixMe: jsdom does not implement OffscreenCanvas transfer.
  HTMLCanvasElement.prototype.transferControlToOffscreen = function() {
    return this;
  };
  try {
    for (let i = 0; i < 3; i++) {
      const chart = mount(
        <ChartComponent {...DEFAULT_PROPS} data={{ datasets: [] }} callbacksRef={{ current: null }} />
      );
      await Promise.resolve();
      await Promise.resolve();
      chart.unmount();
      expect(destroy).toHaveBeenCalledTimes(i + 1);
    }
  } finally {
    // $FlowFixMe: test-only OffscreenCanvas stub.
    delete HTMLCanvasElement.prototype.transferControlToOffscreen;
  }
});
