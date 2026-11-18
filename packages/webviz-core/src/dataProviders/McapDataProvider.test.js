// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

// Synthetic MCAP containers with hand-encoded CDR payloads, independent of the
// ROS 2 serializer under test. No private recordings or ROS installation needed.
import { McapWriter } from "@mcap/core";
// $FlowFixMe - Node Blob is newer than Flow 0.110's Node definitions.
import { Blob, Buffer } from "buffer";

import ApiCheckerDataProvider, { instrumentTreeWithApiCheckerDataProvider } from "./ApiCheckerDataProvider";
import createGetDataProvider from "./createGetDataProvider";
import McapDataProvider from "./McapDataProvider";
import ParseMessagesDataProvider from "./ParseMessagesDataProvider";
import * as decompression from "./ros2/decompression";
import Ros2ToBobjectDataProvider from "./Ros2ToBobjectDataProvider";
import signal from "webviz-core/shared/signal";
import { getField, inaccurateByteSize } from "webviz-core/src/util/binaryObjects";
import sendNotification from "webviz-core/src/util/sendNotification";

const { compressionOptions } = require("../../../../scripts/fixtures/compression");

const schema = `uint64 MAX=18446744073709551615
uint32 count
Inner inner
uint8[] data
uint64 id
================================================================================
MSG: custom_msgs/Inner
builtin_interfaces/Time stamp
uint32 nanosec
`;
// Flow 0.110 cannot represent native bigint; isolate that test SDK boundary.
const toBigInt: (value: string | number) => any = BigInt;
const baseTime = toBigInt("1793889370123456789");
const start = { sec: 1793889370, nsec: 123456789 };
const middle = { ...start, nsec: start.nsec + 1 };
const end = { ...start, nsec: start.nsec + 2 };
const extensionPoint = {
  progressCallback: () => {},
  reportMetadataCallback: () => {},
  notifyPlayerManager: async () => {},
};

// CDR1 little-endian: alignment is relative to the end of the 4-byte header.
function payload(count) {
  const bytes = new Uint8Array(36);
  const view = new DataView(bytes.buffer);
  bytes[1] = 1;
  view.setUint32(4, count, true);
  view.setInt32(8, 123, true);
  view.setUint32(12, 456, true);
  view.setUint32(16, 789, true);
  view.setUint32(20, 3, true);
  bytes.set([11, 22, 33], 24);
  bytes.fill(0xff, 28, 36);
  return bytes;
}

async function recording(options = {}, messageDefinition = schema, extend) {
  const parts = [];
  let position = toBigInt(0);
  const writer = new McapWriter({
    chunkSize: 1,
    writable: {
      write: async (bytes) => {
        parts.push(bytes.slice());
        position += toBigInt(bytes.byteLength);
      },
      position: () => position,
    },
    ...options,
  });
  await writer.start({ profile: "ros2", library: "webviz-synthetic-test" });
  const schemaId = await writer.registerSchema({
    name: "custom_msgs/msg/Sample",
    encoding: "ros2msg",
    data: Buffer.from(messageDefinition),
  });
  const channelId = await writer.registerChannel({
    schemaId,
    topic: "/sample",
    messageEncoding: "cdr",
    metadata: new Map(),
  });
  const unused = await writer.registerChannel({
    schemaId,
    topic: "/unused",
    messageEncoding: "cdr",
    metadata: new Map(),
  });
  for (let i = 0; i < 3; i++) {
    await writer.addMessage({
      channelId,
      sequence: i,
      logTime: baseTime + toBigInt(i),
      publishTime: toBigInt(0),
      data: payload(i),
    });
    await writer.addMessage({
      channelId: unused,
      sequence: i,
      logTime: baseTime + toBigInt(i),
      publishTime: toBigInt(0),
      data: payload(99),
    });
  }
  if (extend) {
    await extend(writer);
  }
  await writer.end();
  return new Blob(parts);
}

