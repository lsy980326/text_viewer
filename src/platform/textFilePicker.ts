import { open } from "@tauri-apps/plugin-dialog";
import { readFile, stat } from "@tauri-apps/plugin-fs";
import {
  type TextFileLike,
  validateTextFileSize,
} from "../core";
import { resolveAndroidDisplayName } from "./mobileVolumeNavigation";

const FILE_METADATA_TIMEOUT_MS = 1_500;
const FILE_READ_TIMEOUT_MS = 90_000;

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripFilenameControls(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? "" : character;
  }).join("");
}

/**
 * Dialogs return paths on desktop/iOS and content URIs on Android. Keep that
 * difference out of the reader and recover the original-looking basename
 * wherever the provider encodes it in the URI.
 */
export function filenameFromSelection(
  selection: string,
  providerDisplayName?: string | null,
): string {
  let candidate: string;
  if (providerDisplayName?.trim()) {
    candidate = providerDisplayName;
  } else try {
    const url = new URL(selection);
    candidate =
      url.searchParams.get("displayName") ??
      url.searchParams.get("filename") ??
      url.searchParams.get("name") ??
      url.pathname;
  } catch {
    candidate = selection;
  }

  const normalized = stripFilenameControls(
    decodePathPart(candidate).normalize("NFC"),
  )
    .replace(/\\/gu, "/")
    .replace(/[?#].*$/u, "");
  let basename = normalized.split("/").filter(Boolean).at(-1) ?? "";

  // Android document-provider IDs often prefix the visible tail with a
  // storage namespace such as `primary:` or `msf:`.
  if (!/\.txt$/iu.test(basename) && basename.includes(":")) {
    basename = basename.split(":").at(-1) ?? basename;
  }
  basename = basename.trim();
  if (!basename) basename = "가져온 소설";
  return /\.txt$/iu.test(basename) ? basename : `${basename}.txt`;
}

function browserTextFile(): Promise<TextFileLike | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,text/plain";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        try {
          if (file) validateTextFileSize(file.size);
          resolve(file);
        } catch (error) {
          reject(error);
        }
      },
      { once: true },
    );
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

function timeoutResult<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), milliseconds);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function readNativeTextFile(path: string): Promise<ArrayBuffer> {
  const bytes = await timeoutResult(readFile(path), FILE_READ_TIMEOUT_MS);
  if (!bytes) {
    throw new Error(
      "파일 제공자가 응답하지 않습니다. 클라우드 파일이라면 기기에 다운로드한 뒤 다시 선택해 주세요.",
    );
  }
  validateTextFileSize(bytes.byteLength);
  const start = bytes.byteOffset;
  const end = start + bytes.byteLength;
  return start === 0 && end === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.buffer.slice(start, end);
}

async function nativeTextFile(): Promise<TextFileLike | null> {
  const usesMobileMimeFilters =
    typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod/iu.test(navigator.userAgent);
  const selected = await open({
    multiple: false,
    directory: false,
    title: "TXT 소설 가져오기",
    pickerMode: "document",
    fileAccessMode: "copy",
    // Android document providers primarily match MIME types, while desktop
    // dialogs match extensions.
    filters: [{
      name: "텍스트 문서",
      extensions: usesMobileMimeFilters ? ["text/plain"] : ["txt"],
    }],
  });
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return null;

  // Some Android/cloud document providers can stream a URI but do not expose
  // metadata through `stat`. Treat size lookup as an early optimization, not
  // as a requirement, and always enforce the limit after reading.
  const information = await timeoutResult(stat(path), FILE_METADATA_TIMEOUT_MS);
  const reportedSize = Number(information?.size);
  const knownSize =
    Number.isFinite(reportedSize) && reportedSize >= 0 ? reportedSize : 0;
  if (knownSize > 0) validateTextFileSize(knownSize);

  let cachedBuffer: Promise<ArrayBuffer> | undefined;
  return {
    name: filenameFromSelection(path, resolveAndroidDisplayName(path)),
    size: knownSize,
    arrayBuffer: () => {
      cachedBuffer ??= readNativeTextFile(path);
      return cachedBuffer;
    },
  };
}

export function pickTextFile(): Promise<TextFileLike | null> {
  return isTauriRuntime() ? nativeTextFile() : browserTextFile();
}
