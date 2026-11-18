// @flow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

// MCAP handlers are synchronous; load WASM before exposing the initialized
// provider. Only the codecs present in this file are imported, inside its worker.
export const MAX_MCAP_CHUNK_BYTES = 256 * 1024 * 1024;
export const MCAP_COMPRESSIONS = ["lz4", "zstd"];

type Decompress = (bytes: Uint8Array, size: any) => Uint8Array;
const pending: { [string]: Promise<Decompress> } = {};

export function checkChunkSize(size: any): number {
  const value = Number(size);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MCAP_CHUNK_BYTES) {
    throw new Error(
      `MCAP compressed chunk exceeds the ${MAX_MCAP_CHUNK_BYTES /
        1048576} MiB decoded chunk limit. Re-chunk the recording.`
    );
  }
  return value;
}

const loadCodec = async (compression: string): Promise<Decompress> => {
  let codec;
  if (compression === "lz4") {
    const module = await import(/* webpackChunkName: "mcap-lz4" */ "@foxglove/wasm-lz4");
    codec = module.default || module;
  } else {
    const module = await import(/* webpackChunkName: "mcap-zstd" */ "@foxglove/wasm-zstd");
    codec = module.default || module;
  }
  await codec.isLoaded;
  const decompress = compression === "lz4" ? codec : codec.decompress;
  return (bytes, size) => {
    const expected = checkChunkSize(size);
    try {
      const output = decompress(bytes, expected);
      if (output.byteLength !== expected) {
        throw new Error(`decoded ${output.byteLength} bytes, expected ${expected}`);
      }
      // Own the result, including when a codec returns a pooled Node Buffer.
      return new Uint8Array(output);
    } catch (error) {
      throw new Error(`Cannot decompress MCAP ${compression} chunk: ${error.message}`);
    }
  };
};

export async function loadMcapDecompressHandlers(compressions: string[]): Promise<{ [string]: Decompress }> {
  const result = {};
  await Promise.all(
    compressions.map(async (compression) => {
      if (!MCAP_COMPRESSIONS.includes(compression)) {
        throw new Error(`MCAP compression ${compression} is not supported. Supported: uncompressed, lz4, zstd.`);
      }
      if (!pending[compression]) {
        pending[compression] = loadCodec(compression).catch((error) => {
          delete pending[compression]; // Allow a later source to retry a failed asset load.
          throw new Error(`Cannot load MCAP ${compression} decoder: ${error.message}`);
        });
      }
      result[compression] = await pending[compression];
    })
  );
  return result;
}