test.each(["", "lz4", "zstd", "mixed"])(
  "indexed %s reads filter topics and preserve nanosecond endpoints",
  async (codec) => {
    const provider = new McapDataProvider({ file: await recording(compressionOptions(codec)) }, []);
    const info = await provider.initialize(extensionPoint);
    expect(info.start).toEqual(start);
    expect(info.end).toEqual(end);
    expect(info.messageEncoding).toBe("cdr");
    expect(info.topics.map(({ name }) => name).sort()).toEqual(["/sample", "/unused"]);
    const { rosBinaryMessages: messages } = await provider.getMessages(start, end, { rosBinaryMessages: ["/sample"] });
    expect(messages.map(({ receiveTime }) => receiveTime)).toEqual([start, middle, end]);
    expect(messages.every(({ topic, message }) => topic === "/sample" && message.byteLength === 36)).toBe(true);
    expect(
      (await provider.getMessages(middle, middle, { rosBinaryMessages: ["/sample"] })).rosBinaryMessages
    ).toHaveLength(1);
    expect((await provider.getMessages(start, end, { rosBinaryMessages: [] })).rosBinaryMessages).toEqual([]);
    await provider.close();
    await expect(provider.getMessages(start, end, { rosBinaryMessages: ["/sample"] })).rejects.toThrow("not open");
  }
);

test.each(["", "lz4", "zstd", "mixed"])(
  "CDR adapter preserves nested messages and uint64 with %s compression",
  async (codec) => {
    const getProvider = createGetDataProvider({
      ApiCheckerDataProvider,
      McapDataProvider,
      Ros2ToBobjectDataProvider,
      ParseMessagesDataProvider,
    });
    const provider = getProvider(
      instrumentTreeWithApiCheckerDataProvider({
        name: "ParseMessagesDataProvider",
        args: {},
        children: [
          {
            name: "Ros2ToBobjectDataProvider",
            args: {},
            children: [
              {
                name: "McapDataProvider",
                args: { file: await recording(compressionOptions(codec)) },
                children: [],
              },
            ],
          },
        ],
      })
    );
    const info = await provider.initialize(extensionPoint);
    expect(info.topics[0].datatype).toBe("custom_msgs/Sample");
    const result = await provider.getMessages(start, end, { parsedMessages: ["/sample"], bobjects: ["/sample"] });
    const { parsedMessages, bobjects } = result;
    if (!parsedMessages || !bobjects) {
      throw new Error("The parser must return both requested representations");
    }
    expect(parsedMessages.map(({ message }) => message.count)).toEqual([0, 1, 2]);
    expect(parsedMessages[0].message.inner).toEqual({ stamp: { sec: 123, nsec: 456 }, nanosec: 789 });
    expect(parsedMessages[0].message.id).toBe(toBigInt("18446744073709551615"));
    expect(Array.from(parsedMessages[0].message.data)).toEqual([11, 22, 33]);
    const stamp = getField(getField(bobjects[0].message, "inner"), "stamp");
    expect(getField(stamp, "nsec")).toBe(456);
    expect(getField(bobjects[0].message, "MAX", true)).toBe(toBigInt("18446744073709551615"));
    expect(inaccurateByteSize(bobjects[0].message)).toBeGreaterThan(36);
    await provider.close();
  }
);

test("missing message indexes produce an actionable initialization error", async () => {
  const provider = new McapDataProvider({ file: await recording({ useMessageIndex: false }) }, []);
  await expect(provider.initialize(extensionPoint)).rejects.toThrow(/message indexes/);
  await provider.close();
});

test("unsupported channels are skipped and reported instead of rejecting the recording", async () => {
  const file = await recording({}, schema, async (writer) => {
    const idlSchema = await writer.registerSchema({
      name: "custom_msgs/msg/FromIdl",
      encoding: "ros2idl",
      data: Buffer.from("module custom_msgs { module msg { struct FromIdl { uint32 value; }; }; };"),
    });
    const channels = [
      { schemaId: 0, topic: "/json", messageEncoding: "json" },
      { schemaId: idlSchema, topic: "/idl", messageEncoding: "cdr" },
      // Same topic name as a supported channel: its records must not reach the CDR decoder.
      { schemaId: 0, topic: "/sample", messageEncoding: "json" },
    ];
    for (const channel of channels) {
      const channelId = await writer.registerChannel({ ...channel, metadata: new Map() });
      await writer.addMessage({
        channelId,
        sequence: 0,
        logTime: baseTime + toBigInt(1),
        publishTime: toBigInt(0),
        data: Buffer.from("{}"),
      });
    }
  });
  const provider = new McapDataProvider({ file }, []);
  const info = await provider.initialize(extensionPoint);
  expect(info.topics.map(({ name }) => name).sort()).toEqual(["/sample", "/unused"]);
  expect(info.start).toEqual(start);
  expect(info.end).toEqual(end);
  expect(sendNotification).toHaveBeenCalledTimes(1);
  const [message, details, type, severity] = (sendNotification: any).mock.calls[0];
  expect([message, type, severity]).toEqual(["Skipped 3 unsupported MCAP topic(s)", "user", "warn"]);
  expect(details).toContain("/json (json messages)");
  expect(details).toContain("/idl (ros2idl schema)");
  expect(details).toContain("/sample (json messages on some channels)");
  const { rosBinaryMessages: messages } = await provider.getMessages(start, end, { rosBinaryMessages: ["/sample"] });
  expect(messages.map(({ message: data }) => data.byteLength)).toEqual([36, 36, 36]);
  await provider.close();
  sendNotification.expectCalledDuringTest();
});

