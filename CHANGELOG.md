# Changelog

## Unreleased

- Skip ROS 2 messages that do not decode against their schema (warning once per topic) instead of failing the whole read and stopping playback.
- A failed background prefetch now stops prefetching for that topic set only; reads elsewhere in the recording keep working.
- Plot ROS 2 `int64`/`uint64` (BigInt) fields, and stop Raw Messages copy/diff from throwing on them.
- Open MCAP files that contain unsupported channels (non-CDR, schemaless or `ros2idl`): those topics are skipped with a warning.
- Accept MCAP chunks that hold no messages without rejecting the file or moving the start time to 0.

## 0.1.0-preview.1 — 2026-11-16

First independent source preview based on Cruise Webviz.

- Add indexed ROS 2 MCAP input, CDR/schema adaptation and uncompressed/LZ4/Zstandard chunk support.
- Preserve ROS 1 input and integrate ROS 2 data with existing message, plot, image and 3D panels.
- Add synthetic fixtures, scene/data regression tests and optional browser verification scripts.
- Add complete-snapshot and original-Z-layer display controls for MarkerArray topics.
- Default two specific layered planning topics to the latest snapshot at Z=0, including old layouts missing these settings; keep explicit overrides.
- Refresh snapshot namespace lists to match the current frame/layer and normalize leading slashes in frame comparisons.
- Collapse identical text labels at identical positions by default, with an option to restore stacking.
- Prepare independent contribution/release documentation and exclude local recordings, screenshots, caches and partial downloads.

The latest planning display changes are verified at the data/scene level, but the reporter's browser output and complete multi-topic alignment remain unconfirmed. This preview is not a stable-release claim.
