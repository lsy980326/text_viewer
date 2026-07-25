import { describe, expect, it, vi } from "vitest";
import {
  clearDesktopWindowSnapshot,
  DESKTOP_WINDOW_MINIMUM,
  enterDesktopStealthWindow,
  readDesktopWindowSnapshot,
  restoreDesktopWindow,
  STEALTH_WINDOW_SNAPSHOT_KEY,
  STEALTH_WINDOW_MINIMUM,
  STEALTH_WINDOW_SIZE,
  type DesktopStealthWindowPort,
  writeDesktopWindowSnapshot,
} from "../platform/desktopStealthWindow";

function createPort(options: { maximized?: boolean; failResize?: boolean } = {}) {
  const calls: string[] = [];
  const record = <T>(name: string, value?: T) => {
    calls.push(value === undefined ? name : `${name}:${JSON.stringify(value)}`);
  };
  const port: DesktopStealthWindowPort = {
    isMaximized: vi.fn(async () => {
      record("isMaximized");
      return options.maximized ?? false;
    }),
    unmaximize: vi.fn(async () => record("unmaximize")),
    maximize: vi.fn(async () => record("maximize")),
    readInnerSize: vi.fn(async () => {
      record("readInnerSize");
      return { width: 1280, height: 900 };
    }),
    readOuterPosition: vi.fn(async () => {
      record("readOuterPosition");
      return { x: 120, y: 80 };
    }),
    setMinimumSize: vi.fn(async (value) =>
      record("setMinimumSize", value),
    ),
    setTargetSize: vi.fn(async (value) => {
      record("setTargetSize", value);
      if (options.failResize) throw new Error("resize failed");
    }),
    restoreInnerSize: vi.fn(async (value) =>
      record("restoreInnerSize", value),
    ),
    restoreOuterPosition: vi.fn(async (value) =>
      record("restoreOuterPosition", value),
    ),
    center: vi.fn(async () => record("center")),
  };
  return { calls, port };
}

describe("desktop stealth window geometry", () => {
  it("captures normal geometry and enters a centered mobile-shaped window", async () => {
    const { calls, port } = createPort({ maximized: true });

    const snapshot = await enterDesktopStealthWindow(port);

    expect(snapshot).toEqual({
      innerSize: { width: 1280, height: 900 },
      outerPosition: { x: 120, y: 80 },
      wasMaximized: true,
    });
    expect(calls).toEqual([
      "isMaximized",
      "unmaximize",
      "readInnerSize",
      "readOuterPosition",
      `setMinimumSize:${JSON.stringify(STEALTH_WINDOW_MINIMUM)}`,
      `setTargetSize:${JSON.stringify(STEALTH_WINDOW_SIZE)}`,
      "center",
    ]);
  });

  it("keeps a validated recovery snapshot only for the current session", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const snapshot = {
      innerSize: { width: 1180, height: 780 },
      outerPosition: { x: -420, y: 36 },
      wasMaximized: false,
    };

    writeDesktopWindowSnapshot(storage, snapshot);
    expect(readDesktopWindowSnapshot(storage)).toEqual(snapshot);
    clearDesktopWindowSnapshot(storage);
    expect(storage.getItem(STEALTH_WINDOW_SNAPSHOT_KEY)).toBeNull();
  });

  it("discards malformed recovery geometry instead of moving the window", () => {
    const values = new Map([
      [
        STEALTH_WINDOW_SNAPSHOT_KEY,
        JSON.stringify({
          innerSize: { width: -1, height: 760 },
          outerPosition: { x: 0, y: 0 },
          wasMaximized: false,
        }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    expect(readDesktopWindowSnapshot(storage)).toBeNull();
    expect(storage.getItem(STEALTH_WINDOW_SNAPSHOT_KEY)).toBeNull();
  });

  it("restores size, position, minimum constraints and maximized state", async () => {
    const { calls, port } = createPort();

    await restoreDesktopWindow(port, {
      innerSize: { width: 1024, height: 768 },
      outerPosition: { x: 40, y: 30 },
      wasMaximized: true,
    });

    expect(calls).toEqual([
      'restoreInnerSize:{"width":1024,"height":768}',
      'restoreOuterPosition:{"x":40,"y":30}',
      `setMinimumSize:${JSON.stringify(DESKTOP_WINDOW_MINIMUM)}`,
      "maximize",
    ]);
  });

  it("rolls back desktop geometry when the compact resize fails", async () => {
    const { calls, port } = createPort({ failResize: true });

    await expect(enterDesktopStealthWindow(port)).rejects.toThrow(
      "resize failed",
    );
    expect(calls).toContain(
      `setMinimumSize:${JSON.stringify(DESKTOP_WINDOW_MINIMUM)}`,
    );
    expect(calls).toContain(
      'restoreInnerSize:{"width":1280,"height":900}',
    );
    expect(calls).toContain(
      'restoreOuterPosition:{"x":120,"y":80}',
    );
  });
});