test("a recording with only unsupported topics explains why nothing is playable", async () => {
  const parts = [];
  let position = toBigInt(0);
  const writer = new McapWriter({
    writable: {
      write: async (bytes) => {
        parts.push(bytes.slice());
        position += toBigInt(bytes.byteLength);
      },
      position: () => position,
    },
  });
  await writer.start({ profile: "ros2", library: "webviz-synthetic-test" });
  const channelId = await writer.registerChannel({
    schemaId: 0,
    topic: "/json",
    messageEncoding: "json",
    metadata: new Map(),
  });
  await writer.addMessage({ channelId, sequence: 0, logTime: baseTime, publishTime: baseTime, data: Buffer.from("{}") });
  await writer.end();
  const provider = new McapDataProvider({ file: new Blob(parts) }, []);
  await expect(provider.initialize(extensionPoint)).rejects.toThrow(
    /no playable ROS 2 topics.*Skipped: \/json \(json messages\)/
  );
  await provider.close();
});

test("chunks without messages do not move the start time or reject the recording", async () => {
  // With chunkSize 1 each message closes its chunk, so this channel lands in a final chunk
  // that holds no messages (messageStartTime/EndTime are 0 in its index).
  const file = await recording({}, schema, async (writer) => {
    await writer.registerChannel({ schemaId: 1, topic: "/late", messageEncoding: "cdr", metadata: new Map() });
  });
  const provider = new McapDataProvider({ file }, []);
  const info = await provider.initialize(extensionPoint);
  /* eslint-disable no-underscore-dangle */
  expect(provider._reader.chunkIndexes.some((chunk) => chunk.messageIndexOffsets.size === 0)).toBe(true);
  /* eslint-enable no-underscore-dangle */
  expect(info.start).toEqual(start);
  expect(info.end).toEqual(end);
  expect(info.topics.map(({ name }) => name).sort()).toEqual(["/late", "/sample", "/unused"]);
  await provider.close();
});

test("undecodable messages are skipped and reported once per topic", async () => {
  const child = new McapDataProvider({ file: await recording() }, []);
  const provider = new Ros2ToBobjectDataProvider(
    {},
    [{ name: "McapDataProvider", args: {}, children: [] }],
    () => child
  );
  await provider.initialize(extensionPoint);
  // A CDR header followed by too few bytes for the schema's first uint32.
  const truncated = () => new Uint8Array([0, 1, 0, 0, 7]).buffer;
  const response = () => ({
    rosBinaryMessages: [
      { topic: "/sample", receiveTime: start, message: truncated() },
      { topic: "/sample", receiveTime: middle, message: payload(1).buffer },
      { topic: "/sample", receiveTime: end, message: truncated() },
    ],
  });
  jest
    .spyOn(child, "getMessages")
    .mockImplementationOnce(async () => response())
    .mockImplementationOnce(async () => response());
  for (let i = 0; i < 2; i++) {
    const { bobjects } = await provider.getMessages(start, end, { bobjects: ["/sample"] });
    expect(bobjects.map(({ receiveTime }) => receiveTime)).toEqual([middle]);
    expect(getField(bobjects[0].message, "count")).toBe(1);
  }
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect((sendNotification: any).mock.calls[0][0]).toBe("Skipping undecodable ROS 2 messages on /sample");
  await provider.close();
  sendNotification.expectCalledDuringTest();
});

test("unknown compression fails during initialization", async () => {
  const provider = new McapDataProvider(
    {
      file: await recording({
        compressChunk: (bytes) => ({ compression: "test-codec", compressedData: bytes }),
      }),
    },
    []
  );
  await expect(provider.initialize(extensionPoint)).rejects.toThrow(/test-codec.*not supported/);
  await provider.close();
});

