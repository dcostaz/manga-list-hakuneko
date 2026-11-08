'use strict';

/**
 * The input of the byte-identity test (Plan-2026Q4-adapter-plugin-standardization Phase 4, step 5): the starting files,
 * one push and one Join List. `golden-4.0.chaptermarks` and `golden-4.0.bookmarks` are what the `adapter-4.0-final`
 * adapter wrote for exactly this input; the rebuilt plugin must write the same bytes.
 */

const BOOKMARKS = [
  { title: { connector: 'ManhuaUS', manga: 'Legend of Star General' }, key: { connector: 'manhuaus', manga: '/manga/legend-of-star-general/' } },
  { title: { connector: 'MangaDex', manga: 'One Piece' }, key: { connector: 'mangadex', manga: 'https://mangadex.org/title/one-piece' } },
  { title: { connector: 'Manga List', manga: 'Solo Leveling' }, key: { connector: 'mangalist', manga: '/manga/solo-leveling' } },
];

const CHAPTERMARKS = [
  { mangaID: '/manga/legend-of-star-general/', connectorID: 'manhuaus', chapterID: '/manga/legend-of-star-general/Chapter 372/', chapterTitle: 'Chapter 372' },
  { mangaID: 'https://mangadex.org/title/one-piece', connectorID: 'mangadex', chapterID: 'https://mangadex.org/title/one-piece/Chapter 1100/', chapterTitle: 'Chapter 1100' },
];

const enc = (/** @type {string} */ connector, /** @type {string} */ manga) => `${connector}::${encodeURIComponent(manga)}`;

/** An update of an existing chaptermark, a new chaptermark, a decimal chapter. */
const PUSH = [
  { pluginEntryId: enc('manhuaus', '/manga/legend-of-star-general/'), chapter: 400 },
  { pluginEntryId: enc('mangalist', '/manga/solo-leveling'), chapter: 12.5 },
  { pluginEntryId: enc('mangadex', 'https://mangadex.org/title/one-piece'), chapter: 1101 },
];

/** One already on the list (confirmed), one new (created). */
const SUBSCRIBE = [
  { pluginEntryId: enc('mangadex', 'https://mangadex.org/title/one-piece'), status: 'bookmarks' },
  { pluginEntryId: enc('mangalist', '/manga/new-series'), status: 'bookmarks' },
];

module.exports = { BOOKMARKS, CHAPTERMARKS, PUSH, SUBSCRIBE, enc };
