'use strict';

const path = require('path');
const fs = require('fs').promises;
const HakunekoSettings = require(path.join(__dirname, 'hakuneko-settings.cjs'));

const SERVICE_NAME = 'hakuneko';

/** @typedef {import('../../../../types/plugintypedefs').PluginInitResult} PluginInitResult */
/** @typedef {import('../../../../types/plugintypedefs').PluginStatus} PluginStatus */
/** @typedef {import('../../../../types/plugintypedefs').PluginSearchResult} PluginSearchResult */
/** @typedef {import('../../../../types/plugintypedefs').PluginMatchCandidate} PluginMatchCandidate */
/** @typedef {import('../../../../types/plugintypedefs').PluginLinkContribution} PluginLinkContribution */
/** @typedef {import('../../../../types/plugintypedefs').PluginWorkspaceEntry} PluginWorkspaceEntry */
/** @typedef {import('../../../../types/plugintypedefs').PluginEntryPage} PluginEntryPage */
/** @typedef {import('../../../../types/plugincontexttypedefs').PluginContextLike} PluginContextLike */

/**
 * Hakuneko file-based tracker plugin.
 *
 * Bidirectional sync with Hakuneko Desktop's `hakuneko.bookmarks` and
 * `hakuneko.chaptermarks` JSON files. No remote API, no credentials — the
 * per-user file paths are the user-association mechanism.
 *
 * Data model:
 * - bookmark:    { title: { connector, manga }, key: { connector, manga } }
 * - chaptermark: { mangaID, connectorID, chapterID, chapterTitle }
 * - link:        chaptermark.mangaID === bookmark.key.manga AND
 *                chaptermark.connectorID === bookmark.key.connector
 * - pluginEntryId: `${key.connector}::${encodeURIComponent(key.manga)}`
 * - folder:        `{downloadBaseDir}/{title.manga}/`
 *
 * Capabilities: tracker.file, workspace.list, workspace.get
 */
class HakunekoAdapter {
  /**
   * @param {object} params
   * @param {PluginContextLike | null} [params.context]
   * @param {HakunekoSettings} params.settings
   */
  constructor({ context, settings }) {
    /** @type {PluginContextLike | null} */
    this._context = context && typeof context === 'object' ? context : null;
    /** @type {HakunekoSettings} */
    this._settings = settings;
    this._downloadBaseDir = settings ? settings.downloadBaseDir : '';
    this._bookmarksPath = settings ? settings.bookmarksPath : '';
    this._chaptermarksPath = settings ? settings.chaptermarksPath : '';
    this._initialized = false;
  }

  /**
   * Plugin factory. The host injects context + settings.
   *
   * @param {object} [options]
   * @param {PluginContextLike} [options.context]
   * @param {HakunekoSettings | null} [options.apiSettings]
   * @param {import('../../../../types/plugintypedefs').PluginServiceSettings} [options.serviceSettings]
   * @returns {Promise<HakunekoAdapter>}
   */
  static async init(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const context = opts.context && typeof opts.context === 'object' ? opts.context : null;

    let settings = opts.apiSettings instanceof HakunekoSettings ? opts.apiSettings : null;
    if (!settings) {
      const serviceSettings = opts.serviceSettings && typeof opts.serviceSettings === 'object'
        ? opts.serviceSettings
        : (opts.apiSettings && typeof opts.apiSettings === 'object' && typeof opts.apiSettings.toLegacyFormat === 'function'
          ? opts.apiSettings.toLegacyFormat()
          : {});
      settings = await HakunekoSettings.init({ serviceSettings });
    }

    return new HakunekoAdapter({ context, settings });
  }

  // ── Identity (static getter required by PluginPackageLoader; instance getter by PluginAPILike) ──

  static get serviceName() { return SERVICE_NAME; }
  static get pluginName() { return SERVICE_NAME; }

  /** @returns {string} */
  get pluginName() { return SERVICE_NAME; }

  /** @returns {string[]} */
  get pluginType() { return Object.freeze(['adapter']); }

