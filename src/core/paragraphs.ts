export interface ParagraphEntry {
  index: number;
  /** UTF-16 offset of the first visible character in the source text. */
  start: number;
  /** Exclusive UTF-16 offset of the last visible character. */
  end: number;
  text: string;
  /** Font-independent approximation used only to size virtual scroll space. */
  visualUnits: number;
  hardBreaks: number;
}

export interface ParagraphLayoutOptions {
  contentWidth: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  paragraphSpacing: number;
  titleHeight?: number;
  bottomPadding?: number;
}

export interface ParagraphLayout {
  /** Estimated top of each paragraph; the final item is the content end. */
  tops: Float64Array;
  totalHeight: number;
}

export interface ParagraphWindow {
  startIndex: number;
  endIndexExclusive: number;
}

const paragraphSeparator = /\n[ \t\f\v]*\n+/gu;

function isTrimmableWhitespace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0xa0 ||
    code === 0xfeff
  );
}

function visualWidthForCodePoint(codePoint: number): number {
  if (codePoint === 0x09 || codePoint === 0x20 || codePoint === 0xa0) {
    return 0.34;
  }
  if (codePoint === 0x0a || codePoint === 0x0d) return 0;
  if (
    (codePoint >= 0x21 && codePoint <= 0x2f) ||
    (codePoint >= 0x3a && codePoint <= 0x40) ||
    (codePoint >= 0x5b && codePoint <= 0x60) ||
    (codePoint >= 0x7b && codePoint <= 0x7e)
  ) {
    return 0.48;
  }
  if (codePoint <= 0x7f) return 0.56;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60)
  ) {
    return 1;
  }
  return codePoint > 0xffff ? 1.08 : 0.82;
}

function measureVisualUnits(text: string): {
  visualUnits: number;
  hardBreaks: number;
} {
  let visualUnits = 0;
  let hardBreaks = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0x0a) hardBreaks += 1;
    visualUnits += visualWidthForCodePoint(codePoint);
  }
  return { visualUnits, hardBreaks };
}

/**
 * Creates immutable paragraph records once per book. The offsets point back
 * into the original source so paged and virtual readers share one locator.
 */
export function createParagraphEntries(content: string): ParagraphEntry[] {
  const entries: ParagraphEntry[] = [];

  const append = (requestedStart: number, requestedEnd: number) => {
    let start = requestedStart;
    let end = requestedEnd;
    while (start < end && isTrimmableWhitespace(content.charCodeAt(start))) {
      start += 1;
    }
    while (end > start && isTrimmableWhitespace(content.charCodeAt(end - 1))) {
      end -= 1;
    }
    if (end <= start) return;

    const text = content.slice(start, end);
    const measured = measureVisualUnits(text);
    entries.push({
      index: entries.length,
      start,
      end,
      text,
      ...measured,
    });
  };

  paragraphSeparator.lastIndex = 0;
  let cursor = 0;
  for (
    let match = paragraphSeparator.exec(content);
    match;
    match = paragraphSeparator.exec(content)
  ) {
    append(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  append(cursor, content.length);
  paragraphSeparator.lastIndex = 0;

  return entries;
}

export function paragraphIndexForOffset(
  paragraphs: readonly ParagraphEntry[],
  requestedOffset: number,
): number {
  if (paragraphs.length === 0) return -1;
  const offset = Number.isFinite(requestedOffset)
    ? Math.max(0, Math.floor(requestedOffset))
    : 0;
  if (offset <= paragraphs[0].start) return 0;
  if (offset >= paragraphs[paragraphs.length - 1].end) {
    return paragraphs.length - 1;
  }

  let low = 0;
  let high = paragraphs.length - 1;
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    if (paragraphs[middle].start <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function createParagraphLayout(
  paragraphs: readonly ParagraphEntry[],
  options: ParagraphLayoutOptions,
): ParagraphLayout {
  const fontSize = Math.max(1, options.fontSize);
  const contentWidth = Math.max(fontSize, options.contentWidth);
  const glyphAdvance = Math.max(
    fontSize * 0.45,
    fontSize * (0.94 + options.letterSpacing),
  );
  const unitsPerLine = Math.max(1, contentWidth / glyphAdvance);
  const lineHeightPixels = fontSize * Math.max(1, options.lineHeight);
  const paragraphGap = fontSize * Math.max(0, options.paragraphSpacing);
  const titleHeight = Math.max(0, options.titleHeight ?? 126);
  const bottomPadding = Math.max(0, options.bottomPadding ?? 48);
  const tops = new Float64Array(paragraphs.length + 1);
  tops[0] = titleHeight;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const wrappedLines = Math.max(
      1,
      Math.ceil(paragraph.visualUnits / unitsPerLine),
      paragraph.hardBreaks + 1,
    );
    tops[index + 1] =
      tops[index] + wrappedLines * lineHeightPixels + paragraphGap;
  }

  return {
    tops,
    totalHeight: tops[paragraphs.length] + bottomPadding,
  };
}

export function paragraphIndexForScrollTop(
  layout: ParagraphLayout,
  requestedScrollTop: number,
): number {
  const paragraphCount = Math.max(0, layout.tops.length - 1);
  if (paragraphCount === 0) return -1;
  const scrollTop = Math.max(
    0,
    Number.isFinite(requestedScrollTop) ? requestedScrollTop : 0,
  );
  if (scrollTop <= layout.tops[0]) return 0;
  if (scrollTop >= layout.tops[paragraphCount]) return paragraphCount - 1;

  let low = 0;
  let high = paragraphCount - 1;
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    if (layout.tops[middle] <= scrollTop) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function paragraphWindowForOffset(
  paragraphs: readonly ParagraphEntry[],
  requestedOffset: number,
  before = 10,
  after = 48,
): ParagraphWindow {
  if (paragraphs.length === 0) {
    return { startIndex: 0, endIndexExclusive: 0 };
  }
  const anchor = Math.max(
    0,
    paragraphIndexForOffset(paragraphs, requestedOffset),
  );
  return {
    startIndex: Math.max(0, anchor - Math.max(0, Math.floor(before))),
    endIndexExclusive: Math.min(
      paragraphs.length,
      anchor + Math.max(1, Math.floor(after)) + 1,
    ),
  };
}
