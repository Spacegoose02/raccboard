// Builds the Android app: web build -> cap sync -> gradle.
// Usage: node scripts/apk.js [debug|release|bundle]   (needs JDK 21 and the Android SDK / ANDROID_HOME)
//   debug   -> release/Raccboard-<version>-debug.apk   (sideload)
//   release -> release/Raccboard-<version>.apk         (signed if a keystore is configured)
//   bundle  -> release/Raccboard-<version>.aab         (upload this to Google Play)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const mode = ['release', 'bundle'].includes(process.argv[2]) ? process.argv[2] : 'debug';
const run = (cmd, cwd = '.') => execSync(cmd, { stdio: 'inherit', cwd });

run('npm run build');
run('npx cap sync android');
const gradle = `"${path.resolve('android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`;
const task = { debug: 'assembleDebug', release: 'assembleRelease', bundle: 'bundleRelease' }[mode];
run(`${gradle} ${task}`, 'android');

const outDir = mode === 'bundle'
  ? path.join('android', 'app', 'build', 'outputs', 'bundle', 'release')
  : path.join('android', 'app', 'build', 'outputs', 'apk', mode);
const ext = mode === 'bundle' ? '.aab' : '.apk';
const file = fs.readdirSync(outDir).find((f) => f.endsWith(ext));
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
fs.mkdirSync('release', { recursive: true });
const dest = path.join('release', `Raccboard-${version}${mode === 'debug' ? '-debug' : ''}${ext}`);
fs.copyFileSync(path.join(outDir, file), dest);
console.log(`\n${ext.slice(1).toUpperCase()} ready: ${dest}`);
