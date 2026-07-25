import type {
  BookRecord,
  CharacterStats,
  ImportedBook,
  TextBlock,
  TextEncoding,
} from "./types";

export const MAX_TEXT_FILE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_BLOCK_CHARACTERS = 8_192;

export type TextImportErrorCode =
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "INVALID_ENCODING"
  | "EMPTY_FILE"
  | "EMPTY_FILENAME";

export class TextImportError extends Error {
  readonly code: TextImportErrorCode;

  constructor(code: TextImportErrorCode, message: string) {
    super(message);
    this.name = "TextImportError";
    this.code = code;
  }
}

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
  byteLength: number;
  hadBom: boolean;
  replacementCharacters: number;
  requiresEncodingConfirmation: boolean;
}

export interface DecodeTextOptions {
  encoding?: TextEncoding | "auto";
  maxBytes?: number;
}

export interface TextFileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ParagraphBlockOptions {
  bookId?: string;
  maxBlockCharacters?: number;
  /** Skip duplicate NFC/line-ending normalization for already decoded text. */
  inputNormalized?: boolean;
}

interface GraphemePart {
  segment: string;
  index: number;
}

type SegmenterLike = {
  segment(input: string): Iterable<{ segment: string; index: number }>;
};

let koreanGraphemeSegmenter: SegmenterLike | undefined;

function getSegmenter(): SegmenterLike | undefined {
  if (koreanGraphemeSegmenter) return koreanGraphemeSegmenter;

  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "grapheme" },
      ) => SegmenterLike;
    }
  ).Segmenter;

  if (!Segmenter) return undefined;
  koreanGraphemeSegmenter = new Segmenter("ko", { granularity: "grapheme" });
  return koreanGraphemeSegmenter;
}

export function segmentGraphemes(text: string): GraphemePart[] {
  const segmenter = getSegmenter();
  if (segmenter) return Array.from(segmenter.segment(text));

  let utf16Index = 0;
  return Array.from(text, (segment) => {
    const part = { segment, index: utf16Index };
    utf16Index += segment.length;
    return part;
  });
}

export function countGraphemes(text: string, includeWhitespace = true): number {
  let count = 0;
  for (const grapheme of iterateGraphemes(text)) {
    if (includeWhitespace || !/\s/u.test(grapheme)) count += 1;
  }
  return count;
}

export function calculateCharacterStats(
  totalText: string,
  currentText = totalText,
  includesWhitespace = true,
): CharacterStats {
  const totalWithWhitespace = countGraphemes(totalText);
  const totalWithoutWhitespace = countGraphemes(totalText, false);
  const currentWithWhitespace = countGraphemes(currentText);
  const currentWithoutWhitespace = countGraphemes(currentText, false);

  return {
    total: includesWhitespace
      ? totalWithWhitespace
      : totalWithoutWhitespace,
    current: includesWhitespace
      ? currentWithWhitespace
      : currentWithoutWhitespace,
    totalWithWhitespace,
    totalWithoutWhitespace,
    currentWithWhitespace,
    currentWithoutWhitespace,
    includesWhitespace,
  };
}

export function normalizeNovelText(text: string): string {
  return text
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .normalize("NFC");
}

export function validateTextFileSize(
  byteLength: number,
  maxBytes = MAX_TEXT_FILE_BYTES,
): void {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new TextImportError(
      "FILE_TOO_LARGE",
      "파일 크기 정보를 확인할 수 없습니다.",
    );
  }
  if (byteLength > maxBytes) {
    throw new TextImportError(
      "FILE_TOO_LARGE",
      `TXT 파일은 최대 ${Math.floor(maxBytes / 1024 / 1024)}MB까지 가져올 수 있습니다.`,
    );
  }
}

function stripFilenameControls(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? "" : character;
  }).join("");
}

export function titleFromFilename(filename: string): string {
  const basename =
    stripFilenameControls(filename.normalize("NFC"))
      .trim()
      .split(/[\\/]/u)
      .at(-1)
      ?.trim() ?? "";
  if (!basename) {
    throw new TextImportError("EMPTY_FILENAME", "파일 이름이 비어 있습니다.");
  }

  const title = basename.replace(/\.txt$/iu, "").trim();
  return title || "제목 없는 책";
}

/** Detects Android provider IDs that were accidentally stored as titles. */
export function looksLikeDocumentProviderId(title: string): boolean {
  const normalized = stripFilenameControls(title.normalize("NFC"))
    .replace(/\s/gu, "")
    .toLocaleLowerCase();
  return /^(?:(?:msf|primary|document|raw)[:_-]?)?\d+$/u.test(normalized);
}

function canonicalEncoding(encoding: TextEncoding): Exclude<TextEncoding, "cp949"> {
  return encoding === "cp949" ? "euc-kr" : encoding;
}

function decode(
  bytes: Uint8Array,
  encoding: TextEncoding,
  fatal: boolean,
): string {
  const decoder = new TextDecoder(canonicalEncoding(encoding), {
    fatal,
    ignoreBOM: false,
  });
  return decoder.decode(bytes).replace(/^\uFEFF/u, "");
}

