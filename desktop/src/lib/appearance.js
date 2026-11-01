// Window background per appearance — mirrors the ACCENTS table in
// src/appearance.js (bgDark/bgLight), which the Android native palette
// (Appearance.java) follows too. Keep these values in sync.
const BACKGROUNDS = {
  green: { dark: '#101312', light: '#f7f9f5' },
  blue: { dark: '#101418', light: '#f5f8fb' },
  purple: { dark: '#15131a', light: '#f8f6fb' },
  pink: { dark: '#191317', light: '#fcf6f8' },
  amber: { dark: '#191613', light: '#fbf8f1' },
};

// Matches DEFAULT_APPEARANCE in src/appearance.js.
export const DEFAULT_APPEARANCE = Object.freeze({ mode: 'dark', accent: 'blue' });

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
