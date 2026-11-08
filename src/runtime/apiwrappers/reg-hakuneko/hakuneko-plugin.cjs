'use strict';

/**
 * HakuNeko adapter: L3a, the definition (Plan-2026Q4-adapter-plugin-standardization Phase 4).
 *
 * HakuNeko Desktop keeps its one reading list in `hakuneko.bookmarks` and the last chapter read per entry in
 * `hakuneko.chaptermarks`. No remote API and no credential: the files' paths are the access grant, arriving with each
 * call (`view.paths`, contract A19), never read from settings.
 *
 * Offers (manifest): `file-path`, `search.query`, `enrich`, `sync.pull`, `sync.push` (the chapter axis only),
 * `sync.list` and `watch.list` (one method, `getReadingList`), `subscribe.add` (a bookmark row's presence is
 * membership; the manifest pushes every host status to the one `bookmarks` list and pulls it as no status, A16),
 * `watch.summary`; and the workspace surface's own-data reads, `listEntries` and `getEntry` (§5.4). `pullProgressBatch`
 * is the one transitional read (§5.4, A23), kept with its result unchanged until the sync refactor retires Pull Review.
 * The files are hakuneko-source.cjs's, the shapes hakuneko-mapping.cjs's.
 */

const path = require('path');
const { definePlugin, notFoundEntry, PluginError } = require('@manga-list/plugin-sdk');
const manifest = require(path.join(__dirname, 'plugin-package.json'));
const settings = require(path.join(__dirname, 'hakuneko-plugin-settings.json'));
const { createClient } = require(path.join(__dirname, 'hakuneko-source.cjs'));
const map = require(path.join(__dirname, 'hakuneko-mapping.cjs'));

/** @typedef {import('./hakuneko-source.cjs').HakunekoClient} HakunekoClient */
/** @typedef {import('./hakuneko-mapping.cjs').Bookmark} Bookmark */

/** @param {{ client: HakunekoClient }} view @returns {HakunekoClient} */
const clientOf = (view) => view.client;

/**
 * The bookmark an id names, by its decoded key; undefined when the id does not decode or the file has no such row.
 * @param {Map<string, Bookmark>} byId
 * @param {unknown} pluginEntryId
 */
function bookmarkFor(byId, pluginEntryId) {
  const decoded = map.decodeEntryId(pluginEntryId);
  return decoded ? byId.get(map.encodeEntryId(decoded.connector, decoded.mangaKey)) : undefined;
}

