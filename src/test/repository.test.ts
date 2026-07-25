import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_SETTINGS,
  createParagraphBlocks,
  createReadingLocator,
  hashString,
  type BookRecord,
  type Bookmark,
  type StoredBook,
} from "../core";
import { MemoryBookRepository } from "../data";

const makeStoredBook = (): StoredBook => {
  const id = "book-1";
  const content = "첫 문단입니다.\n\n둘째 문단입니다.";
  const blocks = createParagraphBlocks(content, { bookId: id });
  const book: BookRecord = {
    id,
    title: "테스트 소설",
    content,
    fileHash: "abc123",
    encoding: "utf-8",
    byteSize: 42,
    createdAt: 10,
    updatedAt: 10,
    progress: 0,
    coverSeed: hashString("테스트 소설"),
    totalCharacters:
      blocks.at(-1)!.characterStart + blocks.at(-1)!.characterCount,
    blockCount: blocks.length,
  };
  return { book, blocks };
};

describe("BookRepository contract", () => {
  it("persists books, reading state, settings, and bookmarks", async () => {
    const repository = new MemoryBookRepository();
    await repository.initialize();
    const stored = makeStoredBook();
    await repository.saveBook(stored);

    expect(await repository.findByFileHash("abc123")).toEqual(stored);
    expect((await repository.listBooks())[0].title).toBe("테스트 소설");

    const locator = createReadingLocator(
      stored.book.id,
      stored.blocks,
      1,
      2,
      20,
    );
    await repository.saveReadingState({
      bookId: stored.book.id,
      flow: "vertical-scroll",
      locator,
    });
    expect(await repository.getReadingState(stored.book.id)).toMatchObject({
      flow: "vertical-scroll",
      locator,
    });

    const bookmark: Bookmark = {
      id: "bookmark-1",
      bookId: stored.book.id,
      locator,
      label: "다시 읽기",
      createdAt: 30,
    };
    await repository.saveBookmark(bookmark);
    expect(await repository.listBookmarks(stored.book.id)).toEqual([bookmark]);

    await repository.saveSettings({
      ...DEFAULT_READER_SETTINGS,
      fontSize: 30,
      surfaceOpacity: 50,
    });
    expect(await repository.getSettings()).toMatchObject({
      fontSize: 30,
      surfaceOpacity: 50,
    });
  });

  it("cascades a book deletion through reader-owned data", async () => {
    const repository = new MemoryBookRepository();
    const stored = makeStoredBook();
    await repository.saveBook(stored);
    const locator = createReadingLocator(
      stored.book.id,
      stored.blocks,
      0,
      1,
    );
    await repository.saveReadingState({
      bookId: stored.book.id,
      flow: "horizontal-paged",
      locator,
    });
    await repository.saveBookmark({
      id: "bookmark-1",
      bookId: stored.book.id,
      locator,
      createdAt: 30,
    });

    await repository.deleteBook(stored.book.id);

    expect(await repository.getBook(stored.book.id)).toBeNull();
    expect(await repository.getReadingState(stored.book.id)).toBeNull();
    expect(await repository.listBookmarks(stored.book.id)).toEqual([]);
  });
});
