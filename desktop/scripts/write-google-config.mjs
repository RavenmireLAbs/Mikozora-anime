// Generate the Windows Google Drive OAuth client config for a packaged
// build. CI supplies the values through repository secrets; local runs can
// either use the same environment variables directly (preferred) or run
// this script deliberately and avoid committing the generated file.
import { writeFile } from 'node:fs/promises';

const clientId = String(process.env.MIKOZORA_GOOGLE_CLIENT_ID || '').trim();
const clientSecret = String(process.env.MIKOZORA_GOOGLE_CLIENT_SECRET || '').trim();

if (!clientId || !clientSecret) {
  console.log('Google Drive desktop client is not configured; leaving the empty config in place.');
  process.exit(0);
}

const target = new URL('../src/lib/google-drive-config.js', import.meta.url);
const body = `// Generated during packaging. Do not commit real values.\n`
  + `export const GOOGLE_DRIVE_CLIENT_ID = ${JSON.stringify(clientId)};\n`
  + `export const GOOGLE_DRIVE_CLIENT_SECRET = ${JSON.stringify(clientSecret)};\n`;

await writeFile(target, body, 'utf8');
console.log('Google Drive desktop client config generated for this build.');
