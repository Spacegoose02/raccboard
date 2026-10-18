import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './api.js';
import { DATA_DIR } from './db.js';

const APP_NAME = process.env.APP_NAME || 'Rackboard';
const PORT = Number(process.env.PORT || 3000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'client', 'dist');

const app = express();
app.disable('x-powered-by');
app.use('/api', api);

if (fs.existsSync(dist)) {
  app.use(express.static(dist, {
    index: false,
    // Hashed build assets never change; everything else (sw.js, manifest, icons) revalidates.
    setHeaders: (res, file) => res.set('Cache-Control', file.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable' : 'no-cache'),
  }));
  // SPA fallback for client-side routes.
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`${APP_NAME} listening on http://localhost:${PORT} (data: ${DATA_DIR})`);
});
