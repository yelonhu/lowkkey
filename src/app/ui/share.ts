import { cnDate } from './Medal.tsx';

/**
 * 分享成图. A medal or a letter drawn onto paper the size of a phone screen (1080 wide), in the
 * theme's own colours and fonts, then handed to the system share sheet, or saved as a file where
 * there is none. Everything is drawn with Canvas 2D so the page's loaded fonts are used as they are.
 */
type Tokens = Record<
  | 'bg'
  | 'surf'
  | 'ink'
  | 'ink2'
  | 'muted'
  | 'faint'
  | 'line'
  | 'line2'
  | 'g0'
  | 'g1'
  | 'g2'
  | 'acc'
  | 'accInk'
  | 'wash',
  string
> & { font: string; sans: string; display: string };
const W = 1080;

function tokens(): Tokens {
  const css = getComputedStyle(document.documentElement),
    t = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: t('--bg'),
    surf: t('--surf'),
    ink: t('--ink'),
    ink2: t('--ink2'),
    muted: t('--muted'),
    faint: t('--faint') || t('--muted'),
    line: t('--line'),
    line2: t('--line2'),
    g0: t('--g0'),
    g1: t('--g1'),
    g2: t('--g2'),
    acc: t('--acc'),
    accInk: t('--acc-ink'),
    wash: t('--wash') || t('--surf'),
    font: t('--font'),
    sans: t('--sans'),
    display: t('--display'),
  };
}
async function fonts(tok: Tokens) {
  await Promise.all(
    [`500 60px ${tok.display}`, `600 52px ${tok.font}`, `400 32px ${tok.font}`, `400 26px ${tok.sans}`].map(f =>
      document.fonts.load(f).catch(() => []),
    ),
  );
}
/** Greedy character wrapping for Chinese prose; closing punctuation hangs onto the line it ends. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      if ('、。，：；！？」』）】〉》…·'.includes(ch)) {
        lines.push(test);
        line = '';
        continue;
      }
      lines.push(line);
      line = ch;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function paragraphs(
  ctx: CanvasRenderingContext2D,
  texts: string[],
  x: number,
  y: number,
  width: number,
  lineHeight: number,
  gap: number,
  draw: boolean,
) {
  for (const text of texts) {
    for (const line of wrap(ctx, text, width)) {
      if (draw) ctx.fillText(line, x, y);
      y += lineHeight;
    }
    y += gap;
  }
  return y - gap;
}
function spacing(ctx: CanvasRenderingContext2D, value: string) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = value;
}
function brand(ctx: CanvasRenderingContext2D, tok: Tokens, y: number) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  spacing(ctx, '0.02em');
  ctx.font = `500 34px ${tok.display}`;
  ctx.fillStyle = tok.ink;
  ctx.fillText('lowkkey', 120, y);
  const width = ctx.measureText('lowkkey').width;
  ctx.beginPath();
  ctx.arc(120 + width + 12, y - 4, 4, 0, Math.PI * 2);
  ctx.fillStyle = tok.acc;
  ctx.fill();
  spacing(ctx, '0');
}
/** The medal as Medal.tsx draws it: rim, disc, sixty ticks, one motif, in the theme's metal. */
function drawMedal(
  ctx: CanvasRenderingContext2D,
  tok: Tokens,
  x: number,
  y: number,
  R: number,
  m: { motif: string; unit?: string; locked: boolean },
) {
  const u = R / 57;
  const metal = ctx.createLinearGradient(x - R, y - R, x + R, y + R);
  metal.addColorStop(0, tok.g0);
  metal.addColorStop(0.5, tok.g1);
  metal.addColorStop(0.78, tok.g0);
  metal.addColorStop(1, tok.g1);
  const circle = (r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  };
  const edge = (r: number, alpha: number) => {
    circle(r);
    ctx.strokeStyle = tok.ink;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 0.5 * u;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  circle(R);
  if (m.locked) {
    ctx.strokeStyle = tok.line;
    ctx.lineWidth = u;
    ctx.stroke();
  } else {
    ctx.fillStyle = metal;
    ctx.fill();
    edge(R, 0.32);
  }
  const disc = ctx.createRadialGradient(x - 12 * u, y - 18 * u, 0, x - 12 * u, y - 18 * u, 90 * u);
  disc.addColorStop(0, tok.surf);
  disc.addColorStop(1, tok.line2);
  circle(50 * u);
  if (!m.locked) {
    ctx.fillStyle = disc;
    ctx.fill();
  }
  edge(50 * u, m.locked ? 0.12 : 0.32);
  ctx.strokeStyle = tok.ink;
  ctx.globalAlpha = m.locked ? 0.12 : 0.3;
  ctx.lineWidth = 0.5 * u;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2,
      r0 = (i % 15 === 0 ? 41 : 43.5) * u;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(a) * 46 * u, y + Math.sin(a) * 46 * u);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const numeral = /^[\d.]+$/.test(m.motif),
    size = (numeral ? (m.motif.length <= 2 ? 42 : m.motif.length === 3 ? 36 : 28) : 40) * u;
  ctx.font = numeral ? `500 ${size}px ${tok.display}` : `600 ${size}px ${tok.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = m.locked ? tok.faint : metal;
  const baseline = y + size * (numeral ? 0.34 : 0.36);
  if (!m.locked) {
    ctx.strokeStyle = tok.ink;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 0.3 * u;
    ctx.strokeText(m.motif, x, baseline);
    ctx.globalAlpha = 1;
  }
  ctx.fillText(m.motif, x, baseline);
  if (m.unit) {
    ctx.font = `400 ${8 * u}px ${tok.sans}`;
    ctx.fillStyle = tok.muted;
    spacing(ctx, '0.08em');
    ctx.fillText(m.unit, x, y + 26 * u);
    spacing(ctx, '0');
  }
}
function paper(height: number, tok: Tokens) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = tok.bg;
  ctx.fillRect(0, 0, W, height);
  return { canvas, ctx };
}
const blobOf = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('image'))), 'image/png'),
  );

export async function medalImage(m: {
  name: string;
  motif: string;
  unit?: string;
  date?: string | null;
  occasion?: string;
  story: string[];
}) {
  const tok = tokens();
  await fonts(tok);
  const measure = paper(10, tok).ctx;
  measure.font = `400 30px ${tok.font}`;
  const storyEnd = paragraphs(measure, m.story, 160, 900, 760, 58, 22, false);
  const height = Math.max(1350, storyEnd + 180);
  const { canvas, ctx } = paper(height, tok);
  drawMedal(ctx, tok, W / 2, 400, 200, { motif: m.motif, unit: m.unit, locked: !m.date });
  ctx.textAlign = 'center';
  ctx.font = `600 52px ${tok.font}`;
  ctx.fillStyle = m.date ? tok.ink : tok.faint;
  spacing(ctx, '0.06em');
  ctx.fillText(m.name, W / 2, 690);
  if (m.date) {
    ctx.font = `400 26px ${tok.sans}`;
    ctx.fillStyle = tok.muted;
    spacing(ctx, '0.08em');
    ctx.fillText(cnDate(m.date), W / 2, 740);
  }
  spacing(ctx, '0');
  let y = 820;
  if (m.occasion) {
    ctx.font = `400 32px ${tok.font}`;
    ctx.fillStyle = tok.ink2;
    for (const line of wrap(ctx, m.occasion, 820)) {
      ctx.fillText(line, W / 2, y);
      y += 52;
    }
    y += 26;
  }
  ctx.textAlign = 'left';
  ctx.font = `400 30px ${tok.font}`;
  ctx.fillStyle = tok.ink2;
  paragraphs(ctx, m.story, 160, Math.max(y, 900), 760, 58, 22, true);
  brand(ctx, tok, height - 100);
  return blobOf(canvas);
}

export async function letterImage(letter: {
  meta: string;
  title?: string | null;
  paragraphs: string[];
  sign?: string | null;
}) {
  const tok = tokens();
  await fonts(tok);
  const measure = paper(10, tok).ctx;
  measure.font = `600 54px ${tok.font}`;
  const titleLines = letter.title ? wrap(measure, letter.title, 840) : [];
  const bodyTop = 200 + titleLines.length * 74 + 40;
  measure.font = `400 32px ${tok.font}`;
  const bodyEnd = paragraphs(measure, letter.paragraphs, 180, bodyTop + 72, 740, 64, 30, false);
  const height = Math.max(1350, bodyEnd + 260);
  const { canvas, ctx } = paper(height, tok);
  ctx.textAlign = 'left';
  ctx.font = `400 24px ${tok.sans}`;
  ctx.fillStyle = tok.muted;
  spacing(ctx, '0.08em');
  ctx.fillText(letter.meta, 120, 150);
  spacing(ctx, '0.02em');
  ctx.font = `600 54px ${tok.font}`;
  ctx.fillStyle = tok.ink;
  titleLines.forEach((line, i) => ctx.fillText(line, 120, 220 + i * 74));
  spacing(ctx, '0');
  // The letter's body sits on the same soft wash as on the page, with the ink dot at its head.
  ctx.fillStyle = tok.wash;
  ctx.beginPath();
  ctx.roundRect(120, bodyTop, 840, bodyEnd - bodyTop + 60, 28);
  ctx.fill();
  const dot = ctx.createLinearGradient(150, bodyTop + 50, 162, bodyTop + 62);
  dot.addColorStop(0, tok.g0);
  dot.addColorStop(1, tok.g2);
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(156, bodyTop + 60, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `400 32px ${tok.font}`;
  ctx.fillStyle = tok.ink2;
  paragraphs(ctx, letter.paragraphs, 180, bodyTop + 72, 740, 64, 30, true);
  if (letter.sign) {
    ctx.textAlign = 'right';
    ctx.font = `400 26px ${tok.sans}`;
    ctx.fillStyle = tok.accInk;
    ctx.fillText('— ' + letter.sign, 960, bodyEnd + 120);
  }
  brand(ctx, tok, height - 100);
  return blobOf(canvas);
}

/** The system share sheet where there is one (a phone), a saved file where there is not. */
export async function shareImage(blob: Blob, name: string, title: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if ((error as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}
