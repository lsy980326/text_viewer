import {
  DEFAULT_READER_SETTINGS,
  joinParagraphBlocks,
  normalizeReaderSettings,
  type Bookmark,
  type BookRecord,
  type ReaderSettings,
  type ReadingState,
  type StoredBook,
  type TextBlock,
} from "../core";
import {
  RepositoryUnavailableError,
  type BookMetadataUpdate,
  type BookRepository,
} from "./repository";

const DATABASE_VERSION = 1;
const SETTINGS_KEY = "reader.settings";

interface StoredBlocks {
  bookId: string;
  blocks: TextBlock[];
}

interface StoredSettings {
  key: string;
  value: ReaderSettings;
}

const requestResult = <Value>(request: IDBRequest<Value>): Promise<Value> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB 요청에 실패했습니다."));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB 작업이 중단되었습니다."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB 작업에 실패했습니다."));
  });

export interface IndexedDbBookRepositoryOptions {
  databaseName?: string;
  indexedDBFactory?: IDBFactory;
}

export class IndexedDbBookRepository implements BookRepository {
  private readonly databaseName: string;
  private readonly factory: IDBFactory | undefined;
  private databasePromise?: Promise<IDBDatabase>;

  constructor(options: IndexedDbBookRepositoryOptions = {}) {
    this.databaseName = options.databaseName ?? "novelier";
    this.factory =
      options.indexedDBFactory ??
      (typeof indexedDB === "undefined" ? undefined : indexedDB);
  }

  async initialize(): Promise<void> {
    await this.database();
  }