  /** @returns {string[]} */
  get capabilities() { return Object.freeze(['tracker.file', 'workspace.list', 'workspace.get']); }

  /** @returns {string} */
  get contractVersion() {
    const { PLUGIN_CONTRACT_VERSION } = require(path.join(__dirname, '..', 'plugindtocontract.cjs'));
    return PLUGIN_CONTRACT_VERSION;
  }

  // ── Lifecycle ──

  /**
   * Validate that all three paths are configured and readable.
   * - Any path empty → { status: 'unconfigured' } (NOT an error: setup incomplete).
   * - A configured path that is unreadable → { status: 'error', message }.
   * - All readable → { status: 'ok' }.
   *
   * @returns {Promise<PluginInitResult | { status: 'unconfigured' }>}
   */
  async initialize() {
    if (!this._downloadBaseDir || !this._bookmarksPath || !this._chaptermarksPath) {
      return { status: 'unconfigured' };
    }

    const targets = [this._downloadBaseDir, this._bookmarksPath, this._chaptermarksPath];
    for (const target of targets) {
      try {
        await fs.access(target);
      } catch (error) {
        return {
          status: 'error',
          message: `Hakuneko path is not readable: ${target} (${error instanceof Error ? error.message : String(error)})`,
        };
      }
    }

    this._initialized = true;
    return { status: 'ok' };
  }

  /**
   * Lightweight status: stat configured paths and report bookmark count.
   *
   * @returns {Promise<PluginStatus | { status: 'unconfigured' } | { status: 'ok', entryCount: number }>}
   */
  async getStatus() {
    if (!this._downloadBaseDir || !this._bookmarksPath || !this._chaptermarksPath) {
      return { status: 'unconfigured' };
    }

    try {
      await fs.access(this._downloadBaseDir);
      await fs.access(this._chaptermarksPath);
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }

    const read = await this._readArrayFile(this._bookmarksPath);
    if (!read.ok) {
      return { status: 'error', message: read.message };
    }

    return { status: 'ok', entryCount: read.data.length };
  }

  // ── workspace.list / workspace.get ──

  /**
   * List bookmark entries as PluginWorkspaceEntry[] with pagination + sorting.
   *
   * Two-argument (filters, pagination) contract — matches the host's calling
   * convention (`apipluginhandler.cjs` case 'listEntries': `instance.listEntries(filters,
   * { ...pagination, sort })`) and mirrors FMD2's `listEntries(filters, pagination)`.
   * A prior single-argument `listEntries(options)` shape silently received only the
   * (usually empty) `filters` object and dropped page/pageSize/sort entirely — the
   * workspace still "worked" on the default 'all' filter (safe defaults kicked in),
   * but pagination, sorting, and search were all silent no-ops.
   *
   * @param {object} [filters]
   * @param {string} [filters.search]
   * @param {string[]} [filters.includeIds]
   * @param {string[]} [filters.excludeIds]
   * @param {object} [pagination]
   * @param {number} [pagination.page]
   * @param {number} [pagination.pageSize]
   * @param {string | { field?: string, direction?: string }} [pagination.sort]
   * @returns {Promise<PluginEntryPage | { status: 'error', message: string, retryable: boolean }>}
   */
  async listEntries(filters = {}, pagination = {}) {
    const f = filters && typeof filters === 'object' ? filters : {};
    const p = pagination && typeof pagination === 'object' ? pagination : {};
    const page = Number.isInteger(p.page) && p.page > 0 ? p.page : 1;
    const pageSize = Number.isInteger(p.pageSize) && p.pageSize > 0 ? p.pageSize : 50;
    const { sortBy, sortDesc } = this._resolveSort(p.sort);

    const bookmarksRead = await this._readArrayFile(this._bookmarksPath);
    if (!bookmarksRead.ok) {
      return { status: 'error', message: bookmarksRead.message, retryable: false };
    }
    const chaptermarksRead = await this._readArrayFile(this._chaptermarksPath);
    if (!chaptermarksRead.ok) {
      return { status: 'error', message: chaptermarksRead.message, retryable: false };
    }

    const chapterByKey = this._indexChaptermarks(chaptermarksRead.data);

    let entries = bookmarksRead.data
      .filter((bookmark) => this._isValidBookmark(bookmark))
      .map((bookmark) => this._buildEntry(bookmark, chapterByKey));

    // Search filter (sanitized contains on mangaTitle).
    if (typeof f.search === 'string' && f.search.trim()) {
      const needle = this._sanitize(f.search);
      if (needle) {
        entries = entries.filter((entry) => {
          const title = this._fieldValue(entry, 'mangaTitle');
          return this._sanitize(typeof title === 'string' ? title : '').includes(needle);
        });
      }
    }

    // includeIds/excludeIds applied server-side BEFORE pagination.
    if (Array.isArray(f.includeIds)) {
      const allow = new Set(f.includeIds);
      entries = entries.filter((entry) => allow.has(entry.pluginEntryId));
    }
    if (Array.isArray(f.excludeIds)) {
      const deny = new Set(f.excludeIds);
      entries = entries.filter((entry) => !deny.has(entry.pluginEntryId));
    }

    entries.sort((a, b) => {
      const av = String(this._fieldValue(a, sortBy) ?? '');
      const bv = String(this._fieldValue(b, sortBy) ?? '');
      return sortDesc ? bv.localeCompare(av) : av.localeCompare(bv);
    });

    const totalCount = entries.length;
    const start = (page - 1) * pageSize;
    const pageEntries = entries.slice(start, start + pageSize);

    return { entries: pageEntries, totalCount, page, pageSize };
  }

