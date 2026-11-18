// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import { markerTopicSettings, resolveMarkerTopicSettings } from "./markerTopicSettings";

test("planning defaults support old layouts and explicit choices survive JSON round trips", () => {
  const topic = "/planning/virtual_map_polygon3d";
  expect(markerTopicSettings(topic, { overrideColor: "red" })).toEqual({
    markerArrayMode: "snapshot",
    markerZLayer: 0,
    overrideColor: "red",
  });
  const explicit = JSON.parse(JSON.stringify({ markerArrayMode: "incremental", markerZLayer: null }));
  expect(markerTopicSettings(topic, explicit)).toEqual(explicit);
  const unrelated = { markerArrayMode: "incremental" };
  expect(markerTopicSettings("/other", unrelated)).toBe(unrelated);
  expect(resolveMarkerTopicSettings({})["t:/planning/virtual_path_polygon3d"]).toEqual({
    markerArrayMode: "snapshot",
    markerZLayer: 0,
  });
});