  private database(): Promise<IDBDatabase> {
    if (!this.factory) {
      throw new RepositoryUnavailableError(
        "이 브라우저에서는 IndexedDB를 사용할 수 없습니다.",
      );
    }
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.factory!.open(
        this.databaseName,
        DATABASE_VERSION,
      );
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("books")) {
          const books = database.createObjectStore("books", { keyPath: "id" });
          books.createIndex("fileHash", "fileHash", { unique: true });
        }
        if (!database.objectStoreNames.contains("blocks")) {
          database.createObjectStore("blocks", { keyPath: "bookId" });
        }
        if (!database.objectStoreNames.contains("readingStates")) {
          database.createObjectStore("readingStates", { keyPath: "bookId" });
        }
        if (!database.objectStoreNames.contains("bookmarks")) {
          const bookmarks = database.createObjectStore("bookmarks", {
            keyPath: "id",
          });
          bookmarks.createIndex("bookId", "bookId", { unique: false });
        }
        if (!database.objectStoreNames.contains("settings")) {
          database.createObjectStore("settings", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ??
            new RepositoryUnavailableError(
              "브라우저 저장소를 열 수 없습니다.",
            ),
        );
      request.onblocked = () =>
        reject(
          new RepositoryUnavailableError(
            "다른 NOVELIER 창에서 저장소 업그레이드를 막고 있습니다.",
          ),
        );
    });

    return this.databasePromise;
  }

  async listBooks(): Promise<BookRecord[]> {
    const database = await this.database();
    const transaction = database.transaction("books", "readonly");
    const books = await requestResult<BookRecord[]>(
      transaction.objectStore("books").getAll(),
    );
    await transactionDone(transaction);
    return books.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async getBook(bookId: string): Promise<StoredBook | null> {
    const database = await this.database();
    const transaction = database.transaction(["books", "blocks"], "readonly");
    const bookRequest = transaction.objectStore("books").get(bookId);
    const blocksRequest = transaction.objectStore("blocks").get(bookId);
    const [book, storedBlocks] = await Promise.all([
      requestResult<BookRecord | undefined>(bookRequest),
      requestResult<StoredBlocks | undefined>(blocksRequest),
    ]);
    await transactionDone(transaction);
    if (!book) return null;

    const blocks = storedBlocks?.blocks ?? [];
    return {
      book: { ...book, content: joinParagraphBlocks(blocks) },
      blocks,
    };
  }

  async findByFileHash(fileHash: string): Promise<StoredBook | null> {
    const database = await this.database();
    const transaction = database.transaction("books", "readonly");
    const book = await requestResult<BookRecord | undefined>(
      transaction.objectStore("books").index("fileHash").get(fileHash),
    );
    await transactionDone(transaction);
    return book ? this.getBook(book.id) : null;
  }

  async saveBook(storedBook: StoredBook): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(
      ["books", "blocks"],
      "readwrite",
    );
    transaction.objectStore("books").put({
      ...storedBook.book,
      content: "",
      blockCount: storedBook.blocks.length,
    });
    transaction.objectStore("blocks").put({
      bookId: storedBook.book.id,
      blocks: storedBook.blocks,
    } satisfies StoredBlocks);
    await transactionDone(transaction);
  }

  async updateBookMetadata(
    bookId: string,
    metadata: BookMetadataUpdate,
  ): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction("books", "readwrite");
    const store = transaction.objectStore("books");
    const book = await requestResult<BookRecord | undefined>(store.get(bookId));
    if (book) store.put({ ...book, ...metadata });
    await transactionDone(transaction);
  }

  async deleteBook(bookId: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(
      ["books", "blocks", "readingStates", "bookmarks"],
      "readwrite",
    );
    transaction.objectStore("books").delete(bookId);
    transaction.objectStore("blocks").delete(bookId);
    transaction.objectStore("readingStates").delete(bookId);
    const bookmarkStore = transaction.objectStore("bookmarks");
    const bookmarkKeys = await requestResult<IDBValidKey[]>(
      bookmarkStore.index("bookId").getAllKeys(bookId),
    );
    for (const key of bookmarkKeys) bookmarkStore.delete(key);
    await transactionDone(transaction);
  }

  async getReadingState(bookId: string): Promise<ReadingState | null> {
    const database = await this.database();
    const transaction = database.transaction("readingStates", "readonly");
    const state = await requestResult<ReadingState | undefined>(
      transaction.objectStore("readingStates").get(bookId),
    );
    await transactionDone(transaction);
    return state ?? null;
  }

  async saveReadingState(state: ReadingState): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(
      ["readingStates", "books"],
      "readwrite",
    );
    transaction.objectStore("readingStates").put(state);
    const bookStore = transaction.objectStore("books");
    const book = await requestResult<BookRecord | undefined>(
      bookStore.get(state.bookId),
    );
    if (book) {
      bookStore.put({
        ...book,
        progress: state.locator.progress,
        updatedAt: state.locator.updatedAt,
      });
    }
    await transactionDone(transaction);
  }

  async listBookmarks(bookId: string): Promise<Bookmark[]> {
    const database = await this.database();
    const transaction = database.transaction("bookmarks", "readonly");
    const bookmarks = await requestResult<Bookmark[]>(
      transaction.objectStore("bookmarks").index("bookId").getAll(bookId),
    );
    await transactionDone(transaction);
    return bookmarks.sort((left, right) => right.createdAt - left.createdAt);
  }

  async saveBookmark(bookmark: Bookmark): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction("bookmarks", "readwrite");
    transaction.objectStore("bookmarks").put(bookmark);
    await transactionDone(transaction);
  }

  async deleteBookmark(bookmarkId: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction("bookmarks", "readwrite");
    transaction.objectStore("bookmarks").delete(bookmarkId);
    await transactionDone(transaction);
  }

  async getSettings(): Promise<ReaderSettings> {
    const database = await this.database();
    const transaction = database.transaction("settings", "readonly");
    const stored = await requestResult<StoredSettings | undefined>(
      transaction.objectStore("settings").get(SETTINGS_KEY),
    );
    await transactionDone(transaction);
    return stored
      ? normalizeReaderSettings(stored.value)
      : { ...DEFAULT_READER_SETTINGS };
  }

  async saveSettings(settings: ReaderSettings): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put({
      key: SETTINGS_KEY,
      value: normalizeReaderSettings(settings),
    } satisfies StoredSettings);
    await transactionDone(transaction);
  }
}
