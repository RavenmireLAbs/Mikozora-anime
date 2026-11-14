// Window background per appearance — mirrors the ACCENTS table in
// src/appearance.js (bgDark/bgLight), which the Android native palette
// (Appearance.java) follows too. Keep these values in sync.
const BACKGROUNDS = {
  green: { dark: '#101312', light: '#f7f9f5' },
  blue: { dark: '#101418', light: '#f5f8fb' },
  purple: { dark: '#15131a', light: '#f8f6fb' },
  pink: { dark: '#191317', light: '#fcf6f8' },
  amber: { dark: '#191613', light: '#fbf8f1' },
  'midnight-sakura': { dark: '#11131B', light: '#F7F4F1' },
  'ocean-deep': { dark: '#10171B', light: '#F1F8F8' },
  'lavender-mist': { dark: '#17131D', light: '#F8F5FC' },
  crimson: { dark: '#191214', light: '#FCF5F5' },
  sunset: { dark: '#1A1412', light: '#FBF5F0' },
  mint: { dark: '#101713', light: '#F2F8F4' },
  teal: { dark: '#101716', light: '#F1F8F6' },
  copper: { dark: '#191510', light: '#FAF6EF' },
  ruby: { dark: '#191219', light: '#FCF4F8' },
  sapphire: { dark: '#11141B', light: '#F4F6FC' },
  orchid: { dark: '#191319', light: '#FCF5FB' },
  arctic: { dark: '#11171B', light: '#F2F8FA' },
  'rose-gold': { dark: '#191513', light: '#FBF6F3' },
  monochrome: { dark: '#121318', light: '#F5F5F6' },
  citron: { dark: '#15170F', light: '#F7F8EF' },
};

// Matches DEFAULT_APPEARANCE in src/appearance.js.
export const DEFAULT_APPEARANCE = Object.freeze({ mode: 'light', accent: 'green' });

export function normalizeAppearance(value) {
  return {
    mode: value?.mode === 'light' ? 'light' : 'dark',
    accent: BACKGROUNDS[value?.accent] ? value.accent : DEFAULT_APPEARANCE.accent,
  };
}

export function backgroundFor(appearance) {
  const a = normalizeAppearance(appearance);
  return BACKGROUNDS[a.accent][a.mode];
}
