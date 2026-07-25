import { describe, expect, it } from "vitest";
import { createStealthSessionState } from "../appStore";

describe("desktop stealth session state", () => {
  it("applies safe automatic defaults and restores visible desktop chrome", () => {
    expect(createStealthSessionState(true, 82)).toEqual({
      stealthView: true,
      privacyMode: false,
      chromeVisible: false,
      openSurface: null,
      stealthOpacity: 28,
    });

    expect(createStealthSessionState(false, 55)).toEqual({
      stealthView: false,
      privacyMode: false,
      chromeVisible: true,
      openSurface: null,
      stealthOpacity: 55,
    });
  });
});
