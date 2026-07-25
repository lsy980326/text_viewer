import {
  DEFAULT_READER_SETTINGS,
  normalizeReaderSettings,
  type Bookmark,
  type ReaderSettings,
  type ReadingState,
  type StoredBook,
} from "../core";
import type {
  BookMetadataUpdate,
  BookRepository,
} from "./repository";

const copy = <Value>(value: Value): Value => structuredClone(value);

/** A deterministic repository used by unit tests and non-persistent previews. */
export class MemoryBookRepository implements BookRepository {
  private readonly books = new Map<string, StoredBook>();
  private readonly readingStates = new Map<string, ReadingState>();
  private readonly bookmarks = new Map<string, Bookmark>();
  private settings: ReaderSettings = { ...DEFAULT_READER_SETTINGS };

  async initialize(): Promise<void> {
    // No setup is required.
  }

  async listBooks(): Promise<StoredBook["book"][]> {
    return [...this.books.values()]
      .map(({ book }) => copy(book))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async getBook(bookId: string): Promise<StoredBook | null> {
    const stored = this.books.get(bookId);
    return stored ? copy(stored) : null;
  }

  async findByFileHash(fileHash: string): Promise<StoredBook | null> {
    const stored = [...this.books.values()].find(
      ({ book }) => book.fileHash === fileHash,
    );
    return stored ? copy(stored) : null;
  }

  async saveBook(storedBook: StoredBook): Promise<void> {
    this.books.set(storedBook.book.id, copy(storedBook));
  }

  async updateBookMetadata(
    bookId: string,
    metadata: BookMetadataUpdate,
  ): Promise<void> {
    const stored = this.books.get(bookId);
    if (!stored) return;
    stored.book = { ...stored.book, ...copy(metadata) };
  }

  async deleteBook(bookId: string): Promise<void> {
    this.books.delete(bookId);
    this.readingStates.delete(bookId);
    for (const [id, bookmark] of this.bookmarks) {
      if (bookmark.bookId === bookId) this.bookmarks.delete(id);
    }
  }

  async getReadingState(bookId: string): Promise<ReadingState | null> {
    const state = this.readingStates.get(bookId);
    return state ? copy(state) : null;
  }

  async saveReadingState(state: ReadingState): Promise<void> {
    this.readingStates.set(state.bookId, copy(state));
    const stored = this.books.get(state.bookId);
    if (stored) {
      stored.book.progress = state.locator.progress;
      stored.book.updatedAt = state.locator.updatedAt;
    }
  }

  async listBookmarks(bookId: string): Promise<Bookmark[]> {
    return [...this.bookmarks.values()]
      .filter((bookmark) => bookmark.bookId === bookId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(copy);
  }

  async saveBookmark(bookmark: Bookmark): Promise<void> {
    this.bookmarks.set(bookmark.id, copy(bookmark));
  }

  async deleteBookmark(bookmarkId: string): Promise<void> {
    this.bookmarks.delete(bookmarkId);
  }

  async getSettings(): Promise<ReaderSettings> {
    return copy(this.settings);
  }

  async saveSettings(settings: ReaderSettings): Promise<void> {
    this.settings = normalizeReaderSettings(settings);
  }
}
