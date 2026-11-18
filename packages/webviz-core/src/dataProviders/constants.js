// @flow
//
//  Copyright (c) 2019-present, Cruise LLC
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.
// Modified in the Webviz ROS 2 MCAP project; see MODIFICATIONS.md at the repository root.
export const CoreDataProviders = {
  ApiCheckerDataProvider: "ApiCheckerDataProvider",
  BagDataProvider: "BagDataProvider",
  McapDataProvider: "McapDataProvider",
  Ros2ToBobjectDataProvider: "Ros2ToBobjectDataProvider",
  CombinedDataProvider: "CombinedDataProvider",
  IdbCacheReaderDataProvider: "IdbCacheReaderDataProvider",
  IdbCacheWriterDataProvider: "IdbCacheWriterDataProvider",
  MeasureDataProvider: "MeasureDataProvider",
  MemoryCacheDataProvider: "MemoryCacheDataProvider",
  ParseMessagesDataProvider: "ParseMessagesDataProvider",
  RenameDataProvider: "RenameDataProvider",
  RewriteBinaryDataProvider: "RewriteBinaryDataProvider",
  RpcDataProvider: "RpcDataProvider",
  WorkerDataProvider: "WorkerDataProvider",
};
export const MESSAGE_FORMATS = ["bobjects", "rosBinaryMessages", "parsedMessages"];
