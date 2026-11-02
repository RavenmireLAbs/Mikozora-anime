// Portable folder / file names for user-owned copies. The series-folder
// algorithm is a direct port of Android's SeriesFolderName.java so Android
// and Windows exports group a series under the same folder name.
import { createHash, randomUUID } from 'node:crypto';

function digest12(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 12);
}

function limit(text, maxPoints, maxBytes) {
  let out = '';
  let bytes = 0;
  let points = 0;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // unpaired surrogate
    const size = Buffer.byteLength(ch, 'utf8');
    if (points >= maxPoints || bytes + size > maxBytes) break;
    out += ch;
    bytes += size;
    points++;
  }
  return out.replace(/[. ]+$/u, '').trim();
}

export function seriesFolderName(title) {
  const original = String(title ?? '').normalize('NFC');
  let text = original
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\s\p{Z}]+/gu, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')
    .trim();
  let changed = text !== original;
  if (!text) text = 'Untitled series';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(text)) {
    text = `_${text}`;
    changed = true;
  }
  let limited = limit(text, 100, 180);
  if (limited !== text) changed = true;
  if (!limited) limited = 'Untitled series';
  if (!changed) return limited;
  const suffix = ` - ${digest12(original)}`;
  const prefix = limit(text, 100 - suffix.length, 180 - suffix.length) || 'Untitled series';
  return prefix + suffix;
}

export function episodeFileBase(meta, id, random = randomUUID) {
  const title = meta?.item?.title || 'Episode';
  const number = meta?.episode?.number == null ? '' : String(meta.episode.number);
  let text = `${title}${number ? ` - Episode ${number}` : ''}`
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!text) text = 'Episode';
  text = Array.from(text).slice(0, 90).join('').trim().replace(/[. ]+$/g, '') || 'Episode';
  const rand = String(random()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'copy';
  return `${text} - ${String(id || '').slice(0, 6)}-${rand}`;
}

export function safeLocalName(name) {
  const text = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return text || 'Episode';
}
