export interface WindowDimensions {
  width: number;
  height: number;
}

export interface WindowCoordinates {
  x: number;
  y: number;
}

export interface DesktopWindowSnapshot {
  innerSize: WindowDimensions;
  outerPosition: WindowCoordinates;
  wasMaximized: boolean;
}

export interface DesktopStealthWindowPort {
  isMaximized: () => Promise<boolean>;
  unmaximize: () => Promise<void>;
  maximize: () => Promise<void>;
  readInnerSize: () => Promise<WindowDimensions>;
  readOuterPosition: () => Promise<WindowCoordinates>;
  setMinimumSize: (size: WindowDimensions) => Promise<void>;
  setTargetSize: (size: WindowDimensions) => Promise<void>;
  restoreInnerSize: (size: WindowDimensions) => Promise<void>;
  restoreOuterPosition: (position: WindowCoordinates) => Promise<void>;
  center: () => Promise<void>;
}

interface SnapshotStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export const STEALTH_WINDOW_SNAPSHOT_KEY =
  "novelier-desktop-stealth-window-snapshot-v1";

export const STEALTH_WINDOW_SIZE: WindowDimensions = {
  width: 430,
  height: 760,
};

export const STEALTH_WINDOW_MINIMUM: WindowDimensions = {
  width: 360,
  height: 520,
};

export const DESKTOP_WINDOW_MINIMUM: WindowDimensions = {
  width: 720,
  height: 560,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isDesktopWindowSnapshot(
  value: unknown,
): value is DesktopWindowSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<DesktopWindowSnapshot>;
  return Boolean(
    snapshot.innerSize &&
      isFiniteNumber(snapshot.innerSize.width) &&
      snapshot.innerSize.width > 0 &&
      isFiniteNumber(snapshot.innerSize.height) &&
      snapshot.innerSize.height > 0 &&
      snapshot.outerPosition &&
      isFiniteNumber(snapshot.outerPosition.x) &&
      isFiniteNumber(snapshot.outerPosition.y) &&
      typeof snapshot.wasMaximized === "boolean",
  );
}

export function writeDesktopWindowSnapshot(
  storage: SnapshotStorage,
  snapshot: DesktopWindowSnapshot,
) {
  storage.setItem(STEALTH_WINDOW_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function readDesktopWindowSnapshot(
  storage: SnapshotStorage,
): DesktopWindowSnapshot | null {
  const serialized = storage.getItem(STEALTH_WINDOW_SNAPSHOT_KEY);
  if (!serialized) return null;

  try {
    const snapshot: unknown = JSON.parse(serialized);
    if (isDesktopWindowSnapshot(snapshot)) return snapshot;
  } catch {
    // Invalid or outdated session data is removed below.
  }

  storage.removeItem(STEALTH_WINDOW_SNAPSHOT_KEY);
  return null;
}

export function clearDesktopWindowSnapshot(storage: SnapshotStorage) {
  storage.removeItem(STEALTH_WINDOW_SNAPSHOT_KEY);
}

export async function restoreDesktopWindow(
  port: DesktopStealthWindowPort,
  snapshot: DesktopWindowSnapshot,
) {
  await port.restoreInnerSize(snapshot.innerSize);
  await port.restoreOuterPosition(snapshot.outerPosition);
  await port.setMinimumSize(DESKTOP_WINDOW_MINIMUM);
  if (snapshot.wasMaximized) await port.maximize();
}

export async function enterDesktopStealthWindow(
  port: DesktopStealthWindowPort,
): Promise<DesktopWindowSnapshot> {
  const wasMaximized = await port.isMaximized();
  if (wasMaximized) await port.unmaximize();

  const [innerSize, outerPosition] = await Promise.all([
    port.readInnerSize(),
    port.readOuterPosition(),
  ]);
  const snapshot = { innerSize, outerPosition, wasMaximized };

  try {
    await port.setMinimumSize(STEALTH_WINDOW_MINIMUM);
    await port.setTargetSize(STEALTH_WINDOW_SIZE);
    await port.center();
    return snapshot;
  } catch (error) {
    await restoreDesktopWindow(port, snapshot).catch(() => undefined);
    throw error;
  }
}
