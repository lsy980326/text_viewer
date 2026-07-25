import { describe, expect, it } from "vitest";
import {
  createParagraphEntries,
  createParagraphLayout,
  paragraphIndexForOffset,
  paragraphIndexForScrollTop,
  paragraphWindowForOffset,
} from "../core";

describe("paragraph ranges and virtual layout", () => {
  const content = [
    "첫 문단입니다.",
    "둘째 문단은\n한 줄을 더 씁니다.",
    "  셋째 문단입니다.  ",
  ].join("\n\n");
  const paragraphs = createParagraphEntries(content);

  it("keeps stable global source offsets while trimming separators", () => {
    expect(paragraphs.map(({ index, text }) => ({ index, text }))).toEqual([
      { index: 0, text: "첫 문단입니다." },
      { index: 1, text: "둘째 문단은\n한 줄을 더 씁니다." },
      { index: 2, text: "셋째 문단입니다." },
    ]);
    for (const paragraph of paragraphs) {
      expect(content.slice(paragraph.start, paragraph.end)).toBe(paragraph.text);
    }
    expect(paragraphs[2].start).toBe(content.indexOf("셋째"));
  });

  it("looks up source offsets and clamps virtual windows", () => {
    expect(paragraphIndexForOffset(paragraphs, 0)).toBe(0);
    expect(paragraphIndexForOffset(paragraphs, paragraphs[1].start)).toBe(1);
    expect(paragraphIndexForOffset(paragraphs, content.length)).toBe(2);
    expect(paragraphWindowForOffset(paragraphs, paragraphs[1].start, 1, 1)).toEqual(
      { startIndex: 0, endIndexExclusive: 3 },
    );
  });

  it("builds a monotonic estimated scroll space", () => {
    const layout = createParagraphLayout(paragraphs, {
      contentWidth: 320,
      fontSize: 20,
      lineHeight: 1.8,
      letterSpacing: 0,
      paragraphSpacing: 1.2,
    });

    expect([...layout.tops]).toEqual(
      [...layout.tops].slice().sort((left, right) => left - right),
    );
    expect(layout.totalHeight).toBeGreaterThan(layout.tops.at(-1) ?? 0);
    expect(paragraphIndexForScrollTop(layout, 0)).toBe(0);
    expect(paragraphIndexForScrollTop(layout, layout.tops[1])).toBe(1);
    expect(paragraphIndexForScrollTop(layout, layout.totalHeight)).toBe(2);
  });

  it("keeps a large virtual window bounded", () => {
    const large = createParagraphEntries(
      Array.from({ length: 3_000 }, (_, index) => `${index} 문단`).join("\n\n"),
    );
    const window = paragraphWindowForOffset(
      large,
      large[2_500].start,
      10,
      48,
    );

    expect(window.endIndexExclusive - window.startIndex).toBeLessThanOrEqual(59);
    expect(window.startIndex).toBe(2_490);
  });

  it(
    "indexes a 50MiB-shaped source without creating paragraph DOM data",
    () => {
      const source = "a".repeat(50 * 1024 * 1024);
      const startedAt = performance.now();
      const entries = createParagraphEntries(source);
      const layout = createParagraphLayout(entries, {
        contentWidth: 720,
        fontSize: 18,
        lineHeight: 1.85,
        letterSpacing: 0,
        paragraphSpacing: 1.25,
      });
      const elapsed = performance.now() - startedAt;

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        index: 0,
        start: 0,
        end: source.length,
      });
      expect(layout.totalHeight).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(5_000);
    },
    15_000,
  );
});
