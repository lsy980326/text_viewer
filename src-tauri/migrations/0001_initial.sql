PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  encoding TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  imported_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS text_blocks (
  book_id TEXT NOT NULL,
  block_index INTEGER NOT NULL CHECK (block_index >= 0),
  content TEXT NOT NULL,
  char_start INTEGER NOT NULL CHECK (char_start >= 0),
  char_count INTEGER NOT NULL CHECK (char_count >= 0),
  PRIMARY KEY (book_id, block_index),
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_text_blocks_book_char_start
  ON text_blocks(book_id, char_start);

CREATE TABLE IF NOT EXISTS reading_state (
  book_id TEXT PRIMARY KEY NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('vertical-scroll', 'horizontal-paged')),
  block_index INTEGER NOT NULL DEFAULT 0 CHECK (block_index >= 0),
  char_offset INTEGER NOT NULL DEFAULT 0 CHECK (char_offset >= 0),
  context_hash TEXT NOT NULL DEFAULT '',
  progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  block_index INTEGER NOT NULL CHECK (block_index >= 0),
  char_offset INTEGER NOT NULL CHECK (char_offset >= 0),
  context_hash TEXT NOT NULL DEFAULT '',
  label TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_book_position
  ON bookmarks(book_id, block_index, char_offset);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

