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

Releases are built by GitHub Actions (`.github/workflows/release-mac.yml`). The
runner signs with Developer ID, notarizes via Apple, and publishes the DMGs +
`latest-mac.yml` straight to the GitHub release. No local build required.

### Primary path (CI)

1. Bump `version` in `package.json`, `desktop/package.json`, `desktop/src/package.json`, `mobile/package.json` — all four must match
2. Commit and push to `main`
3. `git tag vX.Y.Z-mac && git push origin vX.Y.Z-mac` — triggers CI
4. CI takes ~15–30 min. Release appears at `/releases/tag/vX.Y.Z-mac` when done.

The workflow rejects the build if the tag doesn't match `package.json` version, so
version drift between tag and manifests is caught before signing.

### Backup path (local build)

Only when CI is down or you need to ship from your laptop:
1. Bump versions as above, commit
2. `cd desktop && rm -rf prebuild-src && npm run prebuild-darwin`
3. Export `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` in your shell
4. `npm run build-darwin && npm run postbuild-darwin`
5. Verify: `spctl -a -vvv -t exec "dist/mac/Son of Anton.app"` must say `source=Notarized Developer ID`
6. Commit DMGs + blockmaps + `dist/latest-mac.yml` (DMGs go through LFS automatically)
7. Push main, then `gh release create vX.Y.Z-mac` with the 5 files

### Important

- Tag format: `vX.Y.Z-mac` (e.g. `v2.2.17-mac`)
- DMGs are tracked through Git LFS (`.gitattributes` has `*.dmg` and `*.blockmap` rules)
- CI requires six GitHub Secrets: `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PWD`,
  `MACOS_KEYCHAIN_PWD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Signing identity: `Developer ID Application: Jiahe Tian (4QUC4B3L36)` — cert SHA
  `5024F791418B9BF875F599260131D7ADE4DE47CF`, set in `desktop/package.json → build.mac.identity`
- Auto-updater (`electron-updater`) is wired in `desktop/src/main/autoUpdate.js`; it
  reads `latest-mac.yml` from the release, so asset names in that file must match
  uploaded filenames exactly. `artifactName` in `desktop/package.json` enforces
  `Son-of-Anton-${os}-${arch}.${ext}` (hyphens — not spaces, not dots)
- Verify published release: `gh release view vX.Y.Z-mac --json assets`

## Remotes
- `origin` = `SimonSaysGiveMeSmile/SoA-Prod` (production monorepo, macOS releases here)
- `soa-desktop-src` + `soa-mobile-src` = local filesystem paths to historical desktop/mobile repos