  /**
   * @param {string | { field?: string, direction?: string } | undefined} sort
   * @returns {{ sortBy: 'mangaTitle' | 'connectorLabel', sortDesc: boolean }}
   */
  _resolveSort(sort) {
    if (typeof sort === 'string' && sort) {
      const desc = sort.startsWith('-');
      const key = desc ? sort.slice(1) : sort;
      return { sortBy: key === 'connectorLabel' ? 'connectorLabel' : 'mangaTitle', sortDesc: desc };
    }
    if (sort && typeof sort === 'object') {
      const sortBy = sort.field === 'connectorLabel' ? 'connectorLabel' : 'mangaTitle';
      return { sortBy, sortDesc: sort.direction === 'desc' };
    }
    return { sortBy: 'mangaTitle', sortDesc: false };
  }

  /**
   * Resolve a single entry by pluginEntryId.
   *
   * @param {string} pluginEntryId
   * @returns {Promise<PluginWorkspaceEntry | null | { status: 'error', message: string, retryable: boolean }>}
   */
  async getEntry(pluginEntryId) {
    const decoded = this._decodeEntryId(pluginEntryId);
    if (!decoded) return null;

    const bookmarksRead = await this._readArrayFile(this._bookmarksPath);
    if (!bookmarksRead.ok) {
      return { status: 'error', message: bookmarksRead.message, retryable: false };
    }
    const chaptermarksRead = await this._readArrayFile(this._chaptermarksPath);
    if (!chaptermarksRead.ok) {
      return { status: 'error', message: chaptermarksRead.message, retryable: false };
    }

    const bookmark = bookmarksRead.data.find((entry) =>
      this._isValidBookmark(entry)
      && entry.key.connector === decoded.connector
      && entry.key.manga === decoded.mangaKey);

    if (!bookmark) return null;

    return this._buildEntry(bookmark, this._indexChaptermarks(chaptermarksRead.data));
  }

  // ── Linking (folder-based; binary confidence) ──

