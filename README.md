# manga-list-hakuneko

Runtime `pluginType: "adapter"` plugin for [manga-list](https://github.com/dcostaz/manga-list)
that integrates with [Hakuneko Desktop](https://hakuneko.download/) bookmark files.

Hakuneko declares the `tracker.file` capability (bidirectional file-based progress
sync): there is no remote API. The plugin reads and writes Hakuneko's
`hakuneko.bookmarks` and `hakuneko.chaptermarks` JSON files directly. The per-user
file paths configured in plugin settings are the user-association mechanism — no
credentials are required. Capability names are type-neutral — `tracker.file` does
not require `pluginType: "tracker"`; see the loader's `_validateCapabilities()`,
which enforces no such coupling.

## Capabilities

- `tracker.file` — bidirectional file sync (`pullProgress` / `pushProgress`)
- `workspace.list` — paginated bookmark workspace (`listEntries`)
- `workspace.get` — entry detail (`getEntry`)

## Data model

| File | Shape |
| --- | --- |
| bookmarks | `{ title: { connector, manga }, key: { connector, manga } }` |
| chaptermarks | `{ mangaID, connectorID, chapterID, chapterTitle }` |

- A chaptermark links to a bookmark via `mangaID === key.manga` **and** `connectorID === key.connector`.
- `pluginEntryId` = `` `${key.connector}::${encodeURIComponent(key.manga)}` ``
- Folder derivation = `{downloadBaseDir}/{title.manga}/`

Linking is **folder-based and binary**: `findMatches(folderPath)` returns a single
candidate at `confidence: 1.0` on an exact (case-normalised) folder match, an empty
array on no match, or `{ error: 'duplicate_folder', candidates }` when two bookmarks
derive the same folder. `search()` is a separate title-search surface (3-tier exact →
partial → fuzzy) used only by the workspace, never for linking.

## Settings

Three per-user fields (`hakuneko-plugin-settings.json`):

- `downloadBaseDir` — shared manga base directory
- `bookmarksPath` — full path to `hakuneko.bookmarks`
- `chaptermarksPath` — full path to `hakuneko.chaptermarks`

## Build

```sh
npm install
npm run build      # produces dist/hakuneko-adapter-1.0.0.zip
npm test           # node --test tests/unit/*.test.cjs
```

Install the resulting zip into manga-list via `plugin-operation/registry/install`.

## License

MIT
