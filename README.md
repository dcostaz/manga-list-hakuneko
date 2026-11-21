# manga-list-hakuneko

An adapter plugin for [manga-list](https://github.com/dcostaz/manga-list) over
[HakuNeko Desktop](https://hakuneko.download/)'s bookmark files, built on
[`@manga-list/plugin-sdk`](https://github.com/dcostaz/manga-list-plugin-sdk), contract **4.4.0**.

HakuNeko has no remote API: the plugin reads and writes its `hakuneko.bookmarks` and `hakuneko.chaptermarks` JSON files
directly. The files' paths are the access grant, sent by the host with each call; no credential is involved. The
plugin reads only its three granted paths (`bookmarksPath`, `chaptermarksPath`, `downloadBaseDir`) and nothing else of
HakuNeko's: its cached site lists (`hakuneko.mangas.<connector>`) are not part of the source.

**What 4.4.0 changed** (manga-list's Tracker Search): each search candidate carries its record, `detail` (A32): the
bookmark's title, its site (connector id and label, the series key as the site's `path`, or a link when the key is a
full URL), the last chapter read, and the download folder and whether it exists. `search(query, { allHits: true })`
answers every matching bookmark up to the `search.resultCap` setting (A35, A36); without it, the answer is the one it
always was. The candidates are the bookmarks (A38).

## The plugin

```
src/runtime/apiwrappers/reg-hakuneko/
  hakuneko-source.cjs     L4  reach: the two files at the call's paths; atomic writes; unreadable → source_error
  hakuneko-mapping.cjs    L3b map: ids, the chapter parse, the contract's shapes, the workspace's fields
  hakuneko-plugin.cjs     L3a declare and bind: definePlugin({ manifest, settings, createClient, methods })
  plugin-package.json     the manifest
  hakuneko-plugin-settings.json  the settings document { metadata, schema, settings }
src/runtime/web/          the workspace surface (contract §4)
```

| Declared | Method | |
| --- | --- | --- |
| `file-path` | — | `downloadBaseDir`, `bookmarksPath`, `chaptermarksPath` arrive in each call (`filePathOptions.fields`); never read from settings. |
| `search.query` | `search` | Candidates over the bookmarks, best first: exact title 1.0, containment 0.70–0.95, fuzzy 0.70–0.85; up to `options.limit` (10), or with `allHits` every match up to `search.resultCap`. Each carries `detail`: title, site, last chapter read, folder; a full-URL key as its one link. No `search.lookup`: a bookmark's record is all HakuNeko holds. |
| `enrich` | `enrich` | Identity, connector, the derived folder, the last chapter read. |
| `sync.pull` | `pullProgress` | On the list: `status: 'bookmarks'` and the chaptermark's chapter; off it, every field null. |
| `sync.push` | `pushProgress` | The chapter axis only; one atomic write per batch, made once; never creates a bookmark. |
| `sync.list`, `watch.list` | `getReadingList` | Every bookmark, `status: 'bookmarks'`, the chapter parsed in the plugin, `altTitles: null` (a bookmark has one title). The bookmarks file is the source's whole holding: `watchOptions.wholeHolding: true`. |
| `subscribe.add` | `subscribe` | Join List: a bookmark row's presence is membership; a present row is confirmed, a missing one created. |
| `subscribe.remove` | `unsubscribe` | Leave List, `subscribe`'s inverse: every row of the entry dropped in one atomic write; an absent entry is already removed. |
| `watch.summary` | `summarizeEntries` | A bookmark's label; a missing one is `not_found` ("Missing from Hakuneko bookmarks"). |
| `workspace.entry` | `listEntries`, `getEntry` | The surface's own-data reads (contract §5.4). |

The manifest's status vocabulary pushes every host status to the one `bookmarks` list and pulls it as no status (a
membership-only list, contract §2.2). A file that is missing, a folder, not JSON or not an array is `source_error`,
never an empty answer.

## Data model

| File | Shape |
| --- | --- |
| bookmarks | `{ title: { connector, manga }, key: { connector, manga } }` |
| chaptermarks | `{ mangaID, connectorID, chapterID, chapterTitle }` |

- A chaptermark belongs to a bookmark when `mangaID === key.manga` **and** `connectorID === key.connector`.
- `pluginEntryId` = `` `${key.connector}::${encodeURIComponent(key.manga)}` ``
- The folder: `{downloadBaseDir}/{title.manga}/`

## Settings

`downloadBaseDir`, `bookmarksPath` and `chaptermarksPath` (`HakunekoSettings`), the system's with a per-user override.
The host resolves them for the side of each call and sends them as the path grant.

`search.resultCap` (number, 1–25, 25 by default): how many bookmarks a search answers when Tracker Search asks for
every match (`allHits`).

## Build and test

```sh
npm ci
npm test           # node --test; the SDK's contract suite with the adapter cases among them
npm run typecheck  # tsc --noEmit
npm run build      # dist/hakuneko-adapter-<contract>-<commit>.zip
```

`tests/fixtures/golden-4.0.*` hold what the `adapter-4.0-final` adapter wrote for `golden-input.cjs`; a push and a
Join List must write the same bytes. The zip never bundles the SDK: the host stages its own copy.

## License

MIT
