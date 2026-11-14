// Theme preference is deliberately separate from library, collections and downloads.
export const APPEARANCE_KEY = 'moku.appearance.v1';
export const DEFAULT_APPEARANCE = Object.freeze({ mode:'light', accent:'green' });
export const MODES = [
  { id:'light', label:'Light', detail:'Bright, clean, and easy on the eyes' },
  { id:'dark', label:'Dark', detail:'A cozy, low-light look for late-night watching' },
];
export const ACCENTS = [
  { id:'green', label:'Green', hue:95, dark:'#c8ee99', light:'#476d2a', bgDark:'#101312', bgLight:'#f7f9f5', navDark:'#161c17' },
  { id:'blue', label:'Blue', hue:205, dark:'#a9dcff', light:'#216387', bgDark:'#101418', bgLight:'#f5f8fb', navDark:'#151c22' },
  { id:'purple', label:'Purple', hue:265, dark:'#d8c2ff', light:'#694a98', bgDark:'#15131a', bgLight:'#f8f6fb', navDark:'#1d1923' },
  { id:'pink', label:'Pink', hue:337, dark:'#ffc1d4', light:'#9d3d5d', bgDark:'#191317', bgLight:'#fcf6f8', navDark:'#22191d' },
  { id:'amber', label:'Amber', hue:40, dark:'#f7d79b', light:'#805800', bgDark:'#191613', bgLight:'#fbf8f1', navDark:'#211d17' },
  { id:'midnight-sakura', label:'Midnight Sakura', hue:245, dark:'#E98BB5', light:'#B44B78', bgDark:'#11131B', bgLight:'#F7F4F1', navDark:'#151722', secondaryDark:'#8EDFD0', secondaryLight:'#267360', secondaryHoverDark:'#B9F4E6', secondaryHoverLight:'#184F43', themeInkDark:'#35202B', themeInkLight:'#FFFFFF', heroInk:'#35202B', primaryHoverDark:'#F5B8D3', primaryHoverLight:'#963D67' },
  { id:'ocean-deep', label:'Ocean Deep', hue:188, dark:'#7DDCE8', light:'#166B78', bgDark:'#10171B', bgLight:'#F1F8F8', navDark:'#152127' },
  { id:'lavender-mist', label:'Lavender Mist', hue:278, dark:'#D7B8FF', light:'#6940A2', bgDark:'#17131D', bgLight:'#F8F5FC', navDark:'#211B28' },
  { id:'crimson', label:'Crimson', hue:352, dark:'#FF9CA8', light:'#A4263B', bgDark:'#191214', bgLight:'#FCF5F5', navDark:'#231719' },
  { id:'sunset', label:'Sunset', hue:22, dark:'#FFB28A', light:'#9E461D', bgDark:'#1A1412', bgLight:'#FBF5F0', navDark:'#241B17' },
  { id:'mint', label:'Mint', hue:153, dark:'#9BE9C5', light:'#1E7352', bgDark:'#101713', bgLight:'#F2F8F4', navDark:'#16221A' },
  { id:'teal', label:'Teal', hue:173, dark:'#80E1D2', light:'#176F64', bgDark:'#101716', bgLight:'#F1F8F6', navDark:'#152320' },
  { id:'copper', label:'Copper', hue:32, dark:'#EFB16F', light:'#80501B', bgDark:'#191510', bgLight:'#FAF6EF', navDark:'#211B15' },
  { id:'ruby', label:'Ruby', hue:338, dark:'#FF86AB', light:'#9A2055', bgDark:'#191219', bgLight:'#FCF4F8', navDark:'#231720' },
  { id:'sapphire', label:'Sapphire', hue:220, dark:'#9DB9FF', light:'#3657A2', bgDark:'#11141B', bgLight:'#F4F6FC', navDark:'#171B25' },
  { id:'orchid', label:'Orchid', hue:305, dark:'#F0A8E8', light:'#8E3287', bgDark:'#191319', bgLight:'#FCF5FB', navDark:'#231821' },
  { id:'arctic', label:'Arctic', hue:198, dark:'#B5E6FF', light:'#3E6B87', bgDark:'#11171B', bgLight:'#F2F8FA', navDark:'#182127' },
  { id:'rose-gold', label:'Rose Gold', hue:23, dark:'#F0C0A4', light:'#87503B', bgDark:'#191513', bgLight:'#FBF6F3', navDark:'#231A16' },
  { id:'monochrome', label:'Monochrome', hue:0, dark:'#ECEEF3', light:'#4C505C', bgDark:'#121318', bgLight:'#F5F5F6', navDark:'#191A20', neutralize:true },
  { id:'citron', label:'Citron', hue:78, dark:'#DDF38A', light:'#596A18', bgDark:'#15170F', bgLight:'#F7F8EF', navDark:'#1D2015' },
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
