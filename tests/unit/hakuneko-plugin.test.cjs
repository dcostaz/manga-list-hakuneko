'use strict';

/**
 * The HakuNeko adapter on @manga-list/plugin-sdk (Plan-2026Q4-adapter-plugin-standardization Phase 4): the contract
 * suite with the adapter cases, each offer and own-data read against fixture files, the F13 reproductions, and the
 * byte-identity of a push and a Join List against the 4.0 adapter's output. The files' paths are each call's path
 * grant (contract A19), never settings.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const { runConformance, callContext, createStubContext } = require('@manga-list/plugin-sdk/testing');
const { isPluginError, validateResult } = require('@manga-list/plugin-sdk');

const REG = path.join(__dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-hakuneko');
const descriptor = require(path.join(REG, 'hakuneko-plugin.cjs'));
const manifest = require(path.join(REG, 'plugin-package.json'));
const map = require(path.join(REG, 'hakuneko-mapping.cjs'));
const golden = require(path.join(__dirname, '..', 'fixtures', 'golden-input.cjs'));

const BOOKMARKS = [
  { title: { connector: 'ManhuaUS', manga: 'Legend of Star General' }, key: { connector: 'manhuaus', manga: '/manga/legend-of-star-general/' } },
  { title: { connector: 'MangaDex', manga: 'One Piece' }, key: { connector: 'mangadex', manga: 'https://mangadex.org/title/one-piece' } },
  { title: { connector: 'Manga List', manga: 'Solo Leveling' }, key: { connector: 'mangalist', manga: '/manga/solo-leveling' } },
  { title: { connector: 'ManhuaUS', manga: 'Naruto' }, key: { connector: 'manhuaus', manga: '/manga/naruto' } },
  { title: { connector: 'MangaDex', manga: 'Bleach' }, key: { connector: 'mangadex', manga: '/manga/bleach' } },
];

const CHAPTERMARKS = [
  { mangaID: '/manga/legend-of-star-general/', connectorID: 'manhuaus', chapterID: '/manga/legend-of-star-general/Chapter 372/', chapterTitle: 'Chapter 372' },
  { mangaID: 'https://mangadex.org/title/one-piece', connectorID: 'mangadex', chapterID: 'https://mangadex.org/title/one-piece/Chapter 1100/', chapterTitle: 'Chapter 1100' },
];

const LEGEND = map.encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
const ONE_PIECE = map.encodeEntryId('mangadex', 'https://mangadex.org/title/one-piece');
const SOLO = map.encodeEntryId('mangalist', '/manga/solo-leveling');

/**
 * Fixture files in a temp folder and an instance; `ctx()` is a call carrying their grant.
 * @param {{ bookmarks?: object[], chaptermarks?: object[] }} [opts]
 */
async function setup(opts = {}) {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hakuneko-test-'));
  const grant = {
    downloadBaseDir: baseDir,
    bookmarksPath: path.join(baseDir, 'hakuneko.bookmarks'),
    chaptermarksPath: path.join(baseDir, 'hakuneko.chaptermarks'),
  };
  await fs.writeFile(grant.bookmarksPath, JSON.stringify(opts.bookmarks || BOOKMARKS, null, 2), 'utf8');
  await fs.writeFile(grant.chaptermarksPath, JSON.stringify(opts.chaptermarks || CHAPTERMARKS, null, 2), 'utf8');
  const instance = await descriptor.WrapperClass.init({ context: createStubContext(), serviceSettings: { bookmarksPath: '/never/read/from/settings' } });
  const ctx = (/** @type {Record<string, any>} */ overrides = {}) => callContext({ credential: grant, identity: 'user-slot', scope: 'user-label', ...overrides });
  return { baseDir, grant, instance, ctx, cleanup: () => fs.rm(baseDir, { recursive: true, force: true }) };
}

