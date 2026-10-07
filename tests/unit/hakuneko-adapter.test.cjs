'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const HakunekoAdapter = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-hakuneko', 'hakuneko-adapter.cjs',
));
const manifest = require(path.join(__dirname, '..', '..', 'plugin-package.json'));

/** Minimal host context mirroring PluginContextLike. */
const context = {
  utils: {
    sanitizeForSearch(text) {
      if (typeof text !== 'string') return '';
      return text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
    },
  },
  cache: null,
};

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

/**
 * Create a temp environment and an initialized adapter.
 * @param {object} [opts]
 * @param {object[]} [opts.bookmarks]
 * @param {object[]} [opts.chaptermarks]
 * @param {boolean} [opts.writeFiles]
 * @returns {Promise<{ adapter: HakunekoAdapter, baseDir: string, bookmarksPath: string, chaptermarksPath: string, cleanup: () => Promise<void> }>}
 */
async function setupAdapter(opts = {}) {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hakuneko-test-'));
  const bookmarksPath = path.join(baseDir, 'hakuneko.bookmarks');
  const chaptermarksPath = path.join(baseDir, 'hakuneko.chaptermarks');

  if (opts.writeFiles !== false) {
    await fs.writeFile(bookmarksPath, JSON.stringify(opts.bookmarks || BOOKMARKS, null, 2), 'utf8');
    await fs.writeFile(chaptermarksPath, JSON.stringify(opts.chaptermarks || CHAPTERMARKS, null, 2), 'utf8');
  }

  const adapter = await HakunekoAdapter.init({
    context,
    serviceSettings: { downloadBaseDir: baseDir, bookmarksPath, chaptermarksPath },
  });

  return {
    adapter,
    baseDir,
    bookmarksPath,
    chaptermarksPath,
    cleanup: () => fs.rm(baseDir, { recursive: true, force: true }),
  };
}

test('identity - static + instance pluginName, type', async () => {
  assert.equal(HakunekoAdapter.pluginName, 'hakuneko');
  const env = await setupAdapter();
  try {
    assert.equal(env.adapter.pluginName, 'hakuneko');
    assert.deepEqual([...env.adapter.pluginType], ['adapter']);
    assert.ok(Array.isArray(env.adapter.capabilities) && env.adapter.capabilities.length > 0);
  } finally {
    await env.cleanup();
  }
});

// The wrapper's own get capabilities() getter and plugin-package.json's capabilities[] must not
// drift apart (MangaDex shipped exactly that bug). Guards Phase 9's manifest flip.
test('capabilities getter matches plugin-package.json capabilities[]', async () => {
  const env = await setupAdapter();
  try {
    assert.deepEqual([...env.adapter.capabilities].sort(), [...manifest.capabilities].sort());
  } finally {
    await env.cleanup();
  }
});

test('initialize - unconfigured when paths missing, does not throw', async () => {
  const adapter = await HakunekoAdapter.init({
    context,
    serviceSettings: { downloadBaseDir: '', bookmarksPath: '', chaptermarksPath: '' },
  });
  const result = await adapter.initialize();
  assert.deepEqual(result, { status: 'unconfigured' });
});

test('initialize - error when paths set but unreadable', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hakuneko-test-'));
  try {
    const adapter = await HakunekoAdapter.init({
      context,
      serviceSettings: {
        downloadBaseDir: baseDir,
        bookmarksPath: path.join(baseDir, 'nope.bookmarks'),
        chaptermarksPath: path.join(baseDir, 'nope.chaptermarks'),
      },
    });
    const result = await adapter.initialize();
    assert.equal(result.status, 'error');
    assert.equal(typeof result.message, 'string');
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
});

test('initialize - ok when all paths readable', async () => {
  const env = await setupAdapter();
  try {
    const result = await env.adapter.initialize();
    assert.deepEqual(result, { status: 'ok' });
  } finally {
    await env.cleanup();
  }
});

