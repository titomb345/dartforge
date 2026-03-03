/**
 * Capture the visible terminal viewport as a styled PNG with macOS-style
 * window chrome and copy it to the clipboard.
 *
 * xterm.js renders colored text on <canvas> elements. DOM cloning loses
 * canvas pixel data, so we draw directly from xterm's canvases onto our
 * own compositing canvas.
 */
export async function captureTerminalScreenshot(
  terminalElement: HTMLElement,
  terminalBackground: string,
): Promise<void> {
  const screen = terminalElement.querySelector('.xterm-screen') as HTMLElement | null;
  if (!screen) throw new Error('Could not find .xterm-screen element');

  // xterm.js renders text on one or more canvas layers
  const canvases = screen.querySelectorAll('canvas');
  if (canvases.length === 0) throw new Error('Could not find xterm canvas elements');

  const screenRect = screen.getBoundingClientRect();
  const termWidth = Math.round(screenRect.width);
  const termHeight = Math.round(screenRect.height);

  // Layout constants
  const SCALE = 2;
  const PAD = 40;
  const TITLE_H = 36;
  const CONTENT_PAD_X = 4;
  const CONTENT_PAD_Y = 8;
  const BORDER_RADIUS = 10;

  const innerW = termWidth + CONTENT_PAD_X * 2;
  const innerH = TITLE_H + termHeight + CONTENT_PAD_Y * 2;
  const totalW = innerW + PAD * 2;
  const totalH = innerH + PAD * 2;

  const canvas = document.createElement('canvas');
  canvas.width = totalW * SCALE;
  canvas.height = totalH * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);

  // --- Outer gradient background ---
  const grad = ctx.createLinearGradient(0, 0, totalW, totalH);
  grad.addColorStop(0, '#1a1a2e');
  grad.addColorStop(0.5, '#16213e');
  grad.addColorStop(1, '#0f3460');
  roundRect(ctx, 0, 0, totalW, totalH, 12);
  ctx.fillStyle = grad;
  ctx.fill();

  // --- Window chrome shadow ---
  const chromeX = PAD;
  const chromeY = PAD;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 20;
  roundRect(ctx, chromeX, chromeY, innerW, innerH, BORDER_RADIUS);
  ctx.fillStyle = terminalBackground;
  ctx.fill();
  ctx.restore();

  // Subtle border
  roundRect(ctx, chromeX, chromeY, innerW, innerH, BORDER_RADIUS);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // --- Title bar ---
  ctx.save();
  roundRectTop(ctx, chromeX, chromeY, innerW, TITLE_H, BORDER_RADIUS);
  ctx.fillStyle = terminalBackground;
  ctx.fill();
  ctx.restore();

  // Title bar bottom border
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(chromeX, chromeY + TITLE_H - 1, innerW, 1);

  // macOS dots
  const dotColors = ['#ff5f57', '#febc2e', '#28c840'];
  const dotY = chromeY + TITLE_H / 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(chromeX + 14 + i * 20, dotY, 6, 0, Math.PI * 2);
    ctx.fillStyle = dotColors[i];
    ctx.fill();
  }

  // Title text
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '12px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DartForge', chromeX + innerW / 2, dotY);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';

  // --- Terminal content (drawn from xterm's canvases) ---
  const contentX = chromeX + CONTENT_PAD_X;
  const contentY = chromeY + TITLE_H + CONTENT_PAD_Y;

  // Clip to the chrome rounded rect so canvas doesn't overflow corners
  ctx.save();
  roundRect(ctx, chromeX, chromeY, innerW, innerH, BORDER_RADIUS);
  ctx.clip();

  // Draw each xterm canvas layer (text, selections, decorations, etc.)
  for (const c of canvases) {
    if (c.width > 0 && c.height > 0) {
      ctx.drawImage(c, contentX, contentY, termWidth, termHeight);
    }
  }
  ctx.restore();

  // --- Convert to blob and copy to clipboard ---
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to generate screenshot blob'));
    }, 'image/png');
  });

  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundRectTop(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
