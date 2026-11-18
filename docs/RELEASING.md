# Preparing and publishing a source preview

This project is an independent Apache-2.0 derivative of Cruise Webviz. Keep `LICENSE`, `NOTICE`, original source headers, third-party notices and the upstream attribution when sharing it. The authoritative redistribution conditions are in [Apache-2.0 section 4](https://www.apache.org/licenses/LICENSE-2.0).

## Save a clean local version

After installing dependencies and running the checks in the README:

```sh
npm run test:release
npm run release:source
```

The packaging command requires Node.js and `tar` (validated on Linux). It creates:

- `releases/webviz-ros2-mcap-<version>-<timestamp>.tar.gz`
- A matching `.sha256` checksum and `.manifest.json` file.
- An embedded `SOURCE_MANIFEST.json` listing every included path, size and SHA-256.

It respects `.gitignore`, excludes Git metadata, checks that symlinks stay inside the included tree, rejects files of 100 MiB or larger and scans included text for common credential formats. The only allowed `.bag` files are the unchanged upstream public fixtures listed by checksum in `scripts/public-fixtures.json`. This is a useful release check, not a guarantee that arbitrary confidential material can be detected automatically.

Private `.mcap`/`.db3`/`.bag` recordings, `rosbag2_*` directories, partial browser downloads, `bug*.png` screenshots, caches, generated bundles, credential directories and previous release archives are excluded. Local files remain on disk. The inherited GT Cinetype file was moved to ignored `local-data/upstream-assets/`; its redistribution rights were not established.

## Create your GitHub repository

The source archive can be used without the current workspace's `.git` directory. Extract it into a new directory, inspect its manifest, and initialize that clean directory:

```sh
git init -b main
git add .
git diff --cached --stat
git commit -m "Initial ROS 2 MCAP source preview"
git tag v0.1.0-preview.1
```

Create an empty repository in your own GitHub account, then use the remote URL GitHub supplies. Check the staged file list before pushing. This preparation does not create a remote repository, push code or publish a release on your behalf.

Make sure you have the right to publish your own additions, including any employer-owned work. Do not add private recordings, browser screenshots or environment files after extracting the clean archive. Gitignore rules do not remove files that were already committed in some other repository's history.

## Release notes and validation

Use `CHANGELOG.md` as the starting point. Describe this as an experimental preview and keep the known limitations visible. Earlier browser validation does not certify the latest Marker display changes: the latest code has scene/data tests, while the reporter's current browser output and complete multi-topic planning alignment remain unconfirmed.

`npm run verify:mcap -- --no-browser` builds the project and runs helpers, regression tests, lint and Flow. `npm run verify:mcap` additionally needs a local Chrome/Chromium executable and local port-binding permission. GitHub Actions runs the non-browser checks; a workflow file being present does not mean it has already passed on GitHub.

## Assets and dependency notices

The source archive does not include `node_modules` or built assets. If distributing a compiled application, retain emitted `*.LICENSE.txt` files and the notices for all included libraries/codecs. The direct ROS 2 dependency license check is documented in `THIRD_PARTY_NOTICES.md`; it is not an exhaustive legal or vulnerability audit of the legacy dependency tree.