test('the contract suite, the adapter cases among them, passes with 0 failures', async () => {
  const env = await setup();
  try {
    const report = await runConformance({
      WrapperClass: descriptor.WrapperClass,
      descriptor,
      manifest,
      credentials: [env.grant, env.grant],
      inputs: {
        enrich: [[LEGEND, 'manhuaus::%2Fno-such']],
        pullProgress: [ONE_PIECE],
        pushProgress: [[{ pluginEntryId: LEGEND, chapter: 373 }]],
        subscribe: [[{ pluginEntryId: ONE_PIECE, status: 'bookmarks' }]],
        summarizeEntries: [[LEGEND, ONE_PIECE]],
        getEntry: [ONE_PIECE],
      },
    });
    assert.deepEqual(report.failed, []);
    for (const id of [
      'A19.search-refuses-a-call-without-its-path-grant',
      'A25.getReadingList-never-answers-an-unreadable-source-empty',
      'A25.pullProgress-never-answers-an-unreadable-source-empty',
      'A25.listEntries-never-answers-an-unreadable-source-empty',
      'A4.summarizeEntries-unknown-entry-is-not_found',
      'own.getEntry-unknown-id-is-null',
      'status.subscribe-refuses-a-host-status',
      'IV.no-public-method-outside-the-contract',
    ]) {
      assert.ok(report.passed.includes(id), `ran and passed ${id}`);
    }
  } finally {
    await env.cleanup();
  }
});

test('the descriptor and manifest: contract 4.1.0, file-path declared by its three path settings', () => {
  assert.equal(descriptor.pluginName, 'hakuneko');
  assert.equal(descriptor.displayName, 'HakuNeko');
  assert.equal(manifest.pluginContractVersion, '4.1.0');
  assert.deepEqual(manifest.filePathOptions.fields.map((/** @type {any} */ f) => f.key), ['downloadBaseDir', 'bookmarksPath', 'chaptermarksPath']);
  assert.equal(typeof descriptor.WrapperClass.prototype.pullProgressBatch, 'function', 'the transitional read (A23) is kept');
});

test('the paths come from the grant, never settings: a call without it is refused', async () => {
  const env = await setup();
  try {
    await assert.rejects(env.instance.getReadingList(env.ctx({ credential: null })), (e) => isPluginError(e) && e.code === 'host_contract_violation');
    assert.equal((await env.instance.getReadingList(env.ctx())).length, 5);
  } finally {
    await env.cleanup();
  }
});

test('pluginEntryId - encode/decode round-trip, a full-URL key, connectors that do not collide', () => {
  const id = map.encodeEntryId('mangadex', 'https://mangadex.org/title/one-piece');
  assert.deepEqual(map.decodeEntryId(id), { connector: 'mangadex', mangaKey: 'https://mangadex.org/title/one-piece' });
  assert.notEqual(map.encodeEntryId('a', '/x'), map.encodeEntryId('b', '/x'));
  assert.equal(map.decodeEntryId('no-separator'), null);
});

test('search - candidates best first: an exact title 1.0, containment and fuzzy below, canonicalUrl for a URL key', async () => {
  const env = await setup();
  try {
    const exact = await env.instance.search('One Piece', undefined, env.ctx());
    assert.deepEqual(exact[0], { pluginEntryId: ONE_PIECE, title: 'One Piece', confidence: 1.0, canonicalUrl: 'https://mangadex.org/title/one-piece' });
    const partial = await env.instance.search('Legend of Star', undefined, env.ctx());
    assert.equal(partial[0].pluginEntryId, LEGEND);
    assert.ok(partial[0].confidence > 0.7 && partial[0].confidence < 1);
    assert.equal(partial[0].canonicalUrl, null);
    assert.deepEqual(await env.instance.search('', undefined, env.ctx()), []);
    assert.equal((await env.instance.search(['One Piece', 'Naruto'], { limit: 1 }, env.ctx())).length, 1);
  } finally {
    await env.cleanup();
  }
});

