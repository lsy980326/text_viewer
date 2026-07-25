/**
 * Layout inputs used to estimate a conservative page capacity. Spacing values
 * use the same units as ReaderSettings: lineHeight is unitless while letter
 * and paragraph spacing are expressed in em.
 */
export interface PaginationLayout {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  paragraphSpacing: number;
  horizontalPadding?: number;
  verticalPadding?: number;
  reservedVerticalSpace?: number;
  /**
   * Expected glyph advance in em before letter spacing. The conservative
   * default is tuned for mixed Korean and Latin prose.
   */
  averageGlyphWidth?: number;
  /** Additional capacity reduction used to absorb font and wrapping variance. */
  safetyFactor?: number;
  /** Expected number of text lines per paragraph. */
  averageParagraphLines?: number;
}

export interface PageCapacityEstimate {
  charactersPerPage: number;
  charactersPerLine: number;
  linesPerPage: number;
  usableWidth: number;
  usableHeight: number;
  glyphAdvance: number;
  lineHeightPixels: number;
}

/**
 * A half-open range into the original string. Offsets are JavaScript UTF-16
 * offsets so callers can pass them directly to String#slice or DOM APIs.
 * Range construction never stores or copies the corresponding page body.
 */
export interface PageRange {
  index: number;
  start: number;
  end: number;
}

export interface PageRangeOptions {
  charactersPerPage: number;
  /** Optional smaller first-page capacity for a title or other leading UI. */
  firstPageCharacters?: number;
  /**
   * Maximum UTF-16 distance from the estimated end at which a paragraph
   * boundary may be preferred.
   */
  paragraphBoundaryWindow?: number;
  /** Minimum share of the estimated capacity before an early break is used. */
  minimumFillRatio?: number;
}

export interface VirtualContentRange {
  startPageIndex: number;
  endPageIndexExclusive: number;
  startOffset: number;
  endOffset: number;
}

interface GraphemePart {
  segment: string;
  index: number;
}

interface SegmentCollection {
  containing?(index: number): GraphemePart | undefined;
}

type SegmenterLike = {
  segment(input: string): SegmentCollection;
};

const DEFAULT_GLYPH_WIDTH_EM = 0.95;
const DEFAULT_SAFETY_FACTOR = 0.88;
const DEFAULT_PARAGRAPH_LINES = 5;
const DEFAULT_MINIMUM_FILL_RATIO = 0.68;
const MAX_BOUNDARY_WINDOW = 2_048;

let graphemeSegmenter: SegmenterLike | null | undefined;

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: number | undefined, fallback: number): number {
  const finite = finiteOr(value, fallback);
  return finite > 0 ? finite : fallback;
}

