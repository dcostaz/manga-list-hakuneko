'use strict';

/**
 * L3b: map. Pure functions over HakuNeko's records:
 * - bookmark:    { title: { connector, manga }, key: { connector, manga } }
 * - chaptermark: { mangaID, connectorID, chapterID, chapterTitle }
 * - link:        chaptermark.mangaID === bookmark.key.manga AND chaptermark.connectorID === bookmark.key.connector
 * - pluginEntryId: `${key.connector}::${encodeURIComponent(key.manga)}`
 * - folder:        `{downloadBaseDir}/{title.manga}/`
 *
 * Never link state (A4): a bookmark the file does not have is the binding's `not_found`.
 */

/** @typedef {{ title: { connector: string, manga: string }, key: { connector: string, manga: string } }} Bookmark */
/** @typedef {{ mangaID: string, connectorID: string, chapterID?: string, chapterTitle?: string }} Chaptermark */

/** @param {string} connector @param {string} mangaKey @returns {string} */
function encodeEntryId(connector, mangaKey) {
  return `${connector}::${encodeURIComponent(mangaKey)}`;
}

/** @param {unknown} pluginEntryId @returns {{ connector: string, mangaKey: string } | null} */
function decodeEntryId(pluginEntryId) {
  if (typeof pluginEntryId !== 'string') return null;
  const idx = pluginEntryId.indexOf('::');
  if (idx === -1) return null;
  const connector = pluginEntryId.slice(0, idx);
  const encoded = pluginEntryId.slice(idx + 2);
  let mangaKey;
  try {
    mangaKey = decodeURIComponent(encoded);
  } catch {
    mangaKey = encoded;
  }
  return { connector, mangaKey };
}

/** @param {unknown} bookmark @returns {bookmark is Bookmark} */
function isValidBookmark(bookmark) {
  const b = /** @type {any} */ (bookmark);
  return Boolean(
    b && typeof b === 'object'
    && b.key && typeof b.key === 'object' && typeof b.key.manga === 'string' && typeof b.key.connector === 'string'
    && b.title && typeof b.title === 'object' && typeof b.title.manga === 'string' && typeof b.title.connector === 'string',
  );
}

/** @param {any[]} bookmarks @returns {Map<string, Bookmark>} the valid bookmarks by pluginEntryId, the first of a duplicate kept */
function bookmarksById(bookmarks) {
  /** @type {Map<string, Bookmark>} */
  const map = new Map();
  for (const b of bookmarks) {
    if (!isValidBookmark(b)) continue;
    const id = encodeEntryId(b.key.connector, b.key.manga);
    if (!map.has(id)) map.set(id, b);
  }
  return map;
}

/** @param {any[]} chaptermarks @returns {Map<string, Chaptermark>} keyed `${connectorID}::${mangaID}` */
function indexChaptermarks(chaptermarks) {
  /** @type {Map<string, Chaptermark>} */
  const map = new Map();
  for (const cm of chaptermarks) {
    if (cm && typeof cm.mangaID === 'string' && typeof cm.connectorID === 'string') map.set(`${cm.connectorID}::${cm.mangaID}`, cm);
  }
  return map;
}

/** @param {Bookmark} bookmark @param {Map<string, Chaptermark>} chapterByKey @returns {string | null} */
function chapterTitleOf(bookmark, chapterByKey) {
  const cm = chapterByKey.get(`${bookmark.key.connector}::${bookmark.key.manga}`);
  return cm && typeof cm.chapterTitle === 'string' ? cm.chapterTitle : null;
}

/**
 * The chapter in a chaptermark's title, the same parse as the host's `Utils.CHAPTERREGEX`; null when there is none,
 * never an invented default.
 * @param {string | null} chapterTitle
 * @returns {number | null}
 */
