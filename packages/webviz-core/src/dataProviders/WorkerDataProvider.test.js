// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import { mockExtensionPoint } from "./mockExtensionPoint";
import RpcDataProviderRemote from "./RpcDataProviderRemote";
import WorkerDataProvider from "./WorkerDataProvider";
import TestProvider from "webviz-core/src/players/TestProvider";
import Rpc, { createLinkedChannels } from "webviz-core/src/util/Rpc";

jest.mock("./WorkerDataProvider.worker", () => jest.fn());
const MockWorker = require("./WorkerDataProvider.worker");

function setup() {
  const remote = new TestProvider();
  const { local, remote: remoteChannel } = createLinkedChannels();
  const terminate = jest.fn();
  // $FlowFixMe - The fake transport models the worker's termination separately.
  local.terminate = terminate;
  new RpcDataProviderRemote(new Rpc(remoteChannel), () => remote);
  // $FlowFixMe - This constructor is replaced by Jest above.
  MockWorker.mockImplementation(() => local);
  const provider = new WorkerDataProvider({}, [{ name: "TestProvider", args: {}, children: [] }]);
  return { provider, remote, terminate };
}

test("terminates a worker when initialization fails", async () => {
  const { provider, remote, terminate } = setup();
  jest.spyOn(remote, "initialize").mockRejectedValueOnce(new Error("invalid recording"));
  await expect(provider.initialize(mockExtensionPoint().extensionPoint)).rejects.toThrow("invalid recording");
  expect(terminate).toHaveBeenCalledTimes(1);
});

test("terminates a worker even when source cleanup fails", async () => {
  const { provider, remote, terminate } = setup();
  await provider.initialize(mockExtensionPoint().extensionPoint);
  jest.spyOn(remote, "close").mockRejectedValueOnce(new Error("cleanup failed"));
  await expect(provider.close()).rejects.toThrow("cleanup failed");
  expect(terminate).toHaveBeenCalledTimes(1);
});
