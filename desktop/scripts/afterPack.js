const path = require("path");
const fs = require("fs");

exports.default = async function (context) {
  if (process.platform !== "darwin") return;

  const appDir = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  const unpacked = path.join(
    appDir,
    "Contents/Resources/app.asar.unpacked"
  );

  // Fix node-pty spawn-helper permissions
  const fixPaths = [
    "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
    "node_modules/node-pty/prebuilds/darwin-x64/spawn-helper",
    "main/voice/speech_helper",
    "main/voice/speech_transcribe",
    "main/voice/speech_helper.app/Contents/MacOS/speech_helper",
  ];

  for (const rel of fixPaths) {
    const full = path.join(unpacked, rel);
    if (fs.existsSync(full)) {
      fs.chmodSync(full, 0o755);
      console.log(`  • fixed permissions: ${rel}`);
    }
  }
};
