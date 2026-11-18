// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import React from "react";

import { type TopicSettingsEditorProps } from ".";
import { SLabel, SDescription, SInput } from "./common";
import MarkerSettingsEditor from "./MarkerSettingsEditor";
import Flex from "webviz-core/src/components/Flex";
import { Select, Option } from "webviz-core/src/components/Select";
import { markerTopicSettings } from "webviz-core/src/panels/ThreeDimensionalViz/markerTopicSettings";

export default function MarkerArraySettingsEditor(props: TopicSettingsEditorProps<any, any>) {
  const { onFieldChange } = props;
  const settings = markerTopicSettings(props.topicName || "", props.settings);
  const planningDefaults = markerTopicSettings(props.topicName || "").markerArrayMode === "snapshot";
  const mode = settings.markerArrayMode === "snapshot" ? "snapshot" : "incremental";
  const snapshotLabel = planningDefaults ? "Complete snapshot (default)" : "Complete snapshot";
  const incrementalLabel = planningDefaults ? "Incremental updates" : "Incremental updates (default)";
  return (
    <Flex col>
      <SLabel>Message handling</SLabel>
      <SDescription>
        Complete snapshot replaces all markers on this topic with each message, including empty arrays. Use it when each
        message describes the entire scene on this topic.
      </SDescription>
      <Select
        text={mode === "snapshot" ? snapshotLabel : incrementalLabel}
        value={mode}
        onChange={(value) => onFieldChange("markerArrayMode", value)}>
        <Option value="incremental">{incrementalLabel}</Option>
        <Option value="snapshot">{snapshotLabel}</Option>
      </Select>
      <SLabel>Z layer (line markers)</SLabel>
      {planningDefaults && (
        <SDescription>This planning topic defaults to the latest snapshot at Z layer 0.</SDescription>
      )}
      <SDescription>
        Leave blank to show all layers. Enter a value such as 0 to show only line markers whose points all have that
        original Z coordinate (within 0.0001). This uses point coordinates before the marker pose and frame transform.
        Other marker types are unchanged.
      </SDescription>
      <SInput
        aria-label="Z layer (line markers)"
        type="number"
        step="any"
        placeholder="All layers"
        value={Number.isFinite(settings.markerZLayer) ? settings.markerZLayer : ""}
        onChange={(event) => {
          const value = event.target.value.trim();
          const layer = value === "" ? null : Number(value);
          onFieldChange("markerZLayer", Number.isFinite(layer) ? layer : null);
        }}
      />
      <MarkerSettingsEditor {...props} />
    </Flex>
  );
}

MarkerArraySettingsEditor.canEditNamespaceOverrideColor = true;
