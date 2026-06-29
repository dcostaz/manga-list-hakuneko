'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

const HakunekoAdapter = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'apiwrappers', 'reg-hakuneko', 'hakuneko-adapter.cjs',
));

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

test('identity - static + instance pluginName, type, capabilities', async () => {
  assert.equal(HakunekoAdapter.pluginName, 'hakuneko');
  const env = await setupAdapter();
  try {
    assert.equal(env.adapter.pluginName, 'hakuneko');
    assert.deepEqual([...env.adapter.pluginType], ['tracker']);
    assert.deepEqual([...env.adapter.capabilities], ['tracker.file', 'workspace.list', 'workspace.get']);
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

test('listEntries - 5 bookmarks, chapterTitle correct for matched, null otherwise', async () => {
  const env = await setupAdapter();
  try {
    const page = await env.adapter.listEntries({ page: 1, pageSize: 50 });
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
    const page1 = await env.adapter.listEntries({ page: 1, pageSize: 2, sortBy: 'mangaTitle' });
    assert.equal(page1.entries.length, 2);
    assert.equal(page1.totalCount, 5);
    assert.equal(page1.entries[0].fields.mangaTitle.value, 'Bleach');
    assert.equal(page1.entries[1].fields.mangaTitle.value, 'Legend of Star General');
  } finally {
    await env.cleanup();
  }
});

test('getEntry - resolves by pluginEntryId', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('mangadex', 'https://mangadex.org/title/one-piece');
    const entry = await env.adapter.getEntry(id);
    assert.equal(entry.pluginEntryId, id);
    assert.equal(entry.fields.mangaTitle.value, 'One Piece');
    assert.equal(entry.fields.chapterTitle.value, 'Chapter 1100');
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

test('pushProgress - chapter change updates chaptermark, replaces not duplicates', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('manhuaus', '/manga/legend-of-star-general/');
    const result = await env.adapter.pushProgress(id, { currentChapter: 'Chapter 400' });
    assert.equal(result.status, 'ok');
    assert.equal(result.chaptermarkWritten, true);

    const raw = JSON.parse(await fs.readFile(env.chaptermarksPath, 'utf8'));
    const matching = raw.filter((cm) => cm.mangaID === '/manga/legend-of-star-general/' && cm.connectorID === 'manhuaus');
    assert.equal(matching.length, 1);
    assert.equal(matching[0].chapterTitle, 'Chapter 400');
    assert.equal(matching[0].chapterID, '/manga/legend-of-star-general/Chapter 400/');
  } finally {
    await env.cleanup();
  }
});

test('pushProgress - first link appends bookmark, idempotent on second call', async () => {
  const env = await setupAdapter();
  try {
    const id = env.adapter._encodeEntryId('mangalist', '/manga/new-series');

    const first = await env.adapter.pushProgress(id, { title: 'New Series', currentChapter: 'Chapter 1' });
    assert.equal(first.status, 'ok');
    assert.equal(first.bookmarkAppended, true);

    let raw = JSON.parse(await fs.readFile(env.bookmarksPath, 'utf8'));
    assert.equal(raw.filter((b) => b.key.connector === 'mangalist' && b.key.manga === '/manga/new-series').length, 1);

    const second = await env.adapter.pushProgress(id, { title: 'New Series', currentChapter: 'Chapter 2' });
    assert.equal(second.status, 'ok');
    assert.equal(second.bookmarkAppended, false);

    raw = JSON.parse(await fs.readFile(env.bookmarksPath, 'utf8'));
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