test('getStatus - reports bookmark count', async () => {
  const env = await setupAdapter();
  try {
    const status = await env.adapter.getStatus();
    assert.equal(status.status, 'ok');
    assert.equal(status.entryCount, 5);
  } finally {
    await env.cleanup();
  }
});

test('pluginEntryId - encode/decode round-trip stable, including full-URL key', async () => {
  const env = await setupAdapter();
  try {
    const a = env.adapter;
    const cases = [
      { connector: 'manhuaus', mangaKey: '/manga/legend-of-star-general/' },
      { connector: 'mangadex', mangaKey: 'https://mangadex.org/title/one-piece' },
      { connector: 'mangalist', mangaKey: '/manga/solo-leveling' },
    ];
    for (const c of cases) {
      const id = a._encodeEntryId(c.connector, c.mangaKey);
      const decoded = a._decodeEntryId(id);
      assert.deepEqual(decoded, c);
    }
  } finally {
    await env.cleanup();
  }
});

test('pluginEntryId - same key.manga on different connectors does not collide', async () => {
  const env = await setupAdapter();
  try {
    const a = env.adapter;
    const idA = a._encodeEntryId('connA', '/manga/x');
    const idB = a._encodeEntryId('connB', '/manga/x');
    assert.notEqual(idA, idB);
  } finally {
    await env.cleanup();
  }
});

test('findMatches - matching folder returns single candidate at confidence 1.0', async () => {
  const env = await setupAdapter();
  try {
    // Backslash + no trailing slash exercises path normalisation.
    const folderPath = `${env.baseDir}\\Legend of Star General`;
    const result = await env.adapter.findMatches(folderPath);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.equal(result[0].confidence, 1.0);
    assert.equal(result[0].title, 'Legend of Star General');
    assert.equal(result[0].pluginEntryId, env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/'));
  } finally {
    await env.cleanup();
  }
});

test('findMatches - no matching folder returns empty array', async () => {
  const env = await setupAdapter();
  try {
    const result = await env.adapter.findMatches(`${env.baseDir}/Nonexistent Title`);
    assert.deepEqual(result, []);
  } finally {
    await env.cleanup();
  }
});

test('findMatches - duplicate folder returns error with candidates', async () => {
  const dup = [
    { title: { connector: 'ManhuaUS', manga: 'Dup Title' }, key: { connector: 'manhuaus', manga: '/manga/dup-a' } },
    { title: { connector: 'MangaDex', manga: 'Dup Title' }, key: { connector: 'mangadex', manga: '/manga/dup-b' } },
  ];
  const env = await setupAdapter({ bookmarks: dup, chaptermarks: [] });
  try {
    const result = await env.adapter.findMatches(`${env.baseDir}/Dup Title/`);
    assert.equal(result.error, 'duplicate_folder');
    assert.equal(result.candidates.length, 2);
    assert.ok(result.candidates.every((c) => c.confidence === 1.0));
  } finally {
    await env.cleanup();
  }
});

test('buildLinkContribution - correct shape and derived folderPath', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const contribution = await env.adapter.buildLinkContribution(id);
    assert.equal(contribution.pluginEntryId, id);
    assert.equal(contribution.displayTitle, 'Legend of Star General');
    assert.equal(contribution.connectorLabel, 'ManhuaUS');
    assert.equal(contribution.folderPath, `${env.baseDir}/Legend of Star General/`);
    assert.equal(contribution.currentChapter, 'Chapter 372');
    assert.equal(typeof contribution.syncedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(contribution.syncedAt)));
  } finally {
    await env.cleanup();
  }
});

test('buildLinkContribution - null currentChapter when no chaptermark', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('mangalist', '/manga/solo-leveling');
    const contribution = await env.adapter.buildLinkContribution(id);
    assert.equal(contribution.currentChapter, null);
  } finally {
    await env.cleanup();
  }
});