test('enrich - the contribution with the derived folder; a missing id fails alone with not_found', async () => {
  const env = await setup();
  try {
    const [found, missing] = await env.instance.enrich([ONE_PIECE, 'manhuaus::%2Fno-such'], env.ctx());
    assert.equal(found.success, true);
    assert.equal(found.contribution.displayTitle, 'One Piece');
    assert.equal(found.contribution.connectorLabel, 'MangaDex');
    assert.equal(found.contribution.folderPath, `${env.baseDir}/One Piece/`);
    assert.equal(found.contribution.currentChapter, 'Chapter 1100');
    assert.equal(missing.success, false);
    assert.equal(missing.error.code, 'not_found');
  } finally {
    await env.cleanup();
  }
});

test('F13-HakuNeko - pullProgress answers a PluginPullResult: the list token and the chaptermark\'s chapter as a number', async () => {
  const env = await setup();
  try {
    const out = await env.instance.pullProgress(ONE_PIECE, env.ctx());
    assert.deepEqual(out, { pluginEntryId: ONE_PIECE, status: 'bookmarks', chapter: 1100, rating: null, lastUpdated: null });
    assert.deepEqual(validateResult('pullProgress', out, { manifest }), []);
  } finally {
    await env.cleanup();
  }
});

test('F13-HakuNeko - the call context arriving after the id is never read as a current value (the 2026-11-08 Check defect)', async () => {
  const env = await setup();
  try {
    const out = await env.instance.pullProgress(LEGEND, env.ctx());
    assert.equal(out.chapter, 372);
  } finally {
    await env.cleanup();
  }
});

test('F13-HakuNeko - an entry not on the list answers every field null; a bookmark with no chaptermark a null chapter', async () => {
  const env = await setup();
  try {
    assert.deepEqual(await env.instance.pullProgress('manhuaus::%2Fno-such', env.ctx()), { pluginEntryId: 'manhuaus::%2Fno-such', status: null, chapter: null, rating: null, lastUpdated: null });
    assert.equal((await env.instance.pullProgress(SOLO, env.ctx())).chapter, null);
    assert.equal((await env.instance.pullProgress(SOLO, env.ctx())).status, 'bookmarks');
  } finally {
    await env.cleanup();
  }
});

test('getReadingList - every bookmark, status "bookmarks", the chapter parsed here, canonicalUrl only for a URL key, no comparison', async () => {
  const env = await setup();
  try {
    const list = await env.instance.getReadingList(env.ctx());
    assert.equal(list.length, 5);
    const byId = new Map(list.map((/** @type {any} */ e) => [e.pluginEntryId, e]));
    assert.equal(byId.get(LEGEND).chapter, 372);
    assert.equal(byId.get(SOLO).chapter, null);
    assert.equal(byId.get(ONE_PIECE).canonicalUrl, 'https://mangadex.org/title/one-piece');
    assert.equal(byId.get(LEGEND).canonicalUrl, null);
    assert.ok(list.every((/** @type {any} */ e) => e.status === 'bookmarks' && !('comparison' in e)));
  } finally {
    await env.cleanup();
  }
});

test('an unreadable source is source_error, never an empty answer (A25): missing, a folder, not JSON', async () => {
  const env = await setup();
  try {
    const missing = env.ctx({ credential: { ...env.grant, bookmarksPath: path.join(env.baseDir, 'no-such.bookmarks') } });
    await assert.rejects(env.instance.getReadingList(missing), (e) => isPluginError(e) && e.code === 'source_error');
    const folder = env.ctx({ credential: { ...env.grant, bookmarksPath: env.baseDir } });
    await assert.rejects(env.instance.listEntries({}, {}, folder), (e) => isPluginError(e) && /is a folder, not a file/.test(e.message));
    await fs.writeFile(env.grant.bookmarksPath, '{ not valid json', 'utf8');
    await assert.rejects(env.instance.pullProgressBatch(undefined, env.ctx()), (e) => isPluginError(e) && e.code === 'source_error');
    const summary = await env.instance.summarizeEntries([LEGEND], env.ctx());
    assert.equal(summary[0].error.code, 'source_error');
  } finally {
    await env.cleanup();
  }
});

