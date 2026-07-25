import type {
  AppBook,
  AppBookmark,
  AppReaderSettings,
} from "./appStore";
import {
  DEFAULT_READER_SETTINGS,
  hashString,
  importTextFile as importCoreTextFile,
  locatorFromProgress,
  normalizeReaderSettings,
  resolveReadingLocator,
  type Bookmark,
  type BookRecord,
  type DecodeTextOptions,
  type ReaderSettings,
  type ReadingFlow,
  type ReadingLocator,
  type ReadingState,
  type StoredBook,
  type TextBlock,
  type TextEncoding,
  type TextFileLike,
} from "./core";
import {
  openBookRepository,
  type BookRepository,
  type OpenBookRepositoryOptions,
} from "./data";

const clampProgress = (value: number) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const ENCODING_LABELS: Record<BookRecord["encoding"], string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  "euc-kr": "CP949 / EUC-KR",
  cp949: "CP949 / EUC-KR",
};

const CORE_FONT_FAMILIES: Record<
  AppReaderSettings["fontFamily"],
  string
> = {
  "noto-serif": DEFAULT_READER_SETTINGS.fontFamily,
  "system-serif": 'ui-serif, Georgia, "Times New Roman", serif',
  "system-sans": 'ui-sans-serif, system-ui, -apple-system, sans-serif',
};

export interface AppBookMappingContext {
  blocks?: readonly TextBlock[];
  bookmarks?: readonly Bookmark[];
  readingState?: ReadingState | null;
}

export interface HydratedNovelierState {
  books: AppBook[];
  settings: AppReaderSettings;
}

export interface ImportedAppBook {
  status: "imported" | "metadata-updated";
  book: AppBook;
  detectedEncoding: TextEncoding;
  requiresEncodingConfirmation: boolean;
}

export type TextImportStage = "reading" | "saving";

/** Pass `encoding` after the user confirms a fallback in the import UI. */
export interface TextImportOptions extends DecodeTextOptions {
  /**
   * Re-decodes the same immutable file after an explicit encoding choice.
   * Normal imports keep duplicate protection enabled.
   */
  replaceExisting?: boolean;
  onProgress?: (stage: TextImportStage) => void;
}

export interface SaveBookmarkInput {
  bookId: string;
  progress: number;
  excerpt?: string;
  id?: string;
  createdAt?: number;
}

export type CoreOnlyReaderSettingsPatch = Partial<
  Pick<ReaderSettings, "focusMode">
>;

export interface NovelierPersistenceOptions {
  /**
   * Deterministic repository injection for tests and previews. The bridge
   * initializes it lazily on first use.
   */
  repository?: BookRepository;
  /**
   * Alternative lazy repository factory. Its result is initialized by the
   * bridge. Do not supply this together with `repository`.
   */
  repositoryFactory?: () => BookRepository | Promise<BookRepository>;
  openOptions?: OpenBookRepositoryOptions;
  now?: () => number;
  createId?: () => string;
}

export class DuplicateBookError extends Error {
  readonly code = "DUPLICATE_BOOK";
  readonly status = "duplicate";

  constructor(
    readonly existingBookId: string,
    readonly existingBookTitle: string,
  ) {
    super("이미 서재에 있는 TXT 파일입니다.");
    this.name = "DuplicateBookError";
  }
}

export class BookNotFoundError extends Error {
  readonly code = "BOOK_NOT_FOUND";

  constructor(readonly bookId: string) {
    super("저장된 책을 찾을 수 없습니다.");
    this.name = "BookNotFoundError";
  }
}

export class TitleRepairMismatchError extends Error {
  readonly code = "TITLE_REPAIR_MISMATCH";

  constructor() {
    super("선택한 TXT가 이 책의 원본과 일치하지 않습니다.");
    this.name = "TitleRepairMismatchError";
  }
}

function coverSeedNumber(seed: string): number {
  const parsed = Number.parseInt(seed.slice(0, 8), 16);
  const value = Number.isFinite(parsed)
    ? parsed
    : Number.parseInt(hashString(seed), 16);
  return value % 360;
}

