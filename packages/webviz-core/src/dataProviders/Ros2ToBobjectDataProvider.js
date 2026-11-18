// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

// Decode ROS 2 CDR after raw-buffer worker transport, then expose the existing
// bobject contract used by the cache, parser and visualization panels.
import { fixupTypes, parse } from "@foxglove/rosmsg";
import { MessageReader } from "@foxglove/rosmsg2-serialization";

import { adaptDefinitions, estimateMessageBytes, normalizeRos2Definitions, panelTypeName } from "./ros2/mcapUtils";
import type { DataProvider, DataProviderDescriptor, ExtensionPoint, GetDataProvider, GetMessagesTopics } from "./types";
import { cast } from "webviz-core/src/players/types";
import { wrapJsObject } from "webviz-core/src/util/binaryObjects";

const definitionKey = (value) =>
  // Flow 0.110 and ESLint 5 predate the bigint typeof result.
  // $FlowFixMe - Native bigint is retained at the SDK boundary.
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? `${item.toString()}n` : item)); // eslint-disable-line valid-typeof

export default class Ros2ToBobjectDataProvider {
  _provider: DataProvider;
  _closed: boolean = false;
  _readers: Map<string, any> = new Map();
  _datatypes: any = {};
  _typesByTopic: Map<string, string> = new Map();

  constructor(_args: any, children: DataProviderDescriptor[], getDataProvider: GetDataProvider) {
    if (children.length !== 1) {
      throw new Error("Ros2ToBobjectDataProvider requires exactly one child");
    }
    this._provider = getDataProvider(children[0]);
  }

  async initialize(extensionPoint: ExtensionPoint): Promise<any> {
    const result = await this._provider.initialize({ ...extensionPoint, progressCallback: () => {} });
    try {
      const raw = result.messageDefinitions;
      if (result.messageEncoding !== "cdr" || raw.type !== "raw" || !raw.ros2SchemaNamesByTopic) {
        throw new Error("ROS 2 adapter requires CDR payloads and original ROS 2 schema names");
      }
      const schemaNames = raw.ros2SchemaNamesByTopic;
      const parsedMessageDefinitionsByTopic = {};
      const readersBySchema = new Map();
      const topics = result.topics.map((topic) => {
        const schemaName = schemaNames[topic.name];
        const source = raw.messageDefinitionsByTopic[topic.name];
        const key = definitionKey([schemaName, source]);
        let entry = readersBySchema.get(key);
        if (!entry) {
          let definitions;
          try {
            definitions = normalizeRos2Definitions(parse(source, { ros2: true, skipTypeFixup: true }), schemaName);
            // Resolve relative names after both root and embedded names use the
            // same namespace. Raw schema metadata above remains unchanged.
            fixupTypes(definitions);
          } catch (error) {
            throw new Error(`Cannot parse ROS 2 schema ${schemaName} for ${topic.name}: ${error.message}`);
          }
          const reader = new MessageReader(definitions, { timeType: "sec,nsec" });
          const adapted = adaptDefinitions(definitions, schemaName);
          for (const definition of adapted) {
            const datatype = definition.name;
            const fields = { fields: definition.definitions };
            const existing = this._datatypes[datatype];
            if (existing && definitionKey(existing) !== definitionKey(fields)) {
              throw new Error(
                `Conflicting ROS 2 schemas map to ${datatype}. Open recordings with a consistent schema.`
              );
            }
            this._datatypes[datatype] = fields;
          }
          entry = { reader, adapted };
          readersBySchema.set(key, entry);
        }
        this._readers.set(topic.name, entry.reader);
        const datatype = panelTypeName(schemaName);
        this._typesByTopic.set(topic.name, datatype);
        parsedMessageDefinitionsByTopic[topic.name] = entry.adapted;
        return { ...topic, datatype };
      });
      return {
        ...result,
        topics,
        providesParsedMessages: false,
        messageDefinitions: {
          type: "parsed",
          datatypes: this._datatypes,
          messageDefinitionsByTopic: raw.messageDefinitionsByTopic,
          parsedMessageDefinitionsByTopic,
        },
      };
    } catch (error) {
      // The worker may already be initialized when main-thread schema parsing
      // fails. Release it even though this adapter never finished initializing.
      await this.close().catch(() => {}); // Preserve the original schema error.
      throw error;
    }
  }

  async getMessages(start: any, end: any, topics: GetMessagesTopics): Promise<any> {
    if (this._closed) {
      throw new Error("ROS 2 source is closed");
    }
    let result;
    try {
      result = await this._provider.getMessages(start, end, { rosBinaryMessages: topics.bobjects });
    } catch (error) {
      if (this._closed) {
        return { bobjects: [], rosBinaryMessages: undefined, parsedMessages: undefined };
      }
      throw error;
    }
    if (this._closed) {
      return { bobjects: [], rosBinaryMessages: undefined, parsedMessages: undefined };
    }
    const bobjects = (result.rosBinaryMessages || []).map(({ topic, receiveTime, message }) => {
      const reader = this._readers.get(topic);
      const datatype = this._typesByTopic.get(topic);
      if (!reader || !datatype) {
        throw new Error(`No ROS 2 schema registered for ${topic}`);
      }
      let decoded;
      try {
        decoded = reader.readMessage(new Uint8Array(cast<ArrayBuffer>(message)));
      } catch (error) {
        throw new Error(`Cannot decode ROS 2 topic ${topic}: ${error.message}`);
      }
      // A root builtin Time/Duration is decoded as a struct by the library;
      // nested times use its schema-aware timeType conversion.
      if (datatype === "time" || datatype === "duration") {
        decoded = { sec: decoded.sec, nsec: decoded.nanosec };
      }
      return {
        topic,
        receiveTime,
        message: wrapJsObject(this._datatypes, datatype, decoded, estimateMessageBytes(decoded)),
      };
    });
    return { bobjects, rosBinaryMessages: undefined, parsedMessages: undefined };
  }

  async close(): Promise<void> {
    this._closed = true;
    this._readers.clear();
    this._typesByTopic.clear();
    this._datatypes = {};
    await this._provider.close();
  }
}
