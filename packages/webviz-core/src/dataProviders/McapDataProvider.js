// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

// Local indexed ROS 2 MCAP input. CDR payloads use the legacy raw-buffer RPC
// slot; messageEncoding prevents them from reaching the ROS 1 rewriter.
import { McapIndexedReader } from "@mcap/core";

import { checkChunkSize, loadMcapDecompressHandlers, MCAP_COMPRESSIONS } from "./ros2/decompression";
import { createBlobReadable, nanosecondsToTime, timeToNanoseconds } from "./ros2/mcapUtils";
import type { DataProviderDescriptor, ExtensionPoint, GetMessagesTopics } from "./types";
import sendNotification from "webviz-core/src/util/sendNotification";

export default class McapDataProvider {
  _file: ?File;
  _reader: any;
  _supportedChannelIds: Set<number> = new Set();
  _closed: boolean = false;

  constructor({ file }: { file: File }, children: DataProviderDescriptor[]) {
    if (children.length !== 0) {
      throw new Error("McapDataProvider cannot have children");
    }
    this._file = file;
  }

  async initialize(_extensionPoint: ExtensionPoint): Promise<any> {
    const file = this._file;
    if (!file) {
      throw new Error("No local MCAP file selected");
    }
    // The SDK retains this handler map. Fill it after inspecting the summary,
    // so uncompressed files never fetch a codec and the summary is read once.
    const decompressHandlers = {};
    const reader = await McapIndexedReader.Initialize({
      decompressHandlers,
      readable: createBlobReadable(file, () => this._closed),
    });
    if (reader.header.profile !== "ros2") {
      throw new Error(`Expected MCAP profile ros2, received ${reader.header.profile || "an empty profile"}`);
    }
    if (reader.chunkIndexes.length === 0) {
      throw new Error("MCAP has no indexed message chunks. Re-index the recording before opening it.");
    }
    const compressions = new Set();
    let start;
    let end;
    for (const chunk of reader.chunkIndexes) {
      if (chunk.messageIndexOffsets.size === 0) {
        // Per the MCAP spec, messageStartTime/EndTime are 0 when a chunk holds no messages (for
        // example only Schema/Channel records for a topic registered just before recording stopped).
        // Such a chunk is valid and never read for messages: it must not pull the start time to 0
        // or require a codec. Non-zero times without indexes mean the indexes are really missing.
        if (Number(chunk.messageStartTime) === 0 && Number(chunk.messageEndTime) === 0) {
          continue;
        }
        throw new Error("MCAP is missing message indexes. Re-index the recording before opening it.");
      }
      if (chunk.compression !== "") {
        if (!MCAP_COMPRESSIONS.includes(chunk.compression)) {
          throw new Error(
            `MCAP compression ${chunk.compression} is not supported. Supported: uncompressed, lz4, zstd.`
          );
        }
        checkChunkSize(chunk.uncompressedSize);
        compressions.add(chunk.compression);
      }
      if (start == null || chunk.messageStartTime < start) {
        start = chunk.messageStartTime;
      }
      if (end == null || chunk.messageEndTime > end) {
        end = chunk.messageEndTime;
      }
    }
    const topicsByName = new Map();
    const messageDefinitionsByTopic = {};
    const ros2SchemaNamesByTopic = {};
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const supportedChannelIds = new Set();
    const unsupportedReasonsByTopic = new Map();
    for (const channel of reader.channelsById.values()) {
      const schema = reader.schemasById.get(channel.schemaId);
      if (channel.messageEncoding !== "cdr" || !schema || schema.encoding !== "ros2msg") {
        // Skip just this channel; one ros2idl/schemaless/non-CDR topic must not block the recording.
        const reason =
          channel.messageEncoding !== "cdr"
            ? `${channel.messageEncoding || "unknown"} messages`
            : !schema
            ? "no schema"
            : `${schema.encoding || "unknown"} schema`;
        unsupportedReasonsByTopic.set(channel.topic, reason);
        continue;
      }
      const definition = decoder.decode(schema.data);
      if (topicsByName.has(channel.topic)) {
        if (
          messageDefinitionsByTopic[channel.topic] !== definition ||
          ros2SchemaNamesByTopic[channel.topic] !== schema.name
        ) {
          throw new Error(`Topic ${channel.topic} has incompatible schemas on different channels`);
        }
      } else {
        topicsByName.set(channel.topic, { name: channel.topic, datatype: schema.name });
        messageDefinitionsByTopic[channel.topic] = definition;
        ros2SchemaNamesByTopic[channel.topic] = schema.name;
      }
      supportedChannelIds.add(channel.id);
    }
    const skipped = Array.from(unsupportedReasonsByTopic.entries()).map(
      ([topic, reason]) => `${topic} (${reason}${topicsByName.has(topic) ? " on some channels" : ""})`
    );
    const unsupportedSummary = `Only CDR messages with embedded ros2msg schemas are supported (ros2idl is not supported yet). Skipped: ${skipped.join(
      ", "
    )}`;
    if (topicsByName.size === 0) {
      throw new Error(`MCAP contains no playable ROS 2 topics.${skipped.length ? ` ${unsupportedSummary}` : ""}`);
    }
    if (start == null || end == null) {
      throw new Error("MCAP contains no playable topics");
    }
    Object.assign(decompressHandlers, await loadMcapDecompressHandlers(Array.from(compressions)));
    if (this._closed) {
      throw new Error("MCAP source is closed");
    }
    this._reader = reader;
    this._supportedChannelIds = supportedChannelIds;
    if (skipped.length) {
      sendNotification(`Skipped ${skipped.length} unsupported MCAP topic(s)`, unsupportedSummary, "user", "warn");
    }
    // Bounds come from chunk indexes, not the optional Statistics record.
    return {
      start: nanosecondsToTime(start),
      end: nanosecondsToTime(end),
      topics: Array.from(topicsByName.values()),
      providesParsedMessages: false,
      messageEncoding: "cdr",
      messageDefinitions: { type: "raw", messageDefinitionsByTopic, ros2SchemaNamesByTopic },
    };
  }

  async getMessages(start: any, end: any, topics: GetMessagesTopics): Promise<any> {
    const reader = this._reader;
    if (this._closed || !reader) {
      throw new Error("MCAP source is not open");
    }
    const messages = [];
    const requestedTopics = topics.rosBinaryMessages || [];
    if (requestedTopics.length > 0) {
      for await (const record of reader.readMessages({
        topics: requestedTopics,
        startTime: timeToNanoseconds(start),
        endTime: timeToNanoseconds(end),
      })) {
        if (this._closed) {
          throw new Error("MCAP source is closed");
        }
        const channel = reader.channelsById.get(record.channelId);
        if (!channel) {
          throw new Error(`MCAP references unknown channel ${record.channelId}`);
        }
        if (!this._supportedChannelIds.has(record.channelId)) {
          continue; // An unsupported channel that shares its topic name with a supported one.
        }
        // Own exactly this payload before RPC transfers it; transferring the
        // chunk backing buffer would detach other messages and retain chunks.
        messages.push({
          topic: channel.topic,
          receiveTime: nanosecondsToTime(record.logTime),
          message: record.data.slice().buffer,
        });
      }
    }
    return { rosBinaryMessages: messages, bobjects: undefined, parsedMessages: undefined };
  }

  async close(): Promise<void> {
    this._closed = true;
    this._reader = undefined;
    this._file = undefined;
  }
}
