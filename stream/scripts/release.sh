#!/usr/bin/env bash
#
# Builds, signs, notarizes and publishes a release from this Mac.
#
#   pnpm release patch             Publish the next patch version
#   pnpm release minor|major|x.y.z Publish a specific bump or version
#   pnpm release patch --dry-run   Everything except commit, tag and publish
#   pnpm release --check           Only run the checks

set -euo pipefail

REPO="marcelmarais/stream"
SIGNING_IDENTITY="Developer ID Application: Marcel Marais (PD6ZLDT422)"
ENV_FILE="${STREAM_RELEASE_ENV:-$HOME/.config/stream/release.env}"

STREAM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$STREAM_DIR/src-tauri/tauri.conf.json"
HELPERS="$STREAM_DIR/scripts/release-helpers.mjs"
BUNDLE_DIR="$STREAM_DIR/src-tauri/target/release/bundle"
APP="$BUNDLE_DIR/macos/stream.app"

bump=""
dry_run=false
check_only=false
version_changed=false
work_dir="$(mktemp -d)"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() {
  printf '\033[31mError: %s\033[0m\n' "$1" >&2
  exit 1
}

cleanup() {
  rm -rf "$work_dir"
  if [ "$version_changed" = true ]; then
    git -C "$STREAM_DIR" checkout -- "$CONFIG"
  fi
}
trap cleanup EXIT

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --check) check_only=true ;;
    *) bump="$arg" ;;
  esac
done

if [ "$check_only" = false ] && [ -z "$bump" ]; then
  fail "Usage: pnpm release <patch|minor|major|x.y.z> [--dry-run], or --check"
fi

cd "$STREAM_DIR"

load_env() {
  [ -f "$ENV_FILE" ] || fail "Missing $ENV_FILE. Copy scripts/release.env.example there and fill it in."

  if [ "$(stat -f '%Lp' "$ENV_FILE")" != "600" ]; then
    fail "$ENV_FILE holds secrets. Run: chmod 600 \"$ENV_FILE\""
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  : "${UPDATER_KEY_PATH:?Set UPDATER_KEY_PATH in $ENV_FILE}"
  [ -f "$UPDATER_KEY_PATH" ] || fail "No updater key at $UPDATER_KEY_PATH"

  export TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY_PATH")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${UPDATER_KEY_PASSWORD:-}"
  export APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY"

  if [ -n "${APPLE_API_KEY:-}" ]; then
    : "${APPLE_API_ISSUER:?Set APPLE_API_ISSUER in $ENV_FILE}"
    : "${APPLE_API_KEY_PATH:?Set APPLE_API_KEY_PATH in $ENV_FILE}"
    [ -f "$APPLE_API_KEY_PATH" ] || fail "No Apple API key at $APPLE_API_KEY_PATH"
  elif [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
    fail "Set APPLE_API_KEY or APPLE_ID in $ENV_FILE, or notarization won't run"
  fi
}

check_repo() {
  [ "$(git branch --show-current)" = "main" ] || fail "Release from main"
  [ -z "$(git status --porcelain)" ] || fail "Commit or stash your changes first"

  git fetch --quiet origin main --tags
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "main isn't in sync with origin/main"
}

check_tools() {
  gh auth status >/dev/null 2>&1 || fail "Run: gh auth login"
  security find-identity -v -p codesigning | grep -qF "$SIGNING_IDENTITY" || fail "Signing certificate not found: $SIGNING_IDENTITY"
}

# Wrong keys only surface once installed apps reject the update, so fail here
check_updater_key() {
  local probe="$work_dir/probe.txt"
  echo "stream" >"$probe"

  TAURI_PRIVATE_KEY_PATH="$UPDATER_KEY_PATH" \
    TAURI_PRIVATE_KEY_PASSWORD="${UPDATER_KEY_PASSWORD:-}" \
    pnpm --silent tauri signer sign "$probe" >/dev/null 2>&1 || fail "Couldn't sign with the updater key. Check UPDATER_KEY_PASSWORD."

  node "$HELPERS" check-signature "$CONFIG" "$probe.sig" || exit 1
}

verify_build() {
  codesign --verify --deep --strict "$APP" || fail "Code signature is invalid"
  xcrun stapler validate "$APP" >/dev/null || fail "App isn't notarized"
  spctl --assess --type execute "$APP" || fail "Gatekeeper rejected the app"
  node "$HELPERS" check-signature "$CONFIG" "$BUNDLE_DIR/macos/stream.app.tar.gz.sig" || exit 1
}

write_notes() {
  local previous="$1" notes="$2"

  {
    echo "## Installation Instructions (macOS)"
    echo
    echo "**Platform**: Apple Silicon only. Intel Macs are not currently supported."
    echo
    echo "Download the \`.dmg\` below, open it and drag the app to Applications. The app checks for updates on startup."
    echo
    echo "## What's changed"
    echo
    git log --no-merges --format='- %s' "v$previous..HEAD" -- .
  } >"$notes"
}

step "Checking this Mac and repo"
load_env
check_repo
check_tools
check_updater_key
echo "All checks passed"

if [ "$check_only" = true ]; then
  exit 0
fi

current="$(node "$HELPERS" version "$CONFIG")"
version="$(node "$HELPERS" next-version "$CONFIG" "$bump")"
tag="v$version"

if git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null || gh release view "$tag" --repo "$REPO" >/dev/null 2>&1; then
  fail "$tag already exists"
fi

step "Building $tag (currently $current)"
version_changed=true
node "$HELPERS" set-version "$CONFIG" "$version"
pnpm install --frozen-lockfile
pnpm type-check
rm -rf "$BUNDLE_DIR"
pnpm tauri build --bundles app,dmg

step "Verifying the build"
verify_build

stage="$work_dir/stage"
mkdir -p "$stage"
dmg="$stage/stream_${version}_aarch64.dmg"
cp "$BUNDLE_DIR/dmg/stream_${version}_aarch64.dmg" "$dmg"
cp "$dmg" "$stage/stream-latest-macos-arm64.dmg"
cp "$BUNDLE_DIR/macos/stream.app.tar.gz" "$stage/stream_aarch64.app.tar.gz"
cp "$BUNDLE_DIR/macos/stream.app.tar.gz.sig" "$stage/stream_aarch64.app.tar.gz.sig"

notes="$work_dir/notes.md"
write_notes "$current" "$notes"
node "$HELPERS" manifest "$version" "$stage/stream_aarch64.app.tar.gz.sig" "$notes" "$stage/latest.json"

if [ "$dry_run" = true ]; then
  step "Dry run finished: $tag built and verified, nothing published"
  ls -lh "$stage"
  exit 0
fi

step "Publishing $tag"
git add "$CONFIG"
git commit --quiet -m "chore: release $tag"
version_changed=false
git tag "$tag"
git push --quiet origin main "$tag"

# Stays a draft until every asset is up, so the updater never sees a partial
# release
gh release create "$tag" --repo "$REPO" --verify-tag --draft --title "$tag" --notes-file "$notes" "$stage"/*
gh release edit "$tag" --repo "$REPO" --draft=false --latest

published="$(curl -fsSL "https://github.com/$REPO/releases/latest/download/latest.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')"
[ "$published" = "$version" ] || fail "Published, but latest.json reports $published"

step "Released $tag: https://github.com/$REPO/releases/tag/$tag"
