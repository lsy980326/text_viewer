import { describe, expect, it } from "vitest";
import {
  contextHashAt,
  createParagraphBlocks,
  createReadingLocator,
  locatorFromProgress,
  resolveReadingLocator,
} from "../core";

describe("stable reading locators", () => {
  const blocks = createParagraphBlocks(
    "첫 번째 문단입니다.\n\n두 번째 문단에는 찾을 위치가 있습니다.\n\n마지막 문단입니다.",
    { bookId: "book-1" },
  );

  it("stores block identity, grapheme offset, context, and progress", () => {
    const locator = createReadingLocator("book-1", blocks, 1, 8, 100);

    expect(locator).toMatchObject({
      bookId: "book-1",
      blockId: "book-1:1",
      blockIndex: 1,
      characterOffset: 8,
      updatedAt: 100,
    });
    expect(locator.contextHash).toBe(contextHashAt(blocks[1].content, 8));
    expect(locator.progress).toBeGreaterThan(0);
    expect(locator.progress).toBeLessThan(1);
  });

  it("resolves the same sentence after visual pagination changes", () => {
    const locator = createReadingLocator("book-1", blocks, 1, 11, 100);
    expect(resolveReadingLocator(locator, [...blocks])).toEqual(locator);
  });

  it("creates boundary-safe locations from percentage jumps", () => {
    expect(locatorFromProgress("book-1", blocks, -2).progress).toBe(0);
    const end = locatorFromProgress("book-1", blocks, 2);
    expect(end.progress).toBe(1);
    expect(end.blockIndex).toBe(blocks.at(-1)?.index);
    expect(end.characterOffset).toBe(blocks.at(-1)?.characterCount);
  });
});
