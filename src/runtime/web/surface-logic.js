/*
 * HakuNeko workspace surface — pure logic, no DOM.
 *
 * UMD so the same file loads as a classic <script> in the plugin iframe (attaching
 * window.HakunekoSurfaceLogic) AND as a CommonJS module in node --test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HakunekoSurfaceLogic = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SORT_FIELDS = ['mangaTitle', 'connectorLabel'];
  var PAGE_SIZE = 50;

  /** Flatten a PluginWorkspaceEntry ({ pluginEntryId, fields: { name: { value } } }). */
  function flattenEntry(entry) {
    var fields = (entry && entry.fields) || {};
    function v(name) {
      return fields[name] && Object.prototype.hasOwnProperty.call(fields[name], 'value')
        ? fields[name].value
        : null;
    }
    return {
      pluginEntryId: entry && entry.pluginEntryId ? String(entry.pluginEntryId) : '',
      mangaTitle: v('mangaTitle') || '(untitled)',
      connectorLabel: v('connectorLabel') || '',
      chapterTitle: v('chapterTitle') || null,
      // detail-only (getEntry) — absent on list rows
      folderPath: typeof v('folderPath') === 'string' ? v('folderPath') : null,
      folderMatch: v('folderMatch') === 'present' ? true : (v('folderMatch') === 'missing' ? false : null)
    };
  }

  /**
   * Build the { filters, pagination } payload for mangalist.getOwnEntries(). HakuNeko's
   * listEntries understands a `search` filter and sorts by mangaTitle / connectorLabel (a
   * leading '-' means descending).
   *
   * @param {{ search?: string, sort?: string, sortDesc?: boolean, page?: number }} ui
   */
  function buildListRequest(ui) {
    ui = ui || {};
    var filters = {};
    if (typeof ui.search === 'string' && ui.search.trim()) filters.search = ui.search.trim();

    var sort = SORT_FIELDS.indexOf(ui.sort) !== -1 ? ui.sort : 'mangaTitle';
    var page = Number.isInteger(ui.page) && ui.page > 0 ? ui.page : 1;

    return {
      filters: filters,
      pagination: {
        page: page,
        pageSize: PAGE_SIZE,
        sort: ui.sortDesc ? '-' + sort : sort
      }
    };
  }

  /**
   * Given a get-info result row, decide what the surface may offer. `success: true` = linked.
   * @param {{ success?: boolean } | null | undefined} infoRow
   */
  function linkActionsFor(infoRow) {
    var linked = !!(infoRow && infoRow.success === true);
    return { linked: linked, canBookmark: !linked, canFind: linked };
  }

  /** Build a file:// URL for the local series folder, or null. */
  function folderUrl(folderPath) {
    if (typeof folderPath !== 'string' || !folderPath) return null;
    var p = folderPath.replace(/\\/g, '/');
    if (!/\/$/.test(p)) p += '/';
    return 'file:///' + p.replace(/^\/+/, '');
  }

  /** Total page count from a PluginEntryPage-shaped result. */
  function pageCount(page) {
    var total = page && Number.isFinite(page.totalCount) ? page.totalCount : 0;
    var size = page && Number.isFinite(page.pageSize) && page.pageSize > 0 ? page.pageSize : PAGE_SIZE;
    return Math.max(1, Math.ceil(total / size));
  }

  return {
    PAGE_SIZE: PAGE_SIZE,
    SORT_FIELDS: SORT_FIELDS.slice(),
    flattenEntry: flattenEntry,
    buildListRequest: buildListRequest,
    linkActionsFor: linkActionsFor,
    folderUrl: folderUrl,
    pageCount: pageCount
  };
}));
