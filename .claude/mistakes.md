# Mistakes Log
<!-- Claude appends entries here when errors occur. Format: What / Why / Rule. -->

- **What**: `terminal.js` used relative `require("./terminalClient.js")` which broke after reorganization.
- **Why**: Files loaded via `<script>` tag in `ui.html` resolve `require()` relative to `ui.html` (src/), not the script file's actual directory. The codebase reorganization moved terminal.js to `src/renderer/terminal/` but the relative path now resolved from `src/`.
- **Rule**: When a file is loaded via `<script>` tag, all `require()` paths must use `path.join(__dirname, ...)` from the src/ root, or detect context. Never use bare relative paths like `./` or `../` in `<script>`-loaded files.

- **What**: Released v2.2.8 exe built with Electron 12.2.2 instead of 28.3.3 — app wouldn't launch
- **Why**: Did not verify `npm ls electron` matched `package.json` before building
- **Rule**: Before any build, run `npm ls electron electron-builder` and confirm versions match `package.json` specs

- **What**: `gh release create` without `--repo` flag targeted `yifu001/son-of-anton` (private) instead of `SimonSaysGiveMeSmile/son-of-anton-public` (public)
- **Why**: `gh` CLI resolves the default repo from git remotes and may pick the wrong one when multiple remotes exist
- **Rule**: Always use `--repo SimonSaysGiveMeSmile/son-of-anton-public` explicitly when creating releases for the public repo

- **What**: `gh release create` uploaded Git LFS pointer files (~130 bytes) instead of actual DMG binaries (~120MB) — downloads returned 404/"Not Found"
- **Why**: DMGs are tracked by Git LFS in `.gitattributes`. When `gh release create` reads files from inside the repo, Git's LFS smudge/clean filters can interfere with the upload
- **Rule**: Before uploading release assets, ALWAYS copy DMGs to `/tmp/` (outside the git repo) and upload from there to bypass LFS interference

- **What**: Edit to `addShellTab` in `_renderer.js` replaced the `if (nextTab === -1)` block but dropped the closing `}` and `return;`, leaving an unmatched brace that broke syntax
- **Why**: The edit's old_string matched only the first few lines of the block and the replacement omitted the closing brace
- **Rule**: When editing conditional blocks (if/for/while), always include the full block including the closing brace in both old_string and new_string
