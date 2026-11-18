# Modifications and source provenance

This independent project starts from Cruise Webviz commit `d13afdacaec0b48f983adcaca55b84c36c42a5f2`.
Original copyrights and license headers remain with upstream files. Modified source files carry a modification notice;
this companion inventory records changed configuration/JSON files, lockfiles, documentation and added files.

The ROS 2 integration adds MCAP/CDR providers, codec loading, schema adaptation, bounded data/worker handling,
3D Marker display controls and regression/verification scripts. Release preparation changes project metadata,
documentation, local-data exclusions, independent CI and source packaging. See CHANGELOG.md for behavior and limitations.

## Modified upstream paths

- `.dockerignore`
- `.eslintignore`
- `.flowconfig`
- `.github/pull_request_template.md`
- `.gitignore`
- `.vscode/settings.json`
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `README.md`
- `babel.config.js`
- `docs/public/index.html`
- `jest/jest.config.js`
- `package-lock.json`
- `package.json`
- `packages/@cruise-automation/button/package-lock.json`
- `packages/@cruise-automation/hooks/package-lock.json`
- `packages/@cruise-automation/tooltip/package-lock.json`
- `packages/regl-worldview/package-lock.json`
- `packages/webviz-core/.eslintrc.js`
- `packages/webviz-core/README.md`
- `packages/webviz-core/package-lock.json`
- `packages/webviz-core/package.json`
- `packages/webviz-core/src/components/DocumentDropListener.js`
- `packages/webviz-core/src/components/MessagePipeline/index.js`
- `packages/webviz-core/src/components/PlayerManager.js`
- `packages/webviz-core/src/components/ReactChartjs/index.js`
- `packages/webviz-core/src/dataProviders/MemoryCacheDataProvider.js`
- `packages/webviz-core/src/dataProviders/MemoryCacheDataProvider.test.js`
- `packages/webviz-core/src/dataProviders/RewriteBinaryDataProvider.js`
- `packages/webviz-core/src/dataProviders/WorkerDataProvider.js`
- `packages/webviz-core/src/dataProviders/WorkerDataProvider.worker.js`
- `packages/webviz-core/src/dataProviders/constants.js`
- `packages/webviz-core/src/dataProviders/rootGetDataProvider.js`
- `packages/webviz-core/src/dataProviders/standardDataProviderDescriptors.js`
- `packages/webviz-core/src/dataProviders/types.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/Layout/WorkerDataRpc.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/Layout/index.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/SceneBuilder/MessageCollector.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/SceneBuilder/index.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/TopicSettingsEditor/MarkerSettingsEditor.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/TopicSettingsEditor/index.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/TopicTree/TopicSettingsModal.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/Transforms/index.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/commands/PointClouds/readers.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/commands/PointClouds/types.js`
- `packages/webviz-core/src/players/RandomAccessPlayer.js`
- `packages/webviz-core/src/players/RandomAccessPlayer.test.js`
- `packages/webviz-core/src/util/binaryObjects/index.js`
- `packages/webviz-core/src/util/binaryObjects/jsWrapperObjects.js`
- `regconfig.json`
- `webpack.config.js`

## Added project paths

- `.github/workflows/ci.yml`
- `.npmrc`
- `CHANGELOG.md`
- `NOTICE`
- `README.upstream.md`
- `THIRD_PARTY_NOTICES.md`
- `docs/RELEASE_AUDIT.md`
- `docs/RELEASING.md`
- `docs/ROS2_MARKER_SNAPSHOTS.md`
- `docs/ROS2_MCAP_COMPRESSION.md`
- `docs/ROS2_MCAP_INSTALLATION.md`
- `docs/ROS2_MCAP_PLAN.md`
- `docs/ROS2_MCAP_PROGRESS.md`
- `docs/ROS2_MCAP_SCENE_VALIDATION.md`
- `docs/ROS2_MCAP_STABILITY.md`
- `docs/layouts/ros2-ground-layer.json`
- `docs/upstream/CONTRIBUTING.md`
- `docs/upstream/Dockerfile-static-webviz`
- `docs/upstream/Dockerfile-webviz-ci`
- `docs/upstream/README.md`
- `docs/upstream/circleci/config.yml`
- `docs/upstream/circleci/find-screenshots-compare-commit.sh`
- `docs/upstream/webviz-core-README.md`
- `flow-typed/ros2-mcap.js`
- `packages/webviz-core/src/components/ReactChartjs/index.test.js`
- `packages/webviz-core/src/dataProviders/McapDataProvider.js`
- `packages/webviz-core/src/dataProviders/McapDataProvider.test.js`
- `packages/webviz-core/src/dataProviders/Ros2Scene.test.js`
- `packages/webviz-core/src/dataProviders/Ros2ToBobjectDataProvider.js`
- `packages/webviz-core/src/dataProviders/WorkerDataProvider.test.js`
- `packages/webviz-core/src/dataProviders/ros2/decompression.js`
- `packages/webviz-core/src/dataProviders/ros2/mcapUtils.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/Layout/WorkerDataRpc.test.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/TopicSettingsEditor/MarkerArraySettingsEditor.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/TopicSettingsEditor/MarkerArraySettingsEditor.test.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/commands/PointClouds/readers.test.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/markerTopicSettings.js`
- `packages/webviz-core/src/panels/ThreeDimensionalViz/markerTopicSettings.test.js`
- `scripts/bootstrap-local.cjs`
- `scripts/fixtures/compression.js`
- `scripts/fixtures/ros2-scene.js`
- `scripts/mcap-helpers.test.mjs`
- `scripts/public-fixtures.json`
- `scripts/release-source.cjs`
- `scripts/release-source.test.cjs`
- `scripts/smoke-mcap-compression.cjs`
- `scripts/smoke-mcap.cjs`
- `scripts/smoke-ros2-scene.cjs`
- `scripts/stress-mcap.cjs`
- `scripts/verify-clean-install.cjs`
- `scripts/verify-mcap.cjs`
- `third_party/licenses/foxglove-rosmsg-LICENSE.txt`
- `third_party/licenses/foxglove-rosmsg2-serialization-LICENSE.txt`
- `third_party/licenses/foxglove-wasm-lz4-LICENSE.txt`
- `third_party/licenses/foxglove-wasm-zstd-LICENSE.txt`
- `third_party/licenses/inter-ui-LICENSE.txt`
- `third_party/licenses/mcap-core-LICENSE.txt`

## Archived or excluded upstream material

- Historical contribution and package documentation, CircleCI files and Dockerfiles are under `docs/upstream/`.
- `README.upstream.md` preserves the original root README.
- The GT Cinetype asset is excluded from the published tree; it is backed up only under ignored local data. The static landing page uses system-font fallbacks.
- Unchanged public fixtures retain their upstream contents; SHA-256 checksums are in `scripts/public-fixtures.json`.

Generated caches, build outputs, private recordings, screenshots and local archives are not part of this source release.
