# Third-party notices

The Apache-2.0 license at the repository root covers this project's application source; it does not replace the licenses of dependencies or separately licensed assets. Original source headers remain in place.

## Upstream application

Cruise Webviz, upstream commit `d13afdacaec0b48f983adcaca55b84c36c42a5f2`, is the source of the original application, UI packages, rendering library and public fixtures. Its Apache-2.0 license is retained as `LICENSE`; attribution is in `NOTICE`.

## ROS 2/MCAP dependencies

The inherited `packages/webviz-core/src/components/ReactChartjs/index.js` also contains an MIT-licensed wrapper by Jeremy Ayerst; its full file-level notice is retained.

The following installed direct dependencies were checked for this preview. Copies of their distributed license files are in `third_party/licenses/`.

| Package | Version | Package license |
| --- | --- | --- |
| `@mcap/core` | 2.3.0 | MIT |
| `@foxglove/rosmsg` | 5.0.5 | MIT |
| `@foxglove/rosmsg2-serialization` | 3.1.2 | MIT |
| `@foxglove/wasm-lz4` | 1.0.2 | MIT |
| `@foxglove/wasm-zstd` | 1.0.1 | MIT |

These checks are not a full legal or security review of the legacy transitive dependency tree. Source archives do not include installed dependencies. When distributing compiled assets, preserve the licenses and notices of the code and codecs included in those assets, including webpack's emitted `*.LICENSE.txt` files.

## Fonts and assets

- The vendored Roboto Mono WOFF2 font files in `packages/webviz-core/src/styles/assets/` identify `Copyright 2015 Google Inc. All Rights Reserved.` and the Apache-2.0 license URL in their embedded name tables. The license text is included at the repository root.
- Inter UI is installed through npm; its distributed font license is copied to `third_party/licenses/inter-ui-LICENSE.txt`.
- The inherited GT Cinetype file has been excluded from this source distribution because separate redistribution permission was not established. The static landing page now uses system-font fallbacks.
- The unchanged upstream public test fixtures and demonstration assets remain attributed to the upstream distribution. Private local recordings and debug screenshots are not part of this project release.

## Historical configuration

The original CircleCI configuration is archived under `docs/upstream/circleci/` and is inactive. Active package scripts no longer publish to Cruise hosting, npm package scopes or the upstream screenshot bucket. Company names in archived documents and source identifiers describe origin rather than current operation.
