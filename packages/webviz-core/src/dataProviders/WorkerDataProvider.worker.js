// @flow
//
//  Copyright (c) 2018-present, Cruise LLC
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.
// Modified in the Webviz ROS 2 MCAP project; see MODIFICATIONS.md at the repository root.

import ApiCheckerDataProvider from "webviz-core/src/dataProviders/ApiCheckerDataProvider";
import BagDataProvider from "webviz-core/src/dataProviders/BagDataProvider";
import createGetDataProvider from "webviz-core/src/dataProviders/createGetDataProvider";
import IdbCacheWriterDataProvider from "webviz-core/src/dataProviders/IdbCacheWriterDataProvider";
import McapDataProvider from "webviz-core/src/dataProviders/McapDataProvider";
import MeasureDataProvider from "webviz-core/src/dataProviders/MeasureDataProvider";
import RpcDataProviderRemote from "webviz-core/src/dataProviders/RpcDataProviderRemote";
import Rpc from "webviz-core/src/util/Rpc";

// This is the open source version. There is also an internal variant.

const getDataProvider = createGetDataProvider({
  ApiCheckerDataProvider,
  BagDataProvider,
  IdbCacheWriterDataProvider,
  McapDataProvider,
  MeasureDataProvider,
});

if (global.postMessage && !global.onmessage) {
  new RpcDataProviderRemote(new Rpc(global), getDataProvider);
}
