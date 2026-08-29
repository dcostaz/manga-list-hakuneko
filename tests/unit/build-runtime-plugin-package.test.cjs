'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const fs = require('fs');
const os = require('os');

const { buildManifest, buildHakunekoPackage, collectTree } = require(path.join(
  __dirname, '..', '..', 'scripts', 'build-runtime-plugin-package.cjs',
));

test('manifest - reflects plugin-package.json and injects hostApiVersion', () => {
  const manifest = buildManifest('1.0.0');
  assert.equal(manifest.pluginName, 'hakuneko');
  assert.equal(manifest.pluginType, 'adapter');
  assert.equal(manifest.hostApiVersion, '1.0.0');
  assert.deepEqual(manifest.capabilities, ['tracker.file', 'workspace.list', 'workspace.get', 'plugin.cardBadge']);
  assert.equal(manifest.workspace.workspaceId, 'plugin:hakuneko');
  assert.equal(manifest.entrypoints.pluginModule, 'apiwrappers/reg-hakuneko/hakuneko-plugin-module.cjs');
  assert.equal(manifest.entrypoints.settingsFile, 'apiwrappers/reg-hakuneko/hakuneko-plugin-settings.json');
});

test('manifest - has no syncOptions or filterSchema (tracker.file)', () => {
  const manifest = buildManifest('1.0.0');
  assert.equal(manifest.syncOptions, undefined);
  assert.equal(manifest.filterSchema, undefined);
});

test('web/ tree - the whole workspace.entry surface is bundled (host-capability-contract.md §4.2)', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hakuneko-build-')), 'pkg.zip');
  const result = await buildHakunekoPackage({ outputPath: out });

  assert.ok(result.webFiles.includes('web/index.html'));
  assert.ok(result.webFiles.includes('web/app.js'));
  assert.ok(result.webFiles.includes('web/surface-logic.js'));
  assert.ok(result.webFiles.includes('web/styles.css'));
  for (const dest of result.webFiles) assert.match(dest, /^web\/[^\\]+$/);
  assert.equal(result.fileCount, 6 /* FILE_MAPPINGS */ + result.webFiles.length + 1 /* manifest */);
  fs.rmSync(out, { force: true });
});

test('collectTree - returns [] for an absent directory, does not throw', () => {
  assert.deepEqual(collectTree(path.join(os.tmpdir(), 'definitely-not-here-hakuneko'), 'web'), []);
});
