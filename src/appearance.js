// Theme preference is deliberately separate from library, collections and downloads.
export const APPEARANCE_KEY = 'moku.appearance.v1';
export const DEFAULT_APPEARANCE = Object.freeze({ mode:'dark', accent:'green' });
export const MODES = [
  { id:'dark', label:'Dark', detail:'A cozy, low-light look' },
  { id:'light', label:'Light', detail:'A brighter space' },
];
export const ACCENTS = [
  { id:'green', label:'Green', hue:95, dark:'#c8ee99', light:'#476d2a', bgDark:'#101312', bgLight:'#f7f9f5', navDark:'#161c17' },
  { id:'blue', label:'Blue', hue:205, dark:'#a9dcff', light:'#216387', bgDark:'#101418', bgLight:'#f5f8fb', navDark:'#151c22' },
  { id:'purple', label:'Purple', hue:265, dark:'#d8c2ff', light:'#694a98', bgDark:'#15131a', bgLight:'#f8f6fb', navDark:'#1d1923' },
  { id:'pink', label:'Pink', hue:337, dark:'#ffc1d4', light:'#9d3d5d', bgDark:'#191317', bgLight:'#fcf6f8', navDark:'#22191d' },
  { id:'amber', label:'Amber', hue:40, dark:'#f7d79b', light:'#805800', bgDark:'#191613', bgLight:'#fbf8f1', navDark:'#211d17' },
];
export function normalizeAppearance(value) {
  const candidate=value&&typeof value==='object'?value:{};
  return { mode:MODES.some(x=>x.id===candidate.mode)?candidate.mode:DEFAULT_APPEARANCE.mode,
    accent:ACCENTS.some(x=>x.id===candidate.accent)?candidate.accent:DEFAULT_APPEARANCE.accent };
}
export function readAppearance(storage) {
  try { return normalizeAppearance(JSON.parse(storage.getItem(APPEARANCE_KEY)||'null')); }
  catch { return {...DEFAULT_APPEARANCE}; }
}
export function saveAppearance(storage,value) {
  try { storage.setItem(APPEARANCE_KEY,JSON.stringify(normalizeAppearance(value)));return true; }
  catch { return false; }
}
export function applyAppearance(document,value) {
  const appearance=normalizeAppearance(value),root=document.documentElement;
  root.dataset.mode=appearance.mode;root.dataset.accent=appearance.accent;
  if(appearance.mode==='dark'&&appearance.accent==='green')delete root.dataset.themed;
  else root.dataset.themed='true';
  const palette=ACCENTS.find(x=>x.id===appearance.accent);
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',appearance.mode==='light'?palette.bgLight:palette.bgDark);
  return appearance;
}
export function syncNativeAppearance(value) {
  const appearance=normalizeAppearance(value);
  try {
    if(typeof window!=='undefined' && typeof window.MokuBridge?.setAppearance==='function')
      window.MokuBridge.setAppearance(appearance.mode,appearance.accent);
  } catch { /* Appearance still works in the web UI if the bridge is unavailable. */ }
}
