// Copy the built web UI (repo-root `npm run build` -> dist/) into
// desktop/web, where the Electron shell serves it from the mikozora://
// origin. Run by CI before packaging; run it locally before `npm start`.
import { cp, rm, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(desktop, '..', 'dist');
try {
  await access(join(source, 'index.html'));
} catch {
  console.error('Missing web build at ../dist — run `npm run build` in the repo root first.');
  process.exit(1);
}
await rm(join(desktop, 'web'), { recursive: true, force: true });
await cp(source, join(desktop, 'web'), { recursive: true });
console.log('Web UI copied into desktop/web.');
