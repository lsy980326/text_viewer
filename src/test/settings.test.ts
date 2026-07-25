import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_SETTINGS,
  detectPlatformCapabilities,
  normalizeReaderSettings,
} from "../core/settings";

describe("reader settings normalization", () => {
  it("preserves a fully transparent desktop reading surface", () => {
    expect(
      normalizeReaderSettings({
        ...DEFAULT_READER_SETTINGS,
        surfaceOpacity: 0,
      }).surfaceOpacity,
    ).toBe(0);
  });

  it("clamps desktop surface opacity without changing brightness limits", () => {
    expect(
      normalizeReaderSettings({
        ...DEFAULT_READER_SETTINGS,
        surfaceOpacity: -20,
        brightness: 20,
      }),
    ).toMatchObject({
      surfaceOpacity: 0,
      brightness: 35,
    });
    expect(
      normalizeReaderSettings({
        ...DEFAULT_READER_SETTINGS,
        surfaceOpacity: 140,
      }).surfaceOpacity,
    ).toBe(100);
  });

  it("enables volume keys once, then preserves the user's current choice", () => {
    expect(normalizeReaderSettings({}).volumeKeyNavigation).toBe(true);
    expect(
      normalizeReaderSettings({ volumeKeyNavigation: true })
        .volumeKeyNavigation,
    ).toBe(true);
    expect(
      normalizeReaderSettings({
        settingsVersion: 2,
        volumeKeyNavigation: false,
      }).volumeKeyNavigation,
    ).toBe(false);
  });

  it("allows an 8px body font and clamps values outside 8–36px", () => {
    expect(normalizeReaderSettings({ fontSize: 8 }).fontSize).toBe(8);
    expect(normalizeReaderSettings({ fontSize: 4 }).fontSize).toBe(8);
    expect(normalizeReaderSettings({ fontSize: 80 }).fontSize).toBe(36);
  });

  it("advertises hardware volume navigation only in Android Tauri", () => {
    expect(
      detectPlatformCapabilities(
        "Mozilla/5.0 (Linux; Android 16)",
        true,
      ).hardwareVolumeNavigation,
    ).toBe(true);
    expect(
      detectPlatformCapabilities(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)",
        true,
      ).hardwareVolumeNavigation,
    ).toBe(false);
    expect(
      detectPlatformCapabilities(
        "Mozilla/5.0 (Linux; Android 16)",
        false,
      ).hardwareVolumeNavigation,
    ).toBe(false);
  });
});
