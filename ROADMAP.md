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

## Phase 2: Accounts and sharing

- [ ] Local accounts (username/password, sessions)
- [ ] OIDC sign-in (Authentik, Authelia, Keycloak, Google, …)
- [ ] Share boards with family or with individuals (viewer / editor roles)
- [ ] Card members: assign people to cards, filter by member
- [ ] Raccoon avatars (pick one or upload a photo)
- [ ] @mentions in comments

## Phase 3: Views and dates

- [ ] Calendar view (cards, lists and checklist items by due date)
- [ ] List/table view across boards
- [ ] Google Calendar sync (one-way first, then two-way)
- [ ] Due dates on lists and sublists everywhere, including roll-ups on card faces and boards
- [ ] Reminders and notifications

## Phase 4: Extras

- [ ] **Homeboard**: a board template for house projects (rooms as lists, projects as cards, materials as checklists)
- [ ] Send a card by email (and create cards from email)
- [ ] More themes and a custom theme editor
- [ ] Raccoon branding: logo, empty states, illustrations
- [ ] Windows .exe via a packaged Node binary (Node SEA or pkg) with a tray icon
- [ ] GitHub releases plus Docker image publishing (GHCR / Docker Hub, multi-arch)
- [ ] Signed release APK (keystore in CI secrets), then Play Store / F-Droid listing
- [ ] Offline edits in the app with sync when the server is reachable
- [ ] Import from Trello JSON
