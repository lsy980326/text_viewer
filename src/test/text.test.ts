import { describe, expect, it, vi } from "vitest";
import {
  MAX_TEXT_FILE_BYTES,
  TextImportError,
  calculateCharacterStats,
  countGraphemes,
  createParagraphBlocks,
  decodeTextBytes,
  importTextFile,
  joinParagraphBlocks,
  looksLikeDocumentProviderId,
  normalizeNovelText,
  titleFromFilename,
  validateTextFileSize,
} from "../core";

function utf16Bytes(
  text: string,
  byteOrder: "little" | "big",
  withBom = true,
): Uint8Array {
  const bytes: number[] =
    withBom && byteOrder === "little"
      ? [0xff, 0xfe]
      : withBom
        ? [0xfe, 0xff]
        : [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const low = code & 0xff;
    const high = code >> 8;
    bytes.push(...(byteOrder === "little" ? [low, high] : [high, low]));
  }
  return new Uint8Array(bytes);
}

describe("TXT decoding", () => {
  it("decodes UTF-8 with a BOM and normalizes line endings", () => {
    const body = new TextEncoder().encode("첫 줄\r\n둘째 줄");
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...body]);

    expect(decodeTextBytes(bytes)).toMatchObject({
      text: "첫 줄\n둘째 줄",
      encoding: "utf-8",
      hadBom: true,
      requiresEncodingConfirmation: false,
    });
  });

  it.each([
    ["little", "utf-16le"],
    ["big", "utf-16be"],
  ] as const)("decodes UTF-16 %s endian files", (byteOrder, encoding) => {
    expect(decodeTextBytes(utf16Bytes("달빛 아래서", byteOrder))).toMatchObject({
      text: "달빛 아래서",
      encoding,
      hadBom: true,
    });
  });

  it("uses the WHATWG EUC-KR decoder for CP949 Korean bytes", () => {
    const cp949 = new Uint8Array([
      0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4,
    ]);

    expect(decodeTextBytes(cp949)).toMatchObject({
      text: "안녕하세요",
      encoding: "euc-kr",
      replacementCharacters: 0,
    });
  });

  it("rejects inputs above 50MB without allocating the file", () => {
    expect(() => validateTextFileSize(MAX_TEXT_FILE_BYTES + 1)).toThrowError(
      TextImportError,
    );
  });

  it("rejects an oversized source before calling arrayBuffer", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));

    await expect(
      importTextFile({
        name: "too-large.txt",
        size: MAX_TEXT_FILE_BYTES + 1,
        arrayBuffer,
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects an empty TXT during import", async () => {
    await expect(
      importTextFile({
        name: "empty.txt",
        size: 0,
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    ).rejects.toMatchObject({ code: "EMPTY_FILE" });
  });

  it("accepts a provider source whose size is unknown until it is read", async () => {
    const bytes = new TextEncoder().encode("본문");
    const imported = await importTextFile({
      name: "provider.txt",
      size: 0,
      arrayBuffer: async () => bytes.buffer,
    });

    expect(imported.book.byteSize).toBe(bytes.byteLength);
    expect(imported.book.content).toBe("본문");
  });
});

describe("text structure and statistics", () => {
  it("extracts only the title from Windows and POSIX TXT paths", () => {
    expect(titleFromFilename(String.raw`C:\books\달빛 아래서.txt`)).toBe(
      "달빛 아래서",
    );
    expect(titleFromFilename("/books/별 헤는 밤.TXT")).toBe("별 헤는 밤");
  });

  it("sanitizes provider display names and recognizes legacy IDs", () => {
    expect(titleFromFilename(" 달\u0000빛 아래서.txt ")).toBe("달빛 아래서");
    expect(looksLikeDocumentProviderId("msf:42")).toBe(true);
    expect(looksLikeDocumentProviderId("42")).toBe(true);
    expect(looksLikeDocumentProviderId("제42장")).toBe(false);
  });

  it("normalizes NFC and all common line endings", () => {
    expect(normalizeNovelText("가\r나\r\n다")).toBe("가\n나\n다");
  });

  it("counts Unicode grapheme clusters and can exclude whitespace", () => {
    const text = "가 👨‍👩‍👧‍👦\n";
    expect(countGraphemes(text)).toBe(4);
    expect(countGraphemes(text, false)).toBe(2);
    expect(calculateCharacterStats(text, "가 ", false)).toMatchObject({
      total: 2,
      current: 1,
      totalWithWhitespace: 4,
      totalWithoutWhitespace: 2,
    });
  });

  it("creates stable paragraph blocks and safely splits long paragraphs", () => {
    const longParagraph = "가".repeat(300);
    const blocks = createParagraphBlocks(
      `첫 줄\n이어지는 줄\n\n${longParagraph}`,
      { bookId: "book-1", maxBlockCharacters: 256 },
    );

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({
      id: "book-1:0",
      bookId: "book-1",
      index: 0,
      content: "첫 줄\n이어지는 줄",
      characterStart: 0,
    });
    expect(blocks[1].characterCount).toBe(256);
    expect(blocks[2].characterCount).toBe(44);
    expect(joinParagraphBlocks(blocks)).toContain(longParagraph);
  });

  it("indexes a multi-megabyte single paragraph without a full grapheme array", () => {
    const content = "가".repeat(5 * 1024 * 1024);
    const startedAt = performance.now();
    const blocks = createParagraphBlocks(content, { bookId: "large-book" });

    expect(blocks).toHaveLength(640);
    expect(blocks.at(-1)?.characterStart).toBe(5 * 1024 * 1024 - 8_192);
    expect(joinParagraphBlocks(blocks)).toBe(content);
    expect(performance.now() - startedAt).toBeLessThan(5_000);
  });

  it("keeps complex Unicode clusters intact across block boundaries", () => {
    const family = "👨‍👩‍👧‍👦";
    const blocks = createParagraphBlocks(family.repeat(260), {
      bookId: "emoji-book",
      maxBlockCharacters: 256,
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].characterCount).toBe(256);
    expect(blocks[1].characterCount).toBe(4);
    expect(joinParagraphBlocks(blocks)).toBe(family.repeat(260));
  });

  it("does not split surrogate-pair emoji at a fast-path boundary", () => {
    const emoji = "😀";
    const blocks = createParagraphBlocks(emoji.repeat(260), {
      bookId: "emoji-pair-book",
      maxBlockCharacters: 256,
    });

    expect(blocks.map((block) => block.characterCount)).toEqual([256, 4]);
    expect(joinParagraphBlocks(blocks)).toBe(emoji.repeat(260));
  });
});
