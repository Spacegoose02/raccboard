# 🦝 Rackboard

A self-hosted Kanban board for lists, lists of lists, and room-by-room house projects.
Runs as a single Node process with a single SQLite file, so it is easy to back up and easy to run on a home server.

> "Rackboard" is a working name. To rename it, change `APP_NAME` in `client/src/config.js`, the `<title>` in `client/index.html`, and `name` in `package.json`.

## Features

- **Boards**: home screen with board tiles, create, rename, archive and restore. **Complete board** moves a board to a Completed section.
- **Lists**: add, rename, drag to reorder, collapse to a slim column, archive, optional due date.
- **Cards**: add, drag within and between lists (positions saved server-side in one transaction), completion circle, archive, start and due dates shown as badges (overdue in red, due within 24 hours in yellow).
- **Card detail**:
  - title with a completion circle
  - Labels, Dates, Checklist and Attachment buttons
  - Markdown description with Write/Preview tabs and Save/Cancel (GitHub-flavored: tables, task lists, links)
  - **multiple named checklists (sublists)** with a progress bar, hide checked items, and an optional due date per item
  - attachments: upload with the button or drag files onto the card, then download or delete
  - **Comments and activity** panel: a comment box plus an activity log (card created, moved, completed, labels, dates, checklist items, attachments)
- **Card face**: label chips, dates, checklist progress, comment and attachment counts.
- **Labels as custom statuses**: each board starts with *In progress*, *Cancelled*, *Future* and *Done*. You can rename, recolor, add or delete them.
- **Archived items** drawer on each board, where you can restore or permanently delete lists and cards.
- **Settings in one place**: your display name, theme, and per-board settings (rename, color, label editor, complete/archive/delete). Open them from the board with **⚙ Board settings**.
- **Due dates everywhere**: on cards, lists and checklists (sublists), and on individual checklist items. The card face shows the next sublist due date.
- **Themes**: Charcoal (default dark), Light, Midnight, Raccoon gray, Forest, Solarized and Dracula.
- **Phones and tablets**:
  - lists swipe sideways with snap
  - long-press a card to drag it (drag to the screen edge to scroll to other lists)
  - the card view goes full screen with comments below
  - popovers open as bottom sheets, and tap targets are at least 40 px
- **Installable**: it is a PWA (web manifest, app-shell service worker, icons). There is also an Android APK, see [Mobile](#mobile).

## Quick start (development)

Requires Node 22 or newer.

```bash
npm install
npm run dev
```

- Vite dev server: http://localhost:5173 (it proxies `/api` to the API)
- API server: http://localhost:3000 (it restarts automatically when you change files)

## Production (without Docker)

```bash
npm install
npm run build
npm start
```

Open http://localhost:3000. One process serves both the built client and the API.

| Variable        | Default  | Purpose                                  |
| --------------- | -------- | ---------------------------------------- |
| `PORT`          | `3000`   | HTTP port                                |
| `DATA_DIR`      | `./data` | Where the SQLite database and uploads go |
| `MAX_UPLOAD_MB` | `25`     | Maximum attachment size                  |
| `CORS_ORIGIN`   | `*`      | Allowed origin for cross-origin API use  |

Smoke test against a running server: `npm run smoke` (or `node scripts/smoke.js http://host:port`). It creates a temporary board, exercises the API, and then deletes the board.

## Docker

```bash
docker compose up -d --build
```

Or without Compose:

```bash
docker build -t rackboard .
docker run -d --name rackboard -p 3000:3000 -v /path/to/rackboard-data:/data --restart unless-stopped rackboard
```

The image is `node:22-slim`, exposes port 3000, declares `VOLUME /data`, and has a health check at `/api/health`.

### Unraid

There is no PUID/PGID setup. The container runs as the image's `node` user, and everything it stores lives under `/data`.

1. **Docker → Add Container**, Repository: `rackboard:latest` (or your registry tag once images are published).
2. Add a **Path**: Container path `/data` → Host path `/mnt/user/appdata/rackboard`.
3. Add a **Port**: Container `3000` → Host `3000` (or any free port).
4. Optional variables: `TZ`, `MAX_UPLOAD_MB`.

If the appdata folder was created by root and the container cannot write to it, run `chown -R 1000:1000 /mnt/user/appdata/rackboard` once.

### Backups

Copy the `data/` folder: it holds `rackboard.db` (plus WAL files) and `uploads/`. For a hot backup, run `sqlite3 rackboard.db ".backup backup.db"`.

## Mobile

### Install from the browser (PWA)

Open the site on your phone and choose **Install app** or **Add to Home screen**. Chrome only offers a full install over HTTPS (or on localhost). On plain `http://192.168.x.x` you get a home-screen shortcut instead. If you want the full install, put Rackboard behind a reverse proxy with a certificate (for example Nginx Proxy Manager, Caddy or Tailscale). Otherwise use the APK.

### Android APK

The `android/` folder is a [Capacitor](https://capacitorjs.com) project that bundles the web app. On first launch it asks for your server address (for example `http://192.168.1.50:3000`), checks `/api/health`, and remembers the address. You can change it later in **Settings → Server**. Plain-HTTP LAN servers are allowed.

Build it locally. This needs **JDK 21** and the Android SDK, with `ANDROID_HOME` set:

```bash
npm run android:apk
```

The debug APK is written to `release/Rackboard-<version>-debug.apk`. To sideload it, copy it to the phone and open it (allow "install unknown apps" for your file manager). `npm run android:open` opens the project in Android Studio.

You can also build it in GitHub Actions: run the **Android APK** workflow manually or push a `v*` tag, then download the APK from the run's artifacts.

`npm run icons` regenerates the PWA icons, Android launcher icons and splash screens from `scripts/icons.js`.

The API allows cross-origin requests so the app can reach it. `CORS_ORIGIN` (default `*`) narrows this down.

## Project layout

```
server/        Express 5 API + SQLite (better-sqlite3), versioned migrations in db.js
client/        React 19 + Vite app (dnd-kit for drag and drop, react-markdown)
android/       Capacitor Android project (APK)
scripts/       smoke test, icon generator, APK build
```

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

MIT