function nonNegative(value: number | undefined): number {
  return Math.max(0, finiteOr(value, 0));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Produces a conservative capacity rather than attempting font-specific text
 * measurement. Exact DOM pagination can refine the result later without
 * changing the source-offset contract.
 */
export function estimatePageCapacity(
  layout: PaginationLayout,
): PageCapacityEstimate {
  const viewportWidth = positiveOr(layout.viewportWidth, 1);
  const viewportHeight = positiveOr(layout.viewportHeight, 1);
  const fontSize = positiveOr(layout.fontSize, 16);
  const lineHeight = positiveOr(layout.lineHeight, 1.6);
  const horizontalPadding = nonNegative(layout.horizontalPadding);
  const verticalPadding = nonNegative(layout.verticalPadding);
  const reservedVerticalSpace = nonNegative(layout.reservedVerticalSpace);
  const paddedViewportWidth = Math.max(
    fontSize,
    viewportWidth - horizontalPadding * 2,
  );
  const usableWidth = Math.max(
    fontSize,
    Math.min(
      paddedViewportWidth,
      positiveOr(layout.contentWidth, paddedViewportWidth),
    ),
  );
  const usableHeight = Math.max(
    fontSize * lineHeight,
    viewportHeight - verticalPadding * 2 - reservedVerticalSpace,
  );

  const averageGlyphWidth = clamp(
    positiveOr(layout.averageGlyphWidth, DEFAULT_GLYPH_WIDTH_EM),
    0.5,
    1.5,
  );
  const effectiveLetterSpacing = Math.max(
    -averageGlyphWidth * 0.25,
    finiteOr(layout.letterSpacing, 0),
  );
  const glyphAdvance = Math.max(
    fontSize * 0.5,
    fontSize * (averageGlyphWidth + effectiveLetterSpacing),
  );
  const lineHeightPixels = fontSize * lineHeight;
  const rawLines = Math.max(1, Math.floor(usableHeight / lineHeightPixels));
  const averageParagraphLines = Math.max(
    1,
    positiveOr(layout.averageParagraphLines, DEFAULT_PARAGRAPH_LINES),
  );
  const paragraphBreaks = Math.max(
    0,
    Math.ceil(rawLines / averageParagraphLines) - 1,
  );
  const paragraphSpacingPixels =
    nonNegative(layout.paragraphSpacing) * fontSize * paragraphBreaks;
  const linesPerPage = Math.max(
    1,
    Math.floor(
      (usableHeight - paragraphSpacingPixels) / lineHeightPixels,
    ),
  );
  const charactersPerLine = Math.max(
    1,
    Math.floor(usableWidth / glyphAdvance),
  );
  const safetyFactor = clamp(
    positiveOr(layout.safetyFactor, DEFAULT_SAFETY_FACTOR),
    0.5,
    1,
  );

  return {
    charactersPerPage: Math.max(
      1,
      Math.floor(charactersPerLine * linesPerPage * safetyFactor),
    ),
    charactersPerLine,
    linesPerPage,
    usableWidth,
    usableHeight,
    glyphAdvance,
    lineHeightPixels,
  };
}

function getGraphemeSegmenter(): SegmenterLike | null {
  if (graphemeSegmenter !== undefined) return graphemeSegmenter;

  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "grapheme" },
      ) => SegmenterLike;
    }
  ).Segmenter;

  graphemeSegmenter = Segmenter
    ? new Segmenter("ko", { granularity: "grapheme" })
    : null;
  return graphemeSegmenter;
}

function codePointAt(text: string, index: number): number {
  return text.codePointAt(index) ?? 0;
}

function previousCodePointIndex(text: string, index: number): number {
  if (index <= 0) return 0;
  const previous = text.charCodeAt(index - 1);
  return previous >= 0xdc00 &&
    previous <= 0xdfff &&
    index >= 2 &&
    text.charCodeAt(index - 2) >= 0xd800 &&
    text.charCodeAt(index - 2) <= 0xdbff
    ? index - 2
    : index - 1;
}

function nextCodePointIndex(text: string, index: number): number {
  if (index >= text.length) return text.length;
  return Math.min(text.length, index + (codePointAt(text, index) > 0xffff ? 2 : 1));
}

const unicodeMark = /^\p{Mark}$/u;

