# Manga Hub
A local Windows desktop tracker and chapter reader for manga, manhwa, and manhua.

**Note:** Manga Hub requires **[Node.js 22.13+](https://nodejs.org/)** installed on your PC. Ready-to-run Windows packages are on the **[latest release](../../releases/latest)** page.

<p align="center">
  <img src="client/public/icon.svg" width="96" height="96" alt="Manga Hub" />
</p>

Manga Hub currently includes:
- **Unified Library & Tracker:** Track reading status, unread chapter counts, and exact scroll position across sources, with recent releases (< 1 week old) highlighted and sorted first.
- **Multi-Source Browse & Search:** Browse latest updates or search across sources from one view with tag, format (`Manhwa`, `Manga`, `Manhua`), status, creator, and minimum-chapter filters.
- **Built-In Reader:** Vertical long-strip, single-page, and double-page (RTL) modes with keyboard navigation (`←`/`→`, `F` fullscreen, `M` mode cycle, `Esc` return) and local image caching.
- **Local SQLite Storage:** All bookmarks, chapters, and reading progress stay in `data/manga.db` on your machine, with one-click JSON export and import.

### [Download Latest Release](../../releases/latest)
1. Download **`MangaHub-v1.0.0-win64.zip`** from **[Releases](../../releases/latest)**.
2. Extract the full folder anywhere on your PC and double-click **`MangaHub.exe`** (no terminal commands or `npm install` needed).
   *(Note: Windows SmartScreen may show a warning on first launch because the executable is self-signed rather than signed by a paid commercial certificate—click **More info → Run anyway**.)*

### Building from Source
To build the portable release package from a local clone:
```powershell
npm install
npm run build:exe
```

---

## Frequently asked questions

### Where is my library saved?
Everything is stored locally inside the `data/` folder next to `MangaHub.exe` (`data/manga.db` for your library and `data/img-cache/` for cached chapter pages). When updating to a newer release, keep your `data/` folder or export a `.json` backup from **Preferences**.

### Why does a source say it is blocked by a challenge?
Some scanlation sites enable temporary Cloudflare browser challenges. When that happens, Manga Hub pauses automated requests to that domain for 15 minutes and lets you open the chapter directly in your browser with the **↗** button.

### Why are only primary sources shown as filter pills in Browse?
To keep the filter bar clean, primary sources appear as individual pills while secondary sources are queried automatically whenever **All sources** is selected. You can toggle this anytime in **Preferences**.

### I found a broken source or bug. Where do I report it?
Open an issue on the **[Issues](../../issues)** tab with the source name and series title.
