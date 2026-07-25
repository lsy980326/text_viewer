import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SAMPLE_BOOK_CONTENT, SAMPLE_BOOK_TITLE } from "./sampleBook";

export type ReadingFlow = "horizontal-paged" | "vertical-scroll";
export type ThemeName = "light" | "sepia" | "dark";
export type NavSection = "library" | "jump" | "bookmarks" | "settings";
export type AppSurface =
  | "jump"
  | "bookmarks"
  | "brightness"
  | "font"
  | "theme"
  | "more"
  | "search"
  | "book-info"
  | "stats"
  | null;

export interface AppBookmark {
  id: string;
  progress: number;
  excerpt: string;
  createdAt: number;
}

export interface AppBook {
  id: string;
  title: string;
  content: string;
  importedAt: number;
  lastReadAt: number;
  progress: number;
  bookmarks: AppBookmark[];
  coverSeed: number;
  encoding?: string;
  fileHash?: string;
  byteSize?: number;
  blockCount?: number;
  totalCharacters?: number;
}

export interface AppReaderSettings {
  settingsVersion: number;
  flow: ReadingFlow;
  fontFamily: "noto-serif" | "system-serif" | "system-sans";
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  paragraphSpacing: number;
  contentWidth: number;
  horizontalPadding: number;
  theme: ThemeName;
  brightness: number;
  transparencyEnabled: boolean;
  surfaceOpacity: number;
  alwaysOnTop: boolean;
  simpleView: boolean;
  countWhitespace: boolean;
  volumeKeyNavigation: boolean;
}

interface NovelierState {
  books: AppBook[];
  currentBookId: string;
  route: "library" | "reader";
  activeSection: NavSection;
  openSurface: AppSurface;
  chromeVisible: boolean;
  privacyMode: boolean;
  stealthView: boolean;
  stealthOpacity: number;
  searchQuery: string;
  settings: AppReaderSettings;
  setRoute: (route: "library" | "reader") => void;
  openBook: (bookId: string) => void;
  addBook: (book: AppBook) => void;
  replaceBooks: (books: AppBook[], currentBookId?: string) => void;
  updateBook: (book: AppBook) => void;
  removeBook: (bookId: string) => void;
  setProgress: (bookId: string, progress: number) => void;
  setActiveSection: (section: NavSection) => void;
  setOpenSurface: (surface: AppSurface) => void;
  setChromeVisible: (visible: boolean) => void;
  setPrivacyMode: (enabled: boolean) => void;
  setStealthView: (enabled: boolean) => void;
  setStealthOpacity: (opacity: number) => void;
  setSearchQuery: (query: string) => void;
  replaceSettings: (settings: AppReaderSettings) => void;
  updateSettings: (patch: Partial<AppReaderSettings>) => void;
  resetSettings: () => void;
  toggleBookmark: (bookId: string, progress: number, excerpt: string) => void;
}

export const DEFAULT_SETTINGS: AppReaderSettings = {
  settingsVersion: 2,
  flow: "horizontal-paged",
  fontFamily: "noto-serif",
  fontSize: 18,
  lineHeight: 1.85,
  letterSpacing: 0,
  paragraphSpacing: 1.25,
  contentWidth: 720,
  horizontalPadding: 48,
  theme: "light",
  brightness: 100,
  transparencyEnabled: false,
  surfaceOpacity: 82,
  alwaysOnTop: false,
  simpleView: false,
  countWhitespace: true,
  volumeKeyNavigation: true,
};

const sampleBook: AppBook = {
  id: "novelier-welcome",
  title: SAMPLE_BOOK_TITLE,
  content: SAMPLE_BOOK_CONTENT,
  importedAt: Date.now(),
  lastReadAt: Date.now(),
  progress: 0,
  bookmarks: [
    {
      id: "welcome-bookmark",
      progress: 0.37,
      excerpt: "시간은 그렇게 눈에 보이지 않는 원을 그리며 흘렀다.",
      createdAt: Date.now(),
    },
  ],
  coverSeed: 218,
  encoding: "UTF-8",
};

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

export function createStealthSessionState(
  enabled: boolean,
  currentOpacity: number,
) {
  return {
    stealthView: enabled,
    privacyMode: false,
    chromeVisible: !enabled,
    openSurface: null,
    stealthOpacity: enabled ? 28 : currentOpacity,
  } as const;
}

