import { describe, expect, it } from "vitest";
import { filenameFromSelection } from "../platform/textFilePicker";

describe("cross-platform text selection", () => {
  it.each([
    ["/Users/reader/달빛%20아래서.txt", "달빛 아래서.txt"],
    ["file:///private/mobile/별%20헤는%20밤.TXT", "별 헤는 밤.TXT"],
    [
      "content://provider/document/primary%3ADownload%2F유리창%20너머.txt",
      "유리창 너머.txt",
    ],
    [
      "content://provider/document/42?displayName=%EC%86%8C%EC%84%A4.txt",
      "소설.txt",
    ],
  ])("recovers a TXT basename from %s", (selection, expected) => {
    expect(filenameFromSelection(selection)).toBe(expected);
  });

  it("keeps provider-only identifiers importable as TXT", () => {
    expect(filenameFromSelection("content://provider/document/msf%3A42")).toBe(
      "42.txt",
    );
  });

  it("prefers and sanitizes the provider's real display name", () => {
    expect(
      filenameFromSelection(
        "content://provider/document/msf%3A42",
        "  달\u0000빛 아래서.txt ",
      ),
    ).toBe("달빛 아래서.txt");
  });
});
