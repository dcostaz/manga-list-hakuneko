'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const fs = require('fs');
const os = require('os');

const { buildManifest, buildHakunekoPackage, collectTree } = require(path.join(
  __dirname, '..', '..', 'scripts', 'build-runtime-plugin-package.cjs',
));
const { PLUGIN_CONTRACT_VERSION } = require('@manga-list/plugin-sdk');

test('manifest - reflects plugin-package.json and injects hostApiVersion', () => {
  const manifest = buildManifest('1.0.0');
  assert.equal(manifest.pluginName, 'hakuneko');
  assert.equal(manifest.pluginType, 'adapter');
  assert.equal(manifest.hostApiVersion, '1.0.0');
  assert.deepEqual(manifest.capabilities, [
    'file-path', 'search.query', 'enrich', 'sync.pull', 'sync.push', 'sync.list', 'watch.list', 'subscribe.add', 'watch.summary',
  ]);
  assert.equal(manifest.workspace.workspaceId, 'plugin:hakuneko');
  assert.equal(manifest.entrypoints.pluginModule, 'apiwrappers/reg-hakuneko/hakuneko-plugin.cjs');
  assert.deepEqual(manifest.filePathOptions.fields.map((/** @type {any} */ f) => [f.key, f.kind]), [
    ['downloadBaseDir', 'directory'], ['bookmarksPath', 'file'], ['chaptermarksPath', 'file'],
  ]);
  assert.equal(manifest.entrypoints.settingsFile, 'apiwrappers/reg-hakuneko/hakuneko-plugin-settings.json');
});

test('manifest - contract 4.1.0: pluginContractVersion and the SDK\'s constant agree', () => {
  const manifest = buildManifest('1.0.0');
  assert.equal(manifest.pluginContractVersion, '4.1.0');
  assert.equal(PLUGIN_CONTRACT_VERSION, '4.1.0');
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
  assert.equal(result.fileCount, 5 /* FILE_MAPPINGS: three modules, the settings document, the icon */ + result.webFiles.length + 2 /* the manifest, twice */);
  fs.rmSync(out, { force: true });
});

test('the package - the definition and its layers, the manifest at the root and beside the definition; no SDK, no 3.x files', async () => {
  const JSZip = require('jszip');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hakuneko-build-')), 'pkg.zip');
  await buildHakunekoPackage({ outputPath: out });
  const names = Object.keys((await JSZip.loadAsync(fs.readFileSync(out))).files).filter((n) => !n.endsWith('/'));
  for (const name of [
    'plugin-package.json', 'apiwrappers/reg-hakuneko/plugin-package.json', 'apiwrappers/reg-hakuneko/hakuneko-plugin.cjs',
    'apiwrappers/reg-hakuneko/hakuneko-source.cjs', 'apiwrappers/reg-hakuneko/hakuneko-mapping.cjs',
    'apiwrappers/reg-hakuneko/hakuneko-plugin-settings.json', 'images/hakuneko-icon.svg',
  ]) {
    assert.ok(names.includes(name), name);
  }
  assert.ok(!names.some((n) => /plugin-sdk|plugindtocontract|hakuneko-adapter|hakuneko-settings\.cjs|plugin-module/.test(n)), names.join(', '));
  fs.rmSync(out, { force: true });
});

test('collectTree - returns [] for an absent directory, does not throw', () => {
  assert.deepEqual(collectTree(path.join(os.tmpdir(), 'definitely-not-here-hakuneko'), 'web'), []);
});