function bookmarkProgress(
  bookmark: Bookmark,
  blocks: readonly TextBlock[],
): number {
  if (blocks.length === 0) return clampProgress(bookmark.locator.progress);
  return clampProgress(
    resolveReadingLocator(bookmark.locator, blocks).progress,
  );
}

export function toAppBookmark(
  bookmark: Bookmark,
  blocks: readonly TextBlock[] = [],
): AppBookmark {
  return {
    id: bookmark.id,
    progress: bookmarkProgress(bookmark, blocks),
    excerpt: bookmark.label?.trim() || "저장된 위치",
    createdAt: bookmark.createdAt,
  };
}

export function toAppBook(
  book: BookRecord,
  context: AppBookMappingContext = {},
): AppBook {
  const blocks = context.blocks ?? [];
  const readingLocator = context.readingState
    ? resolveReadingLocator(context.readingState.locator, blocks)
    : null;

  return {
    id: book.id,
    title: book.title,
    content: book.content,
    importedAt: book.createdAt,
    lastReadAt: readingLocator?.updatedAt ?? book.updatedAt,
    progress: clampProgress(readingLocator?.progress ?? book.progress),
    bookmarks: (context.bookmarks ?? []).map((bookmark) =>
      toAppBookmark(bookmark, blocks),
    ),
    coverSeed: coverSeedNumber(book.coverSeed),
    encoding: ENCODING_LABELS[book.encoding],
    fileHash: book.fileHash,
    byteSize: book.byteSize,
    blockCount: book.blockCount,
    totalCharacters: book.totalCharacters,
  };
}

function toAppFontFamily(
  fontFamily: string,
): AppReaderSettings["fontFamily"] {
  if (/noto serif kr/iu.test(fontFamily)) return "noto-serif";
  if (/sans/iu.test(fontFamily)) return "system-sans";
  return "system-serif";
}

export function toAppReaderSettings(
  settings: ReaderSettings,
): AppReaderSettings {
  const normalized = normalizeReaderSettings(settings);
  return {
    settingsVersion: normalized.settingsVersion,
    flow: normalized.flow,
    fontFamily: toAppFontFamily(normalized.fontFamily),
    fontSize: normalized.fontSize,
    lineHeight: normalized.lineHeight,
    letterSpacing: normalized.letterSpacing,
    paragraphSpacing: normalized.paragraphSpacing,
    contentWidth: normalized.contentWidth,
    horizontalPadding: normalized.horizontalPadding,
    theme: normalized.theme,
    // Brightness is 35–100 while desktop surface opacity is 0–100.
    brightness: normalized.brightness,
    transparencyEnabled: normalized.transparencyEnabled,
    surfaceOpacity: normalized.surfaceOpacity,
    alwaysOnTop: normalized.alwaysOnTop,
    simpleView: normalized.simpleView,
    countWhitespace: normalized.countWhitespace,
    volumeKeyNavigation: normalized.volumeKeyNavigation,
  };
}

export function toCoreReaderSettings(
  settings: AppReaderSettings,
  base: ReaderSettings = { ...DEFAULT_READER_SETTINGS },
): ReaderSettings {
  return normalizeReaderSettings({
    ...base,
    settingsVersion: settings.settingsVersion,
    flow: settings.flow,
    fontFamily: CORE_FONT_FAMILIES[settings.fontFamily],
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    letterSpacing: settings.letterSpacing,
    paragraphSpacing: settings.paragraphSpacing,
    contentWidth: settings.contentWidth,
    horizontalPadding: settings.horizontalPadding,
    theme: settings.theme,
    // These are already percentages. No dimming/alpha unit conversion occurs.
    brightness: settings.brightness,
    transparencyEnabled: settings.transparencyEnabled,
    surfaceOpacity: settings.surfaceOpacity,
    alwaysOnTop: settings.alwaysOnTop,
    simpleView: settings.simpleView,
    countWhitespace: settings.countWhitespace,
    volumeKeyNavigation: settings.volumeKeyNavigation,
  });
}

function ownedArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof Uint8Array) {
    return Uint8Array.from(input).buffer;
  }
  return input.slice(0);
}

function defaultBookmarkId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `bookmark-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/**
 * Application-facing persistence facade. Construction is side-effect free;
 * native SQLite or browser IndexedDB is opened only by the first operation.
 */
export class NovelierPersistence {
  private repositoryPromise?: Promise<BookRepository>;
  private importQueue: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly options: NovelierPersistenceOptions = {}) {
    if (options.repository && options.repositoryFactory) {
      throw new TypeError(
        "`repository`와 `repositoryFactory`는 함께 사용할 수 없습니다.",
      );
    }
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? defaultBookmarkId;
  }

  private repository(): Promise<BookRepository> {
    if (this.repositoryPromise) return this.repositoryPromise;

    const pending = this.openRepository();
    this.repositoryPromise = pending.catch((error: unknown) => {
      this.repositoryPromise = undefined;
      throw error;
    });
    return this.repositoryPromise;
  }

  private async openRepository(): Promise<BookRepository> {
    if (!this.options.repository && !this.options.repositoryFactory) {
      return openBookRepository(this.options.openOptions);
    }

    const repository =
      this.options.repository ??
      (await this.options.repositoryFactory!());
    await repository.initialize();
    return repository;
  }

  async initialize(): Promise<void> {
    await this.repository();
  }

  private async hydrateStoredBook(
    repository: BookRepository,
    storedBook: StoredBook,
  ): Promise<AppBook> {
    const [readingState, bookmarks] = await Promise.all([
      repository.getReadingState(storedBook.book.id),
      repository.listBookmarks(storedBook.book.id),
    ]);
    return toAppBook(storedBook.book, {
      blocks: storedBook.blocks,
      bookmarks,
      readingState,
    });
  }

  async hydrate(): Promise<HydratedNovelierState> {
    const [books, settings] = await Promise.all([
      this.listBookMetadata(),
      this.getSettings(),
    ]);
    return { books, settings };
  }

  async listBookMetadata(): Promise<AppBook[]> {
    const repository = await this.repository();
    const records = await repository.listBooks();
    return records.map((book) => toAppBook({ ...book, content: "" }));
  }

  /** @deprecated Prefer `listBookMetadata` to make lazy content loading clear. */
  async listBooks(): Promise<AppBook[]> {
    return this.listBookMetadata();
  }

  /** Loads one complete book only when the reader is about to open it. */
  async loadAppBook(bookId: string): Promise<AppBook | null> {
    const repository = await this.repository();
    const storedBook = await repository.getBook(bookId);
    return storedBook
      ? this.hydrateStoredBook(repository, storedBook)
      : null;
  }

  /** @deprecated Prefer the more explicit `loadAppBook`. */
  async getBook(bookId: string): Promise<AppBook | null> {
    return this.loadAppBook(bookId);
  }

  private async requireStoredBook(
    repository: BookRepository,
    bookId: string,
  ): Promise<StoredBook> {
    const storedBook = await repository.getBook(bookId);
    if (!storedBook) throw new BookNotFoundError(bookId);
    return storedBook;
  }

  private enqueueImport(operation: () => Promise<ImportedAppBook>) {
    const result = this.importQueue.then(operation);
    this.importQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  importFile(
    file: TextFileLike,
    options: TextImportOptions = {},
  ): Promise<ImportedAppBook> {
    return this.enqueueImport(async () => {
      const repository = await this.repository();
      const {
        replaceExisting = false,
        onProgress,
        ...decodeOptions
      } = options;
      onProgress?.("reading");
      const imported = await importCoreTextFile(file, decodeOptions);
      const duplicate = await repository.findByFileHash(
        imported.book.fileHash,
      );
      if (duplicate && !replaceExisting) {
        if (duplicate.book.title !== imported.book.title) {
          await repository.updateBookMetadata(duplicate.book.id, {
            title: imported.book.title,
            coverSeed: imported.book.coverSeed,
            updatedAt: this.now(),
          });
          const updated = await this.requireStoredBook(
            repository,
            duplicate.book.id,
          );
          return {
            status: "metadata-updated",
            book: await this.hydrateStoredBook(repository, updated),
            detectedEncoding: imported.book.encoding,
            requiresEncodingConfirmation: false,
          };
        }
        throw new DuplicateBookError(
          duplicate.book.id,
          duplicate.book.title,
        );
      }

      onProgress?.("saving");
      await repository.saveBook(imported);
      return {
        status: "imported",
        book: toAppBook(imported.book, { blocks: imported.blocks }),
        detectedEncoding: imported.book.encoding,
        requiresEncodingConfirmation:
          imported.requiresEncodingConfirmation,
      };
    });
  }

  importBytes(
    filename: string,
    input: ArrayBuffer | Uint8Array,
    options: TextImportOptions = {},
  ): Promise<ImportedAppBook> {
    const bytes = ownedArrayBuffer(input);
    return this.importFile(
      {
        name: filename,
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.slice(0),
      },
      options,
    );
  }

  /**
   * Repairs only title metadata after proving that the user reselected the
   * exact same bytes. Reading position, blocks and bookmarks stay untouched.
   */
  async repairBookTitle(
    bookId: string,
    file: TextFileLike,
  ): Promise<AppBook> {
    const repository = await this.repository();
    const [existing, imported] = await Promise.all([
      this.requireStoredBook(repository, bookId),
      importCoreTextFile(file),
    ]);
    if (existing.book.fileHash !== imported.book.fileHash) {
      throw new TitleRepairMismatchError();
    }
    await repository.updateBookMetadata(bookId, {
      title: imported.book.title,
      coverSeed: imported.book.coverSeed,
      updatedAt: this.now(),
    });
    const updated = await this.requireStoredBook(repository, bookId);
    return this.hydrateStoredBook(repository, updated);
  }

  async deleteBook(bookId: string): Promise<boolean> {
    const repository = await this.repository();
    const existing = await repository.getBook(bookId);
    if (!existing) return false;
    await repository.deleteBook(bookId);
    return true;
  }

  async saveReadingProgress(
    bookId: string,
    progress: number,
    flow: ReadingFlow,
  ): Promise<ReadingLocator> {
    const repository = await this.repository();
    const storedBook = await this.requireStoredBook(repository, bookId);
    const locator = locatorFromProgress(
      bookId,
      storedBook.blocks,
      clampProgress(progress),
      this.now(),
    );
    await repository.saveReadingState({ bookId, flow, locator });
    return locator;
  }

  async saveBookmark(input: SaveBookmarkInput): Promise<AppBookmark> {
    const repository = await this.repository();
    const storedBook = await this.requireStoredBook(
      repository,
      input.bookId,
    );
    const createdAt = input.createdAt ?? this.now();
    const locator = locatorFromProgress(
      input.bookId,
      storedBook.blocks,
      clampProgress(input.progress),
      createdAt,
    );
    const label = input.excerpt?.trim();
    const bookmark: Bookmark = {
      id: input.id ?? this.createId(),
      bookId: input.bookId,
      locator,
      ...(label ? { label } : {}),
      createdAt,
    };
    await repository.saveBookmark(bookmark);
    return toAppBookmark(bookmark, storedBook.blocks);
  }

  async deleteBookmark(bookmarkId: string): Promise<void> {
    const repository = await this.repository();
    await repository.deleteBookmark(bookmarkId);
  }

  async getSettings(): Promise<AppReaderSettings> {
    const repository = await this.repository();
    return toAppReaderSettings(await repository.getSettings());
  }

  async saveSettings(
    settings: AppReaderSettings,
    coreOnlyPatch: CoreOnlyReaderSettingsPatch = {},
  ): Promise<AppReaderSettings> {
    const repository = await this.repository();
    const current = await repository.getSettings();
    const next = toCoreReaderSettings(settings, {
      ...current,
      ...coreOnlyPatch,
    });
    await repository.saveSettings(next);
    return toAppReaderSettings(next);
  }
}

/** Default production facade; it does not open storage until first use. */
export const novelierPersistence = new NovelierPersistence();
