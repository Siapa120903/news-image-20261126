// Thursday 26 November 2026, drawn from scratch in code.
// A Node program using only the standard library. It runs with no
// network, no clock, no randomness and no file reads, so two runs
// write identical bytes. The picture is one big scene, not a
// newspaper page: a Saudi oil refinery burning at night after a
// Houthi drone strike, with three small panels below it for the
// other stories of the day. Letters come from a 5 by 7 bitmap
// font written here as rows of '1' and '0', and the PNG bytes
// are assembled by hand at the end of this file.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const W = 1024;
const H = 1024;

// Colours are packed 0xRRGGBB integers.
const NIGHT_TOP = 0x0a1830;
const NIGHT_LOW = 0x14365e;
const GLOW = 0xe86a10;
const EMBER = 0xc23c08;
const FLAME = 0xf5820b;
const GOLD = 0xffc21a;
const CORE = 0xffe98a;
const SILHOUETTE = 0x0e1a2c;
const SILHOUETTE_LT = 0x1b2f4a;
const SMOKE = 0x4a4f58;
const SMOKE_LT = 0x6b7078;
const PAPER = 0xf4efe3;
const INK = 0x141414;
const SCARLET = 0xb22222;
const NAVY = 0x16385c;
const AMBER = 0xc68e20;
const LEAF = 0x2e7d48;
const WHITE = 0xffffff;
const MOON = 0xe8e4d2;

class Raster {
  readonly w: number;
  readonly h: number;
  private readonly px: Uint8Array;

  constructor(w: number, h: number, fill: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.fillRect(0, 0, w, h, fill);
  }

  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const at = (y * this.w + x) * 3;
    this.px[at] = (c >> 16) & 0xff;
    this.px[at + 1] = (c >> 8) & 0xff;
    this.px[at + 2] = c & 0xff;
  }

  fillRect(x: number, y: number, w: number, h: number, c: number): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) this.set(xx, yy, c);
    }
  }

  outline(x: number, y: number, w: number, h: number, c: number, t = 2): void {
    this.fillRect(x, y, w, t, c);
    this.fillRect(x, y + h - t, w, t, c);
    this.fillRect(x, y, t, h, c);
    this.fillRect(x + w - t, y, t, h, c);
  }

  // Bresenham line, drawn as small squares so thick lines stay solid.
  line(x0: number, y0: number, x1: number, y1: number, c: number, t = 2): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.fillRect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  disc(cx: number, cy: number, r: number, c: number): void {
    for (let y = cy - r; y <= cy + r; y += 1) {
      for (let x = cx - r; x <= cx + r; x += 1) {
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) this.set(x, y, c);
      }
    }
  }

  triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number): void {
    const minX = Math.min(x0, x1, x2);
    const maxX = Math.max(x0, x1, x2);
    const minY = Math.min(y0, y1, y2);
    const maxY = Math.max(y0, y1, y2);
    const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (d === 0) return;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
        const b = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
        const cc = 1 - a - b;
        if (a >= 0 && b >= 0 && cc >= 0) this.set(x, y, c);
      }
    }
  }

  // A vertical blend between two colours, painted over rows y0..y1.
  shade(y0: number, y1: number, top: number, bottom: number): void {
    for (let y = y0; y <= y1; y += 1) {
      const f = (y - y0) / Math.max(1, y1 - y0);
      const r = Math.round(((top >> 16) & 0xff) * (1 - f) + ((bottom >> 16) & 0xff) * f);
      const g = Math.round(((top >> 8) & 0xff) * (1 - f) + ((bottom >> 8) & 0xff) * f);
      const b = Math.round((top & 0xff) * (1 - f) + (bottom & 0xff) * f);
      this.fillRect(0, y, this.w, 1, (r << 16) | (g << 8) | b);
    }
  }

  row(y: number): Uint8Array {
    return this.px.subarray(y * this.w * 3, (y + 1) * this.w * 3);
  }
}

// A tiny deterministic hash, used only to place stars and smoke
// puffs so the picture never changes between runs.
function hash(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 13;
  x = (x * 1274126177) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

// The 5 by 7 font. Each glyph is seven strings of five characters;
// '1' paints, '0' stays clear. Only capitals are needed: every
// label is written in capitals.
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};

Object.assign(FONT, {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  $: ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '+': ['00000', '00100', '00100', '01110', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
});

const screen = new Raster(W, H, NIGHT_TOP);

function textWidth(text: string, size: number): number {
  return text.length * 6 * size - size;
}

function drawText(x: number, y: number, text: string, size: number, colour: number): void {
  let cursor = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT['?'] ?? FONT[' ']!;
    for (let row = 0; row < 7; row += 1) {
      const bits = glyph[row]!;
      for (let col = 0; col < 5; col += 1) {
        if (bits[col] === '1') screen.fillRect(cursor + col * size, y + row * size, size, size, colour);
      }
    }
    cursor += 6 * size;
  }
}

