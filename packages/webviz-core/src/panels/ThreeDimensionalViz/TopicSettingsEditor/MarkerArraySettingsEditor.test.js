// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import { shallow } from "enzyme";
import React from "react";

import { topicSettingsEditorForDatatype } from ".";
import { SInput } from "./common";
import MarkerArraySettingsEditor from "./MarkerArraySettingsEditor";
import MarkerSettingsEditor from "./MarkerSettingsEditor";
import Checkbox from "webviz-core/src/components/Checkbox";
import { Select } from "webviz-core/src/components/Select";

test("only MarkerArray settings offer snapshots and preserve saved selection", () => {
  expect(topicSettingsEditorForDatatype("visualization_msgs/MarkerArray", {})).toBe(MarkerArraySettingsEditor);
  expect(topicSettingsEditorForDatatype("visualization_msgs/Marker", {})).toBe(MarkerSettingsEditor);
  const onFieldChange = jest.fn();
  const props = { settings: {}, message: null, onFieldChange, onSettingsChange: jest.fn() };
  const editor = shallow(<MarkerArraySettingsEditor {...props} />);
  expect(editor.find(Select).prop("value")).toBe("incremental");
  editor.find(Select).prop("onChange")("snapshot");
  expect(onFieldChange).toHaveBeenCalledWith("markerArrayMode", "snapshot");
  editor.setProps({ settings: { markerArrayMode: "snapshot" } });
  expect(editor.find(Select).prop("value")).toBe("snapshot");
  editor.find(Select).prop("onChange")("incremental");
  expect(onFieldChange).toHaveBeenCalledWith("markerArrayMode", "incremental");
});

test("Z layer input supports zero, negative and fractional layers and clearing the filter", () => {
  const onFieldChange = jest.fn();
  const editor = shallow(
    <MarkerArraySettingsEditor
      settings={{ markerZLayer: 0 }}
      message={null}
      onFieldChange={onFieldChange}
      onSettingsChange={jest.fn()}
    />
  );
  expect(editor.find(SInput).prop("value")).toBe(0);
  for (const [input, expected] of [["-1", -1], ["0.5", 0.5], ["", null], ["Infinity", null]]) {
    editor.find(SInput).prop("onChange")({ target: { value: input } });
    expect(onFieldChange).toHaveBeenLastCalledWith("markerZLayer", expected);
  }
});

test("planning topics display effective defaults and explicit all layers", () => {
  const editor = shallow(
    <MarkerArraySettingsEditor
      settings={{}}
      topicName="/planning/virtual_map_polygon3d"
      message={null}
      onFieldChange={jest.fn()}
      onSettingsChange={jest.fn()}
    />
  );
  expect(editor.find(Select).prop("value")).toBe("snapshot");
  expect(editor.find(SInput).prop("value")).toBe(0);
  editor.setProps({ settings: { markerZLayer: null } });
  expect(editor.find(SInput).prop("value")).toBe("");
});

test("duplicate text stacking is opt-in and saved per topic", () => {
  const onFieldChange = jest.fn();
  const editor = shallow(
    <MarkerSettingsEditor settings={{}} message={null} onFieldChange={onFieldChange} onSettingsChange={jest.fn()} />
  );
  const checkbox = () =>
    editor.find(Checkbox).findWhere((node) => node.prop("label") === "Stack identical text labels");
  expect(checkbox().prop("checked")).toBe(false);
  checkbox().prop("onChange")(true);
  expect(onFieldChange).toHaveBeenCalledWith("showDuplicateText", true);
  editor.setProps({ settings: { showDuplicateText: true } });
  expect(checkbox().prop("checked")).toBe(true);
});
