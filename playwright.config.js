import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// End-to-end tests run against the built app (npm run build) on a fresh, throwaway database.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-e2e-'));
const PORT = 3199;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: 'node server/index.js',
    url: `http://localhost:${PORT}/api/health`,
    env: { PORT: String(PORT), DATA_DIR: dataDir },
    reuseExistingServer: false,
  },
});
