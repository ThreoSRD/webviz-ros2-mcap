# ROS 2 MCAP implementation plan

Prepared: 2026-11-09. Original design plan. Initial implementation has since started; see [current progress (中文)](ROS2_MCAP_PROGRESS.md) for code and validation status. The milestones below are acceptance gates, not completed features.

## Objective and first release

Open a single local ROS 2 MCAP file directly in the browser, discover embedded schemas and topics, play/pause/seek, and use Raw Messages, Plot, Image, and 3D panels. Retain ROS 1 bag playback. A ROS installation or a conversion server should not be required for files with complete supported schemas.

First-release target: indexed MCAP with `cdr` messages and `ros2msg` schemas, including custom nested definitions. Start with uncompressed chunks matching the available recording; add and verify zstd and lz4 before advertising compressed-file support. Generic MCAP support does not automatically imply support for every message encoding.

Later scope: `ros2idl`, unindexed file recovery, HTTP range sources, split recordings/metadata.yaml, ROS 2 SQLite `.db3`, mixed ROS 1/ROS 2 sources, live ROS 2 connections, and performance-oriented worker decoding. Unsupported formats need an actionable error in the first release.

## Source snapshot

- New directory and root package name: `webviz-ros2-mcap`.
- Snapshot: 1,360 tracked working-tree files from commit `d13afdacaec0b48f983adcaca55b84c36c42a5f2`; local file contents were copied rather than checked out again.
- Original source files were not edited. Git history/remotes, local recordings, credentials/config directories, dependencies, and generated output were not copied.
- Preserve `LICENSE`, copyright headers, and upstream attribution. Keep internal package names initially to avoid breaking module resolution and Lerna links.
- No GitHub repository, remote, commit, deployment, or package publication has been created.

## Findings from this codebase

| Area | Existing files | Implication |
| --- | --- | --- |
| File entry and player assembly | `packages/webviz-core/src/components/PlayerManager.js` | `buildPlayerFromDescriptor()` always inserts the ROS 1 binary rewriter. MCAP needs an explicit format-aware branch. |
| Source selection | `src/dataProviders/standardDataProviderDescriptors.js`, `constants.js`, `rootGetDataProvider.js` under `packages/webviz-core` | Local files currently use `BagDataProvider`; register and select an MCAP provider. |
| ROS 1 reader | `src/dataProviders/BagDataProvider.js` | Uses `rosbag` 2.6.3, ROS 1 definitions and MD5 sums; it cannot decode ROS 2 CDR. |
| Binary pipeline | `src/dataProviders/RewriteBinaryDataProvider.js`, `ParseMessagesDataProvider.js` | Panels consume internal bobjects as well as parsed messages. Returning plain objects alone will not cover all panels. |
| Workers | `src/dataProviders/WorkerDataProvider.js`, `RpcDataProvider.js`, `RpcDataProviderRemote.js` | RPC accepts only raw buffers through `rosBinaryMessages`; sending decoded objects through the existing worker path will fail. |
| Existing object bridge | `src/util/binaryObjects/index.js`, `BobjectRpc.js` | `wrapJsObject()` can expose decoded objects as bobjects. Its memory-size accounting currently returns zero for these wrappers and must be addressed for bounded caching. |
| Type and time assumptions | `src/types/RosDatatypes.js`, `src/util/datatypes.js`, `src/panels/ThreeDimensionalViz/` | ROS 1 names and `{sec,nsec}` are widespread. ROS 2 metadata and objects need deliberate compatibility handling. |
| Build | root `package.json`, `package-lock.json`, `webpack.config.js` | React 16, Flow 0.110, Jest 23, Lerna 3, and an older webpack pipeline need a dependency/build spike before modern MCAP packages are chosen. |

All abbreviated `src/` paths above are relative to `packages/webviz-core/`.

## Local recording inspection

Only the header, footer, and summary records were inspected, using Python standard-library range reads. Message payloads have not been decoded or validated.

| Property | Observation |
| --- | --- |
| File | A local sensor recording (not distributed) |
| Size | 1,074,975,733 bytes (about 1.00 GiB) |
| Header | Profile `ros2`; writer `libmcap 1.3.1` |
| Encodings | All observed summary schemas use `ros2msg`; channels use `cdr` |
| Indexes | 1,168 chunk indexes; all declare no compression |
| Summary records | 45 schema records and 84 channel records |
| Statistics record | Reports 171,350 messages, 39 schemas, 74 channels, 1,168 chunks, and about 57.807 seconds |
| Standard types | PointCloud2, CompressedImage, Imu, MarkerArray, DiagnosticArray |
| Custom types | Multiple planning, localization, perception, vehicle, and logistics message families |
| Transforms | No `/tf` or `/tf_static` channel appears in the summary |

