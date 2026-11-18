// Create an inspectable source-only preview without touching the workspace's .git.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ignore = require("ignore");

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{30,}\b/,
];

function inventory(root) {
  const rules = ignore().add(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).add([".git/", "/SOURCE_MANIFEST.json"]);
  const fixtures = JSON.parse(fs.readFileSync(path.join(root, "scripts/public-fixtures.json"), "utf8"));
  const files = [];
  function walk(dir = "") {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (rules.ignores(rel + (entry.isDirectory() ? "/" : ""))) continue;
      if (entry.isDirectory()) { walk(rel); continue; }
      const absolute = path.join(root, rel);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        assert.ok(!path.isAbsolute(fs.readlinkSync(absolute)), `Non-portable absolute symlink: ${rel}`);
        const target = fs.realpathSync(absolute);
        assert.ok(target.startsWith(`${root}${path.sep}`), `External symlink: ${rel}`);
        files.push({ path: rel, link: fs.readlinkSync(absolute), size: 0, sha256: sha256(fs.readlinkSync(absolute)) });
        continue;
      }
      assert.ok(stat.isFile(), `Unsupported file: ${rel}`);
      assert.ok(stat.size < 100 * 1024 * 1024, `File too large for source publication: ${rel}`);
      assert.ok(rel.endsWith(".env.example") || !/(^|\/)(?:\.env(?:\.|$)|\.aws|\.codex|\.agents|rosbag2_|bug\d*\.(?:png|jpg))|\.(?:mcap|db3|crdownload|part)(?:\.|$)/i.test(rel), `Local data in source: ${rel}`);
      const bytes = fs.readFileSync(absolute);
      const hash = sha256(bytes);
      if (/\.bag$/i.test(rel)) assert.equal(hash, fixtures[rel], `Unapproved or changed recording: ${rel}`);
      if (!bytes.includes(0)) {
        const text = bytes.toString("utf8");
        for (const pattern of credentialPatterns) assert.ok(!pattern.test(text), `Possible credential in ${rel}; inspect locally`);
      }
      files.push({ path: rel, size: stat.size, sha256: hash });
    }
  }
  walk();
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const paths = new Set(files.map((file) => file.path));
  for (const file of files.filter((item) => item.link)) {
    const target = path.relative(root, fs.realpathSync(path.join(root, file.path))).split(path.sep).join("/");
    assert.ok(paths.has(target), `Symlink target is not in source inventory: ${file.path}`);
  }
  return files;
}

function release(root) {
  root = fs.realpathSync(root);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const files = inventory(root);
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const prefix = `${pkg.name}-${pkg.version}`;
  const manifest = { name: pkg.name, version: pkg.version, created: now.toISOString(), files };
  const cache = path.join(root, ".cache");
  fs.mkdirSync(cache, { recursive: true });
  const stage = fs.mkdtempSync(path.join(cache, "source-release-"));
  const directory = path.join(stage, prefix);
  for (const file of files) {
    const source = path.join(root, file.path), dest = path.join(directory, file.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (file.link) fs.symlinkSync(file.link, dest);
    else fs.copyFileSync(source, dest);
  }
  fs.writeFileSync(path.join(directory, "SOURCE_MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  const out = path.join(root, "releases");
  fs.mkdirSync(out, { recursive: true });
  const archive = path.join(out, `${prefix}-${stamp}.tar.gz`);
  assert.ok(!fs.existsSync(archive), "Snapshot already exists; wait a second and retry");
  const result = spawnSync("tar", ["-czf", archive, "-C", stage, prefix], { encoding: "utf8" });
  assert.equal(result.status, 0, `tar failed: ${result.error?.message || result.stderr}`);
  fs.writeFileSync(`${archive}.sha256`, `${sha256(fs.readFileSync(archive))}  ${path.basename(archive)}\n`);
  fs.writeFileSync(`${archive}.manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Saved ${files.length} source files (${files.reduce((sum, file) => sum + file.size, 0)} bytes).`);
  console.log(path.relative(root, archive));
  console.log("Manifest and SHA-256 written beside the archive. No Git metadata or remote was changed.");
  return archive;
}

module.exports = { inventory, release };
if (require.main === module) release(path.resolve(__dirname, ".."));
