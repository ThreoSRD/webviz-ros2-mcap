# Source preview preparation — 0.1.0-preview.1

Prepared on 2026-11-16. This records local source preparation, not a GitHub publication or a production-readiness certification.

## Local validation

`npm run verify:mcap -- --no-browser` passed on Node 22.22.3.

| Step | Result |
| --- | --- |
| `build` | Passed (exit 0) |
| `helpers` | Passed (exit 0) |
| `regression` | Passed (exit 0) |
| `lint` | Passed (exit 0) |
| `flow` | Passed (exit 0) |

The source-packaging tests, README relative-link check, workflow YAML parse, package/lock metadata consistency check,
source-inventory credential-pattern scan and public-fixture checksum check also passed.
The new GitHub Actions workflow has not been run remotely. Latest 3D display behavior still needs browser confirmation.

## Publication boundary

- Apache-2.0 text and upstream copyright headers are retained. NOTICE, third-party license copies and MODIFICATIONS.md document provenance.
- README describes an independent derivative, current features, tested environment, installation, limitations and contribution/release paths.
- Upstream company contribution policy and CI/Docker material are archived rather than active project instructions.
- Active scripts no longer publish to upstream company hosting, screenshot buckets or npm scopes.
- Local MCAP/SQLite bags, `rosbag2_*` directories, debug screenshots, browser partial downloads, caches and credentials are excluded.
- Six unchanged upstream public ROS 1 fixtures are retained by exact SHA-256 allowlist. They are separate from private recordings.
- The GT Cinetype font was excluded; its local backup remains in ignored local data. Roboto Mono embedded license metadata was checked and the Inter UI font license retained.
- This was not a complete vulnerability or transitive license audit. No project ownership/employment rights can be verified from source files alone.

## Saved version

Run `npm run release:source` to generate a source-only `.tar.gz`, SHA-256 checksum and full per-file manifest under ignored `releases/`.
The archive includes SOURCE_MANIFEST.json; its copy at an extracted repository root is ignored on future commits/repackages.
The current workspace's Git metadata is not writable, so this process saves an independent source snapshot rather than creating a commit/tag here.
No remote repository was created or pushed.