// watch.summary (Plan-2026Q4-watch-summary-register-offer, Phase 6) — the former
// `queryBatch`/map-out coverage, moved to the register name and the array shape.
test('summarizeEntries - returns an active summary for a bookmarked entry', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const results = await env.adapter.summarizeEntries([id]);

    assert.ok(Array.isArray(results), 'array out, not a map (host-capability-contract.md §2.1)');
    assert.deepEqual(results, [{
      pluginEntryId: id,
      success: true,
      summary: {
        linkState: 'active',
        label: 'ManhuaUS: Legend of Star General',
      },
    }]);
  } finally {
    await env.cleanup();
  }
});

// Membership in the bookmarks file IS the badge state, so "not in the file" is an answer, not a
// failure: success stays TRUE. Reporting it as success:false would make the host skip the entry
// and keep showing stale stored state.
test('summarizeEntries - an entry missing from bookmarks is an explicit answer (success:true, linkState error)', async () => {
  const env = await setupAdapter();
  try {
    const missingId = env.adapter._encodeEntryId('mangalist', '/manga/not-in-hakuneko');
    const results = await env.adapter.summarizeEntries([missingId]);

    assert.deepEqual(results, [{
      pluginEntryId: missingId,
      success: true,
      summary: {
        linkState: 'error',
        label: 'Missing from Hakuneko bookmarks',
      },
    }]);
  } finally {
    await env.cleanup();
  }
});

test('summarizeEntries - returns an empty array for empty or absent input, never a throw', async () => {
  const env = await setupAdapter();
  try {
    assert.deepEqual(await env.adapter.summarizeEntries([]), []);
    assert.deepEqual(await env.adapter.summarizeEntries(), []);
  } finally {
    await env.cleanup();
  }
});

// The other half of the per-entry channel: an unparseable bookmarks file means membership is
// unknown for every id. Previously this returned {} -- indistinguishable from "all ids fine".
test('summarizeEntries - a bookmark parse failure is per-entry success:false, not silence', async () => {
  const env = await setupAdapter();
  try {
    await fs.writeFile(env.bookmarksPath, '{not json', 'utf8');
    const id = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const results = await env.adapter.summarizeEntries([id]);

    assert.equal(results.length, 1);
    assert.equal(results[0].pluginEntryId, id);
    assert.equal(results[0].success, false);
    assert.equal(results[0].summary, undefined);
    assert.equal(typeof results[0].error, 'string');
  } finally {
    await env.cleanup();
  }
});

test('queryBatch - the legacy map-out method is gone; watch.summary replaced it', async () => {
  const env = await setupAdapter();
  try {
    assert.equal(typeof env.adapter.queryBatch, 'undefined');
    assert.equal(typeof env.adapter.summarizeEntries, 'function');
  } finally {
    await env.cleanup();
  }
});

test('listEntries - 5 bookmarks, chapterTitle correct for matched, null otherwise', async () => {
  const env = await setupAdapter();
  try {
    const page = await env.adapter.listEntries({}, { page: 1, pageSize: 50 });
    assert.equal(page.totalCount, 5);
    assert.equal(page.entries.length, 5);

    const byTitle = new Map(page.entries.map((e) => [e.fields.mangaTitle.value, e]));
    assert.equal(byTitle.get('Legend of Star General').fields.chapterTitle.value, 'Chapter 372');
    assert.equal(byTitle.get('One Piece').fields.chapterTitle.value, 'Chapter 1100');
    assert.equal(byTitle.get('Solo Leveling').fields.chapterTitle.value, null);
    assert.equal(byTitle.get('Naruto').fields.chapterTitle.value, null);
    assert.equal(byTitle.get('Bleach').fields.chapterTitle.value, null);
  } finally {
    await env.cleanup();
  }
});

test('listEntries - pagination and sort by mangaTitle', async () => {
  const env = await setupAdapter();
  try {
    const page1 = await env.adapter.listEntries({}, { page: 1, pageSize: 2, sort: 'mangaTitle' });
    assert.equal(page1.entries.length, 2);
    assert.equal(page1.totalCount, 5);
    assert.equal(page1.entries[0].fields.mangaTitle.value, 'Bleach');
    assert.equal(page1.entries[1].fields.mangaTitle.value, 'Legend of Star General');
  } finally {
    await env.cleanup();
  }
});

