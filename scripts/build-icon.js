// Convert logo to PNG at multiple sizes with a subtle border for dark-background visibility
const sharp = require('sharp');
const path = require('path');

const srcDark = path.join(__dirname, '..', 'potacat-logo.jpg');
const srcLight = path.join(__dirname, '..', 'potacat-logo_light.jpg');
const outDir = path.join(__dirname, '..', 'assets');

/**
 * Create an SVG rounded-rect border ring overlay.
 * The ring is drawn just inside the edges so it doesn't get clipped.
 */
function borderRing(size, strokeWidth, radius, color) {
  const half = strokeWidth / 2;
  return Buffer.from(`<svg width="${size}" height="${size}">
    <rect x="${half}" y="${half}" width="${size - strokeWidth}" height="${size - strokeWidth}"
          rx="${radius}" ry="${radius}"
          fill="none" stroke="${color}" stroke-width="${strokeWidth}"/>
  </svg>`);
}

async function buildVariant(src, suffix, borderColor) {
  // 512x512 PNG — used by electron-builder and as the app icon
  const img512 = await sharp(src).resize(512, 512).png().toBuffer();
  await sharp(img512)
    .composite([{ input: borderRing(512, 4, 12, borderColor), top: 0, left: 0 }])
    .png()
    .toFile(path.join(outDir, `icon${suffix}.png`));
  console.log(`Created assets/icon${suffix}.png (512x512)`);

  // 256x256 PNG — Windows taskbar / BrowserWindow icon
  const img256 = await sharp(src).resize(256, 256).png().toBuffer();
  await sharp(img256)
    .composite([{ input: borderRing(256, 3, 8, borderColor), top: 0, left: 0 }])
    .png()
    .toFile(path.join(outDir, `icon${suffix}-256.png`));
  console.log(`Created assets/icon${suffix}-256.png (256x256)`);
}

async function main() {
  // Dark icon (default) — light border for visibility on dark panels
  await buildVariant(srcDark, '', 'rgba(255,255,255,0.25)');

  // Light icon — dark border for visibility on light panels
  await buildVariant(srcLight, '-light', 'rgba(0,0,0,0.15)');
}

main().catch((err) => { console.error(err); process.exit(1); });
