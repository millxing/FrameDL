#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../bin"

mkdir -p "$BIN_DIR"

echo "=== Fetching binaries for YT-DLP Manager ==="
echo ""

# 1. Download yt-dlp universal macOS binary
# The folder build (program + _internal folder) starts much faster than the
# one-file build, which unpacks itself at each start.
echo "Downloading yt-dlp (macOS universal, folder build)..."
curl -L -o "$BIN_DIR/yt-dlp.zip" \
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos.zip"
rm -rf "$BIN_DIR/yt-dlp" "$BIN_DIR/yt-dlp_macos"
ditto -x -k "$BIN_DIR/yt-dlp.zip" "$BIN_DIR/yt-dlp"
rm "$BIN_DIR/yt-dlp.zip"

# The zip has copies in place of the symbolic links of a macOS framework.
# codesign rejects that layout ("bundle format is ambiguous"), so make the
# links again. This also removes three copies of the Python library.
FW="$BIN_DIR/yt-dlp/_internal/Python.framework"
if [ -d "$FW/Versions/Current" ] && [ ! -L "$FW/Versions/Current" ]; then
  PYVER="$(ls "$FW/Versions" | grep -v '^Current$' | head -1)"
  rm -rf "$FW/Versions/Current" "$FW/Python" "$FW/Resources" "$BIN_DIR/yt-dlp/_internal/Python"
  ln -s "$PYVER" "$FW/Versions/Current"
  ln -s "Versions/Current/Python" "$FW/Python"
  ln -s "Versions/Current/Resources" "$FW/Resources"
  ln -s "Python.framework/Python" "$BIN_DIR/yt-dlp/_internal/Python"
fi
"$BIN_DIR/yt-dlp/yt-dlp_macos" --version > "$BIN_DIR/yt-dlp/version.txt"
echo "  yt-dlp version: $(cat "$BIN_DIR/yt-dlp/version.txt")"

# 2. Download ffmpeg and ffprobe arm64 static builds
# Using martin-riedl.de which provides signed/notarized arm64 macOS builds
echo ""
echo "Downloading ffmpeg (macOS arm64 static build)..."
curl -L -o "$BIN_DIR/ffmpeg.zip" \
  "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip"
unzip -o "$BIN_DIR/ffmpeg.zip" -d "$BIN_DIR"
rm "$BIN_DIR/ffmpeg.zip"
chmod +x "$BIN_DIR/ffmpeg"

echo "Downloading ffprobe (macOS arm64 static build)..."
curl -L -o "$BIN_DIR/ffprobe.zip" \
  "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffprobe.zip"
unzip -o "$BIN_DIR/ffprobe.zip" -d "$BIN_DIR"
rm "$BIN_DIR/ffprobe.zip"
chmod +x "$BIN_DIR/ffprobe"

# 3. Download deno (required by yt-dlp for YouTube JS challenge solving)
echo ""
echo "Downloading deno (macOS arm64)..."
curl -L -o "$BIN_DIR/deno.zip" \
  "https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip"
unzip -o "$BIN_DIR/deno.zip" -d "$BIN_DIR"
rm "$BIN_DIR/deno.zip"
chmod +x "$BIN_DIR/deno"

echo ""
echo "=== Done! Binaries in $BIN_DIR ==="
ls -lh "$BIN_DIR"
