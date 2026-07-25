import type {
  PlatformCapabilities,
  PlatformName,
  ReaderSettings,
} from "./types";

export const CURRENT_READER_SETTINGS_VERSION = 2;

export const DEFAULT_READER_SETTINGS: Readonly<ReaderSettings> = Object.freeze({
  settingsVersion: CURRENT_READER_SETTINGS_VERSION,
  flow: "horizontal-paged",
  fontFamily: '"Noto Serif KR", "Apple SD Gothic Neo", serif',
  fontSize: 18,
  lineHeight: 1.85,
  letterSpacing: 0,
  paragraphSpacing: 1.25,
  contentWidth: 720,
  horizontalPadding: 48,
  theme: "light",
  brightness: 100,
  transparencyEnabled: false,
  surfaceOpacity: 82,
  alwaysOnTop: false,
  simpleView: false,
  countWhitespace: true,
  volumeKeyNavigation: true,
  focusMode: false,
});

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Applies persisted or user-provided values while keeping the public reader
 * settings inside the ranges supported by the UI.
 */
export function normalizeReaderSettings(
  value: Partial<ReaderSettings> | null | undefined,
): ReaderSettings {
  const settings = { ...DEFAULT_READER_SETTINGS, ...value };
  const surfaceOpacity = Number(settings.surfaceOpacity);
  const storedVersion = Number(value?.settingsVersion) || 0;

  return {
    ...settings,
    settingsVersion: CURRENT_READER_SETTINGS_VERSION,
    flow:
      settings.flow === "vertical-scroll"
        ? "vertical-scroll"
        : "horizontal-paged",
    theme:
      settings.theme === "sepia" || settings.theme === "dark"
        ? settings.theme
        : "light",
    fontSize: clamp(Number(settings.fontSize) || 18, 8, 36),
    lineHeight: clamp(Number(settings.lineHeight) || 1.85, 1.3, 2.4),
    letterSpacing: clamp(Number(settings.letterSpacing) || 0, -0.04, 0.2),
    paragraphSpacing: clamp(
      Number(settings.paragraphSpacing) || 1.25,
      0.5,
      3,
    ),
    contentWidth: clamp(Number(settings.contentWidth) || 720, 420, 980),
    horizontalPadding: clamp(
      Number(settings.horizontalPadding) || 48,
      16,
      96,
    ),
    brightness: clamp(Number(settings.brightness) || 100, 35, 100),
    surfaceOpacity: clamp(
      Number.isFinite(surfaceOpacity) ? surfaceOpacity : 82,
      0,
      100,
    ),
    transparencyEnabled: Boolean(settings.transparencyEnabled),
    alwaysOnTop: Boolean(settings.alwaysOnTop),
    simpleView: Boolean(settings.simpleView),
    countWhitespace: Boolean(settings.countWhitespace),
    // Existing installs did not have a setting version and used an
    // unreliable opt-in default. Turn the feature on exactly once, then keep
    // every explicit choice made under the current schema.
    volumeKeyNavigation:
      storedVersion < CURRENT_READER_SETTINGS_VERSION
        ? true
        : Boolean(settings.volumeKeyNavigation),
    focusMode: Boolean(settings.focusMode),
  };
}

function platformFromUserAgent(userAgent: string): PlatformName {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/windows/i.test(userAgent)) return "windows";
  if (/macintosh|mac os x/i.test(userAgent)) return "macos";
  return userAgent ? "web" : "unknown";
}

export function detectPlatformCapabilities(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
  isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window,
): PlatformCapabilities {
  const platform = platformFromUserAgent(userAgent);
  const formFactor =
    platform === "ios" || platform === "android" ? "mobile" : "desktop";
  const isDesktopNative =
    isTauri && (platform === "macos" || platform === "windows");

  return {
    platform,
    formFactor,
    isTauri,
    nativeFileDialog: isTauri,
    transparentWindow: isDesktopNative,
    alwaysOnTop: isDesktopNative,
    nativeSystemBrightness: false,
    mobileGlassSurface: formFactor === "mobile",
    hardwareVolumeNavigation: isTauri && platform === "android",
  };
}
