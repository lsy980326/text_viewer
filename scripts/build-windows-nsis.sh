#!/bin/sh

set -eu

usage() {
  printf '%s\n' \
    'Usage: scripts/build-windows-nsis.sh [--debug]' \
    '' \
    'Cross-build the Windows x64 MSVC application and NSIS installer.' \
    'Release mode is the default; --debug builds the development package.'
}

build_mode=release
case "${1:-}" in
  "")
    ;;
  --debug)
    build_mode=debug
    shift
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [ "$#" -ne 0 ]; then
  usage >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
windows_target=x86_64-pc-windows-msvc

case "$(uname -s)" in
  Darwin)
    if command -v brew >/dev/null 2>&1; then
      novelier_llvm_bin=${NOVELIER_LLVM_BIN:-}
      novelier_lld_bin=${NOVELIER_LLD_BIN:-}
      if [ -z "$novelier_llvm_bin" ]; then
        if novelier_llvm_prefix=$(brew --prefix llvm 2>/dev/null); then
          novelier_llvm_bin="$novelier_llvm_prefix/bin"
        fi
      fi
      if [ -z "$novelier_lld_bin" ]; then
        if novelier_lld_prefix=$(brew --prefix lld 2>/dev/null); then
          novelier_lld_bin="$novelier_lld_prefix/bin"
        fi
      fi
      if [ -n "$novelier_llvm_bin" ]; then
        PATH="$novelier_llvm_bin:$PATH"
      fi
      if [ -n "$novelier_lld_bin" ]; then
        PATH="$novelier_lld_bin:$PATH"
      fi
      export PATH
    fi
    ;;
  Linux)
    ;;
  *)
    printf '%s\n' \
      'This script is for macOS or Linux cross-build hosts.' \
      'On Windows, run: pnpm tauri build --ci' >&2
    exit 1
    ;;
esac

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_command pnpm
require_command rustup
require_command cargo-xwin
require_command makensis
require_command llvm-rc
require_command lld-link

if ! rustup target list --installed | grep -qx "$windows_target"; then
  printf 'Missing Rust target: %s\n' "$windows_target" >&2
  printf 'Install it with: rustup target add %s\n' "$windows_target" >&2
  exit 1
fi

novelier_xwin_cache_dir=${NOVELIER_XWIN_CACHE_DIR:-"$project_dir/.cache/xwin"}
mkdir -p "$novelier_xwin_cache_dir"

printf 'Building NOVELIER Windows NSIS (%s, %s)\n' \
  "$build_mode" "$windows_target"
printf 'xwin cache: %s\n' "$novelier_xwin_cache_dir"

cd "$project_dir"
if [ "$build_mode" = debug ]; then
  XWIN_CACHE_DIR="$novelier_xwin_cache_dir" \
    pnpm tauri build \
      --debug \
      --runner cargo-xwin \
      --target "$windows_target" \
      --ci
else
  XWIN_CACHE_DIR="$novelier_xwin_cache_dir" \
    pnpm tauri build \
      --runner cargo-xwin \
      --target "$windows_target" \
      --ci
fi

artifact_dir="$project_dir/src-tauri/target/$windows_target/$build_mode/bundle/nsis"
set -- "$artifact_dir"/NOVELIER_*_x64-setup.exe
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  printf 'Expected exactly one NSIS artifact in %s\n' "$artifact_dir" >&2
  exit 1
fi

artifact=$1
printf 'Artifact: %s\n' "$artifact"
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$artifact"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$artifact"
else
  printf '%s\n' 'Warning: no SHA-256 command was found.' >&2
fi

if command -v file >/dev/null 2>&1; then
  file "$artifact"
fi

if command -v 7zz >/dev/null 2>&1; then
  7zz t "$artifact"
fi
