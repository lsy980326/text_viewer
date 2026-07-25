import {
  DEFAULT_READER_SETTINGS,
  hashString,
  joinParagraphBlocks,
  normalizeReaderSettings,
  type Bookmark,
  type BookRecord,
  type ReaderSettings,
  type ReadingFlow,
  type ReadingLocator,
  type ReadingState,
  type StoredBook,
  type TextBlock,
  type TextEncoding,
} from "../core";
import type {
  BookMetadataUpdate,
  BookRepository,
} from "./repository";

const SETTINGS_KEY = "reader.settings";
const TEXT_BLOCK_INSERT_BATCH_SIZE = 150;

export interface SqlExecutionResult {
  rowsAffected: number;
  lastInsertId?: number;
}

/**
 * Structural subset of `@tauri-apps/plugin-sql`'s Database API. Keeping this
 * adapter injectable lets browser tests run without loading native modules.
 */
export interface SqlDatabase {
  execute(
    query: string,
    bindValues?: unknown[],
  ): Promise<SqlExecutionResult>;
  select<Row>(query: string, bindValues?: unknown[]): Promise<Row[]>;
}

interface BookRow {
  id: string;
  title: string;
  file_hash: string;
  encoding: string;
  byte_size: number;
  imported_at: number;
  updated_at: number;
  progress?: number | null;
  block_count?: number | null;
  total_characters?: number | null;
}

interface TextBlockRow {
  book_id: string;
  block_index: number;
  content: string;
  char_start: number;
  char_count: number;
}

interface ReadingStateRow {
  book_id: string;
  mode: ReadingFlow;
  block_index: number;
  char_offset: number;
  context_hash: string;
  progress: number;
  updated_at: number;
}

interface BookmarkRow {
  id: string;
  book_id: string;
  block_index: number;
  char_offset: number;
  context_hash: string;
  label: string | null;
  created_at: number;
}

interface SettingsRow {
  value: string;
}

const numberValue = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const encodingValue = (value: string): TextEncoding => {
  if (
    value === "utf-16le" ||
    value === "utf-16be" ||
    value === "euc-kr" ||
    value === "cp949"
  ) {
    return value;
  }
  return "utf-8";
};

function bookFromRow(row: BookRow, content = ""): BookRecord {
  return {
    id: row.id,
    title: row.title,
    content,
    fileHash: row.file_hash,
    encoding: encodingValue(row.encoding),
    byteSize: numberValue(row.byte_size),
    createdAt: numberValue(row.imported_at),
    updatedAt: numberValue(row.updated_at),
    progress: numberValue(row.progress),
    coverSeed: hashString(`${row.file_hash}:${row.title}`),
    totalCharacters: numberValue(row.total_characters),
    blockCount: numberValue(row.block_count),
  };
}

function blockFromRow(row: TextBlockRow): TextBlock {
  return {
    id: `${row.book_id}:${row.block_index}`,
    bookId: row.book_id,
    index: numberValue(row.block_index),
    content: row.content,
    characterStart: numberValue(row.char_start),
    characterCount: numberValue(row.char_count),
  };
}

export class TauriSqlBookRepository implements BookRepository {
  constructor(private readonly database: SqlDatabase) {}

  async initialize(): Promise<void> {
    await this.database.execute("PRAGMA foreign_keys = ON");
  }

  async listBooks(): Promise<BookRecord[]> {
    const rows = await this.database.select<BookRow>(
      `SELECT b.id, b.title, b.file_hash, b.encoding, b.byte_size,
              b.imported_at, b.updated_at,
              COALESCE(rs.progress, 0) AS progress,
              COUNT(tb.block_index) AS block_count,
              COALESCE(MAX(tb.char_start + tb.char_count), 0)
                AS total_characters
         FROM books b
         LEFT JOIN text_blocks tb ON tb.book_id = b.id
         LEFT JOIN reading_state rs ON rs.book_id = b.id
        GROUP BY b.id
        ORDER BY b.updated_at DESC`,
    );
    return rows.map((row) => bookFromRow(row));
  }

  async getBook(bookId: string): Promise<StoredBook | null> {
    const books = await this.database.select<BookRow>(
      `SELECT b.id, b.title, b.file_hash, b.encoding, b.byte_size,
              b.imported_at, b.updated_at,
              COALESCE(rs.progress, 0) AS progress,
              (SELECT COUNT(*) FROM text_blocks WHERE book_id = b.id)
                AS block_count,
              (SELECT COALESCE(MAX(char_start + char_count), 0)
                 FROM text_blocks WHERE book_id = b.id)
                AS total_characters
         FROM books b
         LEFT JOIN reading_state rs ON rs.book_id = b.id
        WHERE b.id = ?`,
      [bookId],
    );
    const row = books[0];
    if (!row) return null;

    const blockRows = await this.database.select<TextBlockRow>(
      `SELECT book_id, block_index, content, char_start, char_count
         FROM text_blocks
        WHERE book_id = ?
        ORDER BY block_index ASC`,
      [bookId],
    );
    const blocks = blockRows.map(blockFromRow);
    return {
      book: bookFromRow(row, joinParagraphBlocks(blocks)),
      blocks,
    };
  }

  async findByFileHash(fileHash: string): Promise<StoredBook | null> {
    const rows = await this.database.select<{ id: string }>(
      "SELECT id FROM books WHERE file_hash = ? LIMIT 1",
      [fileHash],
    );
    return rows[0] ? this.getBook(rows[0].id) : null;
  }

