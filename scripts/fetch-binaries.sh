#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../bin"

mkdir -p "$BIN_DIR"

echo "=== Fetching binaries for YT-DLP Manager ==="
echo ""

# 1. Download yt-dlp universal macOS binary
echo "Downloading yt-dlp (macOS universal)..."
curl -L -o "$BIN_DIR/yt-dlp_macos" \
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
chmod +x "$BIN_DIR/yt-dlp_macos"
echo "  yt-dlp version: $("$BIN_DIR/yt-dlp_macos" --version)"

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