function utf16Heuristic(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return null;

  const sampleLength = Math.min(bytes.length, 4_096);
  let evenNulls = 0;
  let oddNulls = 0;
  let pairs = 0;

  for (let index = 0; index + 1 < sampleLength; index += 2) {
    if (bytes[index] === 0) evenNulls += 1;
    if (bytes[index + 1] === 0) oddNulls += 1;
    pairs += 1;
  }

  const evenRatio = evenNulls / pairs;
  const oddRatio = oddNulls / pairs;
  if (oddRatio > 0.12 && oddRatio > evenRatio * 2) return "utf-16le";
  if (evenRatio > 0.12 && evenRatio > oddRatio * 2) return "utf-16be";
  return null;
}

function suspiciousControlRatio(text: string): boolean {
  if (!text) return false;
  let controls = 0;
  let characters = 0;
  for (const character of text) {
    characters += 1;
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 && character !== "\n" && character !== "\r" && character !== "\t") {
      controls += 1;
    }
  }
  return controls / characters > 0.01;
}

function decodedResult(
  text: string,
  encoding: TextEncoding,
  byteLength: number,
  hadBom: boolean,
  requiresEncodingConfirmation: boolean,
): DecodedText {
  const normalized = normalizeNovelText(text);
  let replacementCharacters = 0;
  for (const character of normalized) {
    if (character === "\uFFFD") replacementCharacters += 1;
  }
  return {
    text: normalized,
    encoding,
    byteLength,
    hadBom,
    replacementCharacters,
    requiresEncodingConfirmation:
      requiresEncodingConfirmation ||
      replacementCharacters > 0 ||
      suspiciousControlRatio(normalized),
  };
}

/**
 * Decodes all text formats supported by NOVELIER. The WHATWG `euc-kr`
 * decoder includes the Windows-949 extensions used by CP949 files.
 */
export function decodeTextBytes(
  input: ArrayBuffer | Uint8Array,
  options: DecodeTextOptions = {},
): DecodedText {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  validateTextFileSize(bytes.byteLength, options.maxBytes);

  const requested = options.encoding ?? "auto";
  if (requested !== "auto") {
    try {
      const text = decode(bytes, requested, true);
      return decodedResult(text, requested, bytes.byteLength, false, false);
    } catch {
      throw new TextImportError(
        "INVALID_ENCODING",
        `선택한 ${requested} 인코딩으로 파일을 읽을 수 없습니다.`,
      );
    }
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return decodedResult(
      decode(bytes.subarray(3), "utf-8", true),
      "utf-8",
      bytes.byteLength,
      true,
      false,
    );
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodedResult(
      decode(bytes.subarray(2), "utf-16le", true),
      "utf-16le",
      bytes.byteLength,
      true,
      false,
    );
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodedResult(
      decode(bytes.subarray(2), "utf-16be", true),
      "utf-16be",
      bytes.byteLength,
      true,
      false,
    );
  }

  const inferredUtf16 = utf16Heuristic(bytes);
  if (inferredUtf16) {
    try {
      return decodedResult(
        decode(bytes, inferredUtf16, true),
        inferredUtf16,
        bytes.byteLength,
        false,
        true,
      );
    } catch {
      // Continue with the byte-oriented encodings.
    }
  }

  try {
    return decodedResult(
      decode(bytes, "utf-8", true),
      "utf-8",
      bytes.byteLength,
      false,
      false,
    );
  } catch {
    try {
      return decodedResult(
        decode(bytes, "euc-kr", true),
        "euc-kr",
        bytes.byteLength,
        false,
        false,
      );
    } catch {
      const recovered = decode(bytes, "euc-kr", false);
      return decodedResult(
        recovered,
        "euc-kr",
        bytes.byteLength,
        false,
        true,
      );
    }
  }
}

interface ParagraphChunk {
  content: string;
  characterCount: number;
}

/*
 * Most Korean prose consists of one-code-unit precomposed Hangul, CJK,
 * punctuation and Latin characters. In that common case slicing by UTF-16 is
 * also slicing by grapheme and avoids creating millions of SegmentData
 * objects for a long paragraph. Complex clusters take the Unicode-safe path.
 */
