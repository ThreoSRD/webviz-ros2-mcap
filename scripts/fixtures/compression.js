// @noflow
//
//  Copyright (c) 2026-present, Webviz ROS 2 MCAP contributors
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.

// Test-only encoders, independent of the production WASM decoders.
const { createRequire } = require("module");
const path = require("path");
const { zstdCompressSync } = require("zlib");

const coreRequire = createRequire(path.resolve(__dirname, "../../packages/webviz-core/package.json"));
const { compress } = coreRequire("lz4js");

function compressionOptions(mode = "") {
  if (!mode) {
    return {};
  }
  if (!["lz4", "zstd", "mixed"].includes(mode)) {
    throw new Error(`Unknown fixture compression ${mode}`);
  }
  let index = 0;
  return {
    compressChunk: (bytes) => {
      const compression = mode === "mixed" ? ["", "lz4", "zstd"][index++ % 3] : mode;
      if (compression === "zstd" && !zstdCompressSync) {
        throw new Error("Generating zstd fixtures requires Node >=22.15 with zstdCompressSync");
      }
      return {
        compression,
        compressedData:
          compression === "lz4" ? compress(bytes) : compression === "zstd" ? zstdCompressSync(bytes) : bytes,
      };
    },
  };
}

module.exports = { compressionOptions };
