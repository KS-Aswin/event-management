// Generates the seed's placeholder photos (db/fixtures/media/*.jpg).
//
// Every image is drawn here from gradients, shapes and text, so the files are
// our own and license-free. Each stays under 60 KB. db/seed.mjs calls
// ensureFixtures() and only draws files that are missing, so the committed
// files are reused; delete a file (or the folder) to redraw it.
//
// Run on its own with: node db/fixtures/make-media.mjs [--force]

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "media");
const MAX_BYTES = 60 * 1024;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Simple motif per theme, drawn behind the label.
const MOTIFS = {
  venue: (w, h, c) =>
    `<rect x="${w * 0.2}" y="${h * 0.42}" width="${w * 0.6}" height="${h * 0.4}" fill="${c}" opacity=".35"/>` +
    `<polygon points="${w * 0.15},${h * 0.44} ${w * 0.5},${h * 0.2} ${w * 0.85},${h * 0.44}" fill="${c}" opacity=".45"/>` +
    [0, 1, 2, 3, 4].map((i) => `<rect x="${w * (0.26 + i * 0.105)}" y="${h * 0.5}" width="${w * 0.04}" height="${h * 0.32}" fill="#fff" opacity=".25"/>`).join(""),
  camera: (w, h, c) =>
    `<rect x="${w * 0.3}" y="${h * 0.3}" width="${w * 0.4}" height="${h * 0.36}" rx="${h * 0.05}" fill="${c}" opacity=".4"/>` +
    `<circle cx="${w * 0.5}" cy="${h * 0.48}" r="${h * 0.12}" fill="none" stroke="#fff" stroke-width="${h * 0.025}" opacity=".6"/>` +
    `<circle cx="${w * 0.5}" cy="${h * 0.48}" r="${h * 0.05}" fill="#fff" opacity=".35"/>`,
  food: (w, h, c) =>
    `<ellipse cx="${w * 0.5}" cy="${h * 0.55}" rx="${w * 0.34}" ry="${h * 0.2}" fill="#3f7d3a" opacity=".55"/>` +
    [0, 1, 2, 3, 4, 5].map((i) => `<circle cx="${w * (0.28 + i * 0.09)}" cy="${h * (0.5 + (i % 2) * 0.08)}" r="${h * 0.05}" fill="${c}" opacity=".7"/>`).join(""),
  drum: (w, h, c) =>
    [0, 1, 2].map((i) =>
      `<rect x="${w * (0.22 + i * 0.2)}" y="${h * 0.3}" width="${w * 0.14}" height="${h * 0.42}" rx="${w * 0.07}" fill="${c}" opacity=".45"/>` +
      `<ellipse cx="${w * (0.29 + i * 0.2)}" cy="${h * 0.3}" rx="${w * 0.07}" ry="${h * 0.04}" fill="#fff" opacity=".45"/>`
    ).join(""),
  tent: (w, h, c) =>
    `<polygon points="${w * 0.12},${h * 0.8} ${w * 0.5},${h * 0.22} ${w * 0.88},${h * 0.8}" fill="${c}" opacity=".4"/>` +
    `<polygon points="${w * 0.42},${h * 0.8} ${w * 0.5},${h * 0.5} ${w * 0.58},${h * 0.8}" fill="#fff" opacity=".3"/>`,
  sparkle: (w, h, c) =>
    [[0.25, 0.35, 0.06], [0.7, 0.3, 0.09], [0.55, 0.62, 0.05], [0.32, 0.68, 0.04], [0.8, 0.66, 0.05]]
      .map(([x, y, r]) => `<circle cx="${w * x}" cy="${h * y}" r="${h * r}" fill="${c}" opacity=".5"/>`)
      .join(""),
  flower: (w, h, c) =>
    [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2;
      return `<ellipse cx="${w * 0.5 + Math.cos(a) * h * 0.13}" cy="${h * 0.48 + Math.sin(a) * h * 0.13}" rx="${h * 0.1}" ry="${h * 0.06}" transform="rotate(${(a * 180) / Math.PI} ${w * 0.5 + Math.cos(a) * h * 0.13} ${h * 0.48 + Math.sin(a) * h * 0.13})" fill="${c}" opacity=".55"/>`;
    }).join("") + `<circle cx="${w * 0.5}" cy="${h * 0.48}" r="${h * 0.06}" fill="#ffd166" opacity=".8"/>`,
};

function svgFor({ w, h, from, to, accent, motif, title, subtitle, logo }) {
  const draw = MOTIFS[motif] ?? MOTIFS.sparkle;
  if (logo) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.36}" fill="none" stroke="#fff" stroke-width="${w * 0.02}" opacity=".7"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${w * 0.26}" font-weight="700" fill="#fff">${esc(title)}</text>
    </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
      <radialGradient id="v" cx=".5" cy=".4" r=".8"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    ${draw(w, h, accent)}
    <rect width="${w}" height="${h}" fill="url(#v)"/>
    <text x="${w * 0.06}" y="${h * 0.86}" font-family="Georgia, 'Times New Roman', serif" font-size="${h * 0.075}" font-weight="700" fill="#fff">${esc(title)}</text>
    ${subtitle ? `<text x="${w * 0.06}" y="${h * 0.93}" font-family="Arial, Helvetica, sans-serif" font-size="${h * 0.038}" fill="#fff" opacity=".85">${esc(subtitle)}</text>` : ""}
    <text x="${w * 0.94}" y="${h * 0.93}" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="${h * 0.03}" fill="#fff" opacity=".6">Sample image</text>
  </svg>`;
}

async function render(sharp, spec) {
  const svg = Buffer.from(svgFor(spec));
  for (const quality of [74, 64, 54, 44]) {
    const buf = await sharp(svg).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (buf.byteLength <= MAX_BYTES) return buf;
  }
  throw new Error(`Fixture ${spec.file} is over ${MAX_BYTES} bytes even at low quality.`);
}

/** Sizes per purpose (meet MIN_DIMENSIONS in lib/media/config.ts). */
export const SIZES = { logo: [512, 512], cover: [1280, 720], gallery: [1080, 720] };

/**
 * Makes sure every file in `specs` exists. A spec is
 * {file, purpose, from, to, accent, motif, title, subtitle}.
 * Returns the absolute paths in the same order.
 */
export async function ensureFixtures(specs, { force = false } = {}) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  let sharp = null;
  const out = [];
  for (const spec of specs) {
    const file = path.join(FIXTURE_DIR, spec.file);
    if (force || !existsSync(file)) {
      sharp ??= (await import("sharp")).default;
      const [w, h] = SIZES[spec.purpose] ?? SIZES.gallery;
      writeFileSync(file, await render(sharp, { ...spec, w, h, logo: spec.purpose === "logo" }));
    }
    if (statSync(file).size > MAX_BYTES) throw new Error(`${spec.file} is over 60 KB.`);
    out.push(file);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { fixtureSpecs } = await import("../seed-data.mjs");
  const files = await ensureFixtures(fixtureSpecs(), { force: process.argv.includes("--force") });
  console.log(`✓ ${files.length} fixture images in ${FIXTURE_DIR}`);
}