The Statistics schema/channel counts disagree with the summary records. Treat this as an observed discrepancy, not a confirmed corruption diagnosis. Discover channels and schemas from their records; reconcile per-channel counts and time bounds against message/index data during implementation rather than assuming Statistics is authoritative. Include this case in reader validation.

Custom schemas appear embedded, but dependency completeness is still unverified. A ROS workspace should be unnecessary only if the parser can resolve every referenced definition. Missing transforms mean cross-frame visualization cannot be assumed; permit selecting a recorded frame and show useful missing-transform feedback.

## Proposed architecture

```text
Local File -> magic-byte format detection
  ROS 1 bag -> existing worker/BagDataProvider -> existing RewriteBinaryDataProvider
  MCAP      -> worker/McapDataProvider -> Ros2ToBobjectDataProvider
            -> existing MemoryCacheDataProvider
            -> existing ParseMessagesDataProvider
            -> RandomAccessPlayer -> panels
```

The two format branches converge before the cache. This is an initial design to validate in the build spike, with the following contracts:

1. `McapDataProvider` uses an indexed reader and Blob/File range reads. It exposes topic/schema metadata and returns subscribed CDR payloads plus log timestamps through the existing raw-buffer RPC transport. Document that the legacy `rosBinaryMessages` field transports encoded payloads and add explicit encoding/schema metadata to the provider contract; CDR must never reach the ROS 1 rewriter accidentally.
2. `Ros2ToBobjectDataProvider` builds ROS 2 readers per schema identity, decodes subscribed payloads, adapts types/values, and produces bobjects through `wrapJsObject()`. It returns parsed definitions/datatypes and `providesParsedMessages: false`, since the existing outer parser produces the parsed-message subscription results from those bobjects. Validate this contract with the API checker.
3. Assemble the MCAP branch explicitly in `PlayerManager`, retaining the existing ROS 1 branch. Audit Combined/Rename providers before enabling two-source or mixed-format playback.
4. For the first functional slice, file access stays in the existing worker while CDR decoding and wrapping happen outside it. Measure image/point-cloud responsiveness. If decoding blocks interaction, extend RPC to carry structured decoded data and wrap on the main thread, or design explicit bobject serialization using the existing BobjectRpc utilities. Make worker decoding a release requirement if the real recording fails responsiveness checks.
5. Add accurate retained-byte accounting and bounded caches for wrapped messages and decompressed chunks. Existing zero-sized wrapper accounting is unsuitable for a 1 GiB recording. Read only requested chunks/topics and release resources on close/source changes.

Candidate dependencies: `@mcap/core` (`McapIndexedReader`), `@mcap/browser` (browser readable adapter), `@foxglove/rosmsg` (ROS 2 message definitions), and `@foxglove/rosmsg2-serialization` (CDR). Select exact versions after checking module format, syntax, BigInt, browser targets, Flow boundaries, licenses, and webpack/WASM compatibility. Do not write a new MCAP or CDR parser.

## ROS 2 compatibility rules

- Keep original ROS 2 schema names and definitions as decoder metadata. Provide consistent internal aliases such as `sensor_msgs/msg/PointCloud2` -> `sensor_msgs/PointCloud2` for panel discovery, including nested types. Detect alias collisions and incompatible schemas; cache readers by schema identity/content, not only topic or type name. Preserve original names for diagnostics.
- Translate builtin Time/Duration to the `{sec,nsec}` representation expected by existing panels using schema-aware adaptation. Apply matching changes to exposed definitions. Avoid renaming arbitrary user fields named `nanosec`.
- Handle ROS 2 Header without `seq`. If a panel requires a compatibility value, synthesize it explicitly as an adapter detail and document that it was not recorded.
- Validate bounded strings/sequences, fixed arrays, constants/defaults, empty messages, nested custom types, signed durations, alignment, endianness, and supported CDR encapsulations. Reject unsupported variants clearly.
- Keep uint64/int64 values exact during decoding. Establish a policy for BigInt in Raw Messages, JSON export, message paths, Plot, and Node Playground; only convert to Number with a checked safe range.
- Keep MCAP nanosecond timestamps as BigInt until converting by integer quotient/remainder to `{sec,nsec}`. Default playback order is MCAP log time; publish time and header time have different semantics.
- Return requested topics in stable time order with the existing inclusive-range behavior. Verify adjacent playback intervals avoid duplicates and rapid seeks ignore stale results.
- Keep bulk byte arrays typed, especially Image/CompressedImage/PointCloud2 data. Avoid recursive copying of their elements during adaptation.