test('getEntry - resolves by pluginEntryId; detail rows carry folderPath + folderMatch', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('mangadex', 'https://mangadex.org/title/one-piece');
    const entry = await env.adapter.getEntry(id);
    assert.equal(entry.pluginEntryId, id);
    assert.equal(entry.fields.mangaTitle.value, 'One Piece');
    assert.equal(entry.fields.chapterTitle.value, 'Chapter 1100');

    // folder detail — the derived folder does not exist under the temp baseDir here.
    assert.equal(entry.fields.folderPath.value, `${env.baseDir}/One Piece/`);
    assert.equal(entry.fields.folderMatch.value, 'missing');

    // create the folder → getEntry now reports it present.
    await fs.mkdir(`${env.baseDir}/One Piece`);
    const entry2 = await env.adapter.getEntry(id);
    assert.equal(entry2.fields.folderMatch.value, 'present');
  } finally {
    await env.cleanup();
  }
});

test('listEntries - list rows do NOT carry the per-row folder stat (kept cheap for the full-list map)', async () => {
  const env = await setupAdapter();
  try {
    const page = await env.adapter.listEntries({}, { page: 1, pageSize: 50 });
    assert.ok(page.entries.length > 0);
    for (const row of page.entries) {
      assert.equal(row.fields.folderPath, undefined);
      assert.equal(row.fields.folderMatch, undefined);
    }
  } finally {
    await env.cleanup();
  }
});

test('getEntry - returns null for unknown id', async () => {
  const env = await setupAdapter();
  try {
    const entry = await env.adapter.getEntry(env.adapter._encodeEntryId('nope', '/manga/none'));
    assert.equal(entry, null);
  } finally {
    await env.cleanup();
  }
});

test('pullProgress - current_chapter null updates chapter', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const result = await env.adapter.pullProgress(id, { hasBookmark: true, currentChapter: null });
    assert.equal(result.updated.length, 1);
    assert.equal(result.updated[0].chapter_set, 'Chapter 372');
    assert.equal(result.skipped_chapter_exists.length, 0);
    assert.equal(result.skipped_no_bookmark.length, 0);
  } finally {
    await env.cleanup();
  }
});

test('pullProgress - current_chapter already set is skipped', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const result = await env.adapter.pullProgress(id, { hasBookmark: true, currentChapter: 'Chapter 5' });
    assert.equal(result.skipped_chapter_exists.length, 1);
    assert.equal(result.skipped_chapter_exists[0].reason, 'chapter_exists');
    assert.equal(result.updated.length, 0);
  } finally {
    await env.cleanup();
  }
});

test('pullProgress - no bookmark row is skipped', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const result = await env.adapter.pullProgress(id, { hasBookmark: false, currentChapter: null });
    assert.equal(result.skipped_no_bookmark.length, 1);
    assert.equal(result.skipped_no_bookmark[0].reason, 'no_bookmark');
    assert.equal(result.updated.length, 0);
  } finally {
    await env.cleanup();
  }
});

// Plan-2026Q3-hakuneko-progress-sync, Phase A / Q6 ("batch read performance"): one
// read of bookmarks + chaptermarks, one pass, raw per-entry results — no parsing,
// no bucket classification (the host owns that).

