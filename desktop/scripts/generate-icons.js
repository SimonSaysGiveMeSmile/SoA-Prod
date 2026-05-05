const fs = require('fs');
const path = require('path');
const png2icons = require('png2icons');
const Jimp = require('jimp');

const MEDIA = path.join(__dirname, '..', 'media');
const SOURCE = path.join(MEDIA, 'logo.png');

async function generateIcons() {
    console.log('Reading source image...');
    const inputBuffer = fs.readFileSync(SOURCE);

    // Generate ICO (with BMP mode for Windows executables)
    // BMP mode embeds smaller sizes as BMP for better Windows compatibility
    console.log('Generating icon.ico...');
    const icoBuffer = png2icons.createICO(inputBuffer, png2icons.BILINEAR, 0, true);
    fs.writeFileSync(path.join(MEDIA, 'icon.ico'), icoBuffer);
    console.log('Created icon.ico (' + icoBuffer.length + ' bytes)');

    // Generate ICNS for macOS
    console.log('Generating icon.icns...');
    const icnsBuffer = png2icons.createICNS(inputBuffer, png2icons.BILINEAR, 0);
    fs.writeFileSync(path.join(MEDIA, 'icon.icns'), icnsBuffer);
    console.log('Created icon.icns (' + icnsBuffer.length + ' bytes)');

    // Generate Linux icon sizes using Jimp
    // Required sizes: 16, 24, 32, 48, 64, 96, 128, 256, 512
    const LINUX_DIR = path.join(MEDIA, 'linuxIcons');
    const sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512];

    console.log('Generating Linux icons...');
    const sourceImage = await Jimp.read(SOURCE);

    for (const size of sizes) {
        const resized = sourceImage.clone().resize(size, size, Jimp.RESIZE_BILINEAR);
        const outPath = path.join(LINUX_DIR, size + 'x' + size + '.png');
        await resized.writeAsync(outPath);
        console.log('Created ' + size + 'x' + size + '.png');
    }

    console.log('\nIcon generation complete!');
    console.log('Files updated:');
    console.log('  - media/icon.ico');
    console.log('  - media/icon.icns');
    console.log('  - media/linuxIcons/*.png');
}

generateIcons().catch(err => {
    console.error('Error generating icons:', err);
    process.exit(1);
});