export const useNovelierStore = create<NovelierState>()(
  persist(
    (set) => ({
      books: [sampleBook],
      currentBookId: sampleBook.id,
      route: "reader",
      activeSection: "jump",
      openSurface: null,
      chromeVisible: true,
      privacyMode: false,
      stealthView: false,
      stealthOpacity: 28,
      searchQuery: "",
      settings: DEFAULT_SETTINGS,
      setRoute: (route) => set({ route, openSurface: null }),
      openBook: (currentBookId) =>
        set((state) => ({
          currentBookId,
          route: "reader",
          openSurface: null,
          books: state.books.map((book) =>
            book.id === currentBookId ? { ...book, lastReadAt: Date.now() } : book,
          ),
        })),
      addBook: (book) =>
        set((state) => ({
          books: [book, ...state.books.filter((item) => item.id !== book.id)],
          currentBookId: book.id,
          route: "reader",
          openSurface: null,
        })),
      replaceBooks: (books, preferredBookId) =>
        set((state) => {
          const nextBooks = books.length ? books : [sampleBook];
          const requestedId = preferredBookId ?? state.currentBookId;
          const currentBookId = nextBooks.some((book) => book.id === requestedId)
            ? requestedId
            : nextBooks[0].id;
          return { books: nextBooks, currentBookId };
        }),
      updateBook: (book) =>
        set((state) => ({
          books: state.books.map((item) => (item.id === book.id ? book : item)),
        })),
      removeBook: (bookId) =>
        set((state) => {
          const books = state.books.filter((book) => book.id !== bookId);
          const next = books[0] ?? sampleBook;
          return {
            books: books.length ? books : [sampleBook],
            currentBookId:
              state.currentBookId === bookId ? next.id : state.currentBookId,
          };
        }),
      setProgress: (bookId, progress) =>
        set((state) => ({
          books: state.books.map((book) =>
            book.id === bookId
              ? {
                  ...book,
                  progress: clamp(progress),
                  lastReadAt: Date.now(),
                }
              : book,
          ),
        })),
      setActiveSection: (activeSection) => set({ activeSection }),
      setOpenSurface: (openSurface) => set({ openSurface }),
      setChromeVisible: (chromeVisible) => set({ chromeVisible }),
      setPrivacyMode: (enabled) =>
        set({ privacyMode: enabled, openSurface: null }),
      setStealthView: (enabled) =>
        set((state) => ({
          ...createStealthSessionState(
            enabled,
            state.stealthOpacity,
          ),
          route: enabled ? "reader" : state.route,
        })),
      setStealthOpacity: (stealthOpacity) =>
        set({ stealthOpacity: clamp(stealthOpacity, 0, 100) }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      replaceSettings: (settings) => set({ settings }),
      updateSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      resetSettings: () =>
        set({
          settings: DEFAULT_SETTINGS,
          chromeVisible: true,
          privacyMode: false,
          stealthView: false,
          stealthOpacity: 28,
          openSurface: null,
        }),
      toggleBookmark: (bookId, progress, excerpt) =>
        set((state) => ({
          books: state.books.map((book) => {
            if (book.id !== bookId) return book;
            const existing = book.bookmarks.find(
              (bookmark) => Math.abs(bookmark.progress - progress) < 0.008,
            );
            return {
              ...book,
              bookmarks: existing
                ? book.bookmarks.filter(
                    (bookmark) => bookmark.id !== existing.id,
                  )
                : [
                    {
                      id: crypto.randomUUID(),
                      progress,
                      excerpt,
                      createdAt: Date.now(),
                    },
                    ...book.bookmarks,
                  ],
            };
          }),
        })),
    }),
    {
      name: "novelier-ui-state-v2",
      version: 2,
      partialize: (state) => ({
        currentBookId: state.currentBookId,
        route: state.route,
        activeSection: state.activeSection,
        chromeVisible: state.chromeVisible,
        settings: state.settings,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<NovelierState>;
        const persistedSettings: Partial<AppReaderSettings> =
          persisted.settings ?? {};
        const persistedSettingsVersion = Number(
          persistedSettings.settingsVersion,
        );
        const requiresVolumeKeyMigration =
          !Number.isFinite(persistedSettingsVersion) ||
          persistedSettingsVersion < 2;
        return {
          ...currentState,
          ...persisted,
          privacyMode: false,
          stealthView: false,
          stealthOpacity: 28,
          settings: {
            ...DEFAULT_SETTINGS,
            ...persistedSettings,
            settingsVersion: 2,
            volumeKeyNavigation: requiresVolumeKeyMigration
              ? true
              : Boolean(persistedSettings.volumeKeyNavigation),
          },
        };
      },
    },
  ),
);
