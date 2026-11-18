// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import { LayoutWorkerDataSender } from "./WorkerDataRpc";
import signal from "webviz-core/shared/signal";
import { BobjectRpcReceiver } from "webviz-core/src/util/binaryObjects/BobjectRpc";
import Rpc, { createLinkedChannels } from "webviz-core/src/util/Rpc";

test("closing a 3D sender releases queued renders and never sends another frame", async () => {
  const channels = createLinkedChannels();
  const rpc = new Rpc(channels.local);
  const receiver = new BobjectRpcReceiver(new Rpc(channels.remote));
  const finish = signal<void>();
  const render = jest.fn(async () => {
    await finish;
  });
  receiver.receive("$$startFrame", "bobject", render);
  const sender = new LayoutWorkerDataSender(rpc);
  const frame = { frame: {}, worldContextValue: {} };
  const active = sender.renderFrame({ ...frame, frameIndex: 1 });
  const queued = sender.renderFrame({ ...frame, frameIndex: 2 });
  sender.close();
  await expect(queued).resolves.toBe(false);
  finish.resolve();
  await expect(active).resolves.toBe(false);
  await expect(sender.renderFrame({ ...frame, frameIndex: 3 })).resolves.toBe(false);
  expect(render).toHaveBeenCalledTimes(1);
});
