const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { inventory } = require("./release-source.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "webviz-release-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts/public-fixtures.json"), "{}");
  fs.writeFileSync(path.join(root, ".gitignore"), "*.mcap\n*.crdownload\n/bug*.png\nnode_modules/\n.cache/\n");
  return root;
}

test("source inventory excludes recordings, screenshots, downloads and caches", (t) => {
  const root = fixture(t);
  for (const name of ["sensor.mcap", "download.crdownload", "bug51.png", "README.md"]) fs.writeFileSync(path.join(root, name), "example");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules/private.txt"), "private");
  fs.writeFileSync(path.join(root, "SOURCE_MANIFEST.json"), "old archive manifest");
  const names = inventory(root).map((file) => file.path);
  assert.ok(names.includes("README.md"));
  assert.ok(!names.some((name) => /sensor|download|bug51|private/.test(name)));
  assert.ok(!names.includes("SOURCE_MANIFEST.json"));
});

test("inventory rejects external symlinks and unapproved recordings", (t) => {
  const root = fixture(t);
  fs.symlinkSync(path.relative(root, os.tmpdir()), path.join(root, "external"));
  assert.throws(() => inventory(root), /External symlink/);
  fs.unlinkSync(path.join(root, "external"));
  fs.writeFileSync(path.join(root, "private.bag"), "recording");
  assert.throws(() => inventory(root), /Unapproved or changed recording/);
});

test("credential rejection reports a filename without printing the matched key", (t) => {
  const root = fixture(t);
  const secret = "ghp_" + "a".repeat(36);
  fs.writeFileSync(path.join(root, "config.txt"), secret);
  assert.throws(() => inventory(root), (error) => error.message.includes("config.txt") && !error.message.includes(secret));
});