test('summarizeEntries - a bookmark\'s label, in request order; a missing one not_found with its reason; no link state', async () => {
  const env = await setup();
  try {
    const out = await env.instance.summarizeEntries([ONE_PIECE, 'manhuaus::%2Fgone'], env.ctx());
    assert.deepEqual(out[0], { pluginEntryId: ONE_PIECE, success: true, summary: { label: 'MangaDex: One Piece', status: null, latestChapter: null, lastUpdated: null } });
    assert.deepEqual(out[1], { pluginEntryId: 'manhuaus::%2Fgone', success: false, error: { code: 'not_found', message: 'Missing from Hakuneko bookmarks' } });
    assert.deepEqual(await env.instance.summarizeEntries([], env.ctx()), []);
  } finally {
    await env.cleanup();
  }
});

test('listEntries - every bookmark with its chapter title; pagination, sort, search, include/exclude ids before pagination', async () => {
  const env = await setup();
  try {
    const all = await env.instance.listEntries({}, { page: 1, pageSize: 50 }, env.ctx());
    assert.equal(all.totalCount, 5);
    const byTitle = new Map(all.entries.map((/** @type {any} */ e) => [e.title, e]));
    assert.equal(byTitle.get('Legend of Star General').fields.chapterTitle.value, 'Chapter 372');
    assert.equal(byTitle.get('Naruto').fields.chapterTitle.value, null);
    assert.ok(all.entries.every((/** @type {any} */ e) => e.fields.folderPath === undefined), 'list rows carry no folder stat');
    const page1 = await env.instance.listEntries({}, { page: 1, pageSize: 2, sort: 'mangaTitle' }, env.ctx());
    assert.deepEqual(page1.entries.map((/** @type {any} */ e) => e.title), ['Bleach', 'Legend of Star General']);
    assert.equal((await env.instance.listEntries({ search: 'solo' }, {}, env.ctx())).totalCount, 1);
    assert.equal((await env.instance.listEntries({ includeIds: [LEGEND] }, {}, env.ctx())).totalCount, 1);
    assert.equal((await env.instance.listEntries({ excludeIds: [LEGEND] }, {}, env.ctx())).totalCount, 4);
  } finally {
    await env.cleanup();
  }
});

test('getEntry - the detail row with the derived folder and whether it exists; unknown is null', async () => {
  const env = await setup();
  try {
    const entry = await env.instance.getEntry(ONE_PIECE, env.ctx());
    assert.equal(entry.title, 'One Piece');
    assert.equal(entry.fields.folderPath.value, `${env.baseDir}/One Piece/`);
    assert.equal(entry.fields.folderMatch.value, 'missing');
    await fs.mkdir(path.join(env.baseDir, 'One Piece'));
    assert.equal((await env.instance.getEntry(ONE_PIECE, env.ctx())).fields.folderMatch.value, 'present');
    assert.equal(await env.instance.getEntry('manhuaus::%2Fno-such', env.ctx()), null);
  } finally {
    await env.cleanup();
  }
});

test('pullProgressBatch (the transitional read, A23) - unchanged: full discovery, narrowed with inList:false', async () => {
  const env = await setup();
  try {
    const all = await env.instance.pullProgressBatch(undefined, env.ctx());
    assert.equal(all.length, 5);
    assert.deepEqual(all.find((/** @type {any} */ r) => r.pluginEntryId === LEGEND), { pluginEntryId: LEGEND, chapterTitle: 'Chapter 372', inList: true, title: 'Legend of Star General', connectorLabel: 'ManhuaUS' });
    const narrowed = await env.instance.pullProgressBatch([ONE_PIECE, 'manhuaus::%2Fgone'], env.ctx());
    assert.deepEqual(narrowed.map((/** @type {any} */ r) => [r.pluginEntryId, r.inList]), [[ONE_PIECE, true], ['manhuaus::%2Fgone', false]]);
  } finally {
    await env.cleanup();
  }
});

