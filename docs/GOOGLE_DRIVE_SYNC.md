# Google Drive sync setup

Mikozora can sync directly through a user's Google Drive account instead of
through a folder carried by another file-sync app. Both platforms keep the
existing device-sync merge engine and one `mikozora-sync-<platform>-<device>.json`
file per installation. The Drive integration creates a visible **Mikozora**
folder and asks Google only for the least-privilege, per-file
`https://www.googleapis.com/auth/drive.file` scope (plus the account email so
Settings can show which Google account is connected).

> **Do not commit or paste a desktop client secret, authorization code,
> access token, or refresh token into git, an issue, or chat.** The desktop
> client values belong in GitHub Actions secrets or local environment
> variables. Android does not embed a client secret.

Direct Drive sync is disabled cleanly until the Google Cloud project below
exists. Folder sync remains available regardless.

## 1. Create one Google Cloud project

Android and Windows must use OAuth clients in the **same** Google Cloud
project. Google treats the `drive.file` app identity at project level, which
is what lets the Android client read files created by the Windows client and
vice versa.

1. In Google Cloud Console, create or select a project named `Mikozora`.
2. Under **APIs & Services → Library**, enable **Google Drive API**.
3. Configure Google Auth Platform / OAuth consent:
   - Audience/user type: **External**.
   - App name: **Mikozora**.
   - User support email and developer contact email: your email.
   - Scopes/data access:
     - `openid`
     - `https://www.googleapis.com/auth/userinfo.email`
     - `https://www.googleapis.com/auth/drive.file`
4. For a durable personal deployment, publish the app instead of leaving it
   in **Testing**. Testing-mode grants/refresh tokens can expire after seven
   days. Google may ask for basic verification before production use; the
   requested scopes are non-sensitive and Mikozora does not need a broader
   Drive scope.

## 2. Create the Android OAuth client

Under **Google Auth Platform → Clients** (or **APIs & Services →
Credentials**), create an **Android** OAuth client:

- Name: `Mikozora Android`
- Package name: `app.moku.anime`
- SHA-1 certificate fingerprint: the fingerprint of the permanent release
  signing certificate used for GitHub Release APKs.

Get the SHA-1 from the release keystore on your own computer:

```sh
keytool -list -v \
  -keystore /path/outside/the/repo/Mikozora-release-final.p12 \
  -storetype PKCS12 \
  -alias Mikozora
```

Copy the **SHA1** line. A certificate fingerprint is public; the keystore and
its passwords are not.

You do not copy an Android client ID or secret into the app. Google Play
services resolves this client from the package name and signing certificate.

### Debug builds

A debug-signed APK has a different signing certificate and will fail with a
developer/configuration error unless you also create an Android OAuth client
for that debug key's SHA-1 in the same project. Release APKs must use the
permanent release certificate above.

## 3. Create the Windows OAuth client

Create a second OAuth client in the same project:

- Application type: **Desktop app**
- Name: `Mikozora Windows`

Google shows a client ID and client secret. For GitHub release builds, add
them under **GitHub repository → Settings → Secrets and variables → Actions**
with exactly these names:

| Secret | Value |
| --- | --- |
| `MIKOZORA_GOOGLE_DESKTOP_CLIENT_ID` | Desktop OAuth client ID |
| `MIKOZORA_GOOGLE_DESKTOP_CLIENT_SECRET` | Desktop OAuth client secret |

The Windows workflow generates `desktop/src/lib/google-drive-config.js` in
the runner from those secrets before packaging. An installed-app client
secret cannot be kept truly confidential inside a distributed binary, but it
should still never be committed or shared unnecessarily.

For a local desktop run, set environment variables instead:

**PowerShell**

```powershell
$env:MIKOZORA_GOOGLE_CLIENT_ID = "..."
$env:MIKOZORA_GOOGLE_CLIENT_SECRET = "..."
npm start
```

Run that from `desktop/` after the normal web/desktop dependency setup. Do
not run `desktop/scripts/write-google-config.mjs` locally unless you
deliberately want to generate the config file and will avoid committing it.

## 4. Test the finished setup

1. Install the same Mikozora version on Android and Windows. On Android, use
   a build signed with the certificate registered above.
2. On each device, open **Settings → Device Sync**.
3. Set **Sync method** to **Google Drive**.
4. Choose **Connect** and sign in to the same Google account on both.
5. Confirm a visible **Mikozora** folder appears in Google Drive containing
   one `mikozora-sync-android-...json` and one
   `mikozora-sync-windows-...json` after both devices sync.
6. Add a title or mark an episode watched on one device, use **Sync**, then
   open or sync the other device and confirm the change arrives.
7. Test a deletion or unwatch on the second device and confirm it propagates
   back. Downloaded videos are intentionally not copied.

If Android says Google Drive is not configured for this build, check the
Android client package and SHA-1 in the same project. If Windows says it is
not configured, check the two GitHub secret names or local environment
variables and rebuild.

## Privacy and disconnect behavior

Drive sync files contain library titles, collections, history, watch
progress, appearance/content settings, and Smart Downloads selections and
presets. They are not end-to-end encrypted: Google and anyone able to use the
connected Google account or read the visible Mikozora folder can read them.

Disconnecting removes that device's stored Google authorization/refresh
token and stops future syncing. It does not delete the Mikozora folder or any
sync files already in Google Drive; remove those in Drive if desired.