test('pullProgressBatch - omitted entries returns every valid bookmark (full discovery for the "new" bucket)', async () => {
  const env = await setupAdapter();
  try {
    const results = await env.adapter.pullProgressBatch();
    assert.equal(results.length, BOOKMARKS.length);
    assert.ok(results.every((r) => r.inList === true));

    const byId = new Map(results.map((r) => [r.pluginEntryId, r]));
    const starGeneralId = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const onePieceId = env.adapter._encodeEntryId('mangadex', 'https://mangadex.org/title/one-piece');
    const soloLevelingId = env.adapter._encodeEntryId('mangalist', '/manga/solo-leveling');

    assert.equal(byId.get(starGeneralId).chapterTitle, 'Chapter 372');
    assert.equal(byId.get(onePieceId).chapterTitle, 'Chapter 1100');
    // Solo Leveling has a bookmark but no chaptermark fixture — raw null, not
    // defaulted (Q2: "no default" is the wrapper's job to not pre-empt either).
    assert.equal(byId.get(soloLevelingId).chapterTitle, null);

    // title/connectorLabel (owner scenario extension, 2026-07-19): free to
    // attach in full-discovery mode since the bookmark is already in memory —
    // the host's "new" bucket needs a real title to be reviewable at all.
    assert.equal(byId.get(starGeneralId).title, 'Legend of Star General');
    assert.equal(byId.get(starGeneralId).connectorLabel, 'ManhuaUS');
  } finally {
    await env.cleanup();
  }
});

test('pullProgressBatch - empty array behaves the same as omitted (full discovery)', async () => {
  const env = await setupAdapter();
  try {
    const results = await env.adapter.pullProgressBatch([]);
    assert.equal(results.length, BOOKMARKS.length);
  } finally {
    await env.cleanup();
  }
});

test('pullProgressBatch - narrowed to specific entries returns exactly those, in the requested order', async () => {
  const env = await setupAdapter();
  try {
    const onePieceId = env.adapter._encodeEntryId('mangadex', 'https://mangadex.org/title/one-piece');
    const starGeneralId = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const results = await env.adapter.pullProgressBatch([onePieceId, starGeneralId]);

    assert.equal(results.length, 2);
    assert.equal(results[0].pluginEntryId, onePieceId);
    assert.equal(results[0].chapterTitle, 'Chapter 1100');
    assert.equal(results[0].inList, true);
    assert.equal(results[1].pluginEntryId, starGeneralId);
    assert.equal(results[1].chapterTitle, 'Chapter 372');
  } finally {
    await env.cleanup();
  }
});

test('pullProgressBatch - a requested entry no longer in Hakuneko\'s file reports inList:false, not omitted', async () => {
  const env = await setupAdapter();
  try {
    const removedId = env.adapter._encodeEntryId('nonexistent-connector', '/manga/removed-from-hakuneko/');
    const starGeneralId = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const results = await env.adapter.pullProgressBatch([removedId, starGeneralId]);

    assert.equal(results.length, 2, 'the vanished entry must still appear in the results, not be silently dropped');
    assert.deepEqual(results[0], { pluginEntryId: removedId, chapterTitle: null, inList: false, title: null, connectorLabel: null });
    assert.equal(results[1].inList, true);
  } finally {
    await env.cleanup();
  }
});

test('pullProgressBatch - skips malformed bookmark rows the same way listEntries does', async () => {
  const env = await setupAdapter({
    bookmarks: [
      ...BOOKMARKS,
      { title: { connector: 'Broken' } }, // missing key entirely
      null,
    ],
  });
  try {
    const results = await env.adapter.pullProgressBatch();
    assert.equal(results.length, BOOKMARKS.length);
  } finally {
    await env.cleanup();
  }
});

test('pullProgressBatch - surfaces a read error the same way listEntries does, not empty results', async () => {
  const env = await setupAdapter();
  try {
    await fs.writeFile(env.bookmarksPath, '{ not valid json', 'utf8');
    const result = await env.adapter.pullProgressBatch();
    assert.equal(result.status, 'error');
    assert.equal(result.retryable, false);
  } finally {
    await env.cleanup();
  }
});

