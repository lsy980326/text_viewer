import { describe, expect, it } from "vitest";
import desktopCapability from "../../src-tauri/capabilities/desktop-window.json";
import rustWindowSource from "../../src-tauri/src/lib.rs?raw";
import macOsConfig from "../../src-tauri/tauri.macos.conf.json";
import windowsConfig from "../../src-tauri/tauri.windows.conf.json";

interface WindowConfig {
  app: {
    windows: Array<{
      decorations?: boolean;
      shadow?: boolean;
      transparent?: boolean;
    }>;
  };
}

describe("desktop privacy window configuration", () => {
  it.each([
    ["macOS", macOsConfig],
    ["Windows", windowsConfig],
  ] satisfies Array<[string, WindowConfig]>)(
    "keeps the %s shell frameless, shadowless and transparent",
    (_, config) => {
    expect(config.app.windows[0]).toMatchObject({
      decorations: false,
      shadow: false,
      transparent: true,
    });
    },
  );

  it("allows only the native window mutations used by the desktop shell", () => {
    expect(desktopCapability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-start-dragging",
        "core:window:allow-minimize",
        "core:window:allow-set-decorations",
        "core:window:allow-set-shadow",
        "core:window:allow-set-min-size",
        "core:window:allow-set-size",
        "core:window:allow-set-position",
        "core:window:allow-center",
      ]),
    );
    expect(desktopCapability.permissions).not.toContain(
      "core:window:allow-hide",
    );
  });

  it("uses recoverable native minimization and keeps Dock reopen recovery outside the webview", () => {
    expect(rustWindowSource).toContain("window.is_minimized()");
    expect(rustWindowSource).toContain("window.minimize()");
    expect(rustWindowSource).toContain("window.unminimize()");
    expect(rustWindowSource).toContain("tauri::RunEvent::Reopen");
    expect(rustWindowSource).toContain("window.set_focus()");
    expect(rustWindowSource).not.toContain("window.hide()");
  });
});