function drawCentred(y: number, text: string, size: number, colour: number): void {
  drawText(Math.floor((W - textWidth(text, size)) / 2), y, text, size, colour);
}

// --- PNG encoding, written by hand -------------------------------------
// The table for the CRC32 polynomial, built once at load time.
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value >>> 0, 0);
  return b;
}

function chunk(kind: string, data: Buffer): Buffer {
  const tagged = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
  return Buffer.concat([u32be(data.length), tagged, u32be(crc32(tagged))]);
}

function writePng(path: string): void {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y += 1) {
    raw[y * (1 + W * 3)] = 0; // filter type 0: no filtering
    raw.set(screen.row(y), y * (1 + W * 3) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(W, 0);
  header.writeUInt32BE(H, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 2; // true colour, no alpha
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}

// --- The picture ---------------------------------------------------------

function cxIn(x0: number, w: number, text: string, size: number): number {
  return x0 + Math.floor((w - textWidth(text, size)) / 2);
}

// One flame tongue: stacked discs that shrink and brighten as
// they rise, with a small deterministic wobble per layer.
function flame(cx: number, baseY: number, height: number, width: number): void {
  const steps = 26;
  const layers = [
    { frac: 1.0, colour: EMBER },
    { frac: 0.68, colour: FLAME },
    { frac: 0.42, colour: GOLD },
    { frac: 0.22, colour: CORE },
  ];
  for (const layer of layers) {
    for (let i = 0; i < steps; i += 1) {
      const f = i / steps;
      const y = baseY - f * height;
      const r = Math.max(2, (width / 2) * layer.frac * (1 - f * 0.92));
      const wobble = ((hash(i * 7 + cx) % 25) - 12) * (0.4 + f);
      screen.disc(Math.round(cx + wobble), Math.round(y), Math.round(r), layer.colour);
    }
  }
}

// Night sky over the hero scene, y 108..560.
screen.shade(108, 560, NIGHT_TOP, NIGHT_LOW);

// Stars, placed by the hash so they never move.
for (let i = 0; i < 70; i += 1) {
  const x = hash(i * 7) % W;
  const y = 112 + (hash(i * 13) % 170);
  const bright = hash(i * 29) % 3 === 0;
  screen.fillRect(x, y, bright ? 3 : 2, bright ? 3 : 2, bright ? WHITE : 0x9fb4cc);
}

// The moon, upper right.
screen.disc(880, 175, 40, MOON);
screen.disc(866, 164, 8, 0xc9c4ae);
screen.disc(892, 188, 6, 0xc9c4ae);
screen.disc(878, 152, 5, 0xc9c4ae);

// Heat glow behind the fire.
screen.disc(512, 500, 250, 0x8a3a08);
screen.disc(512, 500, 180, GLOW);
screen.disc(512, 500, 120, FLAME);

// The refinery in silhouette: storage tanks, distillation
// columns, pipes and a flare stack.
for (let j = 0; j < 2; j += 1) {
  const x = 70 + j * 110;
  screen.disc(x + 48, 430, 48, SILHOUETTE);
  screen.fillRect(x, 430, 96, 70, SILHOUETTE);
  screen.fillRect(x, 428, 96, 4, SILHOUETTE_LT);
}
screen.fillRect(300, 330, 34, 170, SILHOUETTE);
screen.triangle(300, 330, 334, 330, 317, 300, SILHOUETTE);
screen.fillRect(352, 360, 30, 140, SILHOUETTE_LT);
screen.triangle(352, 360, 382, 360, 367, 334, SILHOUETTE_LT);
screen.fillRect(690, 450, 96, 50, SILHOUETTE);
screen.disc(738, 450, 48, SILHOUETTE);
screen.fillRect(830, 250, 18, 250, SILHOUETTE);
screen.disc(839, 242, 12, GOLD);
screen.disc(839, 234, 7, CORE);
screen.line(70, 470, 830, 470, SILHOUETTE_LT, 4);
screen.line(180, 470, 180, 500, SILHOUETTE_LT, 4);

// A pumpjack in the left foreground.
screen.fillRect(150, 470, 60, 30, SILHOUETTE);
screen.line(150, 470, 214, 438, SILHOUETTE, 5);
screen.line(214, 438, 214, 470, SILHOUETTE, 4);

// The ground the refinery stands on.
screen.fillRect(0, 500, W, 60, 0x0a0f18);

// The fire itself: one big tongue in the middle, two smaller ones.
flame(512, 500, 190, 170);
flame(360, 500, 110, 90);
flame(660, 500, 130, 100);

// Smoke rising and drifting over the flames.
for (let i = 0; i < 12; i += 1) {
  const x = 512 + Math.round(((hash(i * 11) % 141) - 70) * (0.5 + i * 0.06));
  const y = 320 - i * 11 + (hash(i * 5) % 17);
  const r = 24 + (hash(i * 3) % 22);
  screen.disc(x, y, r, i % 2 === 0 ? SMOKE : SMOKE_LT);
}

// The drone that struck, small in the sky at upper left.
screen.fillRect(288, 211, 26, 8, SILHOUETTE);
screen.line(288, 215, 272, 205, SILHOUETTE, 3);
screen.line(314, 215, 330, 205, SILHOUETTE, 3);
screen.fillRect(262, 202, 18, 3, SILHOUETTE);
screen.fillRect(324, 202, 18, 3, SILHOUETTE);
screen.disc(301, 222, 3, SCARLET);

// Header band, naming the day.
screen.fillRect(0, 0, W, 104, 0x081222);
screen.fillRect(0, 104, W, 4, AMBER);
drawCentred(16, 'THURSDAY 26 NOVEMBER 2026', 5, WHITE);
drawCentred(62, 'THE WORLD IN ONE PICTURE', 2, GOLD);

// Caption band under the hero scene.
screen.fillRect(0, 560, W, 92, 0x081222);
drawCentred(572, 'REFINERY ABLAZE', 5, WHITE);
drawCentred(616, 'HOUTHI DRONES HIT RAS TANURA - BRENT OIL +3.5% TO $94.61', 2, GOLD);
screen.fillRect(0, 652, W, 6, AMBER);

// Three small panels for the other stories of the day.
const panels = [
  { x: 24, bar: NAVY },
  { x: 356, bar: SCARLET },
  { x: 688, bar: AMBER },
];
for (const p of panels) {
  screen.fillRect(p.x, 672, 312, 208, PAPER);
  screen.outline(p.x, 672, 312, 208, INK, 2);
  screen.fillRect(p.x, 672, 312, 12, p.bar);
}

// Panel 1: a container ship for the US tariffs.
screen.fillRect(96, 724, 30, 24, SCARLET);
screen.fillRect(130, 724, 30, 24, AMBER);
screen.fillRect(164, 724, 30, 24, LEAF);
screen.line(200, 724, 200, 700, INK, 3);
screen.triangle(200, 700, 224, 706, 200, 712, SCARLET);
screen.fillRect(80, 748, 160, 26, NAVY);
screen.triangle(240, 748, 240, 774, 268, 774, NAVY);
screen.line(70, 786, 270, 786, NAVY, 3);
drawText(cxIn(24, 312, 'US TARIFFS', 3), 800, 'US TARIFFS', 3, INK);
drawText(cxIn(24, 312, 'ON 14 PARTNERS', 2), 828, 'ON 14 PARTNERS', 2, INK);
drawText(cxIn(24, 312, 'CHINA EU JAPAN INDIA', 2), 852, 'CHINA EU JAPAN INDIA', 2, INK);

// Panel 2: a jet for the strike on the Russian airbase.
screen.fillRect(440, 734, 150, 10, SCARLET);
screen.triangle(590, 734, 590, 744, 616, 739, SCARLET);
screen.triangle(448, 734, 470, 734, 452, 712, SCARLET);
screen.triangle(500, 744, 540, 744, 520, 772, SCARLET);
screen.fillRect(560, 736, 18, 6, WHITE);
screen.triangle(440, 737, 440, 741, 414, 739, GOLD);
drawText(cxIn(356, 312, 'UKRAINE HITS', 3), 800, 'UKRAINE HITS', 3, INK);
drawText(cxIn(356, 312, 'RUSSIAN AIRBASE', 2), 828, 'RUSSIAN AIRBASE', 2, INK);
drawText(cxIn(356, 312, '5 JETS DAMAGED', 2), 852, '5 JETS DAMAGED', 2, INK);

// Panel 3: a missile for North Korea's nuclear call.
screen.triangle(832, 708, 856, 708, 844, 690, SCARLET);
screen.fillRect(832, 708, 24, 56, INK);
screen.triangle(832, 764, 812, 780, 832, 780, INK);
screen.triangle(856, 764, 876, 780, 856, 780, INK);
screen.triangle(836, 780, 852, 780, 844, 792, GOLD);
screen.fillRect(840, 720, 8, 12, WHITE);
drawText(cxIn(688, 312, 'KIM ORDERS MORE', 3), 800, 'KIM ORDERS MORE', 3, INK);
drawText(cxIn(688, 312, 'TACTICAL NUKES', 2), 828, 'TACTICAL NUKES', 2, INK);
drawText(cxIn(688, 312, 'DEPLOYED WIDER', 2), 852, 'DEPLOYED WIDER', 2, INK);

// Footer ticker with the rest of the day.
screen.fillRect(0, 896, W, 128, 0x081222);
screen.fillRect(0, 896, W, 4, AMBER);
drawCentred(916, 'ALSO: CAIRO TANKER FIRE KILLS 31 - AI SELL-OFF: NASDAQ NEARS BEAR MARKET', 2, 0xd8d2c2);
drawCentred(940, 'NETANYAHU BRIBERY CHARGE IN DOUBT - 2,000 MIGRANTS REACH CANARY ISLANDS', 2, 0xd8d2c2);
drawCentred(972, '26 NOVEMBER 2026', 2, AMBER);

const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
writePng(join(outputDir, 'entry.png'));
