import {
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FilePlus2,
  GripVertical,
  ListRestart,
  Maximize2,
  Minus,
  Moon,
  MoreHorizontal,
  MoveHorizontal,
  Search,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  SunMedium,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import {
  type AppBook,
  type AppSurface,
  type NavSection,
  useNovelierStore,
} from "./appStore";
import {
  contentOffsetForProgress,
  countGraphemes,
  createPageRanges,
  createParagraphEntries,
  createParagraphLayout,
  estimatePageCapacity,
  looksLikeDocumentProviderId,
  pageIndexForOffset,
  paragraphIndexForOffset,
  paragraphIndexForScrollTop,
  paragraphWindowForOffset,
  progressForContentOffset,
  type ParagraphEntry,
  type TextEncoding,
  type TextFileLike,
} from "./core";
import {
  DuplicateBookError,
  novelierPersistence,
} from "./persistence";
import {
  isTauriRuntime,
  pickTextFile,
} from "./platform/textFilePicker";
import {
  clearDesktopWindowSnapshot,
  enterDesktopStealthWindow,
  readDesktopWindowSnapshot,
  restoreDesktopWindow,
  type DesktopStealthWindowPort,
  type DesktopWindowSnapshot,
  writeDesktopWindowSnapshot,
} from "./platform/desktopStealthWindow";
import {
  isAndroidRuntime,
  isAndroidVolumeNavigationAvailable,
  navigationDelta,
  setAndroidDarkSystemBars,
  setAndroidVolumeCaptureEnabled,
  subscribeAndroidBridgeAvailability,
  subscribeAndroidSafeArea,
  subscribeHardwareReaderNavigation,
} from "./platform/mobileVolumeNavigation";

const isTauri = isTauriRuntime;
const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

function isMobileReaderLayout() {
  return window.matchMedia(
    "(max-width: 767px), (max-height: 520px) and (orientation: landscape)",
  ).matches;
}

function isNativeMobileRuntime() {
  return (
    document.documentElement.dataset.platform === "mobile" ||
    /iPhone|iPad|iPod|Android/iu.test(navigator.userAgent)
  );
}

function blocksDesktopPrivacyShortcut(stealthView: boolean) {
  return isNativeMobileRuntime() || (isMobileReaderLayout() && !stealthView);
}

function createDesktopStealthWindowPort(): DesktopStealthWindowPort {
  const appWindow = getCurrentWindow();
  return {
    isMaximized: () => appWindow.isMaximized(),
    unmaximize: () => appWindow.unmaximize(),
    maximize: () => appWindow.maximize(),
    readInnerSize: async () => {
      const size = await appWindow.innerSize();
      return { width: size.width, height: size.height };
    },
    readOuterPosition: async () => {
      const position = await appWindow.outerPosition();
      return { x: position.x, y: position.y };
    },
    setMinimumSize: (size) =>
      appWindow.setMinSize(new LogicalSize(size.width, size.height)),
    setTargetSize: (size) =>
      appWindow.setSize(new LogicalSize(size.width, size.height)),
    restoreInnerSize: (size) =>
      appWindow.setSize(new PhysicalSize(size.width, size.height)),
    restoreOuterPosition: (position) =>
      appWindow.setPosition(new PhysicalPosition(position.x, position.y)),
    center: () => appWindow.center(),
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatRelativeDate(timestamp: number) {
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "방금 전";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}시간 전`;
  return `${Math.floor(elapsed / 86_400_000)}일 전`;
}

function getExcerpt(content: string, progress: number, length = 64) {
  const start = Math.floor(clamp(progress) * Math.max(content.length - 1, 0));
  return content
    .slice(start, start + length)
    .replace(/\s+/gu, " ")
    .trim();
}

function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function IconButton({
  label,
  children,
  active,
  className = "",
  onClick,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DesktopTitleBar() {
  const stealthView = useNovelierStore((state) => state.stealthView);
  const setStealthView = useNovelierStore((state) => state.setStealthView);
  const minimize = () => {
    if (isTauri()) void getCurrentWindow().minimize();
  };
  const toggleMaximize = () => {
    if (isTauri()) void getCurrentWindow().toggleMaximize();
  };
  const close = () => {
    if (isTauri()) void getCurrentWindow().close();
  };

  return (
    <header className="desktop-titlebar" data-tauri-drag-region="deep">
      <div className="brand" data-tauri-drag-region="deep">
        <LogoMark />
        <span>NOVELIER</span>
      </div>
      <div className="window-actions">
        <button
          type="button"
          className="privacy-window-action"
          aria-label={stealthView ? "기본 PC 보기로 돌아가기" : "몰래보기 시작"}
          aria-pressed={stealthView}
          title="모바일형 몰래보기 · Cmd/Ctrl+Shift+M"
          onClick={() => setStealthView(!stealthView)}
        >
          <Smartphone size={16} strokeWidth={1.7} />
          <span>{stealthView ? "PC 보기" : "몰래보기"}</span>
        </button>
        <button type="button" aria-label="최소화" onClick={minimize}>
          <Minus size={16} strokeWidth={1.7} />
        </button>
        <button type="button" aria-label="최대화 또는 복원" onClick={toggleMaximize}>
          <Square size={13} strokeWidth={1.7} />
        </button>
        <button type="button" aria-label="창 닫기" onClick={close}>
          <X size={17} strokeWidth={1.7} />
        </button>
      </div>
    </header>
  );
}

function StealthQuickControls({
  chromeVisible,
  onRevealChrome,
}: {
  chromeVisible: boolean;
  onRevealChrome: () => void;
}) {
  const stealthOpacity = useNovelierStore((state) => state.stealthOpacity);
  const setStealthView = useNovelierStore((state) => state.setStealthView);
  const setStealthOpacity = useNovelierStore(
    (state) => state.setStealthOpacity,
  );
  const safelyMinimizeWindow = () => {
    if (isTauri()) {
      void getCurrentWindow().minimize();
      return;
    }
    setStealthView(false);
  };
  const revealFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (chromeVisible || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onRevealChrome();
  };

  return (
    <div
      role={chromeVisible ? "toolbar" : "button"}
      className={`stealth-quick-controls ${chromeVisible ? "" : "is-hidden"}`}
      aria-label={
        chromeVisible ? "몰래보기 빠른 설정" : "몰래보기 상단 도구 표시"
      }
      tabIndex={chromeVisible ? undefined : 0}
      onClick={chromeVisible ? undefined : onRevealChrome}
      onKeyDown={revealFromKeyboard}
    >
      {chromeVisible ? (
        <>
          <span
            className="stealth-drag-handle"
            data-tauri-drag-region="deep"
            title="창 이동"
          >
            <GripVertical size={16} aria-hidden="true" />
            <span>이동</span>
          </span>
          <label className="stealth-opacity-control">
            <span className="sr-only">몰래보기 배경 농도</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={stealthOpacity}
              onChange={(event) =>
                setStealthOpacity(Number(event.target.value))
              }
              onPointerUp={(event) => event.currentTarget.blur()}
              onPointerCancel={(event) => event.currentTarget.blur()}
            />
            <output>{stealthOpacity}%</output>
          </label>
          <IconButton
            label="창 안전하게 접기"
            className="stealth-minimize"
            onClick={safelyMinimizeWindow}
          >
            <Minus size={19} />
          </IconButton>
          <IconButton
            label="기본 PC 보기로 돌아가기"
            onClick={() => setStealthView(false)}
          >
            <Maximize2 size={18} />
          </IconButton>
        </>
      ) : null}
    </div>
  );
}

function BookCover({
  title,
  seed,
  compact = false,
}: {
  title: string;
  seed: number;
  compact?: boolean;
}) {
  const style = {
    "--cover-hue": `${seed}`,
  } as CSSProperties;
  return (
    <div className={`book-cover ${compact ? "is-compact" : ""}`} style={style}>
      <span className="cover-glow" />
      <span className="cover-line" />
      <strong>{title.slice(0, 16)}</strong>
      <small>NOVELIER</small>
    </div>
  );
}

const navigation: Array<{
  id: NavSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "library", label: "내 서재", icon: BookOpen },
  { id: "jump", label: "페이지 이동", icon: ListRestart },
  { id: "bookmarks", label: "북마크", icon: Bookmark },
  { id: "settings", label: "읽기 설정", icon: Settings2 },
];

function PrimaryNavigation({
  active,
  onSelect,
}: {
  active: NavSection;
  onSelect: (section: NavSection) => void;
}) {
  return (
    <nav className="primary-navigation" aria-label="주요 메뉴">
      <div className="primary-items">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              className={active === item.id ? "is-selected" : ""}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => onSelect(item.id)}
            >
              <Icon size={20} strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function BookSummary({ book }: { book: AppBook }) {
  return (
    <section className="book-summary" aria-label="현재 책">
      <BookCover title={book.title} seed={book.coverSeed} compact />
      <div className="book-summary-copy">
        <strong>{book.title}</strong>
        <span>TXT · {book.encoding ?? "자동 감지"}</span>
        <div className="mini-progress">
          <span style={{ width: `${Math.round(book.progress * 100)}%` }} />
        </div>
      </div>
      <span className="book-summary-percent">
        {Math.round(book.progress * 100)}%
      </span>
    </section>
  );
}

function RangeField({
  label,
  value,
  minimum,
  maximum,
  step,
  valueLabel,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  valueLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span>
        <strong>{label}</strong>
        <em>{valueLabel}</em>
      </span>
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function JumpControls({
  book,
  totalPages,
  currentPage,
  pagesCalculating,
  onJump,
  onPageJump,
}: {
  book: AppBook;
  totalPages: number;
  currentPage: number;
  pagesCalculating: boolean;
  onJump: (progress: number) => void;
  onPageJump: (page: number) => void;
}) {
  const settings = useNovelierStore((state) => state.settings);
  const isPaged = settings.flow === "horizontal-paged";
  const derivedInputValue = isPaged
    ? pagesCalculating
      ? ""
      : String(currentPage)
    : String(Math.round(book.progress * 100));
  const [draftValue, setDraftValue] = useState(derivedInputValue);
  const [isEditing, setIsEditing] = useState(false);
  const inputValue = isEditing ? draftValue : derivedInputValue;

  const submit = () => {
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed)) return;
    if (isPaged) onPageJump(parsed);
    else onJump(clamp(parsed, 0, 100) / 100);
    setIsEditing(false);
  };

  return (
    <div className="jump-controls">
      <div className="section-heading">
        <div>
          <span className="eyebrow">READING POSITION</span>
          <h2>페이지 이동</h2>
        </div>
        <strong>{Math.round(book.progress * 100)}%</strong>
      </div>
      <input
        className="progress-range"
        type="range"
        min={0}
        max={1000}
        value={Math.round(book.progress * 1000)}
        aria-label="읽기 위치"
        aria-valuetext={`${Math.round(book.progress * 100)}퍼센트`}
        onChange={(event) => onJump(Number(event.target.value) / 1000)}
      />
      <div className="jump-presets is-essential">
        <button type="button" onClick={() => onJump(0)}>
          처음으로
        </button>
        <button type="button" onClick={() => onJump(1)}>
          마지막으로
        </button>
      </div>
      <div className="direct-jump">
        <label>
          {isPaged ? "페이지 번호" : "진행 퍼센트"}
          <span>
            <input
              inputMode="numeric"
              value={inputValue}
              placeholder={isPaged && pagesCalculating ? "계산 중" : undefined}
              disabled={isPaged && pagesCalculating}
              onChange={(event) => {
                setDraftValue(event.target.value);
                setIsEditing(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />
            <em>
              {isPaged
                ? pagesCalculating
                  ? "계산 중…"
                  : `/ ${totalPages}`
                : "%"}
            </em>
          </span>
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={isPaged && pagesCalculating}
        >
          이동
        </button>
      </div>
      <div className="flow-note">
        {isPaged
          ? "글꼴과 창 크기에 따라 전체 페이지가 다시 계산됩니다."
          : "세로 읽기에서는 본문 문자 위치를 기준으로 이동합니다."}
      </div>
    </div>
  );
}

function BookmarksList({
  book,
  onJump,
}: {
  book: AppBook;
  onJump: (progress: number) => void;
}) {
  return (
    <section className="bookmark-list">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SAVED PLACES</span>
          <h2>북마크</h2>
        </div>
        <span>{book.bookmarks.length}</span>
      </div>
      {book.bookmarks.length ? (
        book.bookmarks.map((bookmark) => (
          <button
            type="button"
            className="bookmark-row"
            key={bookmark.id}
            onClick={() => onJump(bookmark.progress)}
          >
            <BookmarkCheck size={17} />
            <span>
              <strong>{bookmark.excerpt || "저장한 위치"}</strong>
              <small>
                {Math.round(bookmark.progress * 100)}% ·{" "}
                {formatRelativeDate(bookmark.createdAt)}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        ))
      ) : (
        <EmptyState
          icon={<Bookmark size={22} />}
          title="아직 북마크가 없습니다"
          copy="본문 상단의 북마크 버튼으로 현재 위치를 저장하세요."
        />
      )}
    </section>
  );
}

function ReaderSettingsControls() {
  const settings = useNovelierStore((state) => state.settings);
  const update = useNovelierStore((state) => state.updateSettings);
  const androidVolumeNavigationAvailable = isAndroidRuntime();

  return (
    <section className="settings-controls">
      <div className="section-heading">
        <div>
          <span className="eyebrow">READING STYLE</span>
          <h2>읽기 설정</h2>
        </div>
      </div>
      <div className="segmented-control" aria-label="읽기 방식">
        <button
          type="button"
          className={settings.flow === "horizontal-paged" ? "is-selected" : ""}
          onClick={() => update({ flow: "horizontal-paged" })}
        >
          <MoveHorizontal size={17} />
          가로 페이지
        </button>
        <button
          type="button"
          className={settings.flow === "vertical-scroll" ? "is-selected" : ""}
          onClick={() => update({ flow: "vertical-scroll" })}
        >
          <Columns2 size={17} className="rotate-icon" />
          세로 스크롤
        </button>
      </div>
      {androidVolumeNavigationAvailable ? (
        <label className="switch-row mobile-volume-navigation-setting">
          <span>
            <strong>음량 버튼으로 페이지 넘기기</strong>
            <small>음량 올림: 이전 · 음량 내림: 다음</small>
          </span>
          <input
            type="checkbox"
            checked={settings.volumeKeyNavigation}
            onChange={(event) =>
              update({ volumeKeyNavigation: event.target.checked })
            }
          />
        </label>
      ) : null}
      <fieldset className="font-family-options">
        <legend>본문 글꼴</legend>
        {(
          [
            ["noto-serif", "Noto 명조"],
            ["system-serif", "시스템 명조"],
            ["system-sans", "시스템 고딕"],
          ] as const
        ).map(([fontFamily, label]) => (
          <button
            type="button"
            key={fontFamily}
            className={settings.fontFamily === fontFamily ? "is-selected" : ""}
            aria-pressed={settings.fontFamily === fontFamily}
            onClick={() => update({ fontFamily })}
          >
            {label}
          </button>
        ))}
      </fieldset>
      <RangeField
        label="글자 크기"
        value={settings.fontSize}
        minimum={8}
        maximum={36}
        step={1}
        valueLabel={`${settings.fontSize}px`}
        onChange={(fontSize) => update({ fontSize })}
      />
      <RangeField
        label="줄 간격"
        value={settings.lineHeight}
        minimum={1.4}
        maximum={2.2}
        step={0.05}
        valueLabel={settings.lineHeight.toFixed(2)}
        onChange={(lineHeight) => update({ lineHeight })}
      />
      <details className="advanced-settings">
        <summary>고급 설정</summary>
        <RangeField
          label="자간"
          value={settings.letterSpacing}
          minimum={-0.04}
          maximum={0.18}
          step={0.01}
          valueLabel={`${settings.letterSpacing.toFixed(2)}em`}
          onChange={(letterSpacing) => update({ letterSpacing })}
        />
        <RangeField
          label="문단 간격"
          value={settings.paragraphSpacing}
          minimum={0.8}
          maximum={2.4}
          step={0.05}
          valueLabel={`${settings.paragraphSpacing.toFixed(2)}em`}
          onChange={(paragraphSpacing) => update({ paragraphSpacing })}
        />
        <RangeField
          label="본문 너비"
          value={settings.contentWidth}
          minimum={480}
          maximum={820}
          step={10}
          valueLabel={`${settings.contentWidth}px`}
          onChange={(contentWidth) => update({ contentWidth })}
        />
        <RangeField
          label="본문 좌우 여백"
          value={settings.horizontalPadding}
          minimum={16}
          maximum={96}
          step={4}
          valueLabel={`${settings.horizontalPadding}px`}
          onChange={(horizontalPadding) => update({ horizontalPadding })}
        />
        <label className="switch-row">
          <span>
            <strong>공백 포함 글자 수</strong>
            <small>통계의 글자 수 계산 기준입니다.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.countWhitespace}
            onChange={(event) =>
              update({ countWhitespace: event.target.checked })
            }
          />
        </label>
      </details>
    </section>
  );
}

function EmptyState({
  icon,
  title,
  copy,
}: {
  icon: ReactNode;
  title: string;
  copy: string;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

function LibraryList({
  books,
  currentBookId,
  onOpen,
  onImport,
  onDelete,
}: {
  books: AppBook[];
  currentBookId: string;
  onOpen: (id: string) => void;
  onImport: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="library-list">
      <div className="section-heading">
        <div>
          <span className="eyebrow">MY LIBRARY</span>
          <h2>내 서재</h2>
        </div>
      </div>
      <div className="library-rows">
        {books.map((book) => (
          <article
            key={book.id}
            className={`library-row ${book.id === currentBookId ? "is-current" : ""}`}
          >
            <button type="button" onClick={() => onOpen(book.id)}>
              <BookCover title={book.title} seed={book.coverSeed} compact />
              <span>
                <strong>{book.title}</strong>
                <small>{Math.round(book.progress * 100)}% 읽음</small>
                <span className="mini-progress">
                  <span style={{ width: `${book.progress * 100}%` }} />
                </span>
              </span>
            </button>
            {book.id !== "novelier-welcome" ? (
              <IconButton label={`${book.title} 삭제`} onClick={() => onDelete(book.id)}>
                <Trash2 size={15} />
              </IconButton>
            ) : null}
          </article>
        ))}
      </div>
      <button type="button" className="import-wide-button" onClick={onImport}>
        <FilePlus2 size={18} />
        TXT 가져오기
      </button>
    </section>
  );
}

function ContextPanel({
  book,
  books,
  activeSection,
  totalPages,
  currentPage,
  pagesCalculating,
  onJump,
  onPageJump,
  onImport,
  onOpenBook,
  onDeleteBook,
  onSelectSection,
}: {
  book: AppBook;
  books: AppBook[];
  activeSection: NavSection;
  totalPages: number;
  currentPage: number;
  pagesCalculating: boolean;
  onJump: (progress: number) => void;
  onPageJump: (page: number) => void;
  onImport: () => void;
  onOpenBook: (id: string) => void;
  onDeleteBook: (id: string) => void;
  onSelectSection: (section: NavSection) => void;
}) {
  return (
    <aside className="context-panel" aria-label="책 도구">
      <BookSummary book={book} />
      <nav className="context-tabs" aria-label="책 도구 메뉴">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              className={activeSection === item.id ? "is-selected" : ""}
              aria-label={item.label}
              onClick={() => onSelectSection(item.id)}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </nav>
      <div className="context-scroll">
        {activeSection === "library" ? (
          <LibraryList
            books={books}
            currentBookId={book.id}
            onOpen={onOpenBook}
            onImport={onImport}
            onDelete={onDeleteBook}
          />
        ) : null}
        {activeSection === "jump" ? (
          <JumpControls
            book={book}
            totalPages={totalPages}
            currentPage={currentPage}
            pagesCalculating={pagesCalculating}
            onJump={onJump}
            onPageJump={onPageJump}
          />
        ) : null}
        {activeSection === "bookmarks" ? (
          <BookmarksList book={book} onJump={onJump} />
        ) : null}
        {activeSection === "settings" ? <ReaderSettingsControls /> : null}
      </div>
    </aside>
  );
}

interface SearchResult {
  id: number;
  progress: number;
  excerpt: string;
}

function SearchPanel({
  book,
  onJump,
}: {
  book: AppBook;
  onJump: (progress: number) => void;
}) {
  const query = useNovelierStore((state) => state.searchQuery);
  const setQuery = useNovelierStore((state) => state.setSearchQuery);
  const results = useMemo<SearchResult[]>(() => {
    const normalized = query.trim().toLocaleLowerCase("ko");
    if (!normalized) return [];
    const content = book.content.toLocaleLowerCase("ko");
    const found: SearchResult[] = [];
    let offset = 0;
    while (found.length < 30) {
      const index = content.indexOf(normalized, offset);
      if (index < 0) break;
      const excerptStart = Math.max(0, index - 26);
      found.push({
        id: index,
        progress: index / Math.max(book.content.length - 1, 1),
        excerpt: book.content
          .slice(excerptStart, index + normalized.length + 46)
          .replace(/\s+/gu, " "),
      });
      offset = index + Math.max(normalized.length, 1);
    }
    return found;
  }, [book.content, query]);

  return (
    <section className="search-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FIND IN BOOK</span>
          <h2>본문 검색</h2>
        </div>
        {query ? <span>{results.length}</span> : null}
      </div>
      <label className="search-field">
        <Search size={18} />
        <input
          autoFocus
          type="search"
          value={query}
          placeholder="단어나 문장 검색"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button type="button" aria-label="검색어 지우기" onClick={() => setQuery("")}>
            <X size={16} />
          </button>
        ) : null}
      </label>
      {query && !results.length ? (
        <EmptyState
          icon={<Search size={21} />}
          title="검색 결과가 없습니다"
          copy="다른 단어나 짧은 문장으로 다시 검색해 보세요."
        />
      ) : (
        <div className="search-results">
          {results.map((result) => (
            <button
              type="button"
              key={result.id}
              onClick={() => onJump(result.progress)}
            >
              <span>{result.excerpt}</span>
              <small>{Math.round(result.progress * 100)}%</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ThemeControls() {
  const settings = useNovelierStore((state) => state.settings);
  const update = useNovelierStore((state) => state.updateSettings);
  const effectiveSurfaceOpacity = settings.transparencyEnabled
    ? settings.surfaceOpacity
    : 100;
  const setSurfaceOpacity = (surfaceOpacity: number) =>
    update({
      surfaceOpacity,
      transparencyEnabled: surfaceOpacity < 100,
      alwaysOnTop: false,
    });

  return (
    <section className="theme-controls">
      <div className="section-heading">
        <div>
          <span className="eyebrow">APPEARANCE</span>
          <h2>화면 설정</h2>
        </div>
      </div>
      <div className="theme-options">
        {(
          [
            ["light", "밝게", "#fcfcfb"],
            ["sepia", "세피아", "#f5efe2"],
            ["dark", "다크", "#17191d"],
          ] as const
        ).map(([theme, label, color]) => (
          <button
            type="button"
            key={theme}
            className={settings.theme === theme ? "is-selected" : ""}
            onClick={() => update({ theme })}
          >
            <span style={{ background: color }}>
              {settings.theme === theme ? <Check size={17} /> : null}
            </span>
            {label}
          </button>
        ))}
      </div>
      <div className="desktop-only-setting desktop-brightness-setting">
        <RangeField
          label="본문 밝기"
          value={settings.brightness}
          minimum={35}
          maximum={100}
          step={1}
          valueLabel={`${settings.brightness}%`}
          onChange={(brightness) => update({ brightness })}
        />
      </div>
      <label className="switch-row desktop-only-setting">
        <span>
          <strong>간단보기</strong>
          <small>책 도구를 접고 본문을 넓게 표시합니다.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.simpleView}
          onChange={(event) => update({ simpleView: event.target.checked })}
        />
      </label>
      <div className="desktop-only-setting desktop-opacity-setting">
        <div className="setting-copy">
          <strong>PC 배경</strong>
          <small>농도를 고르면 투명 모드를 자동으로 켜거나 끕니다.</small>
        </div>
        <div
          className="segmented-control compact"
          role="group"
          aria-label="PC 배경 농도"
        >
          {(
            [
              [100, "기본"],
              [82, "은은"],
              [55, "투명"],
              [0, "완전"],
            ] as const
          ).map(([opacity, label]) => (
            <button
              type="button"
              key={opacity}
              className={
                effectiveSurfaceOpacity === opacity ? "is-selected" : ""
              }
              aria-pressed={effectiveSurfaceOpacity === opacity}
              onClick={() => setSurfaceOpacity(opacity)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="panel-description">
          몰래보기는 28% 투명 배경·간단보기·항상 위를 세션 동안 자동
          적용합니다.
        </p>
      </div>
    </section>
  );
}

function BrightnessControls() {
  const settings = useNovelierStore((state) => state.settings);
  const update = useNovelierStore((state) => state.updateSettings);
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">READER DIMMER</span>
          <h2>밝기 설정</h2>
        </div>
        <SunMedium size={21} />
      </div>
      <RangeField
        label="본문 밝기"
        value={settings.brightness}
        minimum={35}
        maximum={100}
        step={1}
        valueLabel={`${settings.brightness}%`}
        onChange={(brightness) => update({ brightness })}
      />
      <p className="panel-description">
        기기의 시스템 밝기는 변경하지 않고 NOVELIER 읽기 화면만 편안하게
        어둡게 조절합니다.
      </p>
    </section>
  );
}

function StatsPanel({
  book,
  visibleText,
  totalPages,
}: {
  book: AppBook;
  visibleText: string;
  totalPages: number;
}) {
  const settings = useNovelierStore((state) => state.settings);
  const includeWhitespace = settings.countWhitespace;
  const total = useMemo(
    () => countGraphemes(book.content, includeWhitespace),
    [book.content, includeWhitespace],
  );
  const visible = useMemo(
    () => countGraphemes(visibleText, includeWhitespace),
    [visibleText, includeWhitespace],
  );
  return (
    <section className="stats-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">READING STATS</span>
          <h2>읽기 통계</h2>
        </div>
      </div>
      <div className="stat-grid">
        <article>
          <span>진행률</span>
          <strong>{Math.round(book.progress * 100)}%</strong>
        </article>
        <article>
          <span>전체 페이지</span>
          <strong>
            {totalPages > 0 ? formatNumber(totalPages) : "계산 중…"}
          </strong>
        </article>
        <article>
          <span>현재 화면</span>
          <strong>{formatNumber(visible)}</strong>
          <small>글자</small>
        </article>
        <article>
          <span>전체 본문</span>
          <strong>{formatNumber(total)}</strong>
          <small>글자</small>
        </article>
      </div>
      <p className="panel-description">
        {includeWhitespace ? "공백을 포함한" : "공백을 제외한"} Unicode 사용자 인식
        문자 기준입니다.
      </p>
    </section>
  );
}

function BookInfoPanel({
  book,
  onRepairTitle,
}: {
  book: AppBook;
  onRepairTitle: () => void;
}) {
  return (
    <section className="book-info-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">BOOK INFORMATION</span>
          <h2>책 정보</h2>
        </div>
      </div>
      <div className="book-info-card">
        <BookCover title={book.title} seed={book.coverSeed} compact />
        <div>
          <strong>{book.title}</strong>
          <span>TXT · {book.encoding ?? "자동 감지"}</span>
        </div>
      </div>
      <dl className="book-info-list">
        <div>
          <dt>파일 크기</dt>
          <dd>
            {book.byteSize
              ? `${(book.byteSize / 1024).toLocaleString("ko-KR", {
                  maximumFractionDigits: 1,
                })} KB`
              : "내장 예시"}
          </dd>
        </div>
        <div>
          <dt>본문 블록</dt>
          <dd>{book.blockCount?.toLocaleString("ko-KR") ?? "—"}</dd>
        </div>
        <div>
          <dt>가져온 시각</dt>
          <dd>
            {new Intl.DateTimeFormat("ko-KR", {
              dateStyle: "medium",
            }).format(book.importedAt)}
          </dd>
        </div>
      </dl>
      <p className="panel-description">
        제목은 파일명에서 만들며 저자·장·목차 정보는 생성하지 않습니다.
      </p>
      {book.id !== "novelier-welcome" &&
      looksLikeDocumentProviderId(book.title) ? (
        <button
          type="button"
          className="repair-title-button"
          onClick={onRepairTitle}
        >
          <FilePlus2 size={19} />
          <span>
            <strong>원본 파일에서 제목 복구</strong>
            <small>같은 TXT를 다시 선택해 제목만 안전하게 고칩니다.</small>
          </span>
        </button>
      ) : null}
    </section>
  );
}

function MorePanel({
  onOpen,
  onToggleChrome,
  onResetSettings,
}: {
  onOpen: (surface: AppSurface) => void;
  onToggleChrome: () => void;
  onResetSettings: () => void;
}) {
  return (
    <section className="more-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">MORE</span>
          <h2>더보기</h2>
        </div>
      </div>
      <button
        type="button"
        className="compact-reader-only-menu"
        onClick={() => onOpen("search")}
      >
        <Search size={20} />
        <span>
          <strong>본문 검색</strong>
          <small>단어나 문장이 있는 위치 찾기</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <button type="button" onClick={() => onOpen("book-info")}>
        <BookOpen size={20} />
        <span>
          <strong>책 정보</strong>
          <small>제목, 인코딩과 로컬 파일 정보</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <button
        type="button"
        className="compact-reader-only-menu"
        onClick={() => onOpen("stats")}
      >
        <SlidersHorizontal size={20} />
        <span>
          <strong>읽기 통계</strong>
          <small>현재 화면과 전체 글자 수</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <button type="button" onClick={() => onOpen("theme")}>
        <Moon size={20} />
        <span>
          <strong>화면 설정</strong>
          <small>테마, 밝기와 PC 배경을 한곳에서 설정</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <button type="button" onClick={onToggleChrome}>
        <Sparkles size={20} />
        <span>
          <strong>집중 모드</strong>
          <small>주변 도구를 숨기고 본문만 보기</small>
        </span>
        <ChevronRight size={18} />
      </button>
      <button
        type="button"
        className="more-reset-settings"
        onClick={onResetSettings}
      >
        <ListRestart size={20} />
        <span>
          <strong>읽기 설정 초기화</strong>
          <small>책과 북마크, 읽던 위치는 그대로 유지</small>
        </span>
        <ChevronRight size={18} />
      </button>
    </section>
  );
}

function AdaptiveOverlay({
  surface,
  book,
  visibleText,
  totalPages,
  currentPage,
  pagesCalculating,
  onClose,
  onJump,
  onPageJump,
  onOpen,
  onToggleChrome,
  onResetSettings,
  onRepairTitle,
  returnFocusTarget,
}: {
  surface: AppSurface;
  book: AppBook;
  visibleText: string;
  totalPages: number;
  currentPage: number;
  pagesCalculating: boolean;
  onClose: () => void;
  onJump: (progress: number) => void;
  onPageJump: (page: number) => void;
  onOpen: (surface: AppSurface) => void;
  onToggleChrome: () => void;
  onResetSettings: () => void;
  onRepairTitle: () => void;
  returnFocusTarget: HTMLElement | null;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const focusReturnTarget = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!surface) {
      const target = focusReturnTarget.current;
      focusReturnTarget.current = null;
      if (target?.isConnected) target.focus();
      return;
    }

    if (!focusReturnTarget.current) {
      focusReturnTarget.current =
        returnFocusTarget ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
    }
    const frame = requestAnimationFrame(() => {
      const sheet = sheetRef.current;
      if (!sheet || sheet.contains(document.activeElement)) return;
      sheet
        .querySelector<HTMLElement>(
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
        )
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [returnFocusTarget, surface]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const focusable = [
      ...sheet.querySelectorAll<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!surface) return null;
  return (
    <div className="overlay-root" role="presentation" onMouseDown={onClose}>
      <section
        ref={sheetRef}
        className="adaptive-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="읽기 도구"
        onKeyDown={handleDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <IconButton label="닫기" className="sheet-close" onClick={onClose}>
          <X size={18} />
        </IconButton>
        <div className="sheet-content">
          {surface === "jump" ? (
            <JumpControls
              book={book}
              totalPages={totalPages}
              currentPage={currentPage}
              pagesCalculating={pagesCalculating}
              onJump={(value) => {
                onJump(value);
                onClose();
              }}
              onPageJump={(value) => {
                onPageJump(value);
                onClose();
              }}
            />
          ) : null}
          {surface === "bookmarks" ? (
            <BookmarksList
              book={book}
              onJump={(value) => {
                onJump(value);
                onClose();
              }}
            />
          ) : null}
          {surface === "brightness" ? <BrightnessControls /> : null}
          {surface === "font" ? <ReaderSettingsControls /> : null}
          {surface === "theme" ? <ThemeControls /> : null}
          {surface === "search" ? (
            <SearchPanel
              book={book}
              onJump={(value) => {
                onJump(value);
                onClose();
              }}
            />
          ) : null}
          {surface === "stats" ? (
            <StatsPanel
              book={book}
              visibleText={visibleText}
              totalPages={totalPages}
            />
          ) : null}
          {surface === "book-info" ? (
            <BookInfoPanel book={book} onRepairTitle={onRepairTitle} />
          ) : null}
          {surface === "more" ? (
            <MorePanel
              onOpen={onOpen}
              onToggleChrome={onToggleChrome}
              onResetSettings={onResetSettings}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ReaderHeader({
  book,
  books,
  chromeVisible,
  isBookmarked,
  onBack,
  onSelectBook,
  onBookmark,
  onOpen,
}: {
  book: AppBook;
  books: AppBook[];
  chromeVisible: boolean;
  isBookmarked: boolean;
  onBack: () => void;
  onSelectBook: (id: string) => void;
  onBookmark: () => void;
  onOpen: (surface: AppSurface) => void;
}) {
  return (
    <header className={`reader-header reader-chrome ${chromeVisible ? "" : "is-hidden"}`}>
      <IconButton label="서재로 돌아가기" className="mobile-back" onClick={onBack}>
        <ChevronLeft size={25} />
      </IconButton>
      <label className="book-switcher">
        <span className="sr-only">최근 책 전환</span>
        <select value={book.id} onChange={(event) => onSelectBook(event.target.value)}>
          {books.map((item) => (
            <option value={item.id} key={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <ChevronDown size={16} />
      </label>
      <div className="reader-header-actions">
        <button
          type="button"
          className="search-action"
          aria-label="검색"
          onClick={() => onOpen("search")}
        >
          <Search size={20} />
          <span>검색</span>
        </button>
        <IconButton
          label={isBookmarked ? "현재 북마크 제거" : "현재 위치 북마크"}
          active={isBookmarked}
          onClick={onBookmark}
        >
          {isBookmarked ? <BookmarkCheck size={21} /> : <Bookmark size={21} />}
        </IconButton>
        <IconButton label="더보기" onClick={() => onOpen("more")}>
          <MoreHorizontal size={23} />
        </IconButton>
      </div>
    </header>
  );
}

interface PagedParagraphFragment {
  paragraphIndex: number;
  characterOffset: number;
  text: string;
}

interface PagedContentMeasurement {
  availableHeight: number;
  renderedHeight: number;
  overflowPixels: number;
}

const PAGED_LINE_BOTTOM_GUARD_PX = 0.25;

function measurePagedContent(
  viewport: HTMLElement,
): PagedContentMeasurement | null {
  const documentElement =
    viewport.querySelector<HTMLElement>(".reader-document");
  if (!documentElement) return null;

  const documentBounds = documentElement.getBoundingClientRect();
  let finalLineBottom = documentBounds.top;

  for (const element of documentElement.querySelectorAll("h1, p")) {
    const range = document.createRange();
    range.selectNodeContents(element);
    for (const rect of range.getClientRects()) {
      if (rect.height > 0) {
        finalLineBottom = Math.max(finalLineBottom, rect.bottom);
      }
    }
    range.detach();
  }

  const availableHeight = Math.max(1, documentElement.clientHeight);
  const renderedHeight = Math.max(
    documentElement.scrollHeight,
    finalLineBottom - documentBounds.top,
  );
  return {
    availableHeight,
    renderedHeight,
    overflowPixels: Math.max(
      0,
      documentElement.scrollHeight - availableHeight,
      finalLineBottom -
        (documentBounds.bottom - PAGED_LINE_BOTTOM_GUARD_PX),
    ),
  };
}

function paragraphFragmentsForPage(
  content: string,
  paragraphs: readonly ParagraphEntry[],
  startOffset: number,
  endOffset: number,
): PagedParagraphFragment[] {
  const fragments: PagedParagraphFragment[] = [];
  let index = Math.max(0, paragraphIndexForOffset(paragraphs, startOffset));

  while (index < paragraphs.length) {
    const paragraph = paragraphs[index];
    if (paragraph.start >= endOffset) break;
    if (paragraph.end > startOffset) {
      let fragmentStart = Math.max(startOffset, paragraph.start);
      let fragmentEnd = Math.min(endOffset, paragraph.end);
      const raw = content.slice(fragmentStart, fragmentEnd);
      const text = raw.trim();
      if (text) {
        fragmentStart += raw.indexOf(text);
        fragmentEnd = fragmentStart + text.length;
        fragments.push({
          paragraphIndex: paragraph.index,
          characterOffset: fragmentStart,
          text: content.slice(fragmentStart, fragmentEnd),
        });
      }
    }
    index += 1;
  }

  return fragments;
}

function ReaderViewport({
  book,
  progress,
  onProgress,
  onPageInfo,
  onVisibleText,
  chromeVisible,
  onHideChrome,
  compactMobileLayout = false,
  hardwareNavigationEnabled = false,
  stealthTapControls = false,
}: {
  book: AppBook;
  progress: number;
  onProgress: (progress: number) => void;
  onPageInfo: (
    current: number,
    total: number,
    pageStarts?: readonly number[],
  ) => void;
  onVisibleText: (text: string) => void;
  chromeVisible: boolean;
  onHideChrome: () => void;
  compactMobileLayout?: boolean;
  hardwareNavigationEnabled?: boolean;
  stealthTapControls?: boolean;
}) {
  const settings = useNovelierStore((state) => state.settings);
  const viewportRef = useRef<HTMLDivElement>(null);
  const latestProgress = useRef(progress);
  const selfReportedOffset = useRef<number | null>(null);
  const lastVisibleOffset = useRef<number | null>(null);
  const scrollingProgrammatically = useRef(false);
  const scrollFrame = useRef<number | null>(null);
  const restoreFrame = useRef<number | null>(null);
  const paginationFrame = useRef<number | null>(null);
  const readyPageRanges = useRef<typeof pageRanges | null>(null);
  const paragraphs = useMemo(
    () => createParagraphEntries(book.content),
    [book.content],
  );
  const [viewportSize, setViewportSize] = useState(() => ({
    width:
      typeof window === "undefined"
        ? 720
        : Math.max(320, Math.min(900, window.innerWidth)),
    height:
      typeof window === "undefined"
        ? 640
        : Math.max(320, window.innerHeight - 190),
  }));
  const initialOffset = contentOffsetForProgress(book.content.length, progress);
  const [virtualAnchorOffset, setVirtualAnchorOffset] = useState(initialOffset);
  const [pendingRestoreOffset, setPendingRestoreOffset] = useState<number | null>(
    initialOffset,
  );

  useLayoutEffect(() => {
    latestProgress.current = progress;
  }, [progress]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => {
      const next = {
        width: Math.max(1, viewport.clientWidth),
        height: Math.max(1, viewport.clientHeight),
      };
      setViewportSize((previous) =>
        previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    updateSize();
    return () => observer.disconnect();
  }, []);

  const isPhoneLandscape =
    typeof window !== "undefined" &&
    window.matchMedia(
      "(max-height: 520px) and (orientation: landscape)",
    ).matches;
  const isNativeDesktopPlatform =
    typeof document !== "undefined" &&
    (document.documentElement.dataset.platform === "macos" ||
      document.documentElement.dataset.platform === "windows");
  const isMobileReadingLayout =
    typeof window !== "undefined" &&
    (compactMobileLayout ||
      (!isNativeDesktopPlatform &&
        (window.matchMedia("(max-width: 767px)").matches ||
          isPhoneLandscape)));
  const effectiveFontSize = settings.fontSize;
  const effectivePadding = isMobileReadingLayout
    ? Math.min(
        settings.horizontalPadding,
        typeof window !== "undefined" && window.innerWidth < 480 ? 20 : 24,
      )
    : Math.min(
        settings.horizontalPadding,
        Math.max(16, (viewportSize.width - 180) / 2),
      );
  const responsiveContentWidth = compactMobileLayout
    ? Math.min(settings.contentWidth, 680)
    : settings.contentWidth;
  const actualContentWidth = Math.max(
    180,
    Math.min(
      responsiveContentWidth,
      viewportSize.width - effectivePadding * 2,
    ),
  );
  const pageLayoutKey = [
    book.id,
    viewportSize.width,
    viewportSize.height,
    actualContentWidth,
    effectiveFontSize,
    settings.fontFamily,
    settings.lineHeight,
    settings.letterSpacing,
    settings.paragraphSpacing,
    isMobileReadingLayout ? 1 : 0,
    isPhoneLandscape ? 1 : 0,
  ].join(":");
  const [pageCapacityCalibration, setPageCapacityCalibration] = useState({
    key: pageLayoutKey,
    scale: 1,
  });
  const pageCapacityScale =
    pageCapacityCalibration.key === pageLayoutKey
      ? pageCapacityCalibration.scale
      : 1;
  const [fontLayoutRevision, setFontLayoutRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) setFontLayoutRevision((revision) => revision + 1);
    });
    return () => {
      active = false;
    };
  }, [book.id, settings.fontFamily]);

  const pageRanges = useMemo(() => {
    const sharedLayout = {
      viewportWidth: actualContentWidth,
      viewportHeight: viewportSize.height,
      contentWidth: actualContentWidth,
      fontSize: effectiveFontSize,
      lineHeight: settings.lineHeight,
      letterSpacing: settings.letterSpacing,
      paragraphSpacing: settings.paragraphSpacing,
      horizontalPadding: 0,
      verticalPadding: isPhoneLandscape ? 10 : 27,
      averageGlyphWidth: 0.92,
      safetyFactor: 0.72,
      averageParagraphLines: 5,
    };
    const regular = estimatePageCapacity(sharedLayout);
    const first = estimatePageCapacity({
      ...sharedLayout,
      reservedVerticalSpace: isPhoneLandscape ? 60 : 118,
      safetyFactor: isMobileReadingLayout ? 0.9 : 0.72,
      averageParagraphLines: isMobileReadingLayout ? 7 : 5,
    });
    const regularCharacters = Math.max(
      1,
      Math.floor(regular.charactersPerPage * pageCapacityScale),
    );
    const firstCharacters = Math.max(
      1,
      Math.floor(first.charactersPerPage * pageCapacityScale),
    );
    return createPageRanges(book.content, {
      charactersPerPage: regularCharacters,
      firstPageCharacters: firstCharacters,
      paragraphBoundaryWindow: Math.min(
        1_024,
        Math.max(48, Math.floor(regularCharacters * 0.24)),
      ),
      minimumFillRatio: 0.7,
    });
  }, [
    actualContentWidth,
    book.content,
    effectiveFontSize,
    isMobileReadingLayout,
    isPhoneLandscape,
    pageCapacityScale,
    settings.lineHeight,
    settings.letterSpacing,
    settings.paragraphSpacing,
    viewportSize.height,
  ]);
  const pageStartProgresses = useMemo(
    () =>
      pageRanges.map((range) =>
        progressForContentOffset(book.content.length, range.start),
      ),
    [book.content.length, pageRanges],
  );

  const requestedOffset = contentOffsetForProgress(
    book.content.length,
    progress,
  );
  const currentPageIndex = Math.max(
    0,
    pageIndexForOffset(pageRanges, requestedOffset),
  );
  const canonicalPageRange = useMemo(
    () =>
      pageRanges[currentPageIndex] ?? {
        index: 0,
        start: 0,
        end: book.content.length,
      },
    [book.content.length, currentPageIndex, pageRanges],
  );
  const preserveCurrentAnchor =
    lastVisibleOffset.current !== null &&
    Math.abs(lastVisibleOffset.current - requestedOffset) <= 1 &&
    Math.abs(canonicalPageRange.start - requestedOffset) > 1;
  const currentPageRange = useMemo(() => {
    if (!preserveCurrentAnchor) return canonicalPageRange;
    const capacity = Math.max(
      1,
      canonicalPageRange.end - canonicalPageRange.start,
    );
    const boundaryWindow = Math.min(
      1_024,
      Math.max(48, Math.floor(capacity * 0.24)),
    );
    const sample = book.content.slice(
      requestedOffset,
      Math.min(
        book.content.length,
        requestedOffset + capacity + boundaryWindow,
      ),
    );
    const anchored = createPageRanges(sample, {
      charactersPerPage: capacity,
      firstPageCharacters: capacity,
      paragraphBoundaryWindow: boundaryWindow,
      minimumFillRatio: 0.7,
    })[0];
    return {
      index: canonicalPageRange.index,
      start: requestedOffset,
      end: Math.min(
        book.content.length,
        requestedOffset + (anchored?.end ?? capacity),
      ),
    };
  }, [
    book.content,
    canonicalPageRange,
    preserveCurrentAnchor,
    requestedOffset,
  ]);

  useLayoutEffect(() => {
    readyPageRanges.current = null;
    onPageInfo(0, 0, []);
    if (paginationFrame.current !== null) {
      cancelAnimationFrame(paginationFrame.current);
    }
    paginationFrame.current = requestAnimationFrame(() => {
      const readyOffset = contentOffsetForProgress(
        book.content.length,
        latestProgress.current,
      );
      const readyIndex = Math.max(
        0,
        pageIndexForOffset(pageRanges, readyOffset),
      );
      readyPageRanges.current = pageRanges;
      onPageInfo(
        readyIndex + 1,
        Math.max(1, pageRanges.length),
        pageStartProgresses,
      );
      paginationFrame.current = null;
    });
    return () => {
      if (paginationFrame.current !== null) {
        cancelAnimationFrame(paginationFrame.current);
        paginationFrame.current = null;
      }
    };
  }, [
    book.content.length,
    onPageInfo,
    pageRanges,
    pageStartProgresses,
  ]);

  useLayoutEffect(() => {
    if (readyPageRanges.current !== pageRanges) return;
    onPageInfo(
      currentPageIndex + 1,
      Math.max(1, pageRanges.length),
      pageStartProgresses,
    );
  }, [
    currentPageIndex,
    onPageInfo,
    pageRanges,
    pageStartProgresses,
  ]);
  const pagedParagraphs = useMemo(
    () =>
      paragraphFragmentsForPage(
        book.content,
        paragraphs,
        currentPageRange.start,
        currentPageRange.end,
      ),
    [book.content, currentPageRange.end, currentPageRange.start, paragraphs],
  );

  useLayoutEffect(() => {
    if (settings.flow !== "horizontal-paged") return;
    if (fontLayoutRevision === 0) return;

    const viewport = viewportRef.current;
    if (!viewport) return;
    const measurement = measurePagedContent(viewport);
    if (!measurement || measurement.overflowPixels <= 0.5) return;

    /*
     * Remove at least one complete rendered line from the next estimate.
     * React runs this as a layout effect, so an overflowing candidate is
     * repaginated before the browser paints its clipped final line.
     */
    const renderedLineHeight =
      effectiveFontSize *
      Math.max(settings.lineHeight, isMobileReadingLayout ? 1.65 : 1);
    const targetHeight = Math.max(
      renderedLineHeight,
      measurement.availableHeight - renderedLineHeight - 4,
    );
    const heightRatio = Math.min(
      0.9,
      Math.max(
        0.35,
        targetHeight /
          Math.max(measurement.renderedHeight, measurement.availableHeight),
      ),
    );

    setPageCapacityCalibration((previous) => {
      const previousScale =
        previous.key === pageLayoutKey ? previous.scale : 1;
      const nextScale = Math.max(
        0.08,
        Math.min(
          previousScale * heightRatio,
          previousScale - Math.max(0.02, previousScale * 0.04),
        ),
      );
      if (nextScale >= previousScale - 0.001) return previous;
      return { key: pageLayoutKey, scale: nextScale };
    });
  }, [
    currentPageRange.end,
    currentPageRange.start,
    effectiveFontSize,
    fontLayoutRevision,
    isMobileReadingLayout,
    pageLayoutKey,
    pagedParagraphs,
    settings.flow,
    settings.lineHeight,
  ]);

  const paragraphLayout = useMemo(
    () =>
      createParagraphLayout(paragraphs, {
        contentWidth: actualContentWidth,
        fontSize: effectiveFontSize,
        lineHeight: settings.lineHeight,
        letterSpacing: settings.letterSpacing,
        paragraphSpacing: settings.paragraphSpacing,
        titleHeight: 126,
        bottomPadding: 58,
      }),
    [
      actualContentWidth,
      effectiveFontSize,
      paragraphs,
      settings.letterSpacing,
      settings.lineHeight,
      settings.paragraphSpacing,
    ],
  );
  const virtualWindow = useMemo(
    () =>
      paragraphWindowForOffset(
        paragraphs,
        virtualAnchorOffset,
        10,
        48,
      ),
    [paragraphs, virtualAnchorOffset],
  );
  const virtualParagraphs = useMemo(
    () =>
      paragraphs.slice(
        virtualWindow.startIndex,
        virtualWindow.endIndexExclusive,
      ),
    [paragraphs, virtualWindow.endIndexExclusive, virtualWindow.startIndex],
  );

  useEffect(() => {
    latestProgress.current = progress;
    if (settings.flow !== "vertical-scroll") return;
    if (
      selfReportedOffset.current !== null &&
      Math.abs(selfReportedOffset.current - requestedOffset) <= 1
    ) {
      selfReportedOffset.current = null;
      return;
    }
    setVirtualAnchorOffset(requestedOffset);
    setPendingRestoreOffset(requestedOffset);
  }, [requestedOffset, progress, settings.flow]);

  useEffect(() => {
    if (settings.flow !== "vertical-scroll") return;
    const offset = contentOffsetForProgress(
      book.content.length,
      latestProgress.current,
    );
    setVirtualAnchorOffset(offset);
    setPendingRestoreOffset(offset);
  }, [
    actualContentWidth,
    book.content.length,
    book.id,
    effectiveFontSize,
    settings.fontSize,
    settings.lineHeight,
    settings.letterSpacing,
    settings.paragraphSpacing,
    settings.flow,
    viewportSize.height,
  ]);

  const collectVisibleVerticalText = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const children = [
      ...viewport.querySelectorAll<HTMLElement>("[data-paragraph]"),
    ];
    const bounds = viewport.getBoundingClientRect();
    const visible = children.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    const first =
      visible.find(
        (element) => element.getBoundingClientRect().bottom > bounds.top + 12,
      ) ?? visible[0];
    if (!first) return null;
    return {
      characterOffset: Number(first.dataset.characterOffset ?? 0),
      paragraphIndex: Number(first.dataset.paragraph ?? 0),
      text: visible.map((element) => element.innerText).join("\n\n"),
    };
  }, []);

  useLayoutEffect(() => {
    if (
      settings.flow !== "vertical-scroll" ||
      pendingRestoreOffset === null
    ) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    const targetIndex = paragraphIndexForOffset(
      paragraphs,
      pendingRestoreOffset,
    );
    const target =
      targetIndex >= 0
        ? viewport.querySelector<HTMLElement>(
            `[data-paragraph="${targetIndex}"]`,
          )
        : null;
    if (targetIndex >= 0 && !target) return;

    scrollingProgrammatically.current = true;
    if (restoreFrame.current !== null) {
      cancelAnimationFrame(restoreFrame.current);
    }
    const previousScrollBehavior = viewport.style.scrollBehavior;
    viewport.style.scrollBehavior = "auto";
    viewport.scrollTop =
      pendingRestoreOffset <= 0 || !target
        ? 0
        : Math.max(0, target.offsetTop - 18);
    const visible = collectVisibleVerticalText();
    if (visible) onVisibleText(visible.text);
    setPendingRestoreOffset(null);
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = requestAnimationFrame(() => {
        viewport.style.scrollBehavior = previousScrollBehavior;
        scrollingProgrammatically.current = false;
        restoreFrame.current = null;
      });
    });
  }, [
    collectVisibleVerticalText,
    onVisibleText,
    paragraphs,
    pendingRestoreOffset,
    settings.flow,
    virtualWindow.endIndexExclusive,
    virtualWindow.startIndex,
  ]);

  const synchronizeVerticalPosition = useCallback(() => {
    const viewport = viewportRef.current;
    if (
      !viewport ||
      settings.flow !== "vertical-scroll" ||
      scrollingProgrammatically.current
    ) {
      return;
    }
    const visible = collectVisibleVerticalText();
    if (!visible) {
      const estimatedIndex = paragraphIndexForScrollTop(
        paragraphLayout,
        viewport.scrollTop + 18,
      );
      const estimated = paragraphs[estimatedIndex];
      if (estimated) setVirtualAnchorOffset(estimated.start);
      return;
    }

    onVisibleText(visible.text);
    if (lastVisibleOffset.current !== visible.characterOffset) {
      lastVisibleOffset.current = visible.characterOffset;
      selfReportedOffset.current = visible.characterOffset;
      onProgress(
        progressForContentOffset(
          book.content.length,
          visible.characterOffset,
        ),
      );
    }
    if (
      visible.paragraphIndex <= virtualWindow.startIndex + 3 ||
      visible.paragraphIndex >= virtualWindow.endIndexExclusive - 12
    ) {
      setVirtualAnchorOffset(visible.characterOffset);
    }
  }, [
    book.content.length,
    collectVisibleVerticalText,
    onProgress,
    onVisibleText,
    paragraphLayout,
    paragraphs,
    settings.flow,
    virtualWindow.endIndexExclusive,
    virtualWindow.startIndex,
  ]);

  useLayoutEffect(() => {
    if (
      settings.flow !== "vertical-scroll" ||
      pendingRestoreOffset !== null
    ) {
      return;
    }
    const frame = requestAnimationFrame(synchronizeVerticalPosition);
    return () => cancelAnimationFrame(frame);
  }, [
    pendingRestoreOffset,
    settings.flow,
    synchronizeVerticalPosition,
    virtualWindow.endIndexExclusive,
    virtualWindow.startIndex,
  ]);

  const handleVerticalScroll = () => {
    if (
      settings.flow !== "vertical-scroll" ||
      scrollingProgrammatically.current
    ) {
      return;
    }
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      synchronizeVerticalPosition();
    });
  };

  const goPage = useCallback(
    (delta: number) => {
      if (settings.flow !== "horizontal-paged") return;
      const nextIndex = Math.min(
        pageRanges.length - 1,
        Math.max(0, currentPageIndex + delta),
      );
      const nextRange = pageRanges[nextIndex];
      if (!nextRange || nextIndex === currentPageIndex) return;
      lastVisibleOffset.current = nextRange.start;
      selfReportedOffset.current = nextRange.start;
      onProgress(
        progressForContentOffset(book.content.length, nextRange.start),
      );
      onPageInfo(
        nextIndex + 1,
        pageRanges.length,
        pageStartProgresses,
      );
      onVisibleText(book.content.slice(nextRange.start, nextRange.end));
    },
    [
      book.content,
      currentPageIndex,
      onPageInfo,
      onProgress,
      onVisibleText,
      pageRanges,
      pageStartProgresses,
      settings.flow,
    ],
  );

  const moveReadingUnit = useCallback(
    (delta: -1 | 1) => {
      if (settings.flow === "vertical-scroll") {
        const viewport = viewportRef.current;
        if (!viewport) return;
        viewport.scrollBy({
          top: delta * viewport.clientHeight * 0.88,
          behavior: "smooth",
        });
        return;
      }
      goPage(delta);
    },
    [goPage, settings.flow],
  );

  useEffect(() => {
    if (!hardwareNavigationEnabled) return;
    return subscribeHardwareReaderNavigation((intent) => {
      if (document.visibilityState !== "visible") return;
      moveReadingUnit(navigationDelta(intent));
    });
  }, [hardwareNavigationEnabled, moveReadingUnit]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (settings.flow === "vertical-scroll") {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const isEditable =
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement;
        if (isEditable) return;
        const isBackward =
          event.key === "PageUp" || (event.key === " " && event.shiftKey);
        const isForward =
          event.key === "PageDown" || (event.key === " " && !event.shiftKey);
        if (isBackward || isForward) {
          event.preventDefault();
          moveReadingUnit(isBackward ? -1 : 1);
        }
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        moveReadingUnit(-1);
      }
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        moveReadingUnit(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moveReadingUnit, settings.flow]);

  useLayoutEffect(() => {
    if (settings.flow !== "horizontal-paged") return;
    onVisibleText(
      book.content.slice(currentPageRange.start, currentPageRange.end),
    );
    if (Math.abs(requestedOffset - currentPageRange.start) > 1) {
      selfReportedOffset.current = currentPageRange.start;
      lastVisibleOffset.current = currentPageRange.start;
      onProgress(
        progressForContentOffset(
          book.content.length,
          currentPageRange.start,
        ),
      );
    }
  }, [
    book.content,
    currentPageIndex,
    currentPageRange.end,
    currentPageRange.start,
    onProgress,
    onVisibleText,
    pageRanges.length,
    requestedOffset,
    settings.flow,
  ]);

  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      if (restoreFrame.current !== null) {
        cancelAnimationFrame(restoreFrame.current);
      }
    },
    [],
  );

  const tapStart = useRef<{ x: number; y: number } | null>(null);
  const handlePointerDown = (event: ReactPointerEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest("button, input, select, textarea, a")
    ) {
      tapStart.current = null;
      return;
    }
    tapStart.current = { x: event.clientX, y: event.clientY };
  };
  const handlePointerUp = (event: ReactPointerEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest("button, input, select, textarea, a")
    ) {
      tapStart.current = null;
      return;
    }
    if (!tapStart.current) return;
    const deltaX = event.clientX - tapStart.current.x;
    const deltaY = event.clientY - tapStart.current.y;
    tapStart.current = null;
    if (
      settings.flow === "horizontal-paged" &&
      Math.abs(deltaX) > 54 &&
      Math.abs(deltaX) > Math.abs(deltaY)
    ) {
      goPage(deltaX < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) return;
    const selection = window.getSelection()?.toString();
    if (selection) return;
    const viewport = viewportRef.current;
    const localX = viewport
      ? event.clientX - viewport.getBoundingClientRect().left
      : event.clientX;
    if (stealthTapControls && viewport) {
      if (localX < viewport.clientWidth * 0.2) {
        moveReadingUnit(-1);
        return;
      }
      if (localX > viewport.clientWidth * 0.8) {
        moveReadingUnit(1);
        return;
      }
      if (chromeVisible) onHideChrome();
      return;
    }
    if (
      settings.flow === "horizontal-paged" &&
      viewport &&
      localX < viewport.clientWidth * 0.2
    ) {
      goPage(-1);
      return;
    }
    if (
      settings.flow === "horizontal-paged" &&
      viewport &&
      localX > viewport.clientWidth * 0.8
    ) {
      goPage(1);
      return;
    }
    if (chromeVisible) onHideChrome();
  };

  const readerStyle = {
    "--reader-font-family":
      settings.fontFamily === "system-sans"
        ? 'Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        : settings.fontFamily === "system-serif"
          ? '"AppleMyungjo", "Batang", "Times New Roman", serif'
          : '"Noto Serif KR", "AppleMyungjo", "Batang", serif',
    "--reader-font-size": `${effectiveFontSize}px`,
    "--reader-line-height": `${settings.lineHeight}`,
    "--reader-letter-spacing": `${settings.letterSpacing}em`,
    "--reader-paragraph-spacing": `${settings.paragraphSpacing}em`,
    "--reader-content-width": `${responsiveContentWidth}px`,
    "--reader-horizontal-padding": `${
      compactMobileLayout ? effectivePadding : settings.horizontalPadding
    }px`,
  } as CSSProperties;
  const virtualTop =
    virtualWindow.startIndex === 0
      ? 0
      : paragraphLayout.tops[virtualWindow.startIndex];
  const virtualBottom = Math.max(
    0,
    paragraphLayout.totalHeight -
      paragraphLayout.tops[virtualWindow.endIndexExclusive],
  );

  return (
    <main
      ref={viewportRef}
      className={`reader-viewport ${
        settings.flow === "horizontal-paged" ? "is-paged" : "is-scrolling"
      } ${chromeVisible ? "" : "is-immersive"}`}
      style={readerStyle}
      tabIndex={0}
      onScroll={handleVerticalScroll}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      aria-label={`${book.title} 본문`}
      data-page-current={currentPageIndex + 1}
      data-page-total={Math.max(1, pageRanges.length)}
      data-page-capacity-scale={pageCapacityScale.toFixed(4)}
      data-virtualized={settings.flow === "vertical-scroll" ? "true" : "page"}
      data-chrome-toggle-zones={
        "reserved-chrome-only"
      }
    >
      <article
        className="reader-document"
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
      >
        {settings.flow === "horizontal-paged" ? (
          <>
            {currentPageRange.start === 0 ? (
              <>
                <h1>{book.title}</h1>
                <div className="title-rule" />
              </>
            ) : null}
            {pagedParagraphs.map((paragraph) => (
              <p
                key={`${book.id}-${currentPageIndex}-${paragraph.paragraphIndex}`}
                data-paragraph={paragraph.paragraphIndex}
                data-character-offset={paragraph.characterOffset}
              >
                {paragraph.text}
              </p>
            ))}
          </>
        ) : (
          <>
            {virtualWindow.startIndex === 0 ? (
              <>
                <h1>{book.title}</h1>
                <div className="title-rule" />
              </>
            ) : (
              <div
                className="virtual-spacer"
                style={{ height: virtualTop }}
                aria-hidden="true"
              />
            )}
            {virtualParagraphs.map((paragraph) => (
              <p
                key={`${book.id}-${paragraph.index}`}
                data-paragraph={paragraph.index}
                data-character-offset={paragraph.start}
              >
                {paragraph.text}
              </p>
            ))}
            <div
              className="virtual-spacer"
              style={{ height: virtualBottom }}
              aria-hidden="true"
            />
          </>
        )}
      </article>
      {settings.flow === "horizontal-paged" ? (
        <>
          <button
            type="button"
            className="page-tap-button previous"
            aria-label="이전 페이지"
            disabled={currentPageIndex <= 0}
            onClick={(event) => {
              event.stopPropagation();
              goPage(-1);
            }}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            className="page-tap-button next"
            aria-label="다음 페이지"
            disabled={currentPageIndex >= pageRanges.length - 1}
            onClick={(event) => {
              event.stopPropagation();
              goPage(1);
            }}
          >
            <ChevronRight />
          </button>
        </>
      ) : null}
    </main>
  );
}

function ReaderChromeRevealZones({
  chromeVisible,
  onReveal,
}: {
  chromeVisible: boolean;
  onReveal: () => void;
}) {
  if (chromeVisible) return null;
  return (
    <div className="reader-chrome-reveal-zones">
      <button
        type="button"
        className="reader-chrome-reveal-zone top"
        aria-label="상단 읽기 도구 표시"
        onClick={onReveal}
      />
      <button
        type="button"
        className="reader-chrome-reveal-zone bottom"
        aria-label="하단 읽기 도구 표시"
        onClick={onReveal}
      />
    </div>
  );
}

function ReaderFooter({
  book,
  totalPages,
  currentPage,
  pagesCalculating,
  visibleCount,
  chromeVisible,
  onJump,
  onPageJump,
  onOpen,
}: {
  book: AppBook;
  totalPages: number;
  currentPage: number;
  pagesCalculating: boolean;
  visibleCount: number;
  chromeVisible: boolean;
  onJump: (progress: number) => void;
  onPageJump: (page: number) => void;
  onOpen: (surface: AppSurface) => void;
}) {
  const settings = useNovelierStore((state) => state.settings);
  const totalCount = useMemo(
    () =>
      settings.countWhitespace && typeof book.totalCharacters === "number"
        ? book.totalCharacters
        : countGraphemes(book.content, settings.countWhitespace),
    [book.content, book.totalCharacters, settings.countWhitespace],
  );
  const jumpPage = (delta: number) => {
    if (pagesCalculating) return;
    const nextPage = Math.min(totalPages, Math.max(1, currentPage + delta));
    onPageJump(nextPage);
  };

  return (
    <footer className={`reader-footer reader-chrome ${chromeVisible ? "" : "is-hidden"}`}>
      <div className="desktop-page-buttons" aria-label="페이지 넘기기">
        <IconButton
          label="이전 페이지"
          onClick={() => jumpPage(-1)}
          className="footer-page-button"
        >
          <ChevronLeft size={19} />
        </IconButton>
        <IconButton
          label="다음 페이지"
          onClick={() => jumpPage(1)}
          className="footer-page-button"
        >
          <ChevronRight size={19} />
        </IconButton>
      </div>
      <div className="footer-progress">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(book.progress * 1000)}
          aria-label="읽기 진행률"
          aria-valuetext={`${Math.round(book.progress * 100)}퍼센트`}
          onChange={(event) => onJump(Number(event.target.value) / 1000)}
        />
        <button type="button" onClick={() => onOpen("stats")}>
          <span>{Math.round(book.progress * 100)}% · {book.title}</span>
          <strong>
            {settings.flow === "horizontal-paged"
              ? pagesCalculating
                ? "페이지 계산 중…"
                : `${currentPage} / ${totalPages} 페이지`
              : `${formatNumber(visibleCount)} / ${formatNumber(totalCount)}자`}
          </strong>
        </button>
      </div>
    </footer>
  );
}

const mobileActions: Array<{
  id: Exclude<
    AppSurface,
    "more" | "search" | "book-info" | "stats" | null
  >;
  label: string;
  icon: LucideIcon | "text";
}> = [
  { id: "jump", label: "이동", icon: ListRestart },
  { id: "bookmarks", label: "북마크", icon: Bookmark },
  { id: "brightness", label: "밝기 설정", icon: SunMedium },
  { id: "font", label: "글꼴", icon: "text" },
  { id: "theme", label: "테마", icon: Moon },
];

function MobileToolbar({
  chromeVisible,
  active,
  onOpen,
}: {
  chromeVisible: boolean;
  active: AppSurface;
  onOpen: (surface: AppSurface) => void;
}) {
  return (
    <nav
      className={`mobile-toolbar reader-chrome ${chromeVisible ? "" : "is-hidden"}`}
      aria-label="읽기 도구"
    >
      {mobileActions.map((action) => {
        const Icon = action.icon === "text" ? null : action.icon;
        return (
          <button
            type="button"
            key={action.id}
            className={active === action.id ? "is-active" : ""}
            onClick={() => onOpen(action.id)}
          >
            {Icon ? (
              <Icon size={23} strokeWidth={1.7} />
            ) : (
              <strong className="mobile-aa" aria-hidden="true">
                Aa
              </strong>
            )}
            <span>{action.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function MobileLibrary({
  books,
  onOpen,
  onImport,
  onDelete,
}: {
  books: AppBook[];
  onOpen: (id: string) => void;
  onImport: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <main className="mobile-library">
      <header>
        <div>
          <LogoMark />
          <span>NOVELIER</span>
        </div>
      </header>
      <section className="library-hero">
        <span className="eyebrow">YOUR PRIVATE LIBRARY</span>
        <h1>내 서재</h1>
        <p>기기 안에 보관된 이야기를 이어서 읽어 보세요.</p>
      </section>
      <div className="mobile-book-grid">
        {books.map((book) => (
          <article key={book.id}>
            <button type="button" onClick={() => onOpen(book.id)}>
              <BookCover title={book.title} seed={book.coverSeed} />
              <strong>{book.title}</strong>
              <small>{Math.round(book.progress * 100)}% 읽음</small>
              <span className="mini-progress">
                <span style={{ width: `${book.progress * 100}%` }} />
              </span>
            </button>
            {book.id !== "novelier-welcome" ? (
              <IconButton label={`${book.title} 삭제`} onClick={() => onDelete(book.id)}>
                <Trash2 size={16} />
              </IconButton>
            ) : null}
          </article>
        ))}
        <button type="button" className="mobile-import-card" onClick={onImport}>
          <FilePlus2 size={28} />
          <strong>TXT 가져오기</strong>
          <span>UTF-8 · UTF-16 · CP949</span>
        </button>
      </div>
    </main>
  );
}

interface PendingEncodingChoice {
  filename: string;
  bytes: Uint8Array;
  bookId: string;
  detectedEncoding: TextEncoding;
}

function EncodingChoiceDialog({
  pending,
  onKeep,
  onChoose,
}: {
  pending: PendingEncodingChoice;
  onKeep: () => void;
  onChoose: (encoding: TextEncoding) => void;
}) {
  const choices: Array<{ encoding: TextEncoding; label: string }> = [
    { encoding: "utf-8", label: "UTF-8" },
    { encoding: "utf-16le", label: "UTF-16 LE" },
    { encoding: "utf-16be", label: "UTF-16 BE" },
    { encoding: "euc-kr", label: "CP949 / EUC-KR" },
  ];

  return (
    <div className="overlay-root encoding-overlay" role="presentation">
      <section
        className="adaptive-sheet encoding-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="encoding-title"
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-content">
          <span className="eyebrow">TEXT ENCODING</span>
          <h2 id="encoding-title">문자 인코딩을 확인해 주세요</h2>
          <p>
            일부 문자가 깨질 가능성이 있습니다. 현재 감지값을 유지하거나 다른
            인코딩으로 본문을 다시 읽을 수 있습니다.
          </p>
          <div className="encoding-options">
            {choices.map(({ encoding, label }) => (
              <button
                type="button"
                key={encoding}
                className={
                  pending.detectedEncoding === encoding ? "is-detected" : ""
                }
                onClick={() => onChoose(encoding)}
              >
                <span>{label}</span>
                {pending.detectedEncoding === encoding ? (
                  <small>현재 감지</small>
                ) : null}
              </button>
            ))}
          </div>
          <button type="button" className="keep-encoding" onClick={onKeep}>
            현재 결과로 계속 읽기
          </button>
        </div>
      </section>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status">
      <Check size={17} />
      {message}
    </div>
  );
}

export function App() {
  const {
    books,
    currentBookId,
    route,
    activeSection,
    openSurface,
    chromeVisible,
    privacyMode,
    stealthView,
    stealthOpacity,
    settings,
    setRoute,
    openBook,
    addBook,
    replaceBooks,
    updateBook,
    removeBook,
    setProgress,
    setActiveSection,
    setOpenSurface,
    setChromeVisible,
    setPrivacyMode,
    setStealthView,
    replaceSettings,
    updateSettings,
    resetSettings,
    toggleBookmark,
  } = useNovelierStore();
  const transparencyActive =
    settings.transparencyEnabled || privacyMode || stealthView;
  const simpleViewActive =
    settings.simpleView || privacyMode || stealthView;
  const chromeVisibleActive = chromeVisible && !privacyMode;
  const surfaceOpacityActive = privacyMode
    ? Math.min(stealthView ? stealthOpacity : settings.surfaceOpacity, 28)
    : stealthView
      ? stealthOpacity
      : settings.surfaceOpacity;
  const alwaysOnTopActive = stealthView;
  const currentBook = books.find((book) => book.id === currentBookId) ?? books[0];
  const [pageInfo, setPageInfo] = useState({ current: 0, total: 0 });
  const pageStartsRef = useRef<readonly number[]>([]);
  const [visibleText, setVisibleText] = useState("");
  const [toast, setToast] = useState("");
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("TXT를 읽고 분석하는 중…");
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [pendingEncoding, setPendingEncoding] =
    useState<PendingEncodingChoice | null>(null);
  const [overlayTrigger, setOverlayTrigger] = useState<HTMLElement | null>(
    null,
  );
  const [androidBridgeAvailable, setAndroidBridgeAvailable] = useState(
    isAndroidVolumeNavigationAvailable,
  );
  const stealthWindowSnapshot = useRef<DesktopWindowSnapshot | null>(null);
  const stealthWindowTask = useRef<Promise<void>>(Promise.resolve());
  const hardwareNavigationEnabled =
    settings.volumeKeyNavigation &&
    route === "reader" &&
    openSurface === null &&
    !pendingEncoding &&
    !importing &&
    !privacyMode &&
    androidBridgeAvailable;
  const openReaderSurface = useCallback(
    (surface: AppSurface) => {
      if (
        surface &&
        document.activeElement instanceof HTMLElement &&
        !document.activeElement.closest(".adaptive-sheet")
      ) {
        setOverlayTrigger(document.activeElement);
      }
      setOpenSurface(surface);
    },
    [setOpenSurface],
  );
  const toggleReaderChrome = useCallback(() => {
    if (privacyMode) {
      setPrivacyMode(false);
    } else {
      setChromeVisible(!chromeVisible);
    }
    setOpenSurface(null);
  }, [
    chromeVisible,
    privacyMode,
    setChromeVisible,
    setOpenSurface,
    setPrivacyMode,
  ]);
  const revealReaderChrome = useCallback(() => {
    if (privacyMode) setPrivacyMode(false);
    setChromeVisible(true);
    setOpenSurface(null);
  }, [
    privacyMode,
    setChromeVisible,
    setOpenSurface,
    setPrivacyMode,
  ]);
  const hideReaderChrome = useCallback(() => {
    setChromeVisible(false);
    setOpenSurface(null);
  }, [setChromeVisible, setOpenSurface]);

  useEffect(() => {
    return subscribeAndroidBridgeAvailability(setAndroidBridgeAvailable);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const applyInsets = ({
      top,
      right,
      bottom,
      left,
    }: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    }) => {
      root.style.setProperty("--android-safe-area-top", `${top}px`);
      root.style.setProperty("--android-safe-area-right", `${right}px`);
      root.style.setProperty("--android-safe-area-bottom", `${bottom}px`);
      root.style.setProperty("--android-safe-area-left", `${left}px`);
      if (
        /Android/iu.test(navigator.userAgent) &&
        bottom > 0
      ) {
        root.dataset.androidInsetsReady = "true";
      }
    };
    return subscribeAndroidSafeArea(applyInsets);
  }, [androidBridgeAvailable]);

  useEffect(() => {
    const dark = settings.theme === "dark";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    let themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!themeMeta) {
      themeMeta = document.createElement("meta");
      themeMeta.name = "theme-color";
      document.head.append(themeMeta);
    }
    themeMeta.content = dark ? "#17191d" : "#fcfcfb";
    if (androidBridgeAvailable) setAndroidDarkSystemBars(dark);
  }, [androidBridgeAvailable, settings.theme]);

  useEffect(() => {
    let cancelled = false;
    void novelierPersistence
      .hydrate()
      .then(async ({ books: storedBooks, settings: storedSettings }) => {
        if (cancelled) return;
        const state = useNovelierStore.getState();
        const welcome = state.books.find(
          (book) => book.id === "novelier-welcome",
        );
        const library = [
          ...(welcome ? [welcome] : []),
          ...storedBooks.filter((book) => book.id !== "novelier-welcome"),
        ];
        replaceSettings(storedSettings);
        replaceBooks(library, state.currentBookId);

        const targetId = library.some(
          (book) => book.id === state.currentBookId,
        )
          ? state.currentBookId
          : library[0]?.id;
        const target = library.find((book) => book.id === targetId);
        if (target && !target.content) {
          const loaded = await novelierPersistence.loadAppBook(target.id);
          if (!cancelled && loaded) updateBook(loaded);
        }
        if (!cancelled) setPersistenceReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setToast(
          error instanceof Error
            ? `로컬 서재를 열지 못했습니다: ${error.message}`
            : "로컬 서재를 열지 못했습니다.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [replaceBooks, replaceSettings, updateBook]);

  useEffect(() => {
    if (!persistenceReady) return;
    const timeout = window.setTimeout(() => {
      void novelierPersistence.saveSettings(settings).catch(() => {
        setToast("읽기 설정을 저장하지 못했습니다.");
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [persistenceReady, settings]);

  useEffect(() => {
    if (
      !persistenceReady ||
      !currentBook ||
      currentBook.id === "novelier-welcome" ||
      !currentBook.content
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void novelierPersistence
        .saveReadingProgress(
          currentBook.id,
          currentBook.progress,
          settings.flow,
        )
        .catch(() => {
          setToast("현재 읽기 위치를 저장하지 못했습니다.");
        });
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [
    currentBook,
    persistenceReady,
    settings.flow,
  ]);

  useEffect(() => {
    if (!isTauri()) return;
    const html = document.documentElement;
    html.dataset.platform = /iPhone|iPad|iPod|Android/iu.test(
      navigator.userAgent,
    )
      ? "mobile"
      : /Mac/iu.test(navigator.userAgent)
        ? "macos"
        : /Windows/iu.test(navigator.userAgent)
          ? "windows"
          : "mobile";
    if (/Android/iu.test(navigator.userAgent)) {
      html.dataset.mobileOs = "android";
    } else if (/iPhone|iPad|iPod/iu.test(navigator.userAgent)) {
      html.dataset.mobileOs = "ios";
    }
    const appWindow = getCurrentWindow();
    let removeResizeListener: (() => void) | undefined;
    const syncMaximized = () => {
      void appWindow.isMaximized().then((maximized) => {
        html.classList.toggle("is-maximized", maximized);
      });
    };
    syncMaximized();
    void appWindow.onResized(syncMaximized).then((unlisten) => {
      removeResizeListener = unlisten;
    });
    return () => {
      removeResizeListener?.();
      delete html.dataset.platform;
      delete html.dataset.mobileOs;
      delete html.dataset.androidInsetsReady;
      html.classList.remove("is-maximized");
    };
  }, []);

  useEffect(() => {
    const synchronizeCapture = () => {
      setAndroidVolumeCaptureEnabled(
        hardwareNavigationEnabled &&
          document.visibilityState === "visible",
      );
    };
    synchronizeCapture();
    document.addEventListener("visibilitychange", synchronizeCapture);
    return () => {
      document.removeEventListener("visibilitychange", synchronizeCapture);
      setAndroidVolumeCaptureEnabled(false);
    };
  }, [hardwareNavigationEnabled]);

  useEffect(() => {
    if (!isTauri() || isNativeMobileRuntime()) return;
    const desiredStealthView = stealthView;
    const port = createDesktopStealthWindowPort();

    stealthWindowTask.current = stealthWindowTask.current
      .catch(() => undefined)
      .then(async () => {
        if (desiredStealthView) {
          const existingSnapshot =
            stealthWindowSnapshot.current ??
            readDesktopWindowSnapshot(window.sessionStorage);
          if (existingSnapshot) {
            stealthWindowSnapshot.current = existingSnapshot;
            return;
          }
          const snapshot = await enterDesktopStealthWindow(port);
          stealthWindowSnapshot.current = snapshot;
          writeDesktopWindowSnapshot(window.sessionStorage, snapshot);
          return;
        }

        const snapshot =
          stealthWindowSnapshot.current ??
          readDesktopWindowSnapshot(window.sessionStorage);
        if (!snapshot) return;
        await restoreDesktopWindow(port, snapshot);
        stealthWindowSnapshot.current = null;
        clearDesktopWindowSnapshot(window.sessionStorage);
      })
      .catch(() => {
        setToast(
          desiredStealthView
            ? "몰래보기 창 크기를 적용하지 못했습니다."
            : "기존 PC 창 크기를 복원하지 못했습니다.",
        );
        if (desiredStealthView) {
          stealthWindowSnapshot.current = null;
          clearDesktopWindowSnapshot(window.sessionStorage);
          setStealthView(false);
        }
      });
  }, [setStealthView, stealthView]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!isTauri()) return;
    void getCurrentWindow().setAlwaysOnTop(alwaysOnTopActive).catch(() => {
      setToast("이 환경에서는 항상 위 기능을 사용할 수 없습니다.");
    });
  }, [alwaysOnTopActive]);

  useEffect(() => {
    if (
      !isTauri() ||
      /iPhone|iPad|iPod|Android/iu.test(navigator.userAgent)
    ) {
      return;
    }

    const appWindow = getCurrentWindow();
    void Promise.all([
      appWindow.setDecorations(false),
      appWindow.setShadow(!transparencyActive),
    ]).catch(() => {
      setToast("네이티브 창 프레임 상태를 적용하지 못했습니다.");
    });
  }, [transparencyActive]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        openReaderSurface("search");
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        if (privacyMode) setPrivacyMode(false);
        setChromeVisible(!chromeVisibleActive);
        setOpenSurface(null);
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "m"
      ) {
        if (blocksDesktopPrivacyShortcut(stealthView)) return;
        event.preventDefault();
        setStealthView(!stealthView);
        setToast(
          stealthView
            ? "기본 PC 보기로 복원했습니다."
            : "모바일형 몰래보기를 시작했습니다.",
        );
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "s"
      ) {
        if (blocksDesktopPrivacyShortcut(stealthView)) return;
        event.preventDefault();
        if (privacyMode) setPrivacyMode(false);
        updateSettings({ simpleView: !simpleViewActive });
        setChromeVisible(true);
        setOpenSurface(null);
        setToast(
          simpleViewActive
            ? "기본 보기로 전환했습니다."
          : "PC 간단보기를 켰습니다.",
        );
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "t"
      ) {
        if (blocksDesktopPrivacyShortcut(stealthView)) return;
        event.preventDefault();
        if (privacyMode) setPrivacyMode(false);
        updateSettings({
          transparencyEnabled: !transparencyActive,
        });
        setToast(
          transparencyActive
            ? "투명 모드를 껐습니다."
            : "PC 투명 모드를 켰습니다.",
        );
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === "Digit0"
      ) {
        event.preventDefault();
        setPrivacyMode(false);
        setStealthView(false);
        updateSettings({
          surfaceOpacity: 100,
          transparencyEnabled: false,
          alwaysOnTop: false,
          simpleView: false,
        });
        setChromeVisible(true);
        setToast("화면 표시를 안전한 기본값으로 복원했습니다.");
      }
      if (event.key === "Escape") {
        if (privacyMode) setPrivacyMode(false);
        else if (openSurface) setOpenSurface(null);
        else if (stealthView) setStealthView(false);
        else setChromeVisible(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    openSurface,
    openReaderSurface,
    chromeVisible,
    chromeVisibleActive,
    privacyMode,
    setChromeVisible,
    setOpenSurface,
    setPrivacyMode,
    setStealthView,
    simpleViewActive,
    stealthView,
    transparencyActive,
    updateSettings,
  ]);

  useEffect(() => {
    const handlePopState = () => {
      if (openSurface) setOpenSurface(null);
      else if (route === "reader") setRoute("library");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [openSurface, route, setOpenSurface, setRoute]);

  useEffect(() => {
    if (!isTauri() || !/Android/iu.test(navigator.userAgent)) return;
    let removeListener: (() => void) | undefined;
    void onBackButtonPress(() => {
      const state = useNovelierStore.getState();
      if (state.openSurface) {
        state.setOpenSurface(null);
      } else if (state.route === "reader") {
        state.setRoute("library");
      } else {
        void invoke("plugin:app|exit");
      }
    })
      .then((listener) => {
        removeListener = () => {
          void listener.unregister();
        };
      })
      .catch(() => {
        // Browser history remains as the fallback on older Android shells.
      });
    return () => removeListener?.();
  }, []);

  const handleOpenBook = async (bookId: string) => {
    const existing = useNovelierStore
      .getState()
      .books.find((book) => book.id === bookId);
    if (!existing) return;
    if (existing.content || existing.id === "novelier-welcome") {
      openBook(bookId);
      return;
    }

    setImporting(true);
    try {
      const loaded = await novelierPersistence.loadAppBook(bookId);
      if (!loaded) {
        setToast("저장된 책을 찾을 수 없습니다.");
        return;
      }
      updateBook(loaded);
      openBook(bookId);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "책을 열지 못했습니다.");
    } finally {
      setImporting(false);
    }
  };

  const importTextSource = async (source: TextFileLike) => {
    setImportStatus("TXT를 읽고 분석하는 중…");
    setImporting(true);
    try {
      const imported = await novelierPersistence.importFile(source, {
        onProgress: (stage) => {
          setImportStatus(
            stage === "saving"
              ? "서재에 저장하는 중…"
              : "TXT를 읽고 분석하는 중…",
          );
        },
      });
      if (imported.status === "metadata-updated") {
        updateBook(imported.book);
        openBook(imported.book.id);
        setToast(`제목을 ${imported.book.title}(으)로 복구했습니다.`);
        return;
      }
      addBook(imported.book);
      if (imported.requiresEncodingConfirmation) {
        const bytes = new Uint8Array(await source.arrayBuffer());
        setPendingEncoding({
          filename: source.name,
          bytes,
          bookId: imported.book.id,
          detectedEncoding: imported.detectedEncoding,
        });
        setToast("문자 인코딩 확인이 필요합니다.");
      } else {
        setToast(`${imported.book.title}을(를) 서재에 추가했습니다.`);
      }
    } catch (error) {
      if (error instanceof DuplicateBookError) {
        await handleOpenBook(error.existingBookId);
        setToast("이미 서재에 있는 책을 열었습니다.");
      } else {
        setToast(
          error instanceof Error ? error.message : "TXT를 가져오지 못했습니다.",
        );
      }
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    if (!persistenceReady) {
      setToast("로컬 서재를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    try {
      const source = await pickTextFile();
      if (source) await importTextSource(source);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "파일을 열지 못했습니다.");
    }
  };

  const handleRepairTitle = async () => {
    if (importing || currentBook.id === "novelier-welcome") return;
    try {
      const source = await pickTextFile();
      if (!source) return;
      setImporting(true);
      const repaired = await novelierPersistence.repairBookTitle(
        currentBook.id,
        source,
      );
      updateBook(repaired);
      setOpenSurface(null);
      setToast(`제목을 ${repaired.title}(으)로 복구했습니다.`);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "제목을 복구하지 못했습니다.",
      );
    } finally {
      setImporting(false);
    }
  };

  const handleResetSettings = () => {
    const confirmed = window.confirm(
      "읽기 설정을 기본값으로 초기화할까요?\n책, 북마크와 읽던 위치는 유지됩니다.",
    );
    if (!confirmed) return;
    resetSettings();
    setToast("읽기 설정을 초기화했습니다.");
  };

  const handleDelete = async (bookId: string) => {
    const book = books.find((item) => item.id === bookId);
    if (!book) return;
    if (!window.confirm(`‘${book.title}’을(를) 서재에서 삭제할까요?`)) return;
    try {
      await novelierPersistence.deleteBook(bookId);
      removeBook(bookId);
      setToast("책과 읽기 기록을 삭제했습니다.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "책을 삭제하지 못했습니다.");
    }
  };

  const handleJump = (progress: number) => {
    setProgress(currentBook.id, clamp(progress));
  };

  const currentBookmark = currentBook.bookmarks.find(
    (bookmark) => Math.abs(bookmark.progress - currentBook.progress) < 0.008,
  );

  const handleBookmark = async () => {
    if (currentBook.id === "novelier-welcome") {
      toggleBookmark(
        currentBook.id,
        currentBook.progress,
        getExcerpt(currentBook.content, currentBook.progress),
      );
      setToast(
        currentBookmark ? "북마크를 제거했습니다." : "현재 위치를 저장했습니다.",
      );
      return;
    }

    try {
      if (currentBookmark) {
        await novelierPersistence.deleteBookmark(currentBookmark.id);
        updateBook({
          ...currentBook,
          bookmarks: currentBook.bookmarks.filter(
            (bookmark) => bookmark.id !== currentBookmark.id,
          ),
        });
        setToast("북마크를 제거했습니다.");
      } else {
        const bookmark = await novelierPersistence.saveBookmark({
          bookId: currentBook.id,
          progress: currentBook.progress,
          excerpt: getExcerpt(currentBook.content, currentBook.progress),
        });
        updateBook({
          ...currentBook,
          bookmarks: [bookmark, ...currentBook.bookmarks],
        });
        setToast("현재 위치를 저장했습니다.");
      }
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "북마크를 저장하지 못했습니다.",
      );
    }
  };

  const handleEncodingChoice = async (encoding: TextEncoding) => {
    if (!pendingEncoding) return;
    setImporting(true);
    try {
      const imported = await novelierPersistence.importBytes(
        pendingEncoding.filename,
        pendingEncoding.bytes,
        { encoding, replaceExisting: true },
      );
      updateBook(imported.book);
      setPendingEncoding(null);
      setToast(`${imported.book.encoding} 인코딩으로 다시 읽었습니다.`);
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "선택한 인코딩으로 다시 읽지 못했습니다.",
      );
    } finally {
      setImporting(false);
    }
  };

  const appStyle = {
    "--surface-opacity": transparencyActive
      ? `${surfaceOpacityActive / 100}`
      : "1",
    "--reader-brightness": `${settings.brightness / 100}`,
    "--reader-horizontal-padding": `${settings.horizontalPadding}px`,
  } as CSSProperties;
  const visibleCount = useMemo(
    () => countGraphemes(visibleText, settings.countWhitespace),
    [settings.countWhitespace, visibleText],
  );
  const handlePageInfo = useCallback(
    (
      current: number,
      total: number,
      pageStarts?: readonly number[],
    ) => {
      if (pageStarts) pageStartsRef.current = pageStarts;
      setPageInfo((previous) =>
        previous.current === current && previous.total === total
          ? previous
          : { current, total },
      );
    },
    [],
  );
  const handleReaderProgress = useCallback(
    (progress: number) => {
      if (currentBook) setProgress(currentBook.id, progress);
    },
    [currentBook, setProgress],
  );
  const handlePageJump = useCallback(
    (requestedPage: number) => {
      if (!currentBook || pageInfo.total <= 0) return;
      const pageIndex = Math.round(
        clamp(requestedPage, 1, pageInfo.total) - 1,
      );
      const exactProgress = pageStartsRef.current[pageIndex];
      setProgress(
        currentBook.id,
        exactProgress ??
          pageIndex / Math.max(1, pageInfo.total - 1),
      );
    },
    [currentBook, pageInfo.total, setProgress],
  );

  if (!currentBook) return null;

  return (
    <div
      className={`app-shell theme-${settings.theme} ${
        transparencyActive ? "is-transparent" : ""
      } ${simpleViewActive ? "is-simple-view" : ""} ${
        chromeVisibleActive ? "" : "is-focus-mode"
      } ${privacyMode ? "is-privacy-mode" : ""} ${
        stealthView ? "is-stealth-view" : ""
      }`}
      style={appStyle}
      data-theme={settings.theme}
      data-window-layout={stealthView ? "stealth-mobile" : "desktop"}
    >
      <DesktopTitleBar />
      <StealthQuickControls
        chromeVisible={chromeVisibleActive}
        onRevealChrome={revealReaderChrome}
      />
      {route === "library" ? (
        <MobileLibrary
          books={books}
          onOpen={(bookId) => void handleOpenBook(bookId)}
          onImport={() => void handleImport()}
          onDelete={(bookId) => void handleDelete(bookId)}
        />
      ) : (
        <div className="workspace">
          <PrimaryNavigation
            active={activeSection}
            onSelect={setActiveSection}
          />
          <ContextPanel
            book={currentBook}
            books={books}
            activeSection={activeSection}
            totalPages={pageInfo.total}
            currentPage={Math.max(1, pageInfo.current)}
            pagesCalculating={pageInfo.total === 0}
            onJump={handleJump}
            onPageJump={handlePageJump}
            onImport={() => void handleImport()}
            onOpenBook={(bookId) => void handleOpenBook(bookId)}
            onDeleteBook={(bookId) => void handleDelete(bookId)}
            onSelectSection={setActiveSection}
          />
          <section className="reader-workspace">
            <ReaderHeader
              book={currentBook}
              books={books}
              chromeVisible={chromeVisibleActive}
              isBookmarked={Boolean(currentBookmark)}
              onBack={() => setRoute("library")}
              onSelectBook={(bookId) => void handleOpenBook(bookId)}
              onBookmark={() => void handleBookmark()}
              onOpen={openReaderSurface}
            />
            <ReaderViewport
              book={currentBook}
              progress={currentBook.progress}
              onProgress={handleReaderProgress}
              onPageInfo={handlePageInfo}
              onVisibleText={setVisibleText}
              chromeVisible={chromeVisibleActive}
              onHideChrome={hideReaderChrome}
              compactMobileLayout={stealthView}
              hardwareNavigationEnabled={hardwareNavigationEnabled}
              stealthTapControls={stealthView}
            />
            <ReaderFooter
              book={currentBook}
              totalPages={pageInfo.total}
              currentPage={Math.max(1, pageInfo.current)}
              pagesCalculating={pageInfo.total === 0}
              visibleCount={visibleCount}
              chromeVisible={chromeVisibleActive}
              onJump={handleJump}
              onPageJump={handlePageJump}
              onOpen={openReaderSurface}
            />
            <MobileToolbar
              chromeVisible={chromeVisibleActive}
              active={openSurface}
              onOpen={openReaderSurface}
            />
            <ReaderChromeRevealZones
              chromeVisible={chromeVisibleActive}
              onReveal={revealReaderChrome}
            />
          </section>
        </div>
      )}
      <div className="brightness-scrim" aria-hidden="true" />
      <AdaptiveOverlay
        surface={openSurface}
        book={currentBook}
        visibleText={visibleText}
        totalPages={pageInfo.total}
        currentPage={Math.max(1, pageInfo.current)}
        pagesCalculating={pageInfo.total === 0}
        onClose={() => setOpenSurface(null)}
        onJump={handleJump}
        onPageJump={handlePageJump}
        onOpen={openReaderSurface}
        onToggleChrome={toggleReaderChrome}
        onResetSettings={handleResetSettings}
        onRepairTitle={() => void handleRepairTitle()}
        returnFocusTarget={overlayTrigger}
      />
      {pendingEncoding ? (
        <EncodingChoiceDialog
          pending={pendingEncoding}
          onKeep={() => {
            setPendingEncoding(null);
            setToast("자동 감지한 인코딩을 사용합니다.");
          }}
          onChoose={(encoding) => void handleEncodingChoice(encoding)}
        />
      ) : null}
      {importing ? (
        <div className="importing-indicator" role="status">
          <span />
          {importStatus}
        </div>
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </div>
  );
}
