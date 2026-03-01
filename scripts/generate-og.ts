import sharp from 'sharp';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const publicDir = join(projectRoot, 'public');
const iconPath = join(projectRoot, 'src-tauri', 'icons', 'icon.png');

const WIDTH = 1200;
const HEIGHT = 630;

// Background SVG with dark gradient and accent lines
const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <radialGradient id="bg" cx="30%" cy="50%" r="80%">
      <stop offset="0%" stop-color="#141418"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </radialGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#33ccff"/>
      <stop offset="50%" stop-color="#ff8833"/>
      <stop offset="100%" stop-color="#33ccff"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <!-- Top accent line -->
  <rect x="0" y="0" width="${WIDTH}" height="3" fill="url(#accent)" opacity="0.8"/>
  <!-- Bottom accent line -->
  <rect x="0" y="${HEIGHT - 3}" width="${WIDTH}" height="3" fill="url(#accent)" opacity="0.8"/>
</svg>`;

// Text overlay SVG (composited separately so logo sits between bg and text)
const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <!-- Title -->
  <text x="480" y="260" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700" fill="#f0f0f5" letter-spacing="2">DartForge</text>
  <!-- Subtitle -->
  <text x="480" y="320" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="400" fill="#33ccff" letter-spacing="1">A MUD client for DartMUD</text>
  <!-- URL -->
  <text x="480" y="400" font-family="monospace" font-size="20" fill="#666680" letter-spacing="0.5">dartforge.billbergquist.dev</text>
</svg>`;

// Generate the OG image
const background = sharp(Buffer.from(backgroundSvg), { density: 150 }).resize(
  WIDTH,
  HEIGHT,
);

// Resize the logo to fit nicely (about 300px tall, centered vertically)
const logoSize = 320;
const logoLeft = 80;
const logoTop = Math.round((HEIGHT - logoSize) / 2);

const logo = await sharp(iconPath)
  .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();

const textOverlay = await sharp(Buffer.from(textSvg), { density: 150 })
  .resize(WIDTH, HEIGHT)
  .toBuffer();

await background
  .composite([
    { input: logo, left: logoLeft, top: logoTop },
    { input: textOverlay, left: 0, top: 0 },
  ])
  .png()
  .toFile(join(publicDir, 'og-image.png'));

console.log('Generated public/og-image.png (1200x630)');