test("schema parsing failure closes the already initialized MCAP source", async () => {
  const child = new McapDataProvider({ file: await recording({}, "MissingType missing") }, []);
  const close = jest.spyOn(child, "close");
  const provider = new Ros2ToBobjectDataProvider(
    {},
    [{ name: "McapDataProvider", args: {}, children: [] }],
    () => child
  );
  await expect(provider.initialize(extensionPoint)).rejects.toThrow(/Cannot parse ROS 2 schema/);
  expect(close).toHaveBeenCalledTimes(1);
  await expect(child.getMessages(start, end, { rosBinaryMessages: ["/sample"] })).rejects.toThrow("not open");
});

test.each(["data", "error"])("closing the ROS 2 adapter discards pending %s from the old source", async (outcome) => {
  const child = new McapDataProvider({ file: await recording() }, []);
  const provider = new Ros2ToBobjectDataProvider(
    {},
    [{ name: "McapDataProvider", args: {}, children: [] }],
    () => child
  );
  await provider.initialize(extensionPoint);
  const response = signal();
  jest.spyOn(child, "getMessages").mockImplementationOnce(() => response);
  const pending = provider.getMessages(start, end, { bobjects: ["/sample"] });
  await provider.close();
  if (outcome === "data") {
    response.resolve({ rosBinaryMessages: [{ topic: "/sample", receiveTime: start, message: payload(1).buffer }] });
  } else {
    response.reject(new Error("old source read was canceled"));
  }
  await expect(pending).resolves.toEqual({ bobjects: [], rosBinaryMessages: undefined, parsedMessages: undefined });
});

test.each(["lz4", "zstd"])("decoded %s chunk CRC is checked", async (compression) => {
  const { compressChunk } = compressionOptions(compression);
  const provider = new McapDataProvider(
    {
      file: await recording({
        compressChunk: (bytes) => {
          const changed = bytes.slice();
          changed[changed.length - 1] ^= 1;
          return compressChunk(changed);
        },
      }),
    },
    []
  );
  const info = await provider.initialize(extensionPoint);
  await expect(provider.getMessages(info.start, info.end, { rosBinaryMessages: ["/sample"] })).rejects.toThrow(
    /Incorrect chunk CRC/
  );
  await provider.close();
});

test("closing during decoder initialization prevents the source from reopening", async () => {
  const loading = signal();
  const entered = signal();
  jest.spyOn(decompression, "loadMcapDecompressHandlers").mockImplementationOnce(() => {
    entered.resolve();
    return loading;
  });
  const provider = new McapDataProvider({ file: await recording(compressionOptions("zstd")) }, []);
  const initializing = provider.initialize(extensionPoint);
  await entered;
  await provider.close();
  loading.resolve({});
  await expect(initializing).rejects.toThrow("MCAP source is closed");
  await expect(provider.getMessages(start, end, { rosBinaryMessages: ["/sample"] })).rejects.toThrow("not open");
});

test("compressed chunk size is bounded before passing a Number to WASM", () => {
  const max = decompression.MAX_MCAP_CHUNK_BYTES;
  expect(decompression.checkChunkSize(toBigInt(max))).toBe(max);
  for (const value of [toBigInt(max + 1), toBigInt(-1), toBigInt("9007199254740993")]) {
    expect(() => decompression.checkChunkSize(value)).toThrow(/decoded chunk limit/);
  }
});

test.each(["lz4", "zstd"])("%s handler rejects a mismatched decoded size", async (compression) => {
  const handlers = await decompression.loadMcapDecompressHandlers([compression]);
  const input = new Uint8Array([1, 2, 3, 4]);
  const { compressedData } = compressionOptions(compression).compressChunk(input);
  expect(() => handlers[compression](compressedData, toBigInt(5))).toThrow(/Cannot decompress/);
});

// The LZ4 WASM library keeps native frame state after a corrupt frame. Real
// sources run in dedicated workers, which are terminated on failure. Keep
// these terminal failures last in this shared Jest VM; browser tests cover
// opening a good recording after a corrupt source.
test.each(["lz4", "zstd"])("corrupt %s frames produce a decompression error", async (compression) => {
  const provider = new McapDataProvider(
    {
      file: await recording({
        compressChunk: () => ({ compression, compressedData: new Uint8Array([0, 0, 0, 0]) }),
      }),
    },
    []
  );
  const info = await provider.initialize(extensionPoint);
  await expect(provider.getMessages(info.start, info.end, { rosBinaryMessages: ["/sample"] })).rejects.toThrow(
    new RegExp(`Cannot decompress MCAP ${compression} chunk`)
  );
  await provider.close();
});
