import type { ReadingLocator, TextBlock } from "./types";
import { hashString, segmentGraphemes } from "./text";

const CONTEXT_RADIUS = 24;

function clampedOffset(block: TextBlock, offset: number): number {
  return Math.max(0, Math.min(block.characterCount, Math.floor(offset)));
}

export function contextHashAt(
  content: string,
  characterOffset: number,
): string {
  const graphemes = segmentGraphemes(content).map(({ segment }) => segment);
  const offset = Math.max(0, Math.min(graphemes.length, characterOffset));
  const before = graphemes
    .slice(Math.max(0, offset - CONTEXT_RADIUS), offset)
    .join("");
  const after = graphemes
    .slice(offset, Math.min(graphemes.length, offset + CONTEXT_RADIUS))
    .join("");
  return hashString(`${before}\u241f${after}`);
}

function totalCharacters(blocks: readonly TextBlock[]): number {
  return blocks.reduce(
    (total, block) =>
      Math.max(total, block.characterStart + block.characterCount),
    0,
  );
}

export function progressAt(
  blocks: readonly TextBlock[],
  blockIndex: number,
  characterOffset: number,
): number {
  const block = blocks.find(({ index }) => index === blockIndex);
  const total = totalCharacters(blocks);
  if (!block || total === 0) return 0;
  return Math.min(
    1,
    Math.max(0, (block.characterStart + clampedOffset(block, characterOffset)) / total),
  );
}

export function createReadingLocator(
  bookId: string,
  blocks: readonly TextBlock[],
  blockIndex: number,
  characterOffset = 0,
  updatedAt = Date.now(),
): ReadingLocator {
  const fallback = blocks[0];
  const block =
    blocks.find(({ index }) => index === blockIndex) ??
    blocks.at(-1) ??
    fallback;

  if (!block) {
    return {
      bookId,
      blockId: `${bookId}:0`,
      blockIndex: 0,
      characterOffset: 0,
      contextHash: hashString(""),
      progress: 0,
      updatedAt,
    };
  }

  const offset = clampedOffset(block, characterOffset);
  return {
    bookId,
    blockId: block.id,
    blockIndex: block.index,
    characterOffset: offset,
    contextHash: contextHashAt(block.content, offset),
    progress: progressAt(blocks, block.index, offset),
    updatedAt,
  };
}

/**
 * Resolves a stable locator after pagination or typography changes. Imported
 * book content is immutable, so block identity is the fast path. The context
 * hash is used to recover from a re-segmentation around the saved block.
 */
export function resolveReadingLocator(
  locator: ReadingLocator,
  blocks: readonly TextBlock[],
): ReadingLocator {
  if (blocks.length === 0) {
    return createReadingLocator(locator.bookId, blocks, 0, 0, locator.updatedAt);
  }

  const exact = blocks.find(
    (block) =>
      block.id === locator.blockId || block.index === locator.blockIndex,
  );
  if (
    exact &&
    contextHashAt(
      exact.content,
      clampedOffset(exact, locator.characterOffset),
    ) === locator.contextHash
  ) {
    return createReadingLocator(
      locator.bookId,
      blocks,
      exact.index,
      locator.characterOffset,
      locator.updatedAt,
    );
  }

  const orderedCandidates = exact
    ? [
        exact,
        ...blocks.filter(
          (block) =>
            block !== exact &&
            Math.abs(block.index - locator.blockIndex) <= 2,
        ),
      ]
    : blocks.filter(
        (block) => Math.abs(block.index - locator.blockIndex) <= 2,
      );

  for (const block of orderedCandidates) {
    const center =
      block === exact
        ? clampedOffset(block, locator.characterOffset)
        : Math.round(block.characterCount * locator.progress);
    const minimum = Math.max(0, center - 160);
    const maximum = Math.min(block.characterCount, center + 160);
    for (let offset = minimum; offset <= maximum; offset += 1) {
      if (contextHashAt(block.content, offset) === locator.contextHash) {
        return createReadingLocator(
          locator.bookId,
          blocks,
          block.index,
          offset,
          locator.updatedAt,
        );
      }
    }
  }

  return locatorFromProgress(
    locator.bookId,
    blocks,
    locator.progress,
    locator.updatedAt,
  );
}

export function locatorFromProgress(
  bookId: string,
  blocks: readonly TextBlock[],
  requestedProgress: number,
  updatedAt = Date.now(),
): ReadingLocator {
  const progress = Math.min(1, Math.max(0, requestedProgress));
  const total = totalCharacters(blocks);
  if (total === 0) {
    return createReadingLocator(bookId, blocks, 0, 0, updatedAt);
  }

  const absolute = progress * total;
  const block =
    blocks.find(
      (candidate) =>
        absolute <= candidate.characterStart + candidate.characterCount,
    ) ?? blocks.at(-1)!;

  return createReadingLocator(
    bookId,
    blocks,
    block.index,
    Math.round(absolute - block.characterStart),
    updatedAt,
  );
}
