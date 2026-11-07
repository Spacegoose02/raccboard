# Raccboard Notes (Windows desktop)

Pin any Raccboard card to your desktop as a sticky note. Notes are live: edits on a note save to the card, and changes made on the board show up on the note within 20 seconds.

## Run it

```
cd desktop
npm install
npm start
```

Sign in with your Raccboard server URL (for example `http://192.168.1.10:3000`), username and password. Single sign-on accounts aren't supported yet.

## Build an installer

```
npm run dist
```

This writes `dist/Raccboard Notes Setup x.y.z.exe`.

## Using it

- Click the tray icon to open **Pin a card**, pick a board, and press **Pin**.
- Drag a note by its top bar and resize it from any edge. Position and size are remembered.
- On a note: tick checklist items, add items, tick the box by the title to complete the card, click the title or text to edit.
- 📌 keeps a note above other windows, ↗ opens the card in the browser, ✕ unpins it (the card is never deleted).
- Note colour comes from the card's first label.
- The tray menu has show/hide all, refresh now, and Start with Windows (on by default in the installed app).

Settings live in `%APPDATA%\raccboard-notes\notes.json`. The sign-in token is encrypted with Windows DPAPI.
