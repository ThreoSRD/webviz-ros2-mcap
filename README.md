# Webviz ROS 2 MCAP

An independent derivative of [Cruise Webviz](https://github.com/cruise-automation/webviz) that adds local **ROS 2 MCAP playback** to the browser-based visualization tool.

**Release: `0.1.0-preview.1` — experimental.** This project preserves the upstream React/Flow application and adds MCAP input, CDR decoding, ROS 2 message adaptation and regression checks. It is not an official Cruise or Foxglove release.

## What works

- Open an indexed ROS 2 `.mcap` by dragging it into the browser.
- Decode embedded `ros2msg` schemas and `cdr` messages.
- Read uncompressed, LZ4, Zstandard and mixed-compression chunks.
- Inspect messages in Raw Messages and Plot; display JPEG CompressedImage and PointCloud2 data.
- Display basic TF chains and Marker/MarkerArray data, including marker lifetime and delete actions.
- Keep the existing ROS 1 `.bag` playback path.

Recordings are read locally through the browser file API. No ROS installation is needed, and no private recording is included in this repository.

## Quick start

Use **Node.js 22.x (at least 22.15)**; the tested environment is Linux, Node 22.22.3, npm 10.9.8 and Chrome 156. A current Chrome/Chromium browser with WebGL is recommended. Other platforms have not been validated.

From a cloned repository or an extracted source archive:

```sh
npm run bootstrap
npm run webviz-dev
```

Open the address printed by webpack-dev-server, normally **http://localhost:8080/**. Drag a `.mcap` or ROS 1 `.bag` file into the page. Add panels and select topics as needed.

Bootstrap installs the monorepo dependencies and links local packages. Each time you start the development server, it first builds the local packages; allow time for that and the initial webpack compilation before opening the page. Its npm, node-gyp and Puppeteer caches stay under `.cache/`. Chromium downloads are skipped. Rerun bootstrap after interrupted downloads; see [installation details](docs/ROS2_MCAP_INSTALLATION.md).

To build and serve production assets locally:

```sh
NODE_ENV=production npm run build
npm run serve-local
```

Then open **http://127.0.0.1:18080/app/**. The root `private: true` package flag prevents accidental npm publication; it does not restrict publishing this source repository on GitHub.

## 3D display settings

In a 3D panel, open the topic list with the layers icon, then choose the topic row's **⋮ → Edit topic settings**.

- **Message handling → Complete snapshot** replaces a topic's old markers with each complete array, including an empty array. Ordinary MarkerArrays default to incremental updates, preserving namespace/ID, lifetime and delete semantics.
- **Z layer (line markers)** displays complete line markers at one original point Z coordinate. Clear the field to show all layers. It does not flatten or rewrite coordinates.
- Identical text labels at the same position and with the same style in a topic/namespace are shown once. Enable **Stack identical text labels** to inspect repeated labels individually.

Two known layered planning topics, `/planning/virtual_map_polygon3d` and `/planning/virtual_path_polygon3d`, use a **project-specific preset: complete snapshot, Z layer 0**. Explicit settings override the preset. An absent Z setting uses the preset; `markerZLayer: null` explicitly shows all layers. This convention is specific to those topic names, not a general ROS 2 rule.

An optional [ground-layer example layout](docs/layouts/ros2-ground-layer.json) is available. Save your current layout before importing it through **Config → Import/export layout**. See the [3D display guide (中文)](docs/ROS2_MARKER_SNAPSHOTS.md).

## Limitations and validation status

- Requires indexed MCAP chunks and message indexes. `ros2idl`, `.db3`, unindexed MCAP, split recordings and live ROS 2 input are not implemented.
- TF interpolation and exact per-message transform timing are not implemented. Seeking does not reconstruct the full historical state of arbitrary incremental Marker topics.
- Compressed chunks have a 256 MiB decoded-size limit per chunk.
- Latest snapshot, Z-layer, namespace and text-label changes have automated scene/data tests. Their visual behavior in the reporting user's browser has **not yet been confirmed**; multi-topic planning alignment is still being investigated.
- This is a legacy dependency stack. It is a local development/visualization preview, not a claim of production readiness or a complete dependency security audit.

## Verification

After bootstrap:

```sh
npm run test:mcap:helpers
npm run test:mcap:regression
npm run lint
npm run flow
```

For a locked dependency installation and the coordinated checks:

```sh
npm run install-ci
npm run verify:mcap -- --no-browser
```

To include browser smoke tests, use an installed Chrome/Chromium executable:

```sh
BROWSER_PATH=/usr/bin/google-chrome npm run verify:mcap
```

The browser checks generate synthetic recordings. They require local port binding and browser execution permissions. Logs, generated recordings and browser profiles remain under `.cache/`. Earlier browser validation results are documented separately from the latest source-level checks.

## Project layout

| Path | Purpose |
| --- | --- |
| `packages/webviz-core/` | Application, players, ROS 2 data providers and panels |
| `packages/regl-worldview/` | Upstream WebGL rendering library |
| `packages/@cruise-automation/` | Upstream shared UI packages |
| `scripts/` | Local installation, fixtures and verification tools |
| `docs/` | Implementation notes, validation records and example layouts |
| `docs/upstream/`, `README.upstream.md` | Historical upstream documentation and CI configuration |

Internal package names are retained for import and workspace compatibility. Historical upstream documentation describes upstream services and processes, not services operated by this project.

## Origin and license

The starting source snapshot is Cruise Webviz commit [`d13afdacaec0b48f983adcaca55b84c36c42a5f2`](https://github.com/cruise-automation/webviz/commit/d13afdacaec0b48f983adcaca55b84c36c42a5f2). Upstream authors retain their copyrights. This project contributes the ROS 2/MCAP integration and the changes listed in [CHANGELOG.md](CHANGELOG.md) and [MODIFICATIONS.md](MODIFICATIONS.md).

The application source is distributed under [Apache-2.0](LICENSE), with attribution in [NOTICE](NOTICE). Third-party packages and assets retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Project and company names are used to identify provenance, without implying endorsement.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contributions and [the release guide](docs/RELEASING.md) for creating a clean source snapshot and publishing it to your own GitHub repository.