## Milestones and acceptance gates

### 1. Reproducible baseline and compatibility spike

- Install the copied project, establish a documented Node/npm version, and reproduce the existing static build and representative ROS 1 tests.
- Check current Git-pinned dependencies and obsolete install assumptions. Make only the build changes needed to proceed, with lockfile updates.
- Bundle a small indexed MCAP read and one custom CDR message with the chosen libraries using the actual webpack/worker setup. Check BigInt/browser and decompressor integration.
- Decide whether minimal bundler updates are sufficient before considering wider modernization.

Gate: existing ROS 1 fixture opens and the new dependencies work in both required execution contexts.

### 2. MCAP metadata and indexed reads

- Implement Blob range access, magic-byte selection, provider registration, schema/channel discovery, timestamp conversion, subscribed time-window reads, progress, and cleanup.
- Initially support indexed uncompressed `ros2msg`/`cdr` files. Explain unsupported schema/encoding, missing indexes, malformed headers, and truncated records without a permanent loading spinner.
- Verify metadata discrepancies on the available recording and duplicate schema/type/channel cases.

Gate: inspect topics and fetch bounded windows from the real recording without reading its entire payload into memory.

### 3. ROS 2 decoding and basic playback

- Implement schema parsing, decoder caching, compatibility definitions/values, bobject wrapping, format-aware assembly, and memory accounting.
- Update drag/drop and file-picker filters/help text where needed; retain content-based validation.
- Validate Raw Messages, scalar Plot, pause/resume, speed changes, and beginning/middle/end seeks with both standard and custom messages.

Gate: selected values/timestamps agree with an independent ROS 2 or Python MCAP/CDR reference decoder; ROS 1 playback still works.

### 4. Sensor and 3D compatibility

- Validate CompressedImage display, PointCloud2 buffers/fields, IMU data, MarkerArray, time/duration handling, and frame selection on the real recording.
- Add small synthetic fixtures for TF and `/tf_static`, since the real recording has neither. Verify transforms persist appropriately across seeks.
- Profile rapid seeks and playback with images, points, markers, and plots; move decoding into a worker if required by measured UI blocking.
- Add zstd/lz4 with codecs verified against MCAP fixtures; ROS 1 LZ4 support alone does not establish MCAP compatibility.

Gate: common panels render correctly and repeated seeks/source changes keep memory bounded. Record measured load/seek times and peak memory on the test machine before defining performance targets.

### 5. GitHub release preparation

- Replace inherited CI/deploy links and Cruise-specific publishing assumptions with repository-owned build/test workflows. Review legacy telemetry configuration and service endpoints before release.
- Add honest support documentation, screenshots from shareable synthetic data, installation instructions, and a troubleshooting/limitations list.
- Keep large/private recordings excluded. Commit only small generated fixtures with documented provenance.
- Review attribution/dependency licenses, initialize the standalone Git repository, and configure its remote when the destination is supplied. Publish only when requested.

Gate: fresh-checkout installation, production build, ROS 1 and ROS 2 regression checks, and browser smoke tests pass using the documented environment.

## Verification scope

Use focused tests for the reader/adapter/provider contracts and a browser smoke flow; a passing decoder unit test alone does not prove panel compatibility. Cover timestamp precision, inclusive ranges, schema collisions, empty messages, nested/bounded definitions, 64-bit values, malformed/unsupported files, compression, worker transport, byte accounting, cancellation, and cleanup. Compare payload values against an independent reference decoder rather than only asserting implementation-shaped objects.

Keep the full local recording as a manual performance/integration input outside Git. Small public synthetic fixtures should cover the deterministic regressions and TF cases. Baseline/build tests have not been run during this copy-and-plan step.

## Reference documentation

- [MCAP format specification](https://mcap.dev/spec): records, indexes, compression and timestamps.
- [MCAP encoding registry](https://mcap.dev/spec/registry): ROS 2 `cdr` channels with `ros2msg` or `ros2idl` schemas.
- [MCAP TypeScript SDK](https://mcap.dev/docs/typescript/), including [McapIndexedReader](https://mcap.dev/docs/typescript/classes/_mcap_core.McapIndexedReader).
- [Foxglove ROS TypeScript packages](https://github.com/foxglove/ros-typescript): definition parsing and ROS 2 CDR serialization.

Package choices and integration details remain subject to the first milestone's compatibility checks.