function isGraphemeExtension(codePoint: number): boolean {
  return (
    unicodeMark.test(String.fromCodePoint(codePoint)) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
  );
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

function fallbackClusterStart(text: string, requestedOffset: number): number {
  let offset = clamp(Math.floor(requestedOffset), 0, text.length);
  if (
    offset > 0 &&
    offset < text.length &&
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff
  ) {
    offset -= 1;
  }

  while (offset > 0 && offset < text.length) {
    const current = codePointAt(text, offset);
    const previousIndex = previousCodePointIndex(text, offset);
    const previous = codePointAt(text, previousIndex);
    if (
      isGraphemeExtension(current) ||
      current === 0x200d ||
      previous === 0x200d
    ) {
      offset = previousIndex;
      continue;
    }
    break;
  }

  if (offset > 0 && isRegionalIndicator(codePointAt(text, offset))) {
    const previousIndex = previousCodePointIndex(text, offset);
    if (isRegionalIndicator(codePointAt(text, previousIndex))) {
      return previousIndex;
    }
  }
  return offset;
}

function fallbackClusterEnd(text: string, clusterStart: number): number {
  if (clusterStart >= text.length) return text.length;
  let offset = nextCodePointIndex(text, clusterStart);
  const first = codePointAt(text, clusterStart);

  if (
    isRegionalIndicator(first) &&
    offset < text.length &&
    isRegionalIndicator(codePointAt(text, offset))
  ) {
    offset = nextCodePointIndex(text, offset);
  }

  while (offset < text.length) {
    const current = codePointAt(text, offset);
    if (isGraphemeExtension(current)) {
      offset = nextCodePointIndex(text, offset);
      continue;
    }
    if (current === 0x200d) {
      offset = nextCodePointIndex(text, offset);
      if (offset < text.length) {
        offset = nextCodePointIndex(text, offset);
      }
      continue;
    }
    break;
  }
  return offset;
}

function snapForwardToGraphemeBoundary(
  text: string,
  requestedOffset: number,
  segments: SegmentCollection | null,
): number {
  const offset = clamp(Math.floor(requestedOffset), 0, text.length);
  if (offset === 0 || offset === text.length) return offset;

  const containing = segments?.containing?.(offset);
  if (containing) {
    if (containing.index === offset) return offset;
    return Math.min(
      text.length,
      containing.index + containing.segment.length,
    );
  }

  const start = fallbackClusterStart(text, offset);
  return start === offset ? offset : fallbackClusterEnd(text, start);
}

function lineBreakLengthAt(text: string, index: number): number {
  const code = text.charCodeAt(index);
  if (code === 0x0a) return 1;
  if (code === 0x0d) {
    return text.charCodeAt(index + 1) === 0x0a ? 2 : 1;
  }
  return 0;
}

function isInlineWhitespace(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code === 0x09 || code === 0x20;
}

/**
 * Scans only the bounded candidate window. This prevents the repeated
 * backward scans that would make boundary preference quadratic for prose with
 * no blank lines.
 */
function nearbyParagraphBoundary(
  text: string,
  minimum: number,
  target: number,
  maximum: number,
): number | null {
  const scanStart = Math.max(0, minimum - 4);
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let index = scanStart;

  while (index < maximum) {
    const firstBreakLength = lineBreakLengthAt(text, index);
    if (firstBreakLength === 0) {
      index += 1;
      continue;
    }

    let cursor = index;
    let lineBreaks = 0;
    while (cursor < maximum) {
      const breakLength = lineBreakLengthAt(text, cursor);
      if (breakLength > 0) {
        lineBreaks += 1;
        cursor += breakLength;
        continue;
      }
      if (isInlineWhitespace(text, cursor)) {
        cursor += 1;
        continue;
      }
      break;
    }

    if (lineBreaks >= 2 && cursor >= minimum && cursor <= maximum) {
      const distance = Math.abs(cursor - target);
      if (distance < bestDistance || (distance === bestDistance && cursor < target)) {
        best = cursor;
        bestDistance = distance;
      }
    }
    index = Math.max(index + 1, cursor);
  }

  return best;
}

/**
 * Builds deterministic half-open ranges in a single forward pass over the
 * source. Candidate-window scans are bounded by the page capacity, making the
 * total work O(source length) and suitable for the 50MB import limit.
 */
export function createPageRanges(
  content: string,
  options: PageRangeOptions,
): PageRange[] {
  if (content.length === 0) return [];

  const regularCapacity = Math.max(
    1,
    Math.floor(positiveOr(options.charactersPerPage, 1)),
  );
  const firstCapacity = Math.max(
    1,
    Math.floor(positiveOr(options.firstPageCharacters, regularCapacity)),
  );
  const minimumFillRatio = clamp(
    positiveOr(options.minimumFillRatio, DEFAULT_MINIMUM_FILL_RATIO),
    0.1,
    1,
  );
  const requestedWindow = options.paragraphBoundaryWindow;
  const segments = getGraphemeSegmenter()?.segment(content) ?? null;
  const ranges: PageRange[] = [];
  let start = 0;

  while (start < content.length) {
    const capacity = ranges.length === 0 ? firstCapacity : regularCapacity;
    const target = Math.min(content.length, start + capacity);
    if (target === content.length) {
      ranges.push({ index: ranges.length, start, end: content.length });
      break;
    }

    const defaultWindow = Math.min(
      MAX_BOUNDARY_WINDOW,
      Math.max(16, Math.floor(capacity * 0.22)),
    );
    const boundaryWindow = Math.max(
      0,
      Math.floor(nonNegative(requestedWindow ?? defaultWindow)),
    );
    const minimum = Math.min(
      target,
      Math.max(
        target - boundaryWindow,
        start + Math.max(1, Math.floor(capacity * minimumFillRatio)),
      ),
    );
    const maximum = Math.min(content.length, target + boundaryWindow);
    const preferred =
      boundaryWindow > 0
        ? nearbyParagraphBoundary(content, minimum, target, maximum)
        : null;
    let end = snapForwardToGraphemeBoundary(
      content,
      preferred ?? target,
      segments,
    );

    if (end <= start) {
      end = snapForwardToGraphemeBoundary(content, start + 1, segments);
    }
    if (end <= start) {
      // A malformed or unavailable segmenter must never produce a zero page.
      end = Math.min(content.length, nextCodePointIndex(content, start));
    }

    ranges.push({ index: ranges.length, start, end });
    start = end;
  }

  return ranges;
}

/**
 * Finds the page containing an offset in O(log page count). An offset exactly
 * at an internal boundary belongs to the following page; EOF belongs to the
 * final page.
 */
export function pageIndexForOffset(
  ranges: readonly PageRange[],
  requestedOffset: number,
): number {
  if (ranges.length === 0) return -1;
  const finalOffset = ranges[ranges.length - 1].end;
  const offset = clamp(
    Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0,
    ranges[0].start,
    finalOffset,
  );
  if (offset >= finalOffset) return ranges.length - 1;

  let low = 0;
  let high = ranges.length - 1;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (offset < ranges[middle].end) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function contentOffsetForProgress(
  contentLength: number,
  requestedProgress: number,
): number {
  const length = Math.max(
    0,
    Number.isFinite(contentLength) ? Math.floor(contentLength) : 0,
  );
  const progress = clamp(
    Number.isFinite(requestedProgress) ? requestedProgress : 0,
    0,
    1,
  );
  return Math.round(length * progress);
}

export function progressForContentOffset(
  contentLength: number,
  requestedOffset: number,
): number {
  const length = Math.max(
    0,
    Number.isFinite(contentLength) ? Math.floor(contentLength) : 0,
  );
  if (length === 0) return 0;
  return (
    clamp(
      Number.isFinite(requestedOffset) ? requestedOffset : 0,
      0,
      length,
    ) / length
  );
}

/** Resolves a persisted locator progress directly to the repaginated page. */
export function pageIndexForProgress(
  ranges: readonly PageRange[],
  requestedProgress: number,
): number {
  if (ranges.length === 0) return -1;
  return pageIndexForOffset(
    ranges,
    contentOffsetForProgress(
      ranges[ranges.length - 1].end,
      requestedProgress,
    ),
  );
}

/**
 * Returns the source span needed for a virtualized reader around an absolute
 * offset. The end page index is exclusive, matching Array#slice.
 */
export function virtualRangeForOffset(
  ranges: readonly PageRange[],
  requestedOffset: number,
  overscanPages = 2,
): VirtualContentRange | null {
  const pageIndex = pageIndexForOffset(ranges, requestedOffset);
  if (pageIndex < 0) return null;

  const overscan = Math.max(
    0,
    Number.isFinite(overscanPages) ? Math.floor(overscanPages) : 0,
  );
  const startPageIndex = Math.max(0, pageIndex - overscan);
  const endPageIndexExclusive = Math.min(
    ranges.length,
    pageIndex + overscan + 1,
  );

  return {
    startPageIndex,
    endPageIndexExclusive,
    startOffset: ranges[startPageIndex].start,
    endOffset: ranges[endPageIndexExclusive - 1].end,
  };
}
