import { describe, expect, it } from "vitest";
import type { AppReaderSettings } from "../appStore";
import { MemoryBookRepository } from "../data";
import {
  BookNotFoundError,
  DuplicateBookError,
  NovelierPersistence,
  TitleRepairMismatchError,
  toAppReaderSettings,
  toCoreReaderSettings,
} from "../persistence";

class CountingMemoryRepository extends MemoryBookRepository {
  initializationCount = 0;

  override async initialize(): Promise<void> {
    this.initializationCount += 1;
    await super.initialize();
  }
}

const readerSettings: AppReaderSettings = {
  settingsVersion: 2,
  flow: "horizontal-paged",
  fontFamily: "system-serif",
  fontSize: 24,
  lineHeight: 2,
  letterSpacing: 0.04,
  paragraphSpacing: 1.6,
  contentWidth: 680,
  horizontalPadding: 72,
  theme: "sepia",
  brightness: 63,
  transparencyEnabled: true,
  surfaceOpacity: 77,
  alwaysOnTop: true,
  simpleView: true,
  countWhitespace: false,
  volumeKeyNavigation: true,
};

describe("NovelierPersistence", () => {
  it("opens storage lazily, lists metadata, and loads one body on demand", async () => {
    const repository = new CountingMemoryRepository();
    const persistence = new NovelierPersistence({ repository });
    const bytes = new TextEncoder().encode(
      "첫 문단입니다.\n\n두 번째 문단입니다.",
    );

    expect(repository.initializationCount).toBe(0);
    const imported = await persistence.importBytes("테스트 소설.txt", bytes);
    expect(repository.initializationCount).toBe(1);
    expect(imported).toMatchObject({
      status: "imported",
      detectedEncoding: "utf-8",
      requiresEncodingConfirmation: false,
      book: {
        title: "테스트 소설",
        content: "첫 문단입니다.\n\n두 번째 문단입니다.",
        encoding: "UTF-8",
      },
    });

    const metadata = await persistence.listBookMetadata();
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({
      id: imported.book.id,
      title: "테스트 소설",
      content: "",
    });

    const loaded = await persistence.loadAppBook(imported.book.id);
    expect(loaded?.content).toBe(imported.book.content);
    expect(repository.initializationCount).toBe(1);
  });

  it("updates a duplicate hash when the real display name changed", async () => {
    const persistence = new NovelierPersistence({
      repository: new MemoryBookRepository(),
    });
    const bytes = new TextEncoder().encode("중복 검사용 본문");
    const first = await persistence.importBytes("첫 이름.txt", bytes);

    const updated = await persistence.importBytes("다른 이름.txt", bytes);
    expect(updated).toMatchObject({
      status: "metadata-updated",
      book: {
        id: first.book.id,
        title: "다른 이름",
      },
    });

    await expect(
      persistence.importBytes("다른 이름.txt", bytes),
    ).rejects.toMatchObject({
      existingBookId: first.book.id,
      existingBookTitle: "다른 이름",
    });
    await expect(persistence.importBytes("다른 이름.txt", bytes)).rejects
      .toBeInstanceOf(DuplicateBookError);
  });

  it("repairs only title metadata after matching the source hash", async () => {
    const repository = new MemoryBookRepository();
    const persistence = new NovelierPersistence({
      repository,
      now: () => 2_000,
      createId: () => "saved-place",
    });
    const bytes = new TextEncoder().encode("제목 복구 본문");
    const first = await persistence.importBytes("42.txt", bytes);
    await persistence.saveReadingProgress(
      first.book.id,
      0.6,
      "horizontal-paged",
    );
    await persistence.saveBookmark({
      bookId: first.book.id,
      progress: 0.4,
    });

    const repaired = await persistence.repairBookTitle(first.book.id, {
      name: "실제 제목.txt",
      size: bytes.byteLength,
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    });
    expect(repaired).toMatchObject({
      id: first.book.id,
      title: "실제 제목",
      progress: expect.any(Number),
      bookmarks: [{ id: "saved-place" }],
    });

    const otherBytes = new TextEncoder().encode("다른 본문");
    await expect(
      persistence.repairBookTitle(first.book.id, {
        name: "다른 제목.txt",
        size: otherBytes.byteLength,
        arrayBuffer: async () => Uint8Array.from(otherBytes).buffer,
      }),
    ).rejects.toBeInstanceOf(TitleRepairMismatchError);
  });

  it("persists stable progress locators and resolves bookmark progress", async () => {
    const repository = new MemoryBookRepository();
    const persistence = new NovelierPersistence({
      repository,
      now: () => 1_000,
      createId: () => "bookmark-fixed",
    });
    const imported = await persistence.importBytes(
      "위치 테스트.txt",
      new TextEncoder().encode(
        "하나 둘 셋 넷 다섯.\n\n여섯 일곱 여덟 아홉 열.\n\n마지막 문단.",
      ),
    );

    const locator = await persistence.saveReadingProgress(
      imported.book.id,
      0.64,
      "horizontal-paged",
    );
    expect(locator).toMatchObject({
      bookId: imported.book.id,
      blockId: expect.stringContaining(imported.book.id),
      updatedAt: 1_000,
    });
    expect(locator.contextHash).toMatch(/^[0-9a-f]{8}$/u);
    expect(locator.progress).toBeCloseTo(0.64, 1);

    const bookmark = await persistence.saveBookmark({
      bookId: imported.book.id,
      progress: 0.31,
      excerpt: "다시 읽을 위치",
    });
    expect(bookmark).toMatchObject({
      id: "bookmark-fixed",
      excerpt: "다시 읽을 위치",
      createdAt: 1_000,
    });
    expect(bookmark.progress).toBeCloseTo(0.31, 1);

    const loaded = await persistence.loadAppBook(imported.book.id);
    expect(loaded?.progress).toBeCloseTo(0.64, 1);
    expect(loaded?.bookmarks).toEqual([bookmark]);

    await persistence.deleteBookmark(bookmark.id);
    expect((await persistence.loadAppBook(imported.book.id))?.bookmarks).toEqual(
      [],
    );

    expect(await persistence.deleteBook(imported.book.id)).toBe(true);
    expect(await persistence.deleteBook(imported.book.id)).toBe(false);
    await expect(
      persistence.saveReadingProgress(
        imported.book.id,
        0.5,
        "vertical-scroll",
      ),
    ).rejects.toBeInstanceOf(BookNotFoundError);
  });

  it("keeps app percentages direct and preserves core-only settings", async () => {
    const repository = new MemoryBookRepository();
    const persistence = new NovelierPersistence({ repository });

    const saved = await persistence.saveSettings(readerSettings, {
      focusMode: true,
    });
    expect(saved).toEqual(readerSettings);

    const coreSettings = await repository.getSettings();
    expect(coreSettings).toMatchObject({
      brightness: 63,
      surfaceOpacity: 77,
      simpleView: true,
      volumeKeyNavigation: true,
      fontFamily: 'ui-serif, Georgia, "Times New Roman", serif',
      horizontalPadding: 72,
      focusMode: true,
    });
    expect(toAppReaderSettings(coreSettings)).toEqual(readerSettings);
    expect(toCoreReaderSettings(readerSettings, coreSettings)).toMatchObject({
      brightness: 63,
      surfaceOpacity: 77,
      simpleView: true,
      volumeKeyNavigation: true,
      focusMode: true,
    });
  });

  it("forwards an explicit encoding override and reports detection", async () => {
    const persistence = new NovelierPersistence({
      repository: new MemoryBookRepository(),
    });

    // UTF-16LE encoding for "달빛" without a BOM.
    const bytes = new Uint8Array([0xec, 0xb2, 0x5b, 0xbe]);
    const imported = await persistence.importBytes("인코딩.txt", bytes, {
      encoding: "utf-16le",
    });

    expect(imported).toMatchObject({
      detectedEncoding: "utf-16le",
      requiresEncodingConfirmation: false,
      book: { content: "달빛", encoding: "UTF-16 LE" },
    });
  });

  it("replaces only an explicitly re-decoded duplicate", async () => {
    const persistence = new NovelierPersistence({
      repository: new MemoryBookRepository(),
    });
    const bytes = new Uint8Array([0xec, 0xb2, 0x5b, 0xbe]);
    const automatic = await persistence.importBytes("재선택.txt", bytes);

    const replaced = await persistence.importBytes("재선택.txt", bytes, {
      encoding: "utf-16le",
      replaceExisting: true,
    });

    expect(replaced.book.id).toBe(automatic.book.id);
    expect(replaced.book).toMatchObject({
      content: "달빛",
      encoding: "UTF-16 LE",
    });
    expect((await persistence.listBookMetadata())).toHaveLength(1);
  });
});
