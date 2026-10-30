# 🦝 Raccboard

A self-hosted Kanban board for lists, lists of lists, and room-by-room house projects.
Runs as a single Node process with a single SQLite file, so it is easy to back up and easy to run on a home server.

> **About the name:** the app is called **Raccboard** (formerly Rackboard). Some technical identifiers deliberately still say `rackboard` so existing installs keep working: the GitHub repo, the Docker image `ghcr.io/spacegoose02/rackboard`, the database file `rackboard.db`, the Android package id `app.rackboard`, browser storage keys, and calendar event IDs.

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
- **Three views per board** (top of the board): **Board**, **List** (a sortable, searchable table) and **Calendar** (a month view of cards, sublists, checklist items and lists; drag an entry to another day to reschedule it). **📅 Calendar** in the top bar shows every board at once.
- **Card covers**: a color band or one of the card's images on top of the card (🖼 Cover in the card, or **Make cover** on an image attachment).
- **Search and filters**: search titles and descriptions, and filter by label, due date (overdue, next 24 hours, this week, none, not complete) and member.
- **Keyboard shortcuts**: `/` search, `n` new card, `q` my cards, `x` clear filters, `b`/`l`/`c` switch views, `?` show them all.
- **Copy cards and card templates**: copy a card to any list (choose what to keep). Mark a card as a template, then use **+ New card from …** in a list's ⋯ menu.
- **Board templates and copies**: start from Simple Kanban, **Homeboard** (house projects by room), Weekly planner or Project tracker, or copy an existing board with its lists, cards and rules.
- **⚡ Automation** (like Trello's Butler): rules such as *when a card is moved to "Done", mark it complete* or *when every checklist item is done, add label "Ready"*. Triggers are card added, moved, completed or checklist finished, optionally in one list. Actions are complete, incomplete, archive, move, add or remove a label, add the person, set or remove the due date.
- **Import from Trello**: on the home screen, upload a board's JSON export (Trello: board menu → Print, export and share → Export as JSON). Lists, cards, labels, covers, dates, checklists and comments come across, and attachment links are added to the description.
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
| `BACKUP_HOURS`  | `24`     | How often the database is backed up to `DATA_DIR/backups` (`0` turns it off) |
| `BACKUP_KEEP`   | `7`      | How many backups to keep |
| `MAX_UPLOAD_MB` | `25`     | Maximum attachment size                  |
| `CORS_ORIGIN`   | `*`      | Allowed origin for cross-origin API use  |
| `ALLOW_SIGNUP`  | `false`  | Let anyone create an account from the sign-in page |
| `TRUST_PROXY`   | (unset)  | Set to `true` behind a reverse proxy so HTTPS is detected (secure cookies) |
| `PUBLIC_URL`    | (unset)  | Public base URL, e.g. `https://kanban.example.com` (used for the OIDC callback) |

See [Accounts and sign-in](#accounts-and-sign-in) for the `OIDC_*` variables.

Smoke test against a running server: `npm run smoke` (or `node scripts/smoke.js http://host:port`). It creates a temporary board, exercises the API, and then deletes the board. On a fresh server it creates the first admin account (`smoke`). On an existing one, set `SMOKE_USER` and `SMOKE_PASSWORD` to an admin account.

## Docker

Images are published to GitHub Container Registry for `linux/amd64` and `linux/arm64`:

| Tag | Meaning |
| --- | --- |
| `ghcr.io/spacegoose02/rackboard:latest` | Latest build of `main` |
| `:1.0.0`, `:1.0`, `:1` | Releases |
| `:sha-abc1234` | A specific commit |

```bash
docker run -d --name rackboard -p 3000:3000 -v /path/to/rackboard-data:/data -e TZ=America/New_York \
  --restart unless-stopped ghcr.io/spacegoose02/rackboard:latest
```

Or use Compose: `docker compose up -d` with the included `docker-compose.yml`. To build from source instead, run `docker compose up -d --build`.

The image is based on `node:22-slim`. It exposes port 3000, declares `VOLUME /data`, and has a health check at `/api/health`.

**Permissions (PUID/PGID):** the container starts as root only long enough to give `/data` to `PUID:PGID`, then runs Raccboard as that user. The defaults are `99:100` (Unraid's `nobody:users`). On other systems set them to your user, e.g. `-e PUID=1000 -e PGID=1000`. If you start the container with `--user`, it skips this step and runs as that user.

### Unraid

**With the template (easiest):** in Unraid, open **Docker → Add Container**, set **Template** to empty, and paste this into **Template repositories** under Docker settings (or save the file to `/boot/config/plugins/dockerMan/templates-user/`):

```
https://raw.githubusercontent.com/Spacegoose02/rackboard/main/unraid/rackboard.xml
```

Then choose **rackboard** from the template list. It fills in the image, port 3000, `/mnt/user/appdata/rackboard`, PUID 99 / PGID 100, TZ, and optional fields for PUBLIC_URL, OIDC and Google Calendar.

**By hand:** **Docker → Add Container**:
- Repository: `ghcr.io/spacegoose02/rackboard:latest`
- Path: Container `/data` → Host `/mnt/user/appdata/rackboard`
- Port: Container `3000` → any free host port
- Optional variables: `TZ`, `PUBLIC_URL`, and the rest from the tables above

No manual `chown` is needed: the container fixes the appdata folder's ownership on start.

### Backups

Copy the `data/` folder: it holds `rackboard.db` (plus WAL files) and `uploads/`. For a hot backup, run `sqlite3 rackboard.db ".backup backup.db"`.

## Accounts and sign-in

On first start, Raccboard asks you to create the first account, which becomes the **admin**. Existing boards from before accounts are kept. Admins add everyone else in **Settings → Users**, or turn on `ALLOW_SIGNUP=true` so people can sign up themselves.

Everyone has a profile with a display name, email, and avatar: one of 12 raccoons, an uploaded photo, or initials. Comments and activity show who did what. Passwords are hashed with scrypt. Sessions last 30 days and renew with use. In the browser the session is an HttpOnly cookie; the Android app uses a bearer token. Changing your password signs out your other devices.

### Forgot password

Once email is set up (Settings → Email), the sign-in page shows **Forgot password?**. People enter their username or email and get a one-time link that works for 30 minutes. Using it signs them out everywhere else. Accounts without an email address still need an admin or the recovery CLI below.

### Security notes

- Passwords are hashed with scrypt; sessions and reset links are stored only as SHA-256 hashes.
- Sign-in is throttled per IP and username (10 failures / 15 min) and per IP (50 / 15 min).
- The web app sends a strict Content-Security-Policy, `X-Frame-Options: DENY` and `nosniff`. Uploaded files that a browser could run (HTML, SVG…) are always downloaded, never shown inline.
- Cookie-authenticated changes from another site are refused. Put Raccboard behind HTTPS and set `TRUST_PROXY=true` so cookies are marked `Secure`.
- Non-admins can't see other people's email addresses.

### Locked out? Reset a password from the server

Your **username** is what you type to sign in; it's lowercase and separate from your display name. Change your own in **Settings → Profile**. Admins can change anyone's username or reset their password in **Settings → Users**. If no admin can sign in, use the recovery command inside the container. On Unraid: Docker tab → Raccboard icon → **Console**, or from any shell:

```bash
docker exec -it rackboard node server/cli.js list-users
docker exec -it rackboard node server/cli.js reset-password <username> '<new password>'
docker exec -it rackboard node server/cli.js make-admin <username>
docker exec -it rackboard node server/cli.js rename-user <old-username> <new-username>
```

It works while Raccboard is running, signs that user out everywhere, and keeps `/data` owned by `PUID:PGID`. Without Docker, run `node server/cli.js …` in the app folder with the same `DATA_DIR`.

### Sharing, teams and card members

Boards are private to their owner until shared. Use **👪 Share** on a board, or **Settings → Boards & labels**, to share with a person or a whole team:

- **Viewer**: can read and comment
- **Editor**: can also add, edit, move and archive lists and cards
- **Co-owner**: can also rename, share, complete, archive and delete the board

Create teams (a household, a family, a crew) in **Settings → Teams & families**. Sharing a board with a team gives every member access, including people added to the team later.

On a card, **Members** adds people who can open the board, and **Join** adds yourself. Members' avatars show on the card face. The board's filter bar narrows the board to selected people or **My cards**.

Boards created before accounts existed belong to the first admin.

### Single sign-on (OIDC)

Works with Authentik, Authelia, Keycloak, Google, Microsoft and any other OpenID Connect provider. Create a confidential client with the redirect URI `https://<your-rackboard>/api/auth/oidc/callback`, then set:

| Variable             | Purpose |
| -------------------- | ------- |
| `OIDC_ISSUER`        | Issuer URL, e.g. `https://auth.example.com/application/o/rackboard/` |
| `OIDC_CLIENT_ID`     | Client ID |
| `OIDC_CLIENT_SECRET` | Client secret (leave empty for a public PKCE client) |
| `OIDC_NAME`          | Button label, e.g. `Authentik` (default "Single sign-on") |
| `OIDC_REDIRECT_URI`  | Override the callback URL (default `PUBLIC_URL` + `/api/auth/oidc/callback`, or the request's host) |
| `OIDC_SCOPES`        | Default `openid profile email` |
| `OIDC_AUTO_CREATE`   | `true` (default): first sign-in creates an account. `false`: only already-linked accounts can sign in |
| `OIDC_LINK_BY_EMAIL` | `true` (default): link to an existing local account that has the same **verified** email |

OIDC sign-in uses the browser (web and PWA). To use the Android app with an SSO account, set a password in **Settings → Profile** and sign in with that.

`npm run smoke:oidc` runs the whole OIDC flow against a built-in mock identity provider.

## Calendars

Settings → **Calendar** offers three ways to see your dates outside Raccboard, from simplest to most automatic:

1. **Add to calendar** on any card with a due date: opens a prefilled Google Calendar event, or downloads an `.ics` file for Apple Calendar or Outlook.
2. **Calendar feed**: a private `.ics` link with everything dated on the boards you can open. Subscribe to it from Google Calendar (*Other calendars → From URL*), Apple Calendar or Outlook. Google can only reach the feed if your server is reachable from the internet, and refreshes it every few hours. **Reset link** stops the old URL from working.
3. **Google Calendar sync**: pushes dates from boards you pick into a Google calendar you pick, within seconds of a change. It's one-way (Raccboard → Google), and there's a full re-check every 10 minutes. Cards with a start date become multi-day all-day events; timed due dates become 30-minute events; sublists and checklist items get their own events.

To turn on Google sync, an admin creates an OAuth client in Google Cloud:
1. In Google Cloud Console, create a project and enable the **Google Calendar API**.
2. On the **OAuth consent screen**, choose External and add yourself (and family) as test users, or publish the app.
3. Under **Credentials → Create credentials → OAuth client ID**, choose **Web application**. Add the redirect URI `https://<your-rackboard>/api/google/callback`. Google only accepts `https` addresses or `http://localhost`, so a LAN-only server needs a hostname with HTTPS (e.g. via a reverse proxy or Tailscale).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `PUBLIC_URL` (or `GOOGLE_REDIRECT_URI`) and restart. Each person then clicks **Connect Google Calendar** in Settings.

Event times use the server's time zone (`TZ`). `npm run smoke:google` runs the whole connect-and-sync flow against a built-in mock of Google's APIs.

## Email

**✉ Email** at the top of any card sends a formatted copy to one or more addresses. You can add a note and choose people from the board. The email includes the description, labels, members, checklists, a calendar file (`.ics`) for the card's dates, a link back to the card (when `PUBLIC_URL` is set), and optionally the card's attachments (up to `EMAIL_ATTACHMENT_MB`, default 10). Replies go to the sender's profile email, and the card's activity records who it went to.

An admin sets up the mail server in **Settings → Email**, or with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` and `SMTP_SECURE`. **Send test** checks the settings. For Gmail, use `smtp.gmail.com`, port 587 and an app password. `npm run smoke:email` checks the whole flow against a built-in mock mail server.

## Mobile

### Install from the browser (PWA)

Open the site on your phone and choose **Install app** or **Add to Home screen**. Chrome only offers a full install over HTTPS (or on localhost). On plain `http://192.168.x.x` you get a home-screen shortcut instead. If you want the full install, put Raccboard behind a reverse proxy with a certificate (for example Nginx Proxy Manager, Caddy or Tailscale). Otherwise use the APK.

### Android APK

The `android/` folder is a [Capacitor](https://capacitorjs.com) project that bundles the web app. On first launch it asks for your server address (for example `http://192.168.1.50:3000`), checks `/api/health`, and remembers the address. You can change it later in **Settings → Server**. Plain-HTTP LAN servers are allowed.

Build it locally. This needs **JDK 21** and the Android SDK, with `ANDROID_HOME` set:

```bash
npm run android:apk
```

The debug APK is written to `release/Raccboard-<version>-debug.apk`. To sideload it, copy it to the phone and open it (allow "install unknown apps" for your file manager). `npm run android:open` opens the project in Android Studio.

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
