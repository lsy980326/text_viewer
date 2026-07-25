import { afterEach, describe, expect, it, vi } from "vitest";
import hostSource from "../../src-tauri/mobile/android/MainActivity.kt?raw";
import {
  ANDROID_BRIDGE_READY_EVENT,
  HARDWARE_READER_NAVIGATION_EVENT,
  getAndroidSafeAreaInsets,
  isAndroidVolumeNavigationAvailable,
  navigationDelta,
  parseHardwareReaderNavigation,
  setAndroidVolumeCaptureEnabled,
  subscribeAndroidBridgeAvailability,
  subscribeHardwareReaderNavigation,
} from "../platform/mobileVolumeNavigation";

afterEach(() => {
  delete window.NOVELIER_READER_HARDWARE;
  vi.useRealTimers();
});

describe("mobile volume-button navigation", () => {
  it("accepts only the versioned volume-up/back and volume-down/forward pairs", () => {
    const backward = new CustomEvent(HARDWARE_READER_NAVIGATION_EVENT, {
      detail: {
        version: 1,
        source: "volume-up",
        direction: "backward",
        repeat: false,
      },
    });
    const forward = new CustomEvent(HARDWARE_READER_NAVIGATION_EVENT, {
      detail: {
        version: 1,
        source: "volume-down",
        direction: "forward",
        repeat: false,
      },
    });

    expect(navigationDelta(parseHardwareReaderNavigation(backward)!)).toBe(-1);
    expect(navigationDelta(parseHardwareReaderNavigation(forward)!)).toBe(1);
    expect(
      parseHardwareReaderNavigation(
        new CustomEvent(HARDWARE_READER_NAVIGATION_EVENT, {
          detail: {
            version: 1,
            source: "volume-down",
            direction: "backward",
            repeat: false,
          },
        }),
      ),
    ).toBeNull();
    expect(
      parseHardwareReaderNavigation(
        new CustomEvent(HARDWARE_READER_NAVIGATION_EVENT, {
          detail: {
            version: 1,
            source: "volume-up",
            direction: "backward",
            repeat: true,
          },
        }),
      ),
    ).toBeNull();
  });

  it("subscribes to valid intents and ignores malformed native events", () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const unsubscribe = subscribeHardwareReaderNavigation(listener, target);

    target.dispatchEvent(
      new CustomEvent(HARDWARE_READER_NAVIGATION_EVENT, {
        detail: {
          version: 1,
          source: "volume-down",
          direction: "forward",
          repeat: false,
        },
      }),
    );
    target.dispatchEvent(
      new CustomEvent(HARDWARE_READER_NAVIGATION_EVENT, {
        detail: { direction: "forward" },
      }),
    );
    unsubscribe();
    target.dispatchEvent(
      new CustomEvent(HARDWARE_READER_NAVIGATION_EVENT, {
        detail: {
          version: 1,
          source: "volume-up",
          direction: "backward",
          repeat: false,
        },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      version: 1,
      source: "volume-down",
      direction: "forward",
      repeat: false,
    });
  });

  it("captures only when an Android native bridge is present", () => {
    const setVolumeCaptureEnabled = vi.fn();
    window.NOVELIER_READER_HARDWARE = {
      setVolumeCaptureEnabled,
      getDisplayName: vi.fn(() => null),
      getSystemInsets: vi.fn(() => "{}"),
      setDarkSystemBars: vi.fn(),
    };

    expect(
      isAndroidVolumeNavigationAvailable(
        "Mozilla/5.0 (Linux; Android 16)",
        window.NOVELIER_READER_HARDWARE,
      ),
    ).toBe(true);
    expect(
      isAndroidVolumeNavigationAvailable(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)",
        window.NOVELIER_READER_HARDWARE,
      ),
    ).toBe(false);
    expect(setAndroidVolumeCaptureEnabled(true)).toBe(true);
    expect(setAndroidVolumeCaptureEnabled(false)).toBe(true);
    expect(setVolumeCaptureEnabled).toHaveBeenNthCalledWith(1, true);
    expect(setVolumeCaptureEnabled).toHaveBeenNthCalledWith(2, false);

    delete window.NOVELIER_READER_HARDWARE;
    expect(setAndroidVolumeCaptureEnabled(true)).toBe(false);
  });

  it("reacts when the native bridge becomes ready after initial render", () => {
    vi.useFakeTimers();
    let available = false;
    const listener = vi.fn();
    const unsubscribe = subscribeAndroidBridgeAvailability(
      listener,
      window,
      () => available,
    );
    expect(listener).toHaveBeenLastCalledWith(false);

    available = true;
    window.dispatchEvent(new Event(ANDROID_BRIDGE_READY_EVENT));
    expect(listener).toHaveBeenLastCalledWith(true);
    unsubscribe();
  });

  it("parses native safe-area CSS pixels", () => {
    window.NOVELIER_READER_HARDWARE = {
      setVolumeCaptureEnabled: vi.fn(),
      getDisplayName: vi.fn(() => "실제 제목.txt"),
      getSystemInsets: vi.fn(() =>
        JSON.stringify({ top: 24, right: 0, bottom: 48, left: 0 }),
      ),
      setDarkSystemBars: vi.fn(),
    };
    expect(getAndroidSafeAreaInsets()).toEqual({
      top: 24,
      right: 0,
      bottom: 48,
      left: 0,
    });
  });
});

describe("Android volume-button host contract", () => {
  it("maps both volume keys and emits only the initial key-down", () => {
    expect(hostSource).toContain("KeyEvent.KEYCODE_VOLUME_UP");
    expect(hostSource).toContain("KeyEvent.KEYCODE_VOLUME_DOWN");
    expect(hostSource).toContain("event.action == KeyEvent.ACTION_DOWN");
    expect(hostSource).toContain("event.repeatCount == 0");
    expect(hostSource).toContain("source:'volume-up',direction:'backward'");
    expect(hostSource).toContain("source:'volume-down',direction:'forward'");
  });

  it("preserves system volume unless the foreground reader requested capture", () => {
    expect(hostSource).toContain("activityResumed &&");
    expect(hostSource).toContain("shouldCaptureVolumeButtons()");
    expect(hostSource).toContain("return super.dispatchKeyEvent(event)");
    expect(hostSource).toContain("event.action == KeyEvent.ACTION_UP");
    expect(hostSource).toContain("capturedVolumeKeys.remove(event.keyCode)");
    expect(hostSource).toContain("@JavascriptInterface");
  });

  it("announces bridge readiness and exposes provider names, insets and bars", () => {
    expect(hostSource).toContain("novelier:android-bridge-ready");
    expect(hostSource).toContain("OpenableColumns.DISPLAY_NAME");
    expect(hostSource).toContain("WindowInsetsCompat.Type.systemBars()");
    expect(hostSource).toContain("fun getSystemInsets()");
    expect(hostSource).toContain("fun setDarkSystemBars(enabled: Boolean)");
  });

  it("includes three-button and gesture navigation in safe-area reporting", () => {
    expect(hostSource).toContain("WindowInsetsCompat.Type.navigationBars()");
    expect(hostSource).toContain("getInsetsIgnoringVisibility(");
    expect(hostSource).toContain("stableNavigationInsets.bottom");
    expect(hostSource).toContain("WindowInsetsCompat.Type.tappableElement()");
    expect(hostSource).toContain(
      "WindowInsetsCompat.Type.mandatorySystemGestures()",
    );
    expect(hostSource).toContain("tappableInsets.bottom");
  });
});
