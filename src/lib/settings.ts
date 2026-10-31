export type OutputFormat = 'jxl' | 'avif';

/**
 * How JPEG inputs become JXL: 'lossless' always transcodes (bit-exact, ~20%
 * smaller), 'reencode' always encodes the pixels, 'auto' picks per image.
 */
export type JpegMode = 'auto' | 'lossless' | 'reencode';

export interface Settings {
  format: OutputFormat;
  jxl: {
    /** 0–100, mapped to a Butteraugli distance (90 ≈ distance 1.0, visually lossless). */
    quality: number;
    effort: number;
    lossless: boolean;
    jpegMode: JpegMode;
  };
  avif: {
    quality: number;
    /** libaom speed, 0 (slowest) – 10 (fastest). */
    speed: number;
    lossless: boolean;
    /** Full-resolution chroma; 4:2:0 with sharp YUV downsampling otherwise. */
    chroma444: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  format: 'jxl',
  jxl: { quality: 90, effort: 7, lossless: false, jpegMode: 'auto' },
  avif: { quality: 80, speed: 6, lossless: false, chroma444: false },
};

// Bumped when defaults change so stored settings from older defaults are dropped.
const STORAGE_KEY = 'settings-v3';

export function loadSettings(): Settings {
  const fresh = structuredClone(DEFAULT_SETTINGS);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!saved) return fresh;
    return {
      format: saved.format === 'avif' ? 'avif' : 'jxl',
      jxl: { ...fresh.jxl, ...saved.jxl },
      avif: { ...fresh.avif, ...saved.avif },
    };
  } catch {
    return fresh;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode, blocked); settings just won't persist.
  }
}

/** Only the part of the settings that affects the output for the chosen format. */
export function settingsKey(s: Settings): string {
  return JSON.stringify([s.format, s[s.format]]);
}
