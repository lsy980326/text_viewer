import type {
  Bookmark,
  BookRecord,
  ReaderSettings,
  ReadingState,
  StoredBook,
} from "../core";

export type BookMetadataUpdate = Pick<
  BookRecord,
  "title" | "coverSeed" | "updatedAt"
>;

export interface BookRepository {
  initialize(): Promise<void>;
  listBooks(): Promise<StoredBook["book"][]>;
  getBook(bookId: string): Promise<StoredBook | null>;
  findByFileHash(fileHash: string): Promise<StoredBook | null>;
  saveBook(storedBook: StoredBook): Promise<void>;
  updateBookMetadata(
    bookId: string,
    metadata: BookMetadataUpdate,
  ): Promise<void>;
  deleteBook(bookId: string): Promise<void>;
  getReadingState(bookId: string): Promise<ReadingState | null>;
  saveReadingState(state: ReadingState): Promise<void>;
  listBookmarks(bookId: string): Promise<Bookmark[]>;
  saveBookmark(bookmark: Bookmark): Promise<void>;
  deleteBookmark(bookmarkId: string): Promise<void>;
  getSettings(): Promise<ReaderSettings>;
  saveSettings(settings: ReaderSettings): Promise<void>;
}

export class RepositoryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryUnavailableError";
  }
}
