export * from "./indexedDbBookRepository";
export * from "./memoryBookRepository";
export * from "./repository";
export * from "./tauriSqlBookRepository";

import { IndexedDbBookRepository } from "./indexedDbBookRepository";
import type { BookRepository } from "./repository";
import {
  TauriSqlBookRepository,
  type SqlDatabase,
} from "./tauriSqlBookRepository";

export interface CreateBookRepositoryOptions {
  sqlDatabase?: SqlDatabase;
  databaseName?: string;
  indexedDBFactory?: IDBFactory;
}

export interface OpenBookRepositoryOptions
  extends Omit<CreateBookRepositoryOptions, "sqlDatabase"> {
  sqliteUrl?: string;
  forceBrowser?: boolean;
}

/**
 * Selects native SQLite when the host has supplied a Tauri SQL database;
 * otherwise it uses browser IndexedDB. Loading the native plugin remains the
 * application shell's responsibility.
 */
export function createBookRepository(
  options: CreateBookRepositoryOptions = {},
): BookRepository {
  if (options.sqlDatabase) {
    return new TauriSqlBookRepository(options.sqlDatabase);
  }
  return new IndexedDbBookRepository({
    databaseName: options.databaseName,
    indexedDBFactory: options.indexedDBFactory,
  });
}

/**
 * Opens the production persistence backend and runs its initialization. Tauri
 * hosts use the migrated `sqlite:novelier.db`; normal browser previews use
 * IndexedDB without importing any user data outside the device.
 */
export async function openBookRepository(
  options: OpenBookRepositoryOptions = {},
): Promise<BookRepository> {
  const isTauri =
    !options.forceBrowser &&
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window;

  let repository: BookRepository;
  if (isTauri) {
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    const database = await Database.load(
      options.sqliteUrl ?? "sqlite:novelier.db",
    );
    const adapter: SqlDatabase = {
      execute: (query, values) => database.execute(query, values),
      select: <Row>(query: string, values?: unknown[]) =>
        database.select<Row[]>(query, values),
    };
    repository = new TauriSqlBookRepository(adapter);
  } else {
    repository = new IndexedDbBookRepository({
      databaseName: options.databaseName,
      indexedDBFactory: options.indexedDBFactory,
    });
  }

  await repository.initialize();
  return repository;
}
