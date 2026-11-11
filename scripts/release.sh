#!/usr/bin/env bash
# Build, sign, notarize and package FrameDL.
#
#   bash scripts/release.sh             Make the installer and the extension zip in dist/
#   bash scripts/release.sh --install   Also replace /Applications/FrameDL.app
#   bash scripts/release.sh --install-only   Install the app that the last run built
#                                            (use it when the install step stopped)
#
# One-time setup on a new Mac:
#   1. A "Developer ID Application" certificate in the login keychain
#      (plus Apple's "Developer ID Certification Authority G2" intermediate).
#   2. xcrun notarytool store-credentials "framedl-notary" --apple-id <id> --team-id <team>
set -euo pipefail

IDENTITY="Developer ID Application: Rob Schoen (6Y8QUTA3Z3)"
PROFILE="framedl-notary"

cd "$(dirname "$0")/.."
set -o pipefail
MODE="${1:-}"
VERSION="$(node -p "require('./package.json').version")"
APP="dist/mac-arm64/FrameDL.app"
DMG="dist/FrameDL-${VERSION}-arm64.dmg"
EXT_ZIP="dist/FrameDL-extension.zip"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

step() { printf '\n=== %s\n' "$1"; }

# Send a file to Apple and wait for the result. Stop if Apple does not accept it.
notarize() {
  local file="$1" out id
  out="$(xcrun notarytool submit "$file" --keychain-profile "$PROFILE" --wait 2>&1)" || true
  id="$(printf '%s\n' "$out" | awk '$1 == "id:" { print $2; exit }')"
  if ! printf '%s\n' "$out" | grep -q "status: Accepted"; then
    printf '%s\n' "$out" | tail -n 8
    echo "Notarization failed for $file. Apple's log:"
    [ -n "$id" ] && xcrun notarytool log "$id" --keychain-profile "$PROFILE" || true
    exit 1
  fi
  echo "Accepted: $file (submission $id)"
}

if [ "$MODE" != "--install-only" ]; then

step "Check the signing certificate"
security find-identity -v -p codesigning | grep -q "$IDENTITY" || {
  echo "Certificate not found or not valid: $IDENTITY"; exit 1; }

step "Build and sign the app (version $VERSION)"
rm -rf dist/mac-arm64
# The "dir" target makes only the app. electron-builder signs it with the
# settings in package.json. It does not notarize, because this script does that.
npx electron-builder --mac dir
codesign --verify --deep --strict "$APP"

step "Notarize the app (Apple's scan can take from minutes to more than an hour)"
ditto -c -k --keepParent "$APP" "$WORK/FrameDL.zip"
notarize "$WORK/FrameDL.zip"
xcrun stapler staple "$APP"

step "Build and sign the installer"
mkdir "$WORK/stage"
ditto "$APP" "$WORK/stage/FrameDL.app"
ln -s /Applications "$WORK/stage/Applications"
rm -f "$DMG"
hdiutil create -volname "FrameDL" -srcfolder "$WORK/stage" -ov -format UDZO "$DMG" >/dev/null
codesign --sign "$IDENTITY" --timestamp "$DMG"

step "Notarize the installer"
notarize "$DMG"
xcrun stapler staple "$DMG"

step "Gatekeeper checks"
spctl --assess --type execute --verbose=2 "$APP"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"

step "Zip the browser extension"
rm -f "$EXT_ZIP"
zip -r -q -X "$EXT_ZIP" extension -x "*.DS_Store"

else
  [ -d "$APP" ] || { echo "No built app in $APP. Run the script without --install-only first."; exit 1; }
  spctl --assess --type execute --verbose=2 "$APP"
fi

if [ "$MODE" = "--install" ] || [ "$MODE" = "--install-only" ]; then
  step "Install in /Applications"
  RUNNING="/Applications/FrameDL.app/Contents/MacOS/FrameDL"
  osascript -e 'quit app "FrameDL"' || true
  for _ in $(seq 1 20); do
    pgrep -u "$(id -u)" -f "$RUNNING" >/dev/null || break
    perl -e 'select(undef, undef, undef, 0.5)'
  done
  if pgrep -u "$(id -u)" -f "$RUNNING" >/dev/null; then
    echo "FrameDL did not quit. The app is not installed."
    echo "The built app is in $APP."; exit 1
  fi
  # A different account can also have FrameDL open. This script cannot quit it,
  # and to replace the app below a running copy can make that copy fail.
  OTHERS="$(ps -axo user=,command= | awk -v p="$RUNNING" '$2 == p { print $1 }' | sort -u | tr '\n' ' ')"
  if [ -n "$OTHERS" ]; then
    echo "FrameDL is open in a different account: $OTHERS"
    echo "Quit FrameDL in that account, then run this script again with --install-only."
    echo "The built app is in $APP."; exit 1
  fi
  rm -rf /Applications/FrameDL.app
  ditto "$APP" /Applications/FrameDL.app
  open -g -a /Applications/FrameDL.app
  echo "Installed and started."
fi

# The app in dist/ is a 480 MB copy of what is in the installer.
rm -rf dist/mac-arm64

step "Done"
ls -lh "$DMG" "$EXT_ZIP"
