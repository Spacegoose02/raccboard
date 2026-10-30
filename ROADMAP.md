# Roadmap

## Phase 1: MVP ✅

- [x] Multiple boards: home screen with tiles, create, rename, archive, and **Complete board** (moves the board to Completed)
- [x] Lists: add, rename, drag to reorder, collapse, archive, optional due date
- [x] Cards: add, drag within and between lists (persisted transactionally), complete toggle, archive, start and due date badges (overdue in red)
- [x] Card detail modal: Labels, Dates, Checklist and Attachment buttons; Markdown description with edit/preview; multiple named checklists (sublists) with progress and per-item due dates; attachments; comments and an activity log
- [x] Board labels as custom statuses (defaults: In progress, Cancelled, Future, Done)
- [x] Settings page: display name and theme picker
- [x] Themes: Charcoal (default), Light, Midnight, Raccoon gray, Forest, Solarized, Dracula
- [x] Dockerfile, docker-compose, Unraid notes
- [x] Mobile friendly: swipeable lists with snap, long-press touch drag, full-screen card view, bottom-sheet popovers, 40px tap targets
- [x] Installable PWA (manifest, app-shell service worker, raccoon icons)
- [x] Android APK via Capacitor: asks for the server URL on first launch; built locally (`npm run android:apk`, JDK 21 + Android SDK) or in GitHub Actions

## v1.0.0 (released 2026-10-18)

- [x] Archive-list button in the list header, plus "Archive all cards in this list"
- [x] Due dates on lists (also shown on collapsed lists) and on sublists (checklists), with the next sublist due date on the card face
- [x] All settings in one place: Profile, Appearance, Boards & labels (rename, color, label editor, complete/archive/delete), Server, About
- [x] Accounts: first-run admin setup, local sign-in (scrypt, 30-day sessions), optional self sign-up, admin user management
- [x] User profiles: display name, email, password, raccoon avatars (12 presets) or photo upload; comments/activity linked to users
- [x] OIDC single sign-on (Authentik, Authelia, Keycloak, Google…) with PKCE, auto-create and verified-email linking
- [x] Teams / families: create groups, add people, team owners
- [x] Board sharing with people or teams as viewer, editor or co-owner; boards are private by default; ownership transfer
- [x] Card members: add people to cards, Join button, avatars on card faces, filter the board by member or "My cards"
- [x] List view: sortable table of a board's cards with search and hide-completed (stacked rows on phones)
- [x] Calendar view per board and across all boards: cards (with start dates), sublists, checklist items and lists; drag to reschedule; day agenda on phones
- [x] Send a card by email: formatted HTML email with checklists, a calendar file for its dates and optional attachments; SMTP settings in Settings → Email
- [x] Mobile polish: list tabs to jump between lists on phones, compact board header with a ⋯ menu, boards refresh when the app returns to the foreground (and every 30s), offline banner, a small vibration when a drag starts, lazy-loaded views (first download about 40% smaller)
- [x] Send dates to Google Calendar: "Add to calendar" on cards (Google link or .ics), a private calendar feed for any calendar app, and one-way Google Calendar sync for chosen boards

## v1.1.0 (released 2026-10-18)

- [x] Renamed to **Raccboard** (repo, Docker image and data file names unchanged)
- [x] Proper password dialog for admin resets (fixes phone keyboards saving a capital letter or trailing space)
- [x] Change usernames: your own in Profile, anyone's as an admin
- [x] Recovery CLI: list-users, reset-password, rename-user, make-admin
- [x] Docker images on GHCR (amd64 + arm64), Unraid PUID/PGID and template

## v1.2.0 (released 2026-10-23)

- [x] Security hardening: CSP and security headers, safe attachment downloads, stronger login throttling, cross-site write protection, hidden emails, Docker image updates
- [x] Forgot password by email (one-time links)
- [x] Bug fixes: 30-day sign-out, vanishing restored cards, start-date-only cards on calendars, team owners
- [x] Trello favorites: card covers, search and filters, keyboard shortcuts, copy card, card and board templates (incl. Homeboard), automation rules, Trello import

## Phase 2: Accounts and sharing

- [x] @mentions in comments, notifications inbox (bell), due-date reminders, optional email
- [x] Live board updates: changes from other people and devices appear instantly, with "who's viewing" rings on avatars

## Phase 3: Views and dates

- [ ] Two-way Google Calendar sync (edits in Google flow back to cards)
- [ ] Due dates on lists and sublists everywhere, including roll-ups on card faces and boards
- [x] Reminders and notifications

## Phase 4: Extras

- [x] **Homeboard**: a board template for house projects (rooms as lists, projects as cards, materials as checklists)
- [ ] Create cards from email (inbound address per board)
- [ ] More themes and a custom theme editor
- [ ] Raccoon branding: logo, empty states, illustrations
- [ ] Windows .exe via a packaged Node binary (Node SEA or pkg) with a tray icon
- [x] GitHub releases plus Docker image publishing (GHCR, amd64 + arm64) and an Unraid template
- [ ] Docker Hub mirror and Unraid Community Applications listing
- [ ] Signed release APK (keystore in CI secrets), then Play Store / F-Droid listing
- [ ] Offline edits in the app with sync when the server is reachable
- [x] Import from Trello JSON
- [x] Card covers, search and label/due filters, keyboard shortcuts, copy card, card and board templates, Butler-style automation rules