  async saveBook(storedBook: StoredBook): Promise<void> {
    await this.database.execute("BEGIN IMMEDIATE");
    try {
      const { book, blocks } = storedBook;
      await this.database.execute(
        `INSERT INTO books (
           id, title, file_hash, encoding, byte_size, imported_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           file_hash = excluded.file_hash,
           encoding = excluded.encoding,
           byte_size = excluded.byte_size,
           updated_at = excluded.updated_at`,
        [
          book.id,
          book.title,
          book.fileHash,
          book.encoding,
          book.byteSize,
          book.createdAt,
          book.updatedAt,
        ],
      );
      await this.database.execute(
        "DELETE FROM text_blocks WHERE book_id = ?",
        [book.id],
      );
      for (
        let start = 0;
        start < blocks.length;
        start += TEXT_BLOCK_INSERT_BATCH_SIZE
      ) {
        const batch = blocks.slice(
          start,
          start + TEXT_BLOCK_INSERT_BATCH_SIZE,
        );
        const placeholders = batch
          .map(() => "(?, ?, ?, ?, ?)")
          .join(", ");
        const values = batch.flatMap((block) => [
          book.id,
          block.index,
          block.content,
          block.characterStart,
          block.characterCount,
        ]);
        await this.database.execute(
          `INSERT INTO text_blocks (
             book_id, block_index, content, char_start, char_count
           ) VALUES ${placeholders}`,
          values,
        );
      }
      await this.database.execute("COMMIT");
    } catch (error) {
      await this.database.execute("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  async updateBookMetadata(
    bookId: string,
    metadata: BookMetadataUpdate,
  ): Promise<void> {
    await this.database.execute(
      "UPDATE books SET title = ?, updated_at = ? WHERE id = ?",
      [metadata.title, metadata.updatedAt, bookId],
    );
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.database.execute("DELETE FROM books WHERE id = ?", [bookId]);
  }

  async getReadingState(bookId: string): Promise<ReadingState | null> {
    const rows = await this.database.select<ReadingStateRow>(
      `SELECT book_id, mode, block_index, char_offset, context_hash,
              progress, updated_at
         FROM reading_state
        WHERE book_id = ?`,
      [bookId],
    );
    const row = rows[0];
    if (!row) return null;

    const locator: ReadingLocator = {
      bookId: row.book_id,
      blockId: `${row.book_id}:${row.block_index}`,
      blockIndex: numberValue(row.block_index),
      characterOffset: numberValue(row.char_offset),
      contextHash: row.context_hash,
      progress: numberValue(row.progress),
      updatedAt: numberValue(row.updated_at),
    };
    return {
      bookId: row.book_id,
      flow:
        row.mode === "vertical-scroll"
          ? "vertical-scroll"
          : "horizontal-paged",
      locator,
    };
  }

  async saveReadingState(state: ReadingState): Promise<void> {
    const { locator } = state;
    await this.database.execute(
      `INSERT INTO reading_state (
         book_id, mode, block_index, char_offset, context_hash,
         progress, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET
         mode = excluded.mode,
         block_index = excluded.block_index,
         char_offset = excluded.char_offset,
         context_hash = excluded.context_hash,
         progress = excluded.progress,
         updated_at = excluded.updated_at`,
      [
        state.bookId,
        state.flow,
        locator.blockIndex,
        locator.characterOffset,
        locator.contextHash,
        locator.progress,
        locator.updatedAt,
      ],
    );
    await this.database.execute(
      "UPDATE books SET updated_at = ? WHERE id = ?",
      [locator.updatedAt, state.bookId],
    );
  }

  async listBookmarks(bookId: string): Promise<Bookmark[]> {
    const rows = await this.database.select<BookmarkRow>(
      `SELECT id, book_id, block_index, char_offset, context_hash,
              label, created_at
         FROM bookmarks
        WHERE book_id = ?
        ORDER BY created_at DESC`,
      [bookId],
    );
    return rows.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      locator: {
        bookId: row.book_id,
        blockId: `${row.book_id}:${row.block_index}`,
        blockIndex: numberValue(row.block_index),
        characterOffset: numberValue(row.char_offset),
        contextHash: row.context_hash,
        progress: 0,
        updatedAt: numberValue(row.created_at),
      },
      ...(row.label ? { label: row.label } : {}),
      createdAt: numberValue(row.created_at),
    }));
  }

  async saveBookmark(bookmark: Bookmark): Promise<void> {
    await this.database.execute(
      `INSERT INTO bookmarks (
         id, book_id, block_index, char_offset, context_hash, label, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         block_index = excluded.block_index,
         char_offset = excluded.char_offset,
         context_hash = excluded.context_hash,
         label = excluded.label`,
      [
        bookmark.id,
        bookmark.bookId,
        bookmark.locator.blockIndex,
        bookmark.locator.characterOffset,
        bookmark.locator.contextHash,
        bookmark.label ?? null,
        bookmark.createdAt,
      ],
    );
  }

  async deleteBookmark(bookmarkId: string): Promise<void> {
    await this.database.execute("DELETE FROM bookmarks WHERE id = ?", [
      bookmarkId,
    ]);
  }

  async getSettings(): Promise<ReaderSettings> {
    const rows = await this.database.select<SettingsRow>(
      "SELECT value FROM settings WHERE key = ?",
      [SETTINGS_KEY],
    );
    if (!rows[0]) return { ...DEFAULT_READER_SETTINGS };
    try {
      return normalizeReaderSettings(
        JSON.parse(rows[0].value) as Partial<ReaderSettings>,
      );
    } catch {
      return { ...DEFAULT_READER_SETTINGS };
    }
  }

  async saveSettings(settings: ReaderSettings): Promise<void> {
    await this.database.execute(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [
        SETTINGS_KEY,
        JSON.stringify(normalizeReaderSettings(settings)),
        Date.now(),
      ],
    );
  }
}
