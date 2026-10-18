// Builds the Android APK: web build -> cap sync -> gradle assemble.
// Usage: node scripts/apk.js [debug|release]   (needs JDK 17+ and the Android SDK / ANDROID_HOME)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const type = process.argv[2] === 'release' ? 'release' : 'debug';
const run = (cmd, cwd = '.') => execSync(cmd, { stdio: 'inherit', cwd });

run('npm run build');
run('npx cap sync android');
const gradle = `"${path.resolve('android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`;
run(`${gradle} assemble${type === 'release' ? 'Release' : 'Debug'}`, 'android');

const outDir = path.join('android', 'app', 'build', 'outputs', 'apk', type);
const apk = fs.readdirSync(outDir).find((f) => f.endsWith('.apk'));
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
fs.mkdirSync('release', { recursive: true });
const dest = path.join('release', `Rackboard-${version}-${type}.apk`);
fs.copyFileSync(path.join(outDir, apk), dest);
console.log(`\nAPK ready: ${dest}`);
