export const HARDWARE_READER_NAVIGATION_EVENT =
  "novelier:hardware-reader-navigation";
export const ANDROID_BRIDGE_READY_EVENT = "novelier:android-bridge-ready";
export const ANDROID_SAFE_AREA_EVENT = "novelier:android-safe-area";

export type HardwareReaderNavigationDirection = "backward" | "forward";
export type HardwareReaderNavigationSource = "volume-up" | "volume-down";

export interface HardwareReaderNavigationIntent {
  version: 1;
  source: HardwareReaderNavigationSource;
  direction: HardwareReaderNavigationDirection;
  repeat: false;
}

export interface AndroidSafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface AndroidReaderHardwareBridge {
  setVolumeCaptureEnabled(enabled: boolean): void;
  getDisplayName(selection: string): string | null;
  getSystemInsets(): string;
  setDarkSystemBars(enabled: boolean): void;
}

declare global {
  interface Window {
    NOVELIER_READER_HARDWARE?: AndroidReaderHardwareBridge;
  }
}

function currentBridge(): AndroidReaderHardwareBridge | undefined {
  return typeof window === "undefined"
    ? undefined
    : window.NOVELIER_READER_HARDWARE;
}

export function isAndroidRuntime(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return /Android/iu.test(userAgent);
}

export function isAndroidVolumeNavigationAvailable(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
  bridge = currentBridge(),
): boolean {
  return isAndroidRuntime(userAgent) && Boolean(bridge);
}

/**
 * Native injection may happen after React's first render. Observe the ready
 * event and lifecycle re-entry, while also checking immediately so neither
 * ordering can strand volume navigation in an unavailable state.
 */
export function subscribeAndroidBridgeAvailability(
  listener: (available: boolean) => void,
  eventTarget: Window = window,
  availability: () => boolean = isAndroidVolumeNavigationAvailable,
): () => void {
  let lastValue: boolean | undefined;
  const check = () => {
    const available = availability();
    if (available !== lastValue) {
      lastValue = available;
      listener(available);
    }
  };
  const handleVisibility = () => check();
  const retryIds = [0, 100, 500, 1_500].map((delay) =>
    window.setTimeout(check, delay),
  );

  check();
  eventTarget.addEventListener(ANDROID_BRIDGE_READY_EVENT, check);
  eventTarget.addEventListener("pageshow", check);
  eventTarget.document.addEventListener("visibilitychange", handleVisibility);
  return () => {
    retryIds.forEach((id) => window.clearTimeout(id));
    eventTarget.removeEventListener(ANDROID_BRIDGE_READY_EVENT, check);
    eventTarget.removeEventListener("pageshow", check);
    eventTarget.document.removeEventListener(
      "visibilitychange",
      handleVisibility,
    );
  };
}

/**
 * Enables native key capture only while the reader can immediately handle it.
 * Returning false means the platform keeps its ordinary volume-key behavior.
 */
export function setAndroidVolumeCaptureEnabled(enabled: boolean): boolean {
  const bridge = currentBridge();
  if (!bridge) return false;

  try {
    bridge.setVolumeCaptureEnabled(Boolean(enabled));
    return true;
  } catch {
    return false;
  }
}

export function resolveAndroidDisplayName(
  selection: string,
): string | null {
  const bridge = currentBridge();
  if (!bridge) return null;
  try {
    const displayName = bridge.getDisplayName(selection);
    return typeof displayName === "string" && displayName.trim()
      ? displayName
      : null;
  } catch {
    return null;
  }
}

function normalizeSafeArea(
  value: unknown,
): AndroidSafeAreaInsets | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AndroidSafeAreaInsets>;
  const numbers = [
    candidate.top,
    candidate.right,
    candidate.bottom,
    candidate.left,
  ].map(Number);
  if (numbers.some((entry) => !Number.isFinite(entry) || entry < 0)) {
    return null;
  }
  return {
    top: numbers[0],
    right: numbers[1],
    bottom: numbers[2],
    left: numbers[3],
  };
}

export function getAndroidSafeAreaInsets(): AndroidSafeAreaInsets | null {
  const bridge = currentBridge();
  if (!bridge) return null;
  try {
    return normalizeSafeArea(JSON.parse(bridge.getSystemInsets()));
  } catch {
    return null;
  }
}

export function subscribeAndroidSafeArea(
  listener: (insets: AndroidSafeAreaInsets) => void,
  eventTarget: Window = window,
): () => void {
  const reportCurrent = () => {
    const current = getAndroidSafeAreaInsets();
    if (current) listener(current);
  };
  const handleInsets = (event: Event) => {
    const parsed = normalizeSafeArea((event as CustomEvent<unknown>).detail);
    if (parsed) listener(parsed);
  };
  reportCurrent();
  eventTarget.addEventListener(ANDROID_SAFE_AREA_EVENT, handleInsets);
  eventTarget.addEventListener(ANDROID_BRIDGE_READY_EVENT, reportCurrent);
  eventTarget.addEventListener("pageshow", reportCurrent);
  return () => {
    eventTarget.removeEventListener(ANDROID_SAFE_AREA_EVENT, handleInsets);
    eventTarget.removeEventListener(ANDROID_BRIDGE_READY_EVENT, reportCurrent);
    eventTarget.removeEventListener("pageshow", reportCurrent);
  };
}

export function setAndroidDarkSystemBars(enabled: boolean): boolean {
  const bridge = currentBridge();
  if (!bridge) return false;
  try {
    bridge.setDarkSystemBars(Boolean(enabled));
    return true;
  } catch {
    return false;
  }
}

export function parseHardwareReaderNavigation(
  event: Event,
): HardwareReaderNavigationIntent | null {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== "object") return null;

  const candidate = detail as Partial<HardwareReaderNavigationIntent>;
  const isExpectedPair =
    (candidate.source === "volume-up" &&
      candidate.direction === "backward") ||
    (candidate.source === "volume-down" &&
      candidate.direction === "forward");

  if (
    candidate.version !== 1 ||
    candidate.repeat !== false ||
    !isExpectedPair
  ) {
    return null;
  }

  return candidate as HardwareReaderNavigationIntent;
}

export function navigationDelta(
  intent: HardwareReaderNavigationIntent,
): -1 | 1 {
  return intent.direction === "backward" ? -1 : 1;
}

export function subscribeHardwareReaderNavigation(
  listener: (intent: HardwareReaderNavigationIntent) => void,
  eventTarget: EventTarget = window,
): () => void {
  const handleNavigation = (event: Event) => {
    const intent = parseHardwareReaderNavigation(event);
    if (intent) listener(intent);
  };

  eventTarget.addEventListener(
    HARDWARE_READER_NAVIGATION_EVENT,
    handleNavigation,
  );
  return () =>
    eventTarget.removeEventListener(
      HARDWARE_READER_NAVIGATION_EVENT,
      handleNavigation,
    );
}
