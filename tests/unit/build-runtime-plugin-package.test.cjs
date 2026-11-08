'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const fs = require('fs');
const os = require('os');

const { buildManifest, buildHakunekoPackage, collectTree } = require(path.join(
  __dirname, '..', '..', 'scripts', 'build-runtime-plugin-package.cjs',
));
const { PLUGIN_CONTRACT_VERSION } = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'plugindtocontract.cjs',
));

test('manifest - reflects plugin-package.json and injects hostApiVersion', () => {
  const manifest = buildManifest('1.0.0');
  assert.equal(manifest.pluginName, 'hakuneko');
  assert.equal(manifest.pluginType, 'adapter');
  assert.equal(manifest.hostApiVersion, '1.0.0');
  assert.deepEqual(manifest.capabilities, [
    'file-path', 'search.query', 'enrich', 'sync.pull', 'sync.push', 'sync.list', 'watch.list', 'subscribe.add', 'watch.summary',
  ]);
  assert.equal(manifest.workspace.workspaceId, 'plugin:hakuneko');
  assert.equal(manifest.entrypoints.pluginModule, 'apiwrappers/reg-hakuneko/hakuneko-plugin-module.cjs');
  assert.equal(manifest.entrypoints.settingsFile, 'apiwrappers/reg-hakuneko/hakuneko-plugin-settings.json');
});

test('manifest - contract 4.0.0: pluginContractVersion and the vendored constant agree', () => {
  const manifest = buildManifest('1.0.0');
  assert.equal(manifest.pluginContractVersion, '4.0.0');
  assert.equal(PLUGIN_CONTRACT_VERSION, '4.0.0');
});

test('manifest - syncOptions: chapter-only progressAxes + two-table statusVocabulary (membership-only list); no filterSchema', () => {
  const manifest = buildManifest('1.0.0');
  assert.deepEqual(manifest.syncOptions.progressAxes, { pull: ['chapter'], push: ['chapter'] });
  // HakuNeko has one list (the bookmarks file), with no reading status: every host status pushes to it,
  // and it pulls as null — a membership-only list (host-capability-contract.md §2.2, A16).
  assert.deepEqual(manifest.syncOptions.statusVocabulary, {
    push: {
      READING: 'bookmarks', COMPLETED: 'bookmarks', PLAN_TO_READ: 'bookmarks',
      ON_HOLD: 'bookmarks', DROPPED: 'bookmarks', RE_READING: 'bookmarks',
    },
    pull: { bookmarks: null },
  });
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
