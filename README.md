# FrameDL

A Mac app that downloads video and audio from web pages, with a browser extension that sends the current page to the app in one click.

FrameDL is a window on top of [yt-dlp](https://github.com/yt-dlp/yt-dlp). It includes yt-dlp, ffmpeg and deno, so there is nothing else to install.

## Features

- Download a video (MP4) or audio only (MP3) from a page address or a playlist.
- Queue with three downloads at a time. Items that are not complete start again at the next launch.
- Downloads continue when the window is closed. A notification shows the result.
- Option to prefer H.264 video, which plays immediately in QuickTime.
- The app checks for a new yt-dlp each day. Click the yellow version badge to install it, or use the Settings tab.
- The queue shows video titles.
- Browser extension for Brave and Chrome.

## Requirements

- A Mac with Apple Silicon.
- macOS 11 or later.

## Install the app

1. Open the `FrameDL-<version>-arm64.dmg` installer.
2. Move FrameDL to the Applications folder.
3. Open FrameDL.

The installer is signed with a Developer ID and notarized by Apple.

## Install the browser extension

The extension is not in the Chrome Web Store. Load it from a folder:

1. Unzip `FrameDL-extension.zip` to a permanent location. The browser reads this folder at each start.
2. Open `brave://extensions` or `chrome://extensions`.
3. Set **Developer mode** to on.
4. Click **Load unpacked** and select the `extension` folder.
5. Pin the FrameDL icon to the toolbar.

## Use the extension

- **Click the icon:** download the video on the current page.
- **Right-click the icon > Download audio only (MP3):** download the audio.

The first click shows a browser prompt to open FrameDL. Later clicks have no prompt while FrameDL is running.

On a "video in a playlist" address, the extension downloads only that video. On a playlist page, it downloads the full playlist.

## How the extension talks to the app

- **App is running:** the extension sends the page address to a local server in the app (`127.0.0.1`, ports 47631 to 47635).
- **App is not running, or the first click:** the extension opens a `framedl://` link, and macOS starts the app.

The server accepts requests only from browser extensions, and only with a token that the app got from a `framedl://` link. Each macOS user account thus sends its downloads to its own copy of FrameDL.

## Build from source

```
npm install
bash scripts/fetch-binaries.sh   # downloads yt-dlp, ffmpeg, ffprobe and deno to bin/
npm start                        # run in development
```

To make a signed and notarized installer:

```
npm run release                  # installer and extension zip in dist/
npm run release -- --install     # also replace /Applications/FrameDL.app
```

The release script needs a "Developer ID Application" certificate in the login keychain and a `notarytool` keychain profile. Change `IDENTITY` and `PROFILE` at the top of `scripts/release.sh` to your values.

## Limits

- yt-dlp does not support all sites, and it cannot download video that has DRM.
- Sites change frequently. If downloads fail, update yt-dlp first.
- Security software that protects the Downloads folder can block yt-dlp. Allow FrameDL in that software.

## Legal

Download only content that you have the right to download. You are responsible for how you use this software.

## License

MIT. See [LICENSE](LICENSE).

yt-dlp, ffmpeg and deno are separate projects with their own licenses.