  /**
   * Folder-based link discovery. Derives `{downloadBaseDir}/{title.manga}/` for
   * every bookmark and compares (case-normalised) against folderPath.
   *
   * @param {string} folderPath
   * @returns {Promise<PluginMatchCandidate[] | { error: 'duplicate_folder', candidates: PluginMatchCandidate[] }>}
   */
  async findMatches(folderPath) {
    const bookmarksRead = await this._readArrayFile(this._bookmarksPath);
    if (!bookmarksRead.ok) return [];

    const target = this._normalizeFolder(folderPath);
    if (!target) return [];

    const matches = bookmarksRead.data
      .filter((bookmark) => this._isValidBookmark(bookmark))
      .filter((bookmark) => this._normalizeFolder(this._deriveFolder(bookmark.title.manga)) === target);

    if (matches.length === 0) return [];

    const candidates = matches.map((bookmark) => ({
      pluginEntryId: this._encodeEntryId(bookmark.key.connector, bookmark.key.manga),
      title: bookmark.title.manga,
      confidence: 1.0,
    }));

    if (candidates.length >= 2) {
      return { error: 'duplicate_folder', candidates };
    }

    return [candidates[0]];
  }

  /**
   * Build the link contribution for a confirmed link.
   * Targets plugin_references → localtracker. Hakuneko contributes no metadata
   * enrichment beyond identity + folder + last-known chapter.
   *
   * @param {string} pluginEntryId
   * @returns {Promise<PluginLinkContribution | null | { status: 'error', message: string, retryable: boolean }>}
   */
  async buildLinkContribution(pluginEntryId) {
    const decoded = this._decodeEntryId(pluginEntryId);
    if (!decoded) return null;

    const bookmarksRead = await this._readArrayFile(this._bookmarksPath);
    if (!bookmarksRead.ok) {
      return { status: 'error', message: bookmarksRead.message, retryable: false };
    }
    const chaptermarksRead = await this._readArrayFile(this._chaptermarksPath);
    if (!chaptermarksRead.ok) {
      return { status: 'error', message: chaptermarksRead.message, retryable: false };
    }

    const bookmark = bookmarksRead.data.find((entry) =>
      this._isValidBookmark(entry)
      && entry.key.connector === decoded.connector
      && entry.key.manga === decoded.mangaKey);

    if (!bookmark) return null;

    const chaptermark = this._findChaptermark(chaptermarksRead.data, decoded.connector, decoded.mangaKey);

    return {
      pluginEntryId,
      displayTitle: bookmark.title.manga,
      connectorLabel: bookmark.title.connector,
      folderPath: this._deriveFolder(bookmark.title.manga),
      currentChapter: chaptermark && typeof chaptermark.chapterTitle === 'string' ? chaptermark.chapterTitle : null,
      syncedAt: new Date().toISOString(),
    };
  }

  // ── tracker.file: pull / push ──

  /**
   * Pull operation. Conservative: never overwrites existing progress.
   * The host supplies the current bookmark state for the linked entry; the
   * plugin reads its chaptermark and decides per the pull rules.
   *
   * @param {string} pluginEntryId
   * @param {object} [current] - Host-provided current state.
   * @param {boolean} [current.hasBookmark] - Whether a bookmarks row exists for the user.
   * @param {string | number | null} [current.currentChapter] - Existing current_chapter (null/empty if unset).
   * @returns {Promise<{ updated: object[], skipped_no_bookmark: object[], skipped_chapter_exists: object[] } | { status: 'error', message: string, retryable: boolean }>}
   */
  async pullProgress(pluginEntryId, current = {}) {
    const result = { updated: [], skipped_no_bookmark: [], skipped_chapter_exists: [] };

    const decoded = this._decodeEntryId(pluginEntryId);
    if (!decoded) {
      result.skipped_no_bookmark.push({ pluginEntryId, reason: 'no_bookmark' });
      return result;
    }

    const chaptermarksRead = await this._readArrayFile(this._chaptermarksPath);
    if (!chaptermarksRead.ok) {
      return { status: 'error', message: chaptermarksRead.message, retryable: false };
    }

    const ctx = current && typeof current === 'object' ? current : {};
    const hasBookmark = ctx.hasBookmark === true;
    const existingChapter = ctx.currentChapter;
    const chapterIsSet = existingChapter !== null && existingChapter !== undefined && existingChapter !== '';

    const chaptermark = this._findChaptermark(chaptermarksRead.data, decoded.connector, decoded.mangaKey);
    const proposedChapter = chaptermark && typeof chaptermark.chapterTitle === 'string' ? chaptermark.chapterTitle : null;

    if (!hasBookmark) {
      result.skipped_no_bookmark.push({ pluginEntryId, reason: 'no_bookmark' });
      return result;
    }

    if (chapterIsSet) {
      result.skipped_chapter_exists.push({ pluginEntryId, reason: 'chapter_exists', existing: existingChapter });
      return result;
    }

    if (proposedChapter !== null) {
      result.updated.push({ pluginEntryId, chapter_set: proposedChapter });
    }

    return result;
  }