test('pullProgressBatch - functions correctly at ~2000 entries in one pass (checklist: verified at scale)', async () => {
  const bigBookmarks = Array.from({ length: 2000 }, (_, i) => ({
    title: { connector: 'bulk', manga: `Series ${i}` },
    key: { connector: 'bulk', manga: `/manga/series-${i}/` },
  }));
  const bigChaptermarks = bigBookmarks
    .filter((_, i) => i % 3 !== 0) // leave a third with no chaptermark (raw null cases)
    .map((b) => ({ mangaID: b.key.manga, connectorID: b.key.connector, chapterID: `${b.key.manga}Chapter ${b.title.manga}/`, chapterTitle: `Chapter ${b.title.manga.split(' ')[1]}` }));

  const env = await setupAdapter({ bookmarks: bigBookmarks, chaptermarks: bigChaptermarks });
  try {
    const results = await env.adapter.pullProgressBatch();
    assert.equal(results.length, 2000);
    const withChapter = results.filter((r) => r.chapterTitle !== null);
    assert.equal(withChapter.length, bigChaptermarks.length);
  } finally {
    await env.cleanup();
  }
});

test('pushProgress - array in, array out; chapter change updates chaptermark, replaces not duplicates', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const results = await env.adapter.pushProgress([{ pluginEntryId: id, chapter: 400 }]);
    assert.equal(results.length, 1);
    assert.equal(results[0].pluginEntryId, id);
    assert.equal(results[0].success, true);
    assert.deepEqual(results[0].updatedFields, ['chapter']);

    const raw = JSON.parse(await fs.readFile(env.chaptermarksPath, 'utf8'));
    const matching = raw.filter((cm) => cm.mangaID === '/manga/legend-of-star-general/' && cm.connectorID === 'manhuaus');
    assert.equal(matching.length, 1);
    assert.equal(matching[0].chapterTitle, 'Chapter 400');
    assert.equal(matching[0].chapterID, '/manga/legend-of-star-general/Chapter 400/');
  } finally {
    await env.cleanup();
  }
});

test('pushProgress - per-entry failure: a batch with a bad entry still writes the good ones', async () => {
  const env = await setupAdapter();
  try {
    const good = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const noChapter = env.adapter._encodeEntryId('manhuaus', '/manga/another/');
    const results = await env.adapter.pushProgress([
      { pluginEntryId: good, chapter: 12 },
      { pluginEntryId: noChapter },              // no chapter → per-entry failure
      { pluginEntryId: 'not-a-valid-id', chapter: 3 },
    ]);

    assert.equal(results.length, 3);
    assert.equal(results[0].success, true);
    assert.equal(results[1].success, false);
    assert.match(results[1].error, /only supports chapter progress/);
    assert.equal(results[2].success, false);

    const raw = JSON.parse(await fs.readFile(env.chaptermarksPath, 'utf8'));
    assert.equal(raw.filter((cm) => cm.mangaID === '/manga/legend-of-star-general/' && cm.chapterTitle === 'Chapter 12').length, 1);
  } finally {
    await env.cleanup();
  }
});

test('pushProgress - never appends a bookmark (no-append mode, V3); empty array is a no-op', async () => {
  const env = await setupAdapter();
  try {
    assert.deepEqual(await env.adapter.pushProgress([]), []);
    assert.deepEqual(await env.adapter.pushProgress(undefined), []);

    const id = env.adapter._encodeEntryId('mangalist', '/manga/new-series');
    await env.adapter.pushProgress([{ pluginEntryId: id, chapter: 5 }]);
    const raw = JSON.parse(await fs.readFile(env.bookmarksPath, 'utf8'));
    assert.equal(raw.filter((b) => b.key.connector === 'mangalist' && b.key.manga === '/manga/new-series').length, 0);
  } finally {
    await env.cleanup();
  }
});

test('subscribe - array in, array out; existing bookmark confirms without writing, missing is created', async () => {
  const env = await setupAdapter();
  try {
    const existing = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const missing = env.adapter._encodeEntryId('mangalist', '/manga/new-series');

    const results = await env.adapter.subscribe([
      { pluginEntryId: existing, status: 'READING' },
      { pluginEntryId: missing, status: 'READING' },
      { pluginEntryId: 'not-a-valid-id' },
    ]);

    assert.equal(results.length, 3);
    assert.deepEqual(results[0], { pluginEntryId: existing, success: true, mode: 'confirmed' });
    assert.deepEqual(results[1], { pluginEntryId: missing, success: true, mode: 'created' });
    assert.equal(results[2].success, false);

    const raw = JSON.parse(await fs.readFile(env.bookmarksPath, 'utf8'));
    assert.equal(raw.filter((b) => b.key.connector === 'mangalist' && b.key.manga === '/manga/new-series').length, 1);
  } finally {
    await env.cleanup();
  }
});