function parseChapterTitle(chapterTitle) {
  if (typeof chapterTitle !== 'string' || !chapterTitle.trim()) return null;
  const match = /(?:v(?:ol(?:ume)?)?\.?\s*(\d+(?:\.\d+)?))?[\s]*?(?:c(?:h(?:apter)?)?\.?\s*(\d+(?:\.\d+)?))?/i.exec(chapterTitle);
  const rawChapter = match ? match[2] : undefined;
  if (rawChapter === undefined) return null;
  const parsed = parseFloat(rawChapter);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The chaptermark title a pushed chapter is written as. @param {unknown} chapter @returns {string | null} */
function formatChapterTitle(chapter) {
  if (chapter === null || chapter === undefined || chapter === '') return null;
  if (typeof chapter === 'number') return `Chapter ${chapter}`;
  return String(chapter);
}

/** @param {string} connector @returns {string} */
function connectorLabel(connector) {
  return connector === 'mangalist' ? 'Manga List' : connector;
}

/** @param {string} downloadBaseDir @param {string} mangaTitle @returns {string} */
function deriveFolder(downloadBaseDir, mangaTitle) {
  return `${downloadBaseDir}/${mangaTitle}/`;
}

/** The entry's URL: the bookmark key when it is already absolute (connectors that key by URL), else null. @param {string} mangaKey */
function canonicalUrl(mangaKey) {
  return typeof mangaKey === 'string' && /^https?:\/\//i.test(mangaKey) ? mangaKey : null;
}

/**
 * One `PluginReadingListEntry`: `status` the one list's token (`bookmarks`, which `pull` reads as no reading status,
 * A16), the chapter parsed here from the chaptermark (Decision 3: the plugin parses, the host compares).
 * @param {Bookmark} bookmark
 * @param {Map<string, Chaptermark>} chapterByKey
 */
function readingListEntry(bookmark, chapterByKey) {
  return {
    pluginEntryId: encodeEntryId(bookmark.key.connector, bookmark.key.manga),
    title: bookmark.title.manga,
    canonicalUrl: canonicalUrl(bookmark.key.manga),
    status: 'bookmarks',
    chapter: parseChapterTitle(chapterTitleOf(bookmark, chapterByKey)),
    rating: null,
    volume: null,
    listId: null,
    priority: null,
    lastUpdated: null,
  };
}

/**
 * The link contribution: identity, the connector, the derived folder and the last chapter read. HakuNeko carries no
 * other metadata.
 * @param {string} pluginEntryId
 * @param {Bookmark} bookmark
 * @param {Map<string, Chaptermark>} chapterByKey
 * @param {string} downloadBaseDir
 */
function contribution(pluginEntryId, bookmark, chapterByKey, downloadBaseDir) {
  return {
    pluginEntryId,
    displayTitle: bookmark.title.manga,
    connectorLabel: bookmark.title.connector,
    folderPath: deriveFolder(downloadBaseDir, bookmark.title.manga),
    currentChapter: chapterTitleOf(bookmark, chapterByKey),
    syncedAt: new Date().toISOString(),
  };
}

/** `PluginCardSummary`: HakuNeko has no series status; the label names the connector and title. @param {Bookmark} bookmark */
function cardSummary(bookmark) {
  return { label: `${bookmark.title.connector}: ${bookmark.title.manga}`, status: null, latestChapter: null, lastUpdated: null };
}

/**
 * The plugin's own catalog entry (§5.4): `pluginEntryId` and `title` for the host; `fields`, which the workspace
 * surface renders, its own. `detail` adds the derived folder and whether it exists (one stat, so `getEntry` only).
 * @param {Bookmark} bookmark
 * @param {Map<string, Chaptermark>} chapterByKey
 * @param {{ folderPath: string, present: boolean }} [detail]
 */
function workspaceEntry(bookmark, chapterByKey, detail) {
  /** @type {Record<string, { type: string, value: unknown }>} */
  const fields = {
    mangaTitle: { type: 'text', value: bookmark.title.manga },
    connectorLabel: { type: 'text', value: bookmark.title.connector },
    chapterTitle: { type: 'text', value: chapterTitleOf(bookmark, chapterByKey) },
  };
  if (detail) {
    fields.folderPath = { type: 'text', value: detail.folderPath };
    fields.folderMatch = { type: 'status', value: detail.present ? 'present' : 'missing' };
  }
  return { pluginEntryId: encodeEntryId(bookmark.key.connector, bookmark.key.manga), title: bookmark.title.manga, fields };
}

/**
 * The list's sort: `mangaTitle` (default) or `connectorLabel`, `-field` or `{ field, direction }` for descending.
 * @param {unknown} sort
 * @returns {{ sortBy: 'mangaTitle' | 'connectorLabel', sortDesc: boolean }}
 */
function resolveSort(sort) {
  if (typeof sort === 'string' && sort) {
    const desc = sort.startsWith('-');
    const key = desc ? sort.slice(1) : sort;
    return { sortBy: key === 'connectorLabel' ? 'connectorLabel' : 'mangaTitle', sortDesc: desc };
  }
  if (sort && typeof sort === 'object') {
    const s = /** @type {Record<string, unknown>} */ (sort);
    return { sortBy: s.field === 'connectorLabel' ? 'connectorLabel' : 'mangaTitle', sortDesc: s.direction === 'desc' };
  }
  return { sortBy: 'mangaTitle', sortDesc: false };
}

/** @param {string} a @param {string} b @returns {number} */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

/**
 * Title confidence, 3 tiers on sanitized titles: exact 1.0; one containing the other 0.70–0.95 by length ratio; fuzzy
 * (edit distance) 0.70–0.85 above the similarity floor. 0 when none.
 * @param {string} sTerm - sanitized query term
 * @param {string} sTitle - sanitized bookmark title
 * @param {{ enableFuzzy: boolean, maxEditDistance: number, minSimilarity: number }} opts
 */
function matchScore(sTerm, sTitle, opts) {
  if (!sTerm || !sTitle) return 0;
  if (sTitle === sTerm) return 1.0;
  if (sTitle.includes(sTerm) || sTerm.includes(sTitle)) {
    return 0.70 + (Math.min(sTerm.length, sTitle.length) / Math.max(sTerm.length, sTitle.length)) * 0.25;
  }
  if (!opts.enableFuzzy) return 0;
  const dist = levenshtein(sTerm, sTitle);
  const sim = 1 - dist / Math.max(sTerm.length, sTitle.length);
  if (dist > opts.maxEditDistance || sim < opts.minSimilarity) return 0;
  return 0.70 + ((sim - opts.minSimilarity) / (1 - opts.minSimilarity || 1)) * 0.15;
}

module.exports = {
  encodeEntryId, decodeEntryId, isValidBookmark, bookmarksById, indexChaptermarks, chapterTitleOf, parseChapterTitle,
  formatChapterTitle, connectorLabel, deriveFolder, canonicalUrl, readingListEntry, contribution, cardSummary,
  workspaceEntry, resolveSort, levenshtein, matchScore,
};
