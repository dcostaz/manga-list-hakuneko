'use strict';

/**
 * L4: reach. HakuNeko Desktop's two JSON files and the download folder, at the paths each call's grant names
 * (`view.paths`, contract A19: `bookmarksPath`, `chaptermarksPath`, `downloadBaseDir`), never a setting.
 *
 * - `hakuneko.bookmarks`:    [{ title: { connector, manga }, key: { connector, manga } }] — the one list.
 * - `hakuneko.chaptermarks`: [{ mangaID, connectorID, chapterID, chapterTitle }] — the last chapter read per entry.
 * - `hakuneko.mangas.<connector>`: [{ id, title }] — HakuNeko's cached site lists, read where a default install keeps
 *   them, beside the bookmarks file (the folder holding `bookmarksPath`); the plugin reaches nothing else.
 *
 * A file that is missing, a folder, unreadable, not JSON or not an array is `source_error` (A25), never an empty list.
 * The site lists are the exception: they only add to a bookmark, so one that is missing or unreadable is absent.
 * A write is atomic (a temporary file, then a rename) and made once: nothing here retries it (A26).
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { PluginError, resultCapOf } = require('@manga-list/plugin-sdk');

/** @typedef {import('./hakuneko-mapping.cjs').SiteList} SiteList */
/** @typedef {import('./hakuneko-mapping.cjs').SiteListIndex} SiteListIndex */

/** A site list's file name: `hakuneko.mangas.<connector>`, nothing after it (a `.tmp` or `.bak` is not a list). */
const SITE_LIST_FILE = /^hakuneko\.mangas\.([^.]+)$/;

/**
 * @param {string} filePath
 * @returns {Promise<any[]>}
 */
async function readArray(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    const code = error && typeof error === 'object' ? /** @type {any} */ (error).code : '';
    if (code === 'EISDIR') {
      throw new PluginError('source_error', `${filePath} is a folder, not a file. Point this setting at the hakuneko.bookmarks/hakuneko.chaptermarks JSON file inside it.`);
    }
    throw new PluginError('source_error', `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PluginError('source_error', `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new PluginError('source_error', `${filePath} is not a JSON array`);
  }
  return parsed;
}

/**
 * Atomic JSON write: a temporary file, then a rename. A failure is `source_error`.
 * @param {string} filePath
 * @param {unknown} data
 * @returns {Promise<void>}
 */
async function writeArray(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    throw new PluginError('source_error', `Failed to write ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * A site list's entries, or null when the file cannot be read or is not a JSON array: a site list only adds to a
 * bookmark, so its failure is its absence, never an error.
 * @param {string} filePath
 * @returns {Promise<unknown[] | null>}
 */
async function readSiteList(filePath) {
  try {
    /** @type {unknown} */
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The client factory: each call's client reads and writes the files its grant names. The site lists' index is the
 * plugin's own state (§2.5, kept by path): each list is read and indexed once, again only when its modification time
 * or size changes, and a list being indexed is shared by the calls that need it meanwhile.
 * @param {{ settings: Record<string, unknown>, utils: Record<string, any>, indexSiteList: (entries: unknown[]) => SiteListIndex }} deps
 */
function createClient({ settings, utils, indexSiteList }) {
  /** @param {string} text */
  const sanitize = (text) => (utils && typeof utils.sanitizeForSearch === 'function'
    ? utils.sanitizeForSearch(text)
    : (typeof text === 'string' ? text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '') : ''));
  const resultCap = resultCapOf(settings);
  /** @type {Map<string, { stamp: string, list: Promise<SiteList | null> }>} */
  const siteListCache = new Map();

  /**
   * One site list, indexed: the cached index while the file is unchanged; null when it cannot be read.
   * @param {string} filePath @param {string} connector
   * @returns {Promise<SiteList | null>}
   */
  async function siteListAt(filePath, connector) {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      siteListCache.delete(filePath);
      return null;
    }
    if (!stat.isFile()) return null;
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    const cached = siteListCache.get(filePath);
    if (cached && cached.stamp === stamp) return cached.list;
    const list = readSiteList(filePath).then((entries) => (entries ? { connector, byTitle: indexSiteList(entries) } : null));
    siteListCache.set(filePath, { stamp, list });
    return list;
  }

  /**
   * Every site list beside the bookmarks file; none there (or the folder unreadable) is an empty answer, never an
   * error. A list no longer in the folder leaves the index.
   * @param {string} bookmarksPath
   * @returns {Promise<SiteList[]>}
   */
  async function siteLists(bookmarksPath) {
    const dir = path.dirname(bookmarksPath);
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    /** @type {Array<{ filePath: string, connector: string }>} */
    const files = [];
    for (const name of names) {
      const match = SITE_LIST_FILE.exec(name);
      if (match) files.push({ filePath: path.join(dir, name), connector: match[1] });
    }
    const present = new Set(files.map((f) => f.filePath));
    for (const cachedPath of siteListCache.keys()) {
      if (path.dirname(cachedPath) === dir && !present.has(cachedPath)) siteListCache.delete(cachedPath);
    }
    const lists = await Promise.all(files.map((f) => siteListAt(f.filePath, f.connector)));
    return lists.filter((list) => list !== null);
  }

  return (/** @type {{ paths: Record<string, string> | null }} */ view) => {
    const paths = view.paths || {};
    return {
      downloadBaseDir: paths.downloadBaseDir,
      sanitize,
      /** A36: the most hits an `allHits` search answers. */
      resultCap,
      bookmarks: () => readArray(paths.bookmarksPath),
      chaptermarks: () => readArray(paths.chaptermarksPath),
      siteLists: () => siteLists(paths.bookmarksPath),
      writeBookmarks: (/** @type {unknown[]} */ data) => writeArray(paths.bookmarksPath, data),
      writeChaptermarks: (/** @type {unknown[]} */ data) => writeArray(paths.chaptermarksPath, data),
      /** @param {string} folderPath */
      folderExists(folderPath) {
        try {
          return fsSync.existsSync(folderPath) && fsSync.statSync(folderPath).isDirectory();
        } catch {
          return false;
        }
      },
    };
  };
}

/** @typedef {ReturnType<ReturnType<typeof createClient>>} HakunekoClient */

module.exports = { createClient, readArray, writeArray, readSiteList };