  /**
   * Push operation. Writes back to Hakuneko files.
   * - On chapter change: upsert the chaptermark for (mangaID, connectorID).
   * - On first link: append a bookmark if one does not already exist (idempotent).
   * All writes are atomic (.tmp → rename).
   *
   * @param {string} pluginEntryId
   * @param {object} [progress]
   * @param {string | number | null} [progress.currentChapter] - Chapter title or number to write.
   * @param {string} [progress.title] - Display title for first-link bookmark creation.
   * @returns {Promise<{ status: 'ok', bookmarkAppended: boolean, chaptermarkWritten: boolean } | { status: 'error', message: string, retryable: boolean }>}
   */
  async pushProgress(pluginEntryId, progress = {}) {
    const decoded = this._decodeEntryId(pluginEntryId);
    if (!decoded) {
      return { status: 'error', message: `Invalid pluginEntryId: ${pluginEntryId}`, retryable: false };
    }

    const prog = progress && typeof progress === 'object' ? progress : {};

    const bookmarksRead = await this._readArrayFile(this._bookmarksPath);
    if (!bookmarksRead.ok) {
      return { status: 'error', message: bookmarksRead.message, retryable: false };
    }
    const chaptermarksRead = await this._readArrayFile(this._chaptermarksPath);
    if (!chaptermarksRead.ok) {
      return { status: 'error', message: chaptermarksRead.message, retryable: false };
    }

    const bookmarks = bookmarksRead.data;
    const chaptermarks = chaptermarksRead.data;

    let bookmarkAppended = false;
    let chaptermarkWritten = false;

    // First-link: ensure a bookmark exists (idempotent).
    const existingBookmark = bookmarks.find((entry) =>
      this._isValidBookmark(entry)
      && entry.key.connector === decoded.connector
      && entry.key.manga === decoded.mangaKey);

    if (!existingBookmark) {
      const title = typeof prog.title === 'string' && prog.title.trim() ? prog.title : decoded.mangaKey;
      bookmarks.push({
        title: { connector: this._connectorLabel(decoded.connector), manga: title },
        key: { connector: decoded.connector, manga: decoded.mangaKey },
      });
      bookmarkAppended = true;
    }

    // Chapter update: upsert chaptermark.
    const chapterTitle = this._formatChapterTitle(prog.currentChapter);
    if (chapterTitle !== null) {
      const mangaPath = decoded.mangaKey.endsWith('/') ? decoded.mangaKey : `${decoded.mangaKey}/`;
      const chapterID = `${mangaPath}${chapterTitle}/`;
      const existing = chaptermarks.find((cm) =>
        cm && cm.mangaID === decoded.mangaKey && cm.connectorID === decoded.connector);
      if (existing) {
        existing.chapterID = chapterID;
        existing.chapterTitle = chapterTitle;
      } else {
        chaptermarks.push({
          mangaID: decoded.mangaKey,
          connectorID: decoded.connector,
          chapterID,
          chapterTitle,
        });
      }
      chaptermarkWritten = true;
    }

    try {
      if (bookmarkAppended) {
        await this._writeJsonAtomic(this._bookmarksPath, bookmarks);
      }
      if (chaptermarkWritten) {
        await this._writeJsonAtomic(this._chaptermarksPath, chaptermarks);
      }
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error), retryable: false };
    }

    return { status: 'ok', bookmarkAppended, chaptermarkWritten };
  }

  // ── workspace search (NOT used for linking) ──

  /**
   * Title search with 3-tier matching: exact → partial → fuzzy.
   *
   * @param {string | string[]} query
   * @param {object} [options]
   * @param {boolean} [options.returnAll]
   * @param {number} [options.limit]
   * @param {boolean} [options.enableFuzzy]
   * @param {number} [options.maxEditDistance]
   * @param {number} [options.minSimilarity]
   * @returns {Promise<PluginSearchResult[]>}
   */
  async search(query, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const returnAll = opts.returnAll === true;
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 10;
    const enableFuzzy = opts.enableFuzzy !== false;
    const maxEditDistance = Number.isFinite(opts.maxEditDistance) ? opts.maxEditDistance : 12;
    const minSimilarity = Number.isFinite(opts.minSimilarity) ? opts.minSimilarity : 0.85;

    const titles = (Array.isArray(query) ? query : [query])
      .filter((value) => typeof value === 'string' && value.trim().length > 0);
    if (titles.length === 0) return [];

    const bookmarksRead = await this._readArrayFile(this._bookmarksPath);
    if (!bookmarksRead.ok) return [];

    /** @type {Map<string, PluginSearchResult>} */
    const best = new Map();

    for (const bookmark of bookmarksRead.data) {
      if (!this._isValidBookmark(bookmark)) continue;
      const bookmarkTitle = bookmark.title.manga;
      const bSan = this._sanitize(bookmarkTitle);
      if (!bSan) continue;

      let bestScore = 0;
      for (const term of titles) {
        const sSan = this._sanitize(term);
        if (!sSan) continue;

        let score = 0;
        if (bSan === sSan) {
          score = 1.0;
        } else if (bSan.includes(sSan) || sSan.includes(bSan)) {
          const ratio = Math.min(sSan.length, bSan.length) / Math.max(sSan.length, bSan.length);
          score = 0.70 + ratio * 0.25;
        } else if (enableFuzzy) {
          const dist = this._levenshtein(sSan, bSan);
          const sim = 1 - dist / Math.max(sSan.length, bSan.length);
          if (dist <= maxEditDistance && sim >= minSimilarity) {
            const normalized = (sim - minSimilarity) / (1 - minSimilarity || 1);
            score = 0.70 + normalized * 0.15;
          }
        }

        if (score > bestScore) bestScore = score;
      }

      if (bestScore > 0) {
        const pluginEntryId = this._encodeEntryId(bookmark.key.connector, bookmark.key.manga);
        const existing = best.get(pluginEntryId);
        if (!existing || (existing.score ?? 0) < bestScore) {
          best.set(pluginEntryId, { pluginEntryId, title: bookmarkTitle, score: bestScore });
        }
      }
    }

    const results = Array.from(best.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (returnAll) return results.slice(0, limit);
    return results.length > 0 ? [results[0]] : [];
  }

  // ── workspace mutations ──

  /**
   * Create a bookmark in the Hakuneko file. Idempotent.
   *
   * @param {string} pluginEntryId
   * @param {string} title
   * @returns {Promise<{ status: 'ok', pluginEntryId: string } | { status: 'error', message: string }>}
   */
  async createEntry(pluginEntryId, title) {
    const decoded = this._decodeEntryId(pluginEntryId);
    if (!decoded) {
      return { status: 'error', message: `Invalid pluginEntryId: ${pluginEntryId}` };
    }

    const bookmarksRead = await this._readArrayFile(this._bookmarksPath);
    if (!bookmarksRead.ok) {
      return { status: 'error', message: bookmarksRead.message };
    }

    const bookmarks = bookmarksRead.data;
    const exists = bookmarks.some((entry) =>
      this._isValidBookmark(entry)
      && entry.key.connector === decoded.connector
      && entry.key.manga === decoded.mangaKey);

    if (exists) {
      return { status: 'ok', pluginEntryId };
    }

    const mangaTitle = typeof title === 'string' && title.trim() ? title : decoded.mangaKey;
    bookmarks.push({
      title: { connector: this._connectorLabel(decoded.connector), manga: mangaTitle },
      key: { connector: decoded.connector, manga: decoded.mangaKey },
    });

    try {
      await this._writeJsonAtomic(this._bookmarksPath, bookmarks);
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }

    return { status: 'ok', pluginEntryId };
  }

  /**
   * Remove a bookmark and its chaptermark. Idempotent.
   *
   * @param {string} pluginEntryId
   * @returns {Promise<{ status: 'ok', removedBookmark: boolean, removedChaptermark: boolean } | { status: 'error', message: string, retryable: boolean }>}
   */
  async deleteEntry(pluginEntryId) {
    const decoded = this._decodeEntryId(pluginEntryId);
    if (!decoded) {
      return { status: 'ok', removedBookmark: false, removedChaptermark: false };
    }

    const bookmarksRead = await this._readArrayFile(this._bookmarksPath);
    if (!bookmarksRead.ok) {
      return { status: 'error', message: bookmarksRead.message, retryable: false };
    }
    const chaptermarksRead = await this._readArrayFile(this._chaptermarksPath);
    if (!chaptermarksRead.ok) {
      return { status: 'error', message: chaptermarksRead.message, retryable: false };
    }

    const filteredBookmarks = bookmarksRead.data.filter((entry) =>
      !(this._isValidBookmark(entry)
        && entry.key.connector === decoded.connector
        && entry.key.manga === decoded.mangaKey));
    const removedBookmark = filteredBookmarks.length !== bookmarksRead.data.length;

    const filteredChaptermarks = chaptermarksRead.data.filter((cm) =>
      !(cm && cm.mangaID === decoded.mangaKey && cm.connectorID === decoded.connector));
    const removedChaptermark = filteredChaptermarks.length !== chaptermarksRead.data.length;

    try {
      if (removedBookmark) {
        await this._writeJsonAtomic(this._bookmarksPath, filteredBookmarks);
      }
      if (removedChaptermark) {
        await this._writeJsonAtomic(this._chaptermarksPath, filteredChaptermarks);
      }
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error), retryable: false };
    }

    return { status: 'ok', removedBookmark, removedChaptermark };
  }

  // ── Internal helpers ──

  /**
   * @param {string} text
   * @returns {string}
   */
  _sanitize(text) {
    if (this._context && this._context.utils && typeof this._context.utils.sanitizeForSearch === 'function') {
      return this._context.utils.sanitizeForSearch(text);
    }
    // Dependency-free fallback (host always injects context in production).
    if (typeof text !== 'string') return '';
    return text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  /**
   * @param {string} connector
   * @param {string} mangaKey
   * @returns {string}
   */
  _encodeEntryId(connector, mangaKey) {
    return `${connector}::${encodeURIComponent(mangaKey)}`;
  }

  /**
   * @param {string} pluginEntryId
   * @returns {{ connector: string, mangaKey: string } | null}
   */
  _decodeEntryId(pluginEntryId) {
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

  /**
   * @param {string} mangaTitle
   * @returns {string}
   */
  _deriveFolder(mangaTitle) {
    return `${this._downloadBaseDir}/${mangaTitle}/`;
  }

  /**
   * @param {string} folderPath
   * @returns {string}
   */
  _normalizeFolder(folderPath) {
    return String(folderPath || '')
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/\/+$/, '')
      .trim()
      .toLowerCase();
  }

  /**
   * @param {string} connector
   * @returns {string}
   */
  _connectorLabel(connector) {
    return connector === 'mangalist' ? 'Manga List' : connector;
  }

  /**
   * @param {string | number | null | undefined} chapter
   * @returns {string | null}
   */
  _formatChapterTitle(chapter) {
    if (chapter === null || chapter === undefined || chapter === '') return null;
    if (typeof chapter === 'number') return `Chapter ${chapter}`;
    return String(chapter);
  }

  /**
   * @param {unknown} bookmark
   * @returns {boolean}
   */
  _isValidBookmark(bookmark) {
    return Boolean(
      bookmark
      && typeof bookmark === 'object'
      && bookmark.key && typeof bookmark.key === 'object'
      && typeof bookmark.key.manga === 'string'
      && typeof bookmark.key.connector === 'string'
      && bookmark.title && typeof bookmark.title === 'object'
      && typeof bookmark.title.manga === 'string'
      && typeof bookmark.title.connector === 'string',
    );
  }

  /**
   * @param {object[]} chaptermarks
   * @returns {Map<string, object>}
   */
  _indexChaptermarks(chaptermarks) {
    const map = new Map();
    for (const cm of chaptermarks) {
      if (cm && typeof cm.mangaID === 'string' && typeof cm.connectorID === 'string') {
        map.set(`${cm.connectorID}::${cm.mangaID}`, cm);
      }
    }
    return map;
  }

  /**
   * @param {object[]} chaptermarks
   * @param {string} connector
   * @param {string} mangaKey
   * @returns {object | undefined}
   */
  _findChaptermark(chaptermarks, connector, mangaKey) {
    return chaptermarks.find((cm) => cm && cm.mangaID === mangaKey && cm.connectorID === connector);
  }

  /**
   * @param {object} bookmark
   * @param {Map<string, object>} chapterByKey
   * @returns {PluginWorkspaceEntry}
   */
  _buildEntry(bookmark, chapterByKey) {
    const chaptermark = chapterByKey.get(`${bookmark.key.connector}::${bookmark.key.manga}`);
    const chapterTitle = chaptermark && typeof chaptermark.chapterTitle === 'string' ? chaptermark.chapterTitle : null;
    return {
      pluginEntryId: this._encodeEntryId(bookmark.key.connector, bookmark.key.manga),
      fields: {
        mangaTitle: { type: 'text', value: bookmark.title.manga },
        connectorLabel: { type: 'text', value: bookmark.title.connector },
        chapterTitle: { type: 'text', value: chapterTitle },
      },
    };
  }

  /**
   * @param {PluginWorkspaceEntry} entry
   * @param {string} fieldName
   * @returns {unknown}
   */
  _fieldValue(entry, fieldName) {
    return entry && entry.fields && entry.fields[fieldName] ? entry.fields[fieldName].value : undefined;
  }

  /**
   * Read a JSON array file. Distinguishes file-not-found (empty array, not an
   * error) from parse failure (error result, never swallowed).
   *
   * @param {string} filePath
   * @returns {Promise<{ ok: true, data: object[] } | { ok: false, message: string, retryable: boolean }>}
   */
  async _readArrayFile(filePath) {
    if (!filePath) {
      return { ok: true, data: [] };
    }
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { ok: true, data: [] };
      }
      if (error && error.code === 'EISDIR') {
        return { ok: false, message: `${filePath} is a folder, not a file. Point this setting at the hakuneko.bookmarks/hakuneko.chaptermarks JSON file inside it.`, retryable: false };
      }
      return { ok: false, message: `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`, retryable: false };
    }
    try {
      const parsed = JSON.parse(raw);
      return { ok: true, data: Array.isArray(parsed) ? parsed : [] };
    } catch (error) {
      return { ok: false, message: `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`, retryable: false };
    }
  }

  /**
   * Atomic JSON write: write to .tmp then rename.
   *
   * @param {string} filePath
   * @param {unknown} data
   * @returns {Promise<void>}
   */
  async _writeJsonAtomic(filePath, data) {
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmpPath, filePath);
  }

  /**
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
  _levenshtein(a, b) {
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
}

module.exports = HakunekoAdapter;
