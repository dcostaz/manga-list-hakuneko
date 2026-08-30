'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const L = require(path.join(
  __dirname, '..', '..', 'src', 'runtime', 'web', 'surface-logic.js',
));

test('flattenEntry - unwraps list-row fields', () => {
  const flat = L.flattenEntry({
    pluginEntryId: 'manhuaus::%2Fmanga%2Fx%2F',
    fields: {
      mangaTitle: { type: 'text', value: 'Legend of Star General' },
      connectorLabel: { type: 'text', value: 'ManhuaUS' },
      chapterTitle: { type: 'text', value: 'Chapter 400' },
    },
  });
  assert.equal(flat.mangaTitle, 'Legend of Star General');
  assert.equal(flat.connectorLabel, 'ManhuaUS');
  assert.equal(flat.chapterTitle, 'Chapter 400');
  assert.equal(flat.folderPath, null, 'detail-only fields are absent on list rows');
  assert.equal(flat.folderMatch, null);
});

test('flattenEntry - detail row exposes folderPath + folderMatch boolean', () => {
  const present = L.flattenEntry({
    pluginEntryId: 'a', fields: {
      mangaTitle: { value: 'X' },
      folderPath: { type: 'text', value: '/manga/X/' },
      folderMatch: { type: 'status', value: 'present' },
    },
  });
  assert.equal(present.folderPath, '/manga/X/');
  assert.equal(present.folderMatch, true);

  const missing = L.flattenEntry({ pluginEntryId: 'a', fields: { folderMatch: { value: 'missing' } } });
  assert.equal(missing.folderMatch, false);
});

test('flattenEntry - safe defaults for a bare entry', () => {
  const flat = L.flattenEntry({ pluginEntryId: 'a', fields: {} });
  assert.equal(flat.mangaTitle, '(untitled)');
  assert.equal(flat.connectorLabel, '');
  assert.equal(flat.chapterTitle, null);
});

test('buildListRequest - search + sort (leading - for descending), default page 1', () => {
  const req = L.buildListRequest({ search: '  luffy ', sort: 'connectorLabel', sortDesc: true });
  assert.deepEqual(req.filters, { search: 'luffy' });
  assert.equal(req.pagination.page, 1);
  assert.equal(req.pagination.pageSize, L.PAGE_SIZE);
  assert.equal(req.pagination.sort, '-connectorLabel');
});

test('buildListRequest - drops empty search / unknown sort', () => {
  const req = L.buildListRequest({ search: '   ', sort: 'nope', page: 4 });
  assert.deepEqual(req.filters, {});
  assert.equal(req.pagination.page, 4);
  assert.equal(req.pagination.sort, 'mangaTitle');
});

test('linkActionsFor - success:true = linked (find, no bookmark); else not linked (bookmark)', () => {
  assert.deepEqual(L.linkActionsFor({ success: true }), { linked: true, canBookmark: false, canFind: true });
  assert.deepEqual(L.linkActionsFor({ success: false }), { linked: false, canBookmark: true, canFind: false });
  assert.deepEqual(L.linkActionsFor(null), { linked: false, canBookmark: true, canFind: false });
});

test('folderUrl - builds a file:/// URL, normalises separators + trailing slash', () => {
  assert.equal(L.folderUrl('C:\\manga\\One Piece'), 'file:///C:/manga/One Piece/');
  assert.equal(L.folderUrl('/mnt/manga/One Piece/'), 'file:///mnt/manga/One Piece/');
  assert.equal(L.folderUrl(''), null);
  assert.equal(L.folderUrl(null), null);
});

test('pageCount - ceil(total / pageSize), never below 1', () => {
  assert.equal(L.pageCount({ totalCount: 0 }), 1);
  assert.equal(L.pageCount({ totalCount: 50, pageSize: 50 }), 1);
  assert.equal(L.pageCount({ totalCount: 51, pageSize: 50 }), 2);
});
