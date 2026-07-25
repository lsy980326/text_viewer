export const TEXT_ENCODINGS = [
  "utf-8",
  "utf-16le",
  "utf-16be",
  "euc-kr",
  "cp949",
] as const;

export type TextEncoding = (typeof TEXT_ENCODINGS)[number];
export type ReadingFlow = "horizontal-paged" | "vertical-scroll";
export type ReaderTheme = "light" | "sepia" | "dark";
export type PlatformName =
  | "macos"
  | "windows"
  | "ios"
  | "android"
  | "web"
  | "unknown";

export interface BookRecord {
  id: string;
  title: string;
  /**
   * The hydrated text. List queries may intentionally leave this as an empty
   * string; getBook() always reconstructs it from the persisted blocks.
   */
  content: string;
  fileHash: string;
  encoding: TextEncoding;
  byteSize: number;
  createdAt: number;
  updatedAt: number;
  progress: number;
  coverSeed: string;
  totalCharacters: number;
  blockCount: number;
}

export interface TextBlock {
  id: string;
  bookId: string;
  index: number;
  content: string;
  characterStart: number;
  characterCount: number;
}

export interface ReadingLocator {
  bookId: string;
  blockId: string;
  blockIndex: number;
  characterOffset: number;
  contextHash: string;
  progress: number;
  updatedAt: number;
}

export interface ReaderSettings {
  /** Persisted settings schema used for one-time default migrations. */
  settingsVersion: number;
  flow: ReadingFlow;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  paragraphSpacing: number;
  contentWidth: number;
  horizontalPadding: number;
  theme: ReaderTheme;
  /** App-local reading brightness as a percentage from 35 through 100. */
  brightness: number;
  transparencyEnabled: boolean;
  /** Desktop reading-surface opacity as a percentage from 0 through 100. */
  surfaceOpacity: number;
  alwaysOnTop: boolean;
  /** Persistent desktop layout with navigation and context panels collapsed. */
  simpleView: boolean;
  countWhitespace: boolean;
  /**
   * Android reader navigation using the physical volume buttons.
   * Unsupported platforms keep their normal system-volume behavior.
   */
  volumeKeyNavigation: boolean;
  focusMode: boolean;
}

export interface CharacterStats {
  total: number;
  current: number;
  totalWithWhitespace: number;
  totalWithoutWhitespace: number;
  currentWithWhitespace: number;
  currentWithoutWhitespace: number;
  includesWhitespace: boolean;
}

export interface Bookmark {
  id: string;
  bookId: string;
  locator: ReadingLocator;
  label?: string;
  createdAt: number;
}

export interface PlatformCapabilities {
  platform: PlatformName;
  formFactor: "desktop" | "mobile";
  isTauri: boolean;
  nativeFileDialog: boolean;
  transparentWindow: boolean;
  alwaysOnTop: boolean;
  nativeSystemBrightness: false;
  mobileGlassSurface: boolean;
  hardwareVolumeNavigation: boolean;
}

export interface ReadingState {
  bookId: string;
  flow: ReadingFlow;
  locator: ReadingLocator;
}

export interface StoredBook {
  book: BookRecord;
  blocks: TextBlock[];
}

export interface ImportedBook extends StoredBook {
  requiresEncodingConfirmation: boolean;
}
