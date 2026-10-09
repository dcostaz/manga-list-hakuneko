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
  assert.deepEqual(manifest.capabilities, [
    'file-path', 'search.query', 'sync.pull', 'sync.push', 'sync.list', 'watch.list', 'subscribe.add', 'watch.summary',
  ]);
  assert.equal(manifest.workspace.workspaceId, 'plugin:hakuneko');
  assert.equal(manifest.entrypoints.pluginModule, 'apiwrappers/reg-hakuneko/hakuneko-plugin-module.cjs');
  assert.equal(manifest.entrypoints.settingsFile, 'apiwrappers/reg-hakuneko/hakuneko-plugin-settings.json');
});

test('manifest - syncOptions: chapter-only progressAxes + single-list statusVocabulary; no filterSchema', () => {
  const manifest = buildManifest('1.0.0');
  assert.deepEqual(manifest.syncOptions.progressAxes, { pull: ['chapter'], push: ['chapter'] });
  // HakuNeko has one reading list (the bookmarks file) — every canonical status maps to it.
  for (const key of ['READING', 'COMPLETED', 'PLAN_TO_READ', 'ON_HOLD', 'DROPPED', 'RE_READING']) {
    assert.equal(manifest.syncOptions.statusVocabulary[key], 'bookmarks');
  }
  assert.equal(manifest.filterSchema, undefined);
});

test('manifest - workspace declares an entry surface + callbacks, no retired schema', () => {
  const ws = buildManifest('1.0.0').workspace;
  assert.equal(ws.entry, 'web/index.html');
  assert.deepEqual(ws.callbacks, ['get-info', 'bookmark', 'find-in-mangalist', 'open-url']);
  assert.equal(ws.components, undefined);
  assert.equal(ws.cardDisplay, undefined);
  assert.equal(ws.detailLayout, undefined);
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
