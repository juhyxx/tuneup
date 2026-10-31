// Small translation table, in the spirit of ../scalear: the browser's language picks the strings,
// a missing one falls back to English.

const dicts = {
  en: {
    'start': 'Start',
    'stop': 'Stop',
    'settings': 'Settings',
    'close': 'Close',
    'reference': 'Reference pitch A4',
    'notation': 'Note names',
    'language': 'Language',
    'input': 'Input device',
    'input.default': 'Default',
    'input.n': 'Microphone {n}',
    'auto-lang': 'Automatic',
    'hint.idle': 'Allow the microphone and play a note',
    'hint.listening': 'Listening… play a note',
    'hint.low': 'Flat',
    'hint.high': 'Sharp',
    'hint.ok': 'In tune',
    'err.secure': 'Microphone access needs https or localhost.',
    'err.denied': 'Microphone access was blocked. Allow it in the browser’s site settings, then tap here to retry.',
    'err.other': 'Could not open the microphone: {msg}',
    'update': 'New version ready',
    'reload': 'Reload',
  },
  cs: {
    'start': 'Start',
    'stop': 'Stop',
    'settings': 'Nastavení',
    'close': 'Zavřít',
    'reference': 'Referenční tón A4',
    'notation': 'Názvy tónů',
    'language': 'Jazyk',
    'input': 'Vstupní zařízení',
    'input.default': 'Výchozí',
    'input.n': 'Mikrofon {n}',
    'auto-lang': 'Automaticky',
    'hint.idle': 'Povol mikrofon a zahraj tón',
    'hint.listening': 'Poslouchám… zahraj tón',
    'hint.low': 'Nízko',
    'hint.high': 'Vysoko',
    'hint.ok': 'Naladěno',
    'err.secure': 'Mikrofon funguje jen přes https nebo localhost.',
    'err.denied': 'Přístup k mikrofonu je zablokovaný. Povol ho v nastavení webu v prohlížeči a klepni sem pro nový pokus.',
    'err.other': 'Mikrofon se nepodařilo otevřít: {msg}',
    'update': 'Je tu nová verze',
    'reload': 'Načíst',
  },
};

export const LANGS = { en: 'English', cs: 'Čeština' };
// Central European languages call B natural "H"
const H_LANGS = new Set(['cs']);

let lang = 'en';

export function detect() {
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  for (const p of prefs) {
    const base = p.toLowerCase().split('-')[0];
    if (Object.hasOwn(LANGS, base)) return base;
  }
  return 'en';
}

export function use(code) {
  lang = Object.hasOwn(LANGS, code) ? code : detect();
  document.documentElement.lang = lang;
  return lang;
}

export const defaultH = () => H_LANGS.has(lang);

export function t(key, vars = {}) {
  const s = dicts[lang]?.[key] ?? dicts.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function apply(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(e => (e.textContent = t(e.dataset.i18n)));
  root.querySelectorAll('[data-i18n-label]').forEach(e => e.setAttribute('aria-label', t(e.dataset.i18nLabel)));
}