test('pushProgress - applied is the chapter written; a bad entry fails alone; the good ones are written once', async () => {
  const env = await setup();
  try {
    const out = await env.instance.pushProgress([
      { pluginEntryId: LEGEND, chapter: 12 },
      { pluginEntryId: map.encodeEntryId('manhuaus', '/manga/another/') },
      { pluginEntryId: 'not-a-valid-id', chapter: 3 },
    ], env.ctx());
    assert.deepEqual(out[0], { pluginEntryId: LEGEND, success: true, applied: { chapter: 12 } });
    assert.equal(out[1].success, false);
    assert.match(out[1].error.message, /only supports chapter progress/);
    assert.equal(out[2].error.code, 'not_found');
    const raw = JSON.parse(await fs.readFile(env.grant.chaptermarksPath, 'utf8'));
    assert.equal(raw.filter((/** @type {any} */ cm) => cm.mangaID === '/manga/legend-of-star-general/').length, 1);
    assert.equal(raw.find((/** @type {any} */ cm) => cm.mangaID === '/manga/legend-of-star-general/').chapterTitle, 'Chapter 12');
    assert.equal(fsSync.existsSync(`${env.grant.chaptermarksPath}.tmp`), false, 'the write is atomic');
  } finally {
    await env.cleanup();
  }
});

test('pushProgress - never appends a bookmark (no-append mode, V3); an empty batch is a no-op', async () => {
  const env = await setup();
  try {
    assert.deepEqual(await env.instance.pushProgress([], env.ctx()), []);
    await env.instance.pushProgress([{ pluginEntryId: map.encodeEntryId('mangalist', '/manga/new-series'), chapter: 5 }], env.ctx());
    const raw = JSON.parse(await fs.readFile(env.grant.bookmarksPath, 'utf8'));
    assert.equal(raw.filter((/** @type {any} */ b) => b.key.manga === '/manga/new-series').length, 0);
  } finally {
    await env.cleanup();
  }
});

test('subscribe - PluginSubscribeResult: a present bookmark confirmed, a missing one created, idempotent', async () => {
  const env = await setup();
  try {
    const NEW = map.encodeEntryId('mangalist', '/manga/new-series');
    const out = await env.instance.subscribe([{ pluginEntryId: ONE_PIECE, status: 'bookmarks' }, { pluginEntryId: NEW, status: 'bookmarks' }], env.ctx());
    assert.deepEqual(out, [
      { pluginEntryId: ONE_PIECE, success: true, listId: null, status: 'bookmarks' },
      { pluginEntryId: NEW, success: true, listId: null, status: 'bookmarks' },
    ]);
    const before = await fs.readFile(env.grant.bookmarksPath, 'utf8');
    await env.instance.subscribe([{ pluginEntryId: NEW, status: 'bookmarks' }], env.ctx());
    assert.equal(await fs.readFile(env.grant.bookmarksPath, 'utf8'), before, 'confirming writes nothing');
  } finally {
    await env.cleanup();
  }
});

test('byte-identity - a push and a Join List write exactly what the adapter-4.0-final adapter wrote for the same input', async () => {
  const env = await setup({ bookmarks: golden.BOOKMARKS, chaptermarks: golden.CHAPTERMARKS });
  try {
    await env.instance.pushProgress(golden.PUSH, env.ctx());
    await env.instance.subscribe(golden.SUBSCRIBE, env.ctx());
    const fixtures = path.join(__dirname, '..', 'fixtures');
    assert.ok((await fs.readFile(env.grant.chaptermarksPath)).equals(await fs.readFile(path.join(fixtures, 'golden-4.0.chaptermarks'))), 'chaptermarks');
    assert.ok((await fs.readFile(env.grant.bookmarksPath)).equals(await fs.readFile(path.join(fixtures, 'golden-4.0.bookmarks'))), 'bookmarks');
  } finally {
    await env.cleanup();
  }
});

test('the mapping\'s chapter parse mirrors the host\'s: "Chapter N", "Ch.N", none', () => {
  assert.equal(map.parseChapterTitle('Chapter 1100'), 1100);
  assert.equal(map.parseChapterTitle('Ch.15.5'), 15.5);
  assert.equal(map.parseChapterTitle('Prologue'), null);
  assert.equal(map.parseChapterTitle(null), null);
});
