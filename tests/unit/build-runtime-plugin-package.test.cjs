'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { buildManifest } = require(path.join(
  __dirname, '..', '..', 'scripts', 'build-runtime-plugin-package.cjs',
));

test('manifest - reflects plugin-package.json and injects hostApiVersion', () => {
  const manifest = buildManifest('1.0.0');
  assert.equal(manifest.pluginName, 'hakuneko');
  assert.equal(manifest.pluginType, 'tracker');
  assert.equal(manifest.hostApiVersion, '1.0.0');
  assert.deepEqual(manifest.capabilities, ['tracker.file', 'workspace.list', 'workspace.get']);
  assert.equal(manifest.workspace.workspaceId, 'plugin:hakuneko');
  assert.equal(manifest.entrypoints.pluginModule, 'apiwrappers/reg-hakuneko/hakuneko-plugin-module.cjs');
  assert.equal(manifest.entrypoints.settingsFile, 'apiwrappers/reg-hakuneko/hakuneko-plugin-settings.json');
});

test('manifest - has no syncOptions or filterSchema (tracker.file)', () => {
  const manifest = buildManifest('1.0.0');
  assert.equal(manifest.syncOptions, undefined);
  assert.equal(manifest.filterSchema, undefined);
});
