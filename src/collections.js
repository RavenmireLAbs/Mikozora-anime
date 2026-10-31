// Collections refer to the existing library by its unchanged source + URL key.
// They do not own or move downloads, episode history, or files in the user's folder.
export const COLLECTIONS_KEY = 'moku.collections.v1';
export const FAVOURITES_ID = 'favourites';
export const titleKey = item => `${item.source}|${item.url}`;
export const initialCollections = () => [{ id:FAVOURITES_ID, name:'Favourites', items:[] }];

export function normalizeCollections(value) {
  const input = Array.isArray(value) ? value : [];
  const fav = input.find(x => x && x.id === FAVOURITES_ID);
  const cleanItems = items => [...new Set((Array.isArray(items) ? items : []).filter(x => typeof x === 'string' && x))];
  const result = [{ id:FAVOURITES_ID, name:'Favourites', items:cleanItems(fav?.items) }];
  const ids = new Set([FAVOURITES_ID, 'all']);
  for (const entry of input) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) continue;
    if (typeof entry.name !== 'string' || !entry.name.trim()) continue;
    ids.add(entry.id);
    result.push({ id:entry.id, name:entry.name.trim(), items:cleanItems(entry.items) });
  }
  return result;
}
export function cleanCollectionName(name) { return String(name || '').trim().replace(/\s+/g, ' '); }
export function collectionNameError(name, collections, exceptId = '') {
  const cleaned = cleanCollectionName(name);
  if (!cleaned) return 'Enter a collection name.';
  if (cleaned.length > 40) return 'Choose a name of 40 characters or fewer.';
  const key = cleaned.toLocaleLowerCase();
  if (key === 'all titles' || collections.some(c => c.id !== exceptId && c.name.toLocaleLowerCase() === key)) return 'A collection with this name already exists.';
  return '';
}
export function createCollection(collections, name, id) {
  return [...collections, { id, name:cleanCollectionName(name), items:[] }];
}
export function renameCollection(collections, id, name) {
  if (id === FAVOURITES_ID || id === 'all') return collections;
  return collections.map(c => c.id === id ? { ...c, name:cleanCollectionName(name) } : c);
}
export function deleteCollection(collections, id) {
  return id === FAVOURITES_ID || id === 'all' ? collections : collections.filter(c => c.id !== id);
}
export function setCollectionItems(collections, id, keys) {
  const clean = [...new Set(keys.filter(x => typeof x === 'string' && x))];
  return collections.map(c => c.id === id ? { ...c, items:clean } : c);
}
export function setTitleCollections(collections, key, selectedIds) {
  const selected = new Set(selectedIds);
  return collections.map(c => {
    const has = c.items.includes(key);
    const shouldHave = selected.has(c.id);
    if (has === shouldHave) return c;
    return { ...c, items:shouldHave ? [key, ...c.items] : c.items.filter(x => x !== key) };
  });
}
export function toggleFavourite(collections, key) {
  return collections.map(c => c.id !== FAVOURITES_ID ? c : ({ ...c, items:c.items.includes(key) ? c.items.filter(x => x !== key) : [key, ...c.items] }));
}
export function removeTitleFromCollections(collections, key) {
  return collections.map(c => c.items.includes(key) ? { ...c, items:c.items.filter(x => x !== key) } : c);
}
