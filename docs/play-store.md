# Publishing Raccboard to Google Play

The Android app (`android/`, Capacitor) is already a full native app shell around the Raccboard UI. On first launch it asks for your server address. These are the steps that need you.

## 1. Developer account
Sign up at https://play.google.com/console (one-time $25 fee, identity verification). New personal accounts must run a **closed test with at least 12 testers for 14 days** before production release.

## 2. Upload key (once, keep it safe)
```bash
keytool -genkeypair -v -keystore raccboard-upload.jks -alias raccboard -keyalg RSA -keysize 2048 -validity 10000
```
Back up the `.jks` file and passwords. Never commit them (they are git-ignored).

Local builds: create `android/keystore.properties`:
```
storeFile=/absolute/path/raccboard-upload.jks
storePassword=...
keyAlias=raccboard
keyPassword=...
```
then `npm run android:aab` → `release/Raccboard-<version>.aab`.

GitHub Actions: add repo secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 raccboard-upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. The **Android APK** workflow then also builds a signed APK and the `.aab`.

## 3. Play Console listing
- Create app, enrol in **Play App Signing** (Google holds the app key, you upload with yours).
- Upload the `.aab` to a testing track.
- Store listing: icon 512×512 (`branding/png/raccboard-icon-512.png`), feature graphic 1024×500, at least 2 phone screenshots, short and full description.
- Privacy policy URL (required), Data safety form (the app sends board data only to the user's own server), content rating questionnaire, target audience.

## 4. Each release
Bump `versionCode` / `versionName` in `android/app/build.gradle` (versionCode must always increase), build the AAB, upload.

Note: the package id is `app.rackboard`. It can never change after the first Play upload.
