// Notarize the macOS build if Apple credentials are present in the env.
// Skips cleanly on Linux/Windows, when signing is disabled, or when any of
// APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID are missing.
//
//   export APPLE_ID=you@example.com
//   export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
//   export APPLE_TEAM_ID=ABCDE12345
//   npm run build:mac
//
// Set SKIP_NOTARIZATION=1 to force-skip (e.g. CI without secrets).

const path = require("path");

exports.default = async function notarizeApp(context) {
    if (process.platform !== "darwin") return;
    if (context.electronPlatformName !== "darwin") return;
    if (process.env.SKIP_NOTARIZATION === "1") {
        console.log("[notarize] SKIP_NOTARIZATION=1 — skipping");
        return;
    }

    const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
    if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
        console.log(
            "[notarize] APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set — skipping notarization " +
            "(DMG will be signed-but-not-notarized; Gatekeeper will warn users on first launch)"
        );
        return;
    }

    const { notarize } = require("@electron/notarize");
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);
    const appBundleId =
        context.packager.appInfo.info._configuration.appId || "com.edex.ui";

    console.log(`[notarize] submitting ${appPath} to Apple notary service…`);
    await notarize({
        tool: "notarytool",
        appPath,
        appBundleId,
        appleId: APPLE_ID,
        appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
        teamId: APPLE_TEAM_ID,
    });
    console.log("[notarize] done");
};
