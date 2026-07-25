import { describe, expect, it } from "vitest";
import {
  contentOffsetForProgress,
  createPageRanges,
  estimatePageCapacity,
  pageIndexForOffset,
  pageIndexForProgress,
  progressForContentOffset,
  virtualRangeForOffset,
} from "../core";

function graphemeBoundaries(text: string): Set<number> {
  const boundaries = new Set<number>([0, text.length]);
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter: new (
        locale?: string,
        options?: { granularity: "grapheme" },
      ) => {
        segment(input: string): Iterable<{ index: number; segment: string }>;
      };
    }
  ).Segmenter;

  for (const part of new Segmenter("ko", { granularity: "grapheme" }).segment(
    text,
  )) {
    boundaries.add(part.index);
    boundaries.add(part.index + part.segment.length);
  }
  return boundaries;
}

describe("page capacity estimation", () => {
  const baseLayout = {
    viewportWidth: 720,
    viewportHeight: 760,
    contentWidth: 720,
    fontSize: 18,
    lineHeight: 1.85,
    letterSpacing: 0,
    paragraphSpacing: 1.25,
    horizontalPadding: 48,
    verticalPadding: 24,
  };

  it("derives a conservative capacity from all reading dimensions", () => {
    const estimate = estimatePageCapacity(baseLayout);

    expect(estimate).toMatchObject({
      usableWidth: 624,
      usableHeight: 712,
    });
    expect(estimate.charactersPerLine).toBeGreaterThan(20);
    expect(estimate.linesPerPage).toBeGreaterThan(10);
    expect(estimate.charactersPerPage).toBeLessThan(
      estimate.charactersPerLine * estimate.linesPerPage,
    );
  });

  it("reduces capacity for smaller content, larger type, and extra spacing", () => {
    const base = estimatePageCapacity(baseLayout).charactersPerPage;
    const constrained = estimatePageCapacity({
      ...baseLayout,
      contentWidth: 480,
      fontSize: 26,
      lineHeight: 2,
      letterSpacing: 0.08,
      paragraphSpacing: 2,
      reservedVerticalSpace: 100,
    }).charactersPerPage;

    expect(constrained).toBeLessThan(base);
  });
});

describe("Unicode-safe page ranges", () => {
  it("creates contiguous ranges without splitting grapheme clusters", () => {
    const text =
      "가나다e\u0301라마👨‍👩‍👧‍👦바사🇰🇷아자차카타파하🙂끝";
    const ranges = createPageRanges(text, {
      charactersPerPage: 5,
      paragraphBoundaryWindow: 0,
    });
    const boundaries = graphemeBoundaries(text);

    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges[0].start).toBe(0);
    expect(ranges.at(-1)?.end).toBe(text.length);
    for (const [index, range] of ranges.entries()) {
      expect(range).toEqual({
        index,
        start: range.start,
        end: range.end,
      });
      expect(range.end).toBeGreaterThan(range.start);
      expect(boundaries.has(range.start)).toBe(true);
      expect(boundaries.has(range.end)).toBe(true);
      if (index > 0) expect(range.start).toBe(ranges[index - 1].end);
    }
  });

  it("prefers a nearby paragraph end and never emits an empty page", () => {
    const firstParagraph = "가".repeat(78);
    const text = `${firstParagraph}\n\n${"나".repeat(130)}`;
    const ranges = createPageRanges(text, {
      charactersPerPage: 100,
      paragraphBoundaryWindow: 30,
      minimumFillRatio: 0.6,
    });

    expect(ranges[0]).toEqual({
      index: 0,
      start: 0,
      end: firstParagraph.length + 2,
    });
    expect(ranges.every(({ start, end }) => end > start)).toBe(true);

    const newlineOnly = createPageRanges("\n".repeat(100), {
      charactersPerPage: 1,
      paragraphBoundaryWindow: 16,
    });
    expect(newlineOnly.every(({ start, end }) => end > start)).toBe(true);
    expect(newlineOnly.at(-1)?.end).toBe(100);
  });

  it("uses a distinct deterministic first-page capacity", () => {
    const text = "가".repeat(1_000);
    const options = {
      charactersPerPage: 200,
      firstPageCharacters: 120,
      paragraphBoundaryWindow: 0,
    };

    expect(createPageRanges(text, options)).toEqual(
      createPageRanges(text, options),
    );
    expect(createPageRanges(text, options).slice(0, 2)).toEqual([
      { index: 0, start: 0, end: 120 },
      { index: 1, start: 120, end: 320 },
    ]);
  });
});

describe("page lookup and virtual ranges", () => {
  const ranges = createPageRanges("가".repeat(1_000), {
    charactersPerPage: 100,
    paragraphBoundaryWindow: 0,
  });

  it("binary-searches boundaries and clamps outside offsets", () => {
    expect(pageIndexForOffset([], 10)).toBe(-1);
    expect(pageIndexForOffset(ranges, -10)).toBe(0);
    expect(pageIndexForOffset(ranges, 99)).toBe(0);
    expect(pageIndexForOffset(ranges, 100)).toBe(1);
    expect(pageIndexForOffset(ranges, 1_000)).toBe(9);
    expect(pageIndexForOffset(ranges, 2_000)).toBe(9);
  });

  it("restores pages from stable progress and converts offsets", () => {
    expect(contentOffsetForProgress(1_000, 0.45)).toBe(450);
    expect(progressForContentOffset(1_000, 450)).toBe(0.45);
    expect(pageIndexForProgress(ranges, 0.45)).toBe(4);
    expect(pageIndexForProgress(ranges, 1)).toBe(9);
  });

  it("returns an overscanned source window without page bodies", () => {
    expect(virtualRangeForOffset(ranges, 450, 2)).toEqual({
      startPageIndex: 2,
      endPageIndexExclusive: 7,
      startOffset: 200,
      endOffset: 700,
    });
    expect(virtualRangeForOffset([], 0)).toBeNull();
  });
});

describe("large-text pagination", () => {
  it(
    "builds offset-only ranges for a 50MiB source with linear work",
    () => {
      const source = "a".repeat(50 * 1024 * 1024);
      const startedAt = performance.now();
      const ranges = createPageRanges(source, {
        charactersPerPage: 1_024,
        paragraphBoundaryWindow: 128,
      });
      const elapsed = performance.now() - startedAt;

      expect(ranges).toHaveLength(50 * 1024);
      expect(ranges[0]).toEqual({ index: 0, start: 0, end: 1_024 });
      expect(ranges.at(-1)?.end).toBe(source.length);
      expect(
        ranges.every(
          (range) =>
            typeof range.index === "number" &&
            typeof range.start === "number" &&
            typeof range.end === "number" &&
            Object.keys(range).length === 3,
        ),
      ).toBe(true);
      expect(elapsed).toBeLessThan(5_000);
    },
    15_000,
  );
});
