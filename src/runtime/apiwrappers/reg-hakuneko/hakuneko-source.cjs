'use strict';

/**
 * L4: reach. HakuNeko Desktop's two JSON files and the download folder, at the paths each call's grant names
 * (`view.paths`, contract A19: `bookmarksPath`, `chaptermarksPath`, `downloadBaseDir`), never a setting.
 *
 * - `hakuneko.bookmarks`:    [{ title: { connector, manga }, key: { connector, manga } }] — the one list.
 * - `hakuneko.chaptermarks`: [{ mangaID, connectorID, chapterID, chapterTitle }] — the last chapter read per entry.
 *
 * A file that is missing, a folder, unreadable, not JSON or not an array is `source_error` (A25), never an empty list.
 * A write is atomic (a temporary file, then a rename) and made once: nothing here retries it (A26).
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const { PluginError } = require('@manga-list/plugin-sdk');

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
 * The client factory: each call's client reads and writes the files its grant names.
 * @param {{ utils: Record<string, any> }} deps
 */
function createClient({ utils }) {
  /** @param {string} text */
  const sanitize = (text) => (utils && typeof utils.sanitizeForSearch === 'function'
    ? utils.sanitizeForSearch(text)
    : (typeof text === 'string' ? text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '') : ''));
  return (/** @type {{ paths: Record<string, string> | null }} */ view) => {
    const paths = view.paths || {};
    return {
      downloadBaseDir: paths.downloadBaseDir,
      sanitize,
      bookmarks: () => readArray(paths.bookmarksPath),
      chaptermarks: () => readArray(paths.chaptermarksPath),
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

module.exports = { createClient, readArray, writeArray };
