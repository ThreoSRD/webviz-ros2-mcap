// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

import type { Message } from "webviz-core/src/players/types";
import { getObject, getRos2DecodedValue } from "webviz-core/src/util/binaryObjects";
import { BobWriter, getSerializeFunctions } from "webviz-core/src/util/binaryObjects/binaryMessageWriter";
import { getSourceData } from "webviz-core/src/util/binaryObjects/messageDefinitionUtils";
import { VISUALIZATION_MSGS$MARKER_ARRAY } from "webviz-core/src/util/globalConstants";

// The legacy binary deep parser converts 64-bit integers to Number by default.
// Leave any schema containing them (or an unrecognized primitive) untouched.
const SAFE_PRIMITIVES = new Set([
  "bool",
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "float32",
  "float64",
  "string",
  "time",
  "duration",
]);
// CDR uses typed arrays for wider numeric sequences, whereas binary bobject
// deep parsing returns ordinary arrays. Preserve the original representation.
const SAFE_PRIMITIVE_ARRAYS = new Set(["bool", "int8", "uint8", "string", "time", "duration"]);
const MAX_REUSED_BUFFER_BYTES = 8 * 1024 * 1024;

function markerDefinitions(datatypes: any): ?any {
  const result = {};
  const pending = [VISUALIZATION_MSGS$MARKER_ARRAY];
  while (pending.length) {
    const name = pending.pop();
    if (result[name]) {
      continue;
    }
    const definition = datatypes[name];
    if (!definition || !Array.isArray(definition.fields)) {
      return undefined;
    }
    result[name] = definition;
    for (const field of definition.fields) {
      if (field.isConstant) {
        continue;
      }
      if (SAFE_PRIMITIVES.has(field.type)) {
        if (field.isArray && !SAFE_PRIMITIVE_ARRAYS.has(field.type)) {
          return undefined;
        }
        continue;
      }
      // In particular, do not silently convert int64/uint64 to Number.
      if (["int64", "uint64", "json"].includes(field.type) || !datatypes[field.type]) {
        return undefined;
      }
      pending.push(field.type);
    }
  }
  return result;
}

function createTimeValidator(definitions: any): any => boolean {
  // Find only branches containing time values; point and color arrays can be
  // large but do not need to be revisited for this check.
  const containingTime: Set<string> = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of Object.keys(definitions)) {
      if (
        !containingTime.has(name) &&
        definitions[name].fields.some(
          field =>
            !field.isConstant && (field.type === "time" || field.type === "duration" || containingTime.has(field.type))
        )
      ) {
        containingTime.add(name);
        changed = true;
      }
    }
  }
  const fieldsByType: { [string]: any } = {};
  for (const name of containingTime) {
    fieldsByType[name] = definitions[name].fields.filter(
      field =>
        !field.isConstant && (field.type === "time" || field.type === "duration" || containingTime.has(field.type))
    );
  }
  const validTime = (value: any): boolean =>
    !!value &&
    Number.isInteger(value.sec) &&
    value.sec >= -2147483648 &&
    value.sec <= 2147483647 &&
    Number.isInteger(value.nsec) &&
    value.nsec >= 0 &&
    value.nsec <= 2147483647;
  const validObject = (name: string, value: any): boolean => {
    if (!value || typeof value !== "object") {
      return false;
    }
    for (const field of fieldsByType[name]) {
      const check =
        field.type === "time" || field.type === "duration" ? validTime : item => validObject(field.type, item);
      const fieldValue = value[field.name];
      if (field.isArray ? !Array.isArray(fieldValue) || !fieldValue.every(check) : !check(fieldValue)) {
        return false;
      }
    }
    return true;
  };
  return value =>
    !containingTime.has(VISUALIZATION_MSGS$MARKER_ARRAY) || validObject(VISUALIZATION_MSGS$MARKER_ARRAY, value);
}

// Scoped to one layout worker sender. The original cached messages and their
// representations remain unchanged for Raw Messages, Plot, and other panels.
export default class CompactRos2MarkerMessages {
  _serializers: WeakMap<any, any> = new WeakMap();

  compact(message: Message): Message {
    const decoded = getRos2DecodedValue(message.message);
    if (!decoded) {
      return message;
    }
    const source = getSourceData(Object.getPrototypeOf(message.message).constructor);
    if (!source || source.datatype !== VISUALIZATION_MSGS$MARKER_ARRAY) {
      return message;
    }
    let serializer = this._serializers.get(source.datatypes);
    if (serializer === undefined) {
      const definitions = markerDefinitions(source.datatypes);
      if (!definitions) {
        this._serializers.set(source.datatypes, null);
        return message;
      }
      try {
        const writer = new BobWriter();
        serializer = {
          writer,
          write: getSerializeFunctions(definitions, writer)[VISUALIZATION_MSGS$MARKER_ARRAY],
          validTime: createTimeValidator(definitions),
        };
      } catch (_error) {
        // Unusual but valid schemas keep the existing object transport path.
        serializer = null;
      }
      this._serializers.set(source.datatypes, serializer);
    }
    if (!serializer) {
      return message;
    }
    try {
      if (!serializer.validTime(decoded)) {
        return message;
      }
      serializer.write(decoded);
      const { buffer, bigString } = serializer.writer.write();
      if (buffer.byteLength > MAX_REUSED_BUFFER_BYTES) {
        // Avoid retaining an exceptionally large scratch buffer indefinitely.
        this._serializers.delete(source.datatypes);
      }
      return {
        ...message,
        message: getObject(source.datatypes, source.datatype, buffer, bigString),
      };
    } catch (_error) {
      serializer.writer.reset();
      this._serializers.set(source.datatypes, null);
      return message;
    }
  }

  clear() {
    this._serializers = new WeakMap();
  }
}
