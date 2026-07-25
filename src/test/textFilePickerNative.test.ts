import { afterEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  open: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: nativeMocks.open }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: nativeMocks.readFile,
  stat: nativeMocks.stat,
}));

import { pickTextFile } from "../platform/textFilePicker";

describe("native text file selection", () => {
  afterEach(() => {
    nativeMocks.open.mockReset();
    nativeMocks.readFile.mockReset();
    nativeMocks.stat.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("reads a provider URI even when metadata lookup is unsupported", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    nativeMocks.open.mockResolvedValue(
      "content://provider/document/Download%2Fnovel.txt",
    );
    nativeMocks.stat.mockRejectedValue(new Error("unsupported stat"));
    nativeMocks.readFile.mockResolvedValue(new TextEncoder().encode("본문"));

    const file = await pickTextFile();

    expect(file).toMatchObject({ name: "novel.txt", size: 0 });
    const buffer = await file?.arrayBuffer();
    expect(buffer?.byteLength).toBe(new TextEncoder().encode("본문").byteLength);
    expect(nativeMocks.readFile).toHaveBeenCalledOnce();
  });
});
