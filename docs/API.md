# Raccboard REST API

Everything the app does goes through the JSON API under `/api`, so scripts can do the same.

## Authentication

Create a personal token in **Settings → API & webhooks**. It is shown once. Send it on every request:

```sh
curl -H "Authorization: Bearer rb_..." https://board.example.com/api/boards
```

A token acts as you, with your board permissions. It does not expire; revoke it in Settings. Tokens cannot create other tokens.

## Common endpoints

| Method & path | What it does |
| --- | --- |
| `GET /boards` | Boards you can see (`my_role` is viewer, editor or owner) |
| `GET /boards/:id` | A board with its lists, cards, labels, people and fields |
| `POST /boards/:id/lists` `{name}` | Add a list |
| `POST /lists/:id/cards` `{title}` | Add a card to a list |
| `PATCH /cards/:id` | Change a card: `title`, `description`, `list_id`, `due_date`, `start_date`, `completed`, `recurrence`… |
| `DELETE /cards/:id` | Delete a card |
| `GET /cards/:id` | Card detail with comments, checklists and activity |
| `GET /search?q=` | Full-text search across your boards |

Errors come back as `{ "error": "message" }` with a 4xx or 5xx status.

## Webhooks

Board owners can add up to 10 webhook URLs per board in **Settings → API & webhooks**. After each successful change to the board, Raccboard POSTs:

```json
{ "event": "board.changed", "board_id": "…", "method": "PATCH", "path": "/cards/…", "by": { "id": "…", "name": "Sam" }, "at": "2026-10-31T00:00:00.000Z" }
```

The **Test** button sends `{ "event": "ping" }`. Headers:

- `X-Raccboard-Event`: the event name
- `X-Raccboard-Signature`: `sha256=` followed by the HMAC-SHA256 of the raw body, keyed with the webhook's secret (shown once when you add it)

Verify it in Node:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-raccboard-signature']));
```

Deliveries time out after 5 seconds and are not retried; the last status is shown next to each webhook. Fetch `GET /boards/:id` to see what changed.