test('subscribe - idempotent: a created row confirms on the next call; empty array no-op', async () => {
  const env = await setupAdapter();
  try {
    assert.deepEqual(await env.adapter.subscribe([]), []);
    const id = env.adapter._encodeEntryId('mangalist', '/manga/new-series');
    assert.equal((await env.adapter.subscribe([{ pluginEntryId: id }]))[0].mode, 'created');
    assert.equal((await env.adapter.subscribe([{ pluginEntryId: id }]))[0].mode, 'confirmed');

    const raw = JSON.parse(await fs.readFile(env.bookmarksPath, 'utf8'));
    assert.equal(raw.filter((b) => b.key.connector === 'mangalist' && b.key.manga === '/manga/new-series').length, 1);
  } finally {
    await env.cleanup();
  }
});

test('createEntry - creates mangalist bookmark, idempotent', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('mangalist', '/manga/created');
    const r1 = await env.adapter.createEntry(id, 'Created Title');
    assert.equal(r1.status, 'ok');

    const raw = JSON.parse(await fs.readFile(env.bookmarksPath, 'utf8'));
    const created = raw.find((b) => b.key.manga === '/manga/created');
    assert.equal(created.title.manga, 'Created Title');
    assert.equal(created.title.connector, 'Manga List');

    const r2 = await env.adapter.createEntry(id, 'Created Title');
    assert.equal(r2.status, 'ok');
    const raw2 = JSON.parse(await fs.readFile(env.bookmarksPath, 'utf8'));
    assert.equal(raw2.filter((b) => b.key.manga === '/manga/created').length, 1);
  } finally {
    await env.cleanup();
  }
});

test('deleteEntry - removes bookmark and chaptermark, idempotent', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const r1 = await env.adapter.deleteEntry(id);
    assert.equal(r1.status, 'ok');
    assert.equal(r1.removedBookmark, true);
    assert.equal(r1.removedChaptermark, true);

    const r2 = await env.adapter.deleteEntry(id);
    assert.equal(r2.removedBookmark, false);
    assert.equal(r2.removedChaptermark, false);
  } finally {
    await env.cleanup();
  }
});

test('search - exact match scores 1.0; fuzzy returns ranked results', async () => {
  const env = await setupAdapter();
  try {
    const exact = await env.adapter.search('One Piece');
    assert.equal(exact.length, 1);
    assert.equal(exact[0].title, 'One Piece');
    assert.equal(exact[0].score, 1.0);

    const all = await env.adapter.search('one piece', { returnAll: true, limit: 10 });
    assert.ok(all.length >= 1);
    assert.equal(all[0].title, 'One Piece');
  } finally {
    await env.cleanup();
  }
});

test('read - JSON parse failure surfaces an error, not empty results', async () => {
  const env = await setupAdapter();
  try {
    await fs.writeFile(env.bookmarksPath, '{ not valid json', 'utf8');
    const page = await env.adapter.listEntries();
    assert.equal(page.status, 'error');
    assert.equal(page.retryable, false);
  } finally {
    await env.cleanup();
  }
});

test('read - bookmarksPath pointing at a folder surfaces a clear error, not empty results', async () => {
  const env = await setupAdapter({ writeFiles: false });
  try {
    const adapter = await HakunekoAdapter.init({
      context,
      serviceSettings: {
        downloadBaseDir: env.baseDir,
        bookmarksPath: env.baseDir, // a directory, not a file
        chaptermarksPath: env.chaptermarksPath
      }
    });
    const page = await adapter.listEntries();
    assert.equal(page.status, 'error');
    assert.equal(page.retryable, false);
    assert.match(page.message, /is a folder, not a file/);
  } finally {
    await env.cleanup();
  }
});
