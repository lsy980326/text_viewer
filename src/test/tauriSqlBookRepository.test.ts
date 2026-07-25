import { describe, expect, it, vi } from "vitest";
import {
  hashString,
  type BookRecord,
  type StoredBook,
  type TextBlock,
} from "../core";
import {
  TauriSqlBookRepository,
  type SqlDatabase,
} from "../data/tauriSqlBookRepository";

describe("TauriSqlBookRepository bulk import", () => {
  it("stores text blocks in bounded batches instead of one native call each", async () => {
    const execute = vi.fn<SqlDatabase["execute"]>(
      async () => ({ rowsAffected: 1 }),
    );
    const database: SqlDatabase = {
      execute,
      select: async <Row>() => [] as Row[],
    };
    const repository = new TauriSqlBookRepository(database);
    const blocks: TextBlock[] = Array.from({ length: 301 }, (_, index) => ({
      id: `book-batch:${index}`,
      bookId: "book-batch",
      index,
      content: `문단 ${index}`,
      characterStart: index * 4,
      characterCount: 4,
    }));
    const book: BookRecord = {
      id: "book-batch",
      title: "대량 저장",
      content: "",
      fileHash: "batch-hash",
      encoding: "utf-8",
      byteSize: 1_024,
      createdAt: 1,
      updatedAt: 1,
      progress: 0,
      coverSeed: hashString("대량 저장"),
      totalCharacters: 1_204,
      blockCount: blocks.length,
    };
    const stored: StoredBook = { book, blocks };

    await repository.saveBook(stored);

    const inserts = execute.mock.calls.filter((call) =>
      String(call[0]).includes("INSERT INTO text_blocks"),
    );
    expect(inserts).toHaveLength(3);
    expect(inserts.map((call) => call[1]?.length)).toEqual([
      750,
      750,
      5,
    ]);
    expect(execute).toHaveBeenLastCalledWith("COMMIT");
  });
});
