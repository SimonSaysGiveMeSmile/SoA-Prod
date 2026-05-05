# Son of Anton

Electron 28 sci-fi terminal (eDEX-UI fork). Two-process app: main (`src/_boot.js`), renderer (`src/_renderer.js`). Widgets loaded via `<script>` tags in `src/ui.html`.

## Project Rules
- Never commit `.env`, `secrets.json`, or API keys
- Never modify `prebuild-src/` — generated artifact
- When moving files: grep all `require()` paths + `<script>` tags in `ui.html` and update them
- Preserve `<script>` load order in `ui.html`
- Before moving/renaming/creating/deleting files, read `docs/STRUCTURE.md` for current layout. After the change, update `docs/STRUCTURE.md` to reflect it.

## Mistake Tracking
@.claude/mistakes.md

Before starting any task, read the mistakes file above. After making an error (wrong path, broken require, failed build, incorrect assumption, etc.), append a concise entry to that file with:
- **What went wrong** (1 line)
- **Why** (1 line)
- **Rule to follow** (1 line)

## Release Workflow (macOS DMGs)

This repo (`son-of-anton-public`) hosts macOS builds. Releases go to `SimonSaysGiveMeSmile/son-of-anton-public`.

### Steps
1. Bump version in `package.json`
2. Commit source changes first (separate from build artifacts)
3. Clean old prebuild: `rm -rf prebuild-src`
4. Run `npm run prebuild-darwin` (rsync + minify + npm install)
5. Run `npm run build-darwin` (electron-builder, produces x64 + arm64 DMGs in `dist/`)
6. Commit DMG files (tracked via Git LFS) + `dist/latest-mac.yml`
7. Push to `origin main`
8. Create release: `gh release create vX.Y.Z-mac --repo SimonSaysGiveMeSmile/son-of-anton-public --title "..." --notes "..." dist/Son\ of\ Anton-macOS-arm64.dmg dist/Son\ of\ Anton-macOS-x64.dmg`
9. Update macOS download links in `README.md` to point to new release tag
10. Commit and push README update

### Important
- Tag format: `vX.Y.Z-mac` (e.g., `v2.2.9-mac`)
- DMGs are tracked with Git LFS (`.gitattributes` has `*.dmg` and `*.blockmap` rules)
- Always specify `--repo SimonSaysGiveMeSmile/son-of-anton-public` — without it, `gh` may target the wrong remote
- Verify download URLs with: `gh api repos/SimonSaysGiveMeSmile/son-of-anton-public/releases/tags/vX.Y.Z-mac --jq '.assets[] | .browser_download_url'`

## Remotes
- `origin` / `fork` = `SimonSaysGiveMeSmile/son-of-anton-public` (public fork, macOS releases here)
- `upstream` = `yifu001/son-of-anton-public` (upstream public)
- `target` = `yifu001/son-of-anton` (private repo, Windows releases there)
- `myfork` = `SimonSaysGiveMeSmile/son-of-anton` (private fork)
