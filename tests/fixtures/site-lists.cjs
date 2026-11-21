'use strict';

/**
 * HakuNeko's site lists (`hakuneko.mangas.<connector>`: [{ id, title }], the format of the files HakuNeko Desktop
 * caches in its data folder), written beside the bookmarks file by the tests. Against the tests' bookmarks:
 *
 * - `manganel` keys by full URL: One Piece and Legend of Star General (its title with other case, punctuation and
 *   spacing) give links; a series no bookmark holds is never a result.
 * - `readm` keys by site path: One Piece is listed there, but a path gives no link. An entry with an empty title (as
 *   HakuNeko caches some) names nothing.
 * - `mangadex` and `manhuaus` hold One Piece and Legend of Star General under URLs, but each is that bookmark's own
 *   connector, left out.
 * - `broken` is not JSON and `manganel.tmp` is not a list file: both are ignored.
 */

const SITE_LISTS = {
  manganel: [
    { id: 'https://chapmanganelo.com/manga-op1', title: 'One Piece' },
    { id: 'https://chapmanganelo.com/manga-lsg', title: 'LEGEND  of Star-General!' },
    { id: 'https://chapmanganelo.com/manga-only', title: 'Only On A Site List' },
  ],
  readm: [
    { id: '/manga/one-piece', title: 'ONE PIECE' },
    { id: '/manga/blank', title: '' },
  ],
  mangadex: [
    { id: 'https://mangadex.org/title/other-one-piece', title: 'One Piece' },
  ],
  manhuaus: [
    { id: 'https://manhuaus.com/manga/legend-of-star-general/', title: 'Legend of Star General' },
  ],
};

/** Files beside the bookmarks that are not a readable site list. */
const NOT_LISTS = {
  'hakuneko.mangas.broken': '{ not json',
  'hakuneko.mangas.manganel.tmp': JSON.stringify([{ id: 'https://chapmanganelo.com/manga-tmp', title: 'One Piece' }]),
};

module.exports = { SITE_LISTS, NOT_LISTS };
