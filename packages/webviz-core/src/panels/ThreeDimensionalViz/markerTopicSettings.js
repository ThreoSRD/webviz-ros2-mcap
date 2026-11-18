// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

// These known publishers describe layered planning snapshots. Other MarkerArrays
// retain their incremental semantics and show all layers by default.
const PLANNING_TOPICS = ["/planning/virtual_map_polygon3d", "/planning/virtual_path_polygon3d"];

export function markerTopicSettings(topic: string, settings: any = {}): any {
  if (!PLANNING_TOPICS.includes(topic)) {
    return settings;
  }
  const result: any = { markerArrayMode: "snapshot", markerZLayer: 0 };
  for (const key of Object.keys(settings)) {
    if (settings[key] !== undefined) {
      result[key] = settings[key];
    }
  }
  return result;
}

export function resolveMarkerTopicSettings(settingsByKey: { [string]: any }): { [string]: any } {
  const result = { ...settingsByKey };
  for (const topic of PLANNING_TOPICS) {
    result[`t:${topic}`] = markerTopicSettings(topic, settingsByKey[`t:${topic}`]);
  }
  return result;
}

export function pointsMatchLayer(points: any[], layer: any): boolean {
  return (
    typeof layer !== "number" ||
    !Number.isFinite(layer) ||
    (points.length > 0 && points.every((point) => Number.isFinite(point.z) && Math.abs(point.z - layer) <= 1e-4))
  );
}