module.exports = definePlugin({
  manifest,
  settings,
  createClient,
  methods: {
    /**
     * `search.query`: candidates over the bookmarks, best first, up to `options.limit` (10). Each term is matched on
     * sanitized titles (exact, containment, fuzzy); a bookmark matched by several terms keeps its best confidence.
     */
    async search(view, query, options) {
      const opts = options && typeof options === 'object' ? options : {};
      const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 10;
      const scoring = {
        enableFuzzy: opts.enableFuzzy !== false,
        maxEditDistance: Number.isFinite(opts.maxEditDistance) ? opts.maxEditDistance : 12,
        minSimilarity: Number.isFinite(opts.minSimilarity) ? opts.minSimilarity : 0.85,
      };
      const client = clientOf(view);
      const terms = (Array.isArray(query) ? query : [query])
        .filter((value) => typeof value === 'string' && value.trim())
        .map((term) => client.sanitize(term));
      if (!terms.length) return [];
      /** @type {Array<{ pluginEntryId: string, title: string, confidence: number, canonicalUrl: string | null }>} */
      const out = [];
      for (const [pluginEntryId, bookmark] of map.bookmarksById(await client.bookmarks())) {
        const sTitle = client.sanitize(bookmark.title.manga);
        const confidence = Math.max(0, ...terms.map((term) => map.matchScore(term, sTitle, scoring)));
        if (confidence > 0) out.push({ pluginEntryId, title: bookmark.title.manga, confidence, canonicalUrl: map.canonicalUrl(bookmark.key.manga) });
      }
      return out.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
    },

    /** `enrich`: per entry; an id with no bookmark is its entry's `not_found`. */
    async enrich(view, pluginEntryIds) {
      const client = clientOf(view);
      const byId = map.bookmarksById(await client.bookmarks());
      const chapterByKey = map.indexChaptermarks(await client.chaptermarks());
      return (Array.isArray(pluginEntryIds) ? pluginEntryIds : []).map((id) => {
        const bookmark = bookmarkFor(byId, id);
        return bookmark
          ? { pluginEntryId: id, success: true, contribution: map.contribution(id, bookmark, chapterByKey, client.downloadBaseDir) }
          : notFoundEntry(id, `No Hakuneko bookmark for '${id}'`);
      });
    },

    /**
     * `sync.pull` (A1): on the list, the list's token and the chaptermark's chapter; not on it, every field null.
     * Whether to apply it is the host's decision.
     */
    async pullProgress(view, pluginEntryId) {
      const empty = { pluginEntryId: String(pluginEntryId), status: null, chapter: null, rating: null, lastUpdated: null };
      const client = clientOf(view);
      const bookmark = bookmarkFor(map.bookmarksById(await client.bookmarks()), pluginEntryId);
      if (!bookmark) return empty;
      const chapterTitle = map.chapterTitleOf(bookmark, map.indexChaptermarks(await client.chaptermarks()));
      return { ...empty, status: 'bookmarks', chapter: map.parseChapterTitle(chapterTitle) };
    },

    /**
     * `sync.push` (§2.1, A26): one read and one atomic write of the chaptermarks for the batch, made once. The chapter is
     * the only axis. A push never creates a bookmark: membership is `subscribe`'s (no-append mode, V3).
     */
    async pushProgress(view, entries) {
      const list = Array.isArray(entries) ? entries : [];
      if (!list.length) return [];
      const client = clientOf(view);
      const chaptermarks = await client.chaptermarks();
      /** @type {Array<{ pluginEntryId: string, success: boolean, applied: { chapter: number } | null, error?: { code: string, message: string } }>} */
      const results = [];
      let dirty = false;
      for (const entry of list) {
        const pluginEntryId = String(entry && entry.pluginEntryId);
        const decoded = map.decodeEntryId(pluginEntryId);
        if (!decoded) {
          results.push({ pluginEntryId, success: false, applied: null, error: { code: 'not_found', message: `Invalid pluginEntryId: ${pluginEntryId}` } });
          continue;
        }
        const chapterTitle = map.formatChapterTitle(entry ? entry.chapter : null);
        if (chapterTitle === null) {
          results.push({ pluginEntryId, success: false, applied: null, error: { code: 'source_error', message: 'Hakuneko only supports chapter progress; no chapter value was provided.' } });
          continue;
        }
        const mangaPath = decoded.mangaKey.endsWith('/') ? decoded.mangaKey : `${decoded.mangaKey}/`;
        const chapterID = `${mangaPath}${chapterTitle}/`;
        const existing = chaptermarks.find((cm) => cm && cm.mangaID === decoded.mangaKey && cm.connectorID === decoded.connector);
        if (existing) {
          existing.chapterID = chapterID;
          existing.chapterTitle = chapterTitle;
        } else {
          chaptermarks.push({ mangaID: decoded.mangaKey, connectorID: decoded.connector, chapterID, chapterTitle });
        }
        dirty = true;
        const applied = map.parseChapterTitle(chapterTitle);
        results.push({ pluginEntryId, success: true, applied: applied === null ? null : { chapter: applied } });
      }
      if (dirty) {
        try {
          await client.writeChaptermarks(chaptermarks);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return results.map((r) => (r.success ? { pluginEntryId: r.pluginEntryId, success: false, applied: null, error: { code: 'source_error', message } } : r));
        }
      }
      return results;
    },

    /** `sync.list` and `watch.list`: every bookmark, one read of both files. */
    async getReadingList(view) {
      const client = clientOf(view);
      const bookmarks = await client.bookmarks();
      const chapterByKey = map.indexChaptermarks(await client.chaptermarks());
      return bookmarks.filter(map.isValidBookmark).map((bookmark) => map.readingListEntry(bookmark, chapterByKey));
    },

    /**
     * `subscribe.add` (§2.1): Join List for a file source — a bookmark row's presence is membership. Each row is
     * ensured once (one read, one atomic write); a row already there is confirmed. `status` is the one list's token.
     */
    async subscribe(view, entries) {
      const list = Array.isArray(entries) ? entries : [];
      if (!list.length) return [];
      const client = clientOf(view);
      const bookmarks = await client.bookmarks();
      /** @type {Array<{ pluginEntryId: string, success: boolean, listId: null, status: string | null, error?: { code: string, message: string }, created?: boolean }>} */
      const results = [];
      let dirty = false;
      for (const entry of list) {
        const pluginEntryId = String(entry && entry.pluginEntryId);
        const decoded = map.decodeEntryId(pluginEntryId);
        if (!decoded) {
          results.push({ pluginEntryId, success: false, listId: null, status: null, error: { code: 'not_found', message: `Invalid pluginEntryId: ${pluginEntryId}` } });
          continue;
        }
        const present = bookmarks.some((b) => map.isValidBookmark(b) && b.key.connector === decoded.connector && b.key.manga === decoded.mangaKey);
        if (!present) {
          bookmarks.push({
            title: { connector: map.connectorLabel(decoded.connector), manga: decoded.mangaKey },
            key: { connector: decoded.connector, manga: decoded.mangaKey },
          });
          dirty = true;
        }
        results.push({ pluginEntryId, success: true, listId: null, status: 'bookmarks', created: !present });
      }
      if (dirty) {
        try {
          await client.writeBookmarks(bookmarks);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return results.map(({ created, ...r }) => (created ? { ...r, success: false, status: null, error: { code: 'source_error', message } } : r));
        }
      }
      return results.map(({ created, ...r }) => r);
    },

    /** `watch.summary`: one read; a bookmark's label, or `not_found` for an entry missing from the file. */
    async summarizeEntries(view, pluginEntryIds) {
      const byId = map.bookmarksById(await clientOf(view).bookmarks());
      return (Array.isArray(pluginEntryIds) ? pluginEntryIds : []).map((id) => {
        const bookmark = bookmarkFor(byId, id);
        return bookmark ? { pluginEntryId: id, success: true, summary: map.cardSummary(bookmark) } : notFoundEntry(id, 'Missing from Hakuneko bookmarks');
      });
    },

    /**
     * §5.4 `own-list`: every bookmark, `search` on the title and `includeIds`/`excludeIds` before pagination, sorted by
     * title or connector. List rows carry no folder stat (kept cheap for the whole list).
     */
    async listEntries(view, filters, pagination) {
      const f = filters && typeof filters === 'object' ? filters : {};
      const p = pagination && typeof pagination === 'object' ? pagination : {};
      const page = Number.isInteger(p.page) && p.page > 0 ? p.page : 1;
      const pageSize = Number.isInteger(p.pageSize) && p.pageSize > 0 ? p.pageSize : 50;
      const { sortBy, sortDesc } = map.resolveSort(p.sort);
      const client = clientOf(view);
      const bookmarks = await client.bookmarks();
      const chapterByKey = map.indexChaptermarks(await client.chaptermarks());

      let entries = bookmarks.filter(map.isValidBookmark).map((bookmark) => map.workspaceEntry(bookmark, chapterByKey));
      if (typeof f.search === 'string' && f.search.trim()) {
        const needle = client.sanitize(f.search);
        if (needle) entries = entries.filter((e) => client.sanitize(String(e.fields.mangaTitle.value || '')).includes(needle));
      }
      if (Array.isArray(f.includeIds)) {
        const allow = new Set(f.includeIds);
        entries = entries.filter((e) => allow.has(e.pluginEntryId));
      }
      if (Array.isArray(f.excludeIds)) {
        const deny = new Set(f.excludeIds);
        entries = entries.filter((e) => !deny.has(e.pluginEntryId));
      }
      entries.sort((a, b) => {
        const av = String(a.fields[sortBy].value ?? '');
        const bv = String(b.fields[sortBy].value ?? '');
        return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
      });
      const start = (page - 1) * pageSize;
      return { entries: entries.slice(start, start + pageSize), totalCount: entries.length, page, pageSize };
    },

    /** §5.4 `own-entry`: one bookmark with its derived folder and whether it exists; an unknown id is `null`. */
    async getEntry(view, pluginEntryId) {
      const client = clientOf(view);
      const bookmark = bookmarkFor(map.bookmarksById(await client.bookmarks()), pluginEntryId);
      if (!bookmark) throw new PluginError('not_found', `No Hakuneko bookmark for '${pluginEntryId}'`);
      const chapterByKey = map.indexChaptermarks(await client.chaptermarks());
      const folderPath = map.deriveFolder(client.downloadBaseDir, bookmark.title.manga);
      return map.workspaceEntry(bookmark, chapterByKey, { folderPath, present: client.folderExists(folderPath) });
    },

    /**
     * §5.4's transitional read (A23), its result unchanged for the host's Pull Review until the sync refactor retires
     * it: one read of both files, raw per-entry rows, no parsing. Omitted or empty `entries`: every valid bookmark,
     * `inList: true`. Narrowed: exactly those ids, in order, `inList: false` (with null title and connector) for one no
     * longer in the file.
     */
    async pullProgressBatch(view, entries) {
      const client = clientOf(view);
      const byId = new Map();
      for (const bookmark of (await client.bookmarks()).filter(map.isValidBookmark)) {
        byId.set(map.encodeEntryId(bookmark.key.connector, bookmark.key.manga), bookmark);
      }
      const chapterByKey = map.indexChaptermarks(await client.chaptermarks());
      /** @param {string} pluginEntryId @param {Bookmark | undefined} bookmark */
      const toResult = (pluginEntryId, bookmark) => (bookmark
        ? { pluginEntryId, chapterTitle: map.chapterTitleOf(bookmark, chapterByKey), inList: true, title: bookmark.title.manga, connectorLabel: bookmark.title.connector }
        : { pluginEntryId, chapterTitle: null, inList: false, title: null, connectorLabel: null });
      const requested = Array.isArray(entries) ? entries.filter((id) => typeof id === 'string' && id) : [];
      return requested.length
        ? requested.map((id) => toResult(id, byId.get(id)))
        : [...byId.entries()].map(([id, bookmark]) => toResult(id, bookmark));
    },
  },
});