const COMPLEX_GRAPHEME_PATTERN =
  /[\p{Mark}\p{Cf}\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/u;
const SURROGATE_CODE_UNIT_PATTERN = /[\ud800-\udfff]/;

function hasOnlySingleCodeUnitGraphemes(text: string): boolean {
  return (
    !COMPLEX_GRAPHEME_PATTERN.test(text) &&
    !SURROGATE_CODE_UNIT_PATTERN.test(text)
  );
}

function* iterateGraphemes(text: string): Iterable<string> {
  const segmenter = getSegmenter();
  if (segmenter) {
    for (const part of segmenter.segment(text)) yield part.segment;
    return;
  }
  yield* text;
}

function splitLongParagraph(
  paragraph: string,
  maximum: number,
): ParagraphChunk[] {
  if (paragraph.length <= maximum) {
    return [{
      content: paragraph,
      characterCount: countGraphemes(paragraph),
    }];
  }

  if (hasOnlySingleCodeUnitGraphemes(paragraph)) {
    const chunks: ParagraphChunk[] = [];
    for (let start = 0; start < paragraph.length; start += maximum) {
      const content = paragraph.slice(start, start + maximum);
      chunks.push({ content, characterCount: content.length });
    }
    return chunks;
  }

  const chunks: ParagraphChunk[] = [];
  let buffer: string[] = [];
  let characterCount = 0;
  for (const grapheme of iterateGraphemes(paragraph)) {
    buffer.push(grapheme);
    characterCount += 1;
    if (characterCount < maximum) continue;
    chunks.push({ content: buffer.join(""), characterCount });
    buffer = [];
    characterCount = 0;
  }
  if (buffer.length > 0) {
    chunks.push({ content: buffer.join(""), characterCount });
  }
  return chunks;
}

export function createParagraphBlocks(
  input: string,
  options: ParagraphBlockOptions = {},
): TextBlock[] {
  const bookId = options.bookId ?? "unassigned";
  const maximum = Math.max(
    256,
    Math.floor(options.maxBlockCharacters ?? DEFAULT_MAX_BLOCK_CHARACTERS),
  );
  const normalized = (
    options.inputNormalized ? input : normalizeNovelText(input)
  ).trim();
  if (!normalized) return [];

  const chunks = normalized
    .split(/\n[ \t]*\n+/gu)
    .flatMap((paragraph) =>
      splitLongParagraph(paragraph.trim(), maximum).map(
        ({ content, characterCount }, chunkIndex) => ({
          content,
          characterCount,
          continuesPrevious: chunkIndex > 0,
        }),
      ),
    )
    .filter(({ content }) => Boolean(content));

  let characterStart = 0;
  return chunks.map(({ content, characterCount, continuesPrevious }, index) => {
    if (index > 0 && !continuesPrevious) characterStart += 2;
    const block: TextBlock = {
      id: `${bookId}:${index}`,
      bookId,
      index,
      content,
      characterStart,
      characterCount,
    };
    characterStart += characterCount;
    return block;
  });
}

export function joinParagraphBlocks(blocks: readonly TextBlock[]): string {
  const ordered = [...blocks].sort((left, right) => left.index - right.index);
  const parts: string[] = [];
  ordered.forEach((block, index) => {
    if (index === 0) {
      parts.push(block.content);
      return;
    }
    const previous = ordered[index - 1];
    const previousEnd =
      previous.characterStart + previous.characterCount;
    const separatorLength = Math.max(
      0,
      block.characterStart - previousEnd,
    );
    if (separatorLength > 0) parts.push("\n".repeat(separatorLength));
    parts.push(block.content);
  });
  return parts.join("");
}

export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function sha256Hex(
  input: ArrayBuffer | Uint8Array,
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("이 환경에서는 안전한 파일 해시를 계산할 수 없습니다.");
  }
  const digestInput =
    input instanceof Uint8Array
      ? input.buffer instanceof ArrayBuffer &&
        input.byteOffset === 0 &&
        input.byteLength === input.buffer.byteLength
        ? input.buffer
        : input.slice().buffer
      : input;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    digestInput,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function importTextFile(
  file: TextFileLike,
  options: DecodeTextOptions = {},
): Promise<ImportedBook> {
  if (!/\.txt$/iu.test(file.name)) {
    throw new TextImportError(
      "UNSUPPORTED_FILE_TYPE",
      "NOVELIER는 현재 TXT 파일만 지원합니다.",
    );
  }
  validateTextFileSize(file.size, options.maxBytes);

  const buffer = await file.arrayBuffer();
  validateTextFileSize(buffer.byteLength, options.maxBytes);
  const bytes = new Uint8Array(buffer);
  const decoded = decodeTextBytes(bytes, options);
  if (!decoded.text.trim()) {
    throw new TextImportError(
      "EMPTY_FILE",
      "읽을 수 있는 본문이 없는 TXT 파일입니다.",
    );
  }
  const fileHash = await sha256Hex(bytes);
  const id = `book-${fileHash.slice(0, 24)}`;
  const blocks = createParagraphBlocks(decoded.text, {
    bookId: id,
    inputNormalized: true,
  });
  const content = joinParagraphBlocks(blocks);
  const now = Date.now();

  const book: BookRecord = {
    id,
    title: titleFromFilename(file.name),
    content,
    fileHash,
    encoding: decoded.encoding,
    byteSize: bytes.byteLength,
    createdAt: now,
    updatedAt: now,
    progress: 0,
    coverSeed: hashString(`${fileHash}:${titleFromFilename(file.name)}`),
    totalCharacters: blocks.at(-1)
      ? blocks.at(-1)!.characterStart + blocks.at(-1)!.characterCount
      : 0,
    blockCount: blocks.length,
  };

  return {
    book,
    blocks,
    requiresEncodingConfirmation: decoded.requiresEncodingConfirmation,
  };
}
