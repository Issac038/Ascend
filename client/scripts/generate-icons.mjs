// One-off generator: Ascend PWA icons as PNGs, no external dependencies.
// Renders the existing brand mark (rounded square + ascending chevron with
// crossbar) with 4x supersampling for clean anti-aliased edges.
// Run: node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public");

// ---------- tiny PNG encoder ----------
function crc32(buf) {
    let table = crc32.table;
    if (!table) {
        table = crc32.table = new Int32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        raw[y * (stride + 1)] = 0; // filter: none
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    return Buffer.concat([
        sig,
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

// ---------- SDF rendering of the Ascend mark ----------
const SS = 4; // supersampling factor
function sdRoundedRect(px, py, cx, cy, halfW, halfH, r) {
    const qx = Math.abs(px - cx) - (halfW - r);
    const qy = Math.abs(py - cy) - (halfH - r);
    const ax = Math.max(qx, 0);
    const ay = Math.max(qy, 0);
    return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
// distance to segment ab
function sdSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
    return Math.hypot(apx - abx * t, apy - aby * t);
}

// Render at `size` px. padUnits = outer padding in viewBox-32 units.
// markScale enlarges the glyph around the canvas center for small-size legibility.
function renderIcon(size, { padUnits, rounded, markScale = 1 }) {
    const total = size * SS;
    const img = Buffer.alloc(total * total * 4);
    const u = total / 32; // device pixels per viewBox unit
    const cx = 16 * u, cy = 16 * u;

    const half = (16 - padUnits) * u;
    const r = rounded ? 7 * u : 0;
    const stroke = 2.6 * markScale * u;
    const stroke2 = 2.0 * markScale * u;

    // chevron: apex (16, 9.5), feet (9.5, 21.5)/(22.5, 21.5); crossbar y=17.5
    // scaled around the visual center of the mark (16, 15.75)
    const s = (vx, vy) => [
        (16 + (vx - 16) * markScale) * u,
        (15.75 + (vy - 15.75) * markScale) * u
    ];
    const apex = s(16, 9.5);
    const l = s(9.5, 21.5);
    const rt = s(22.5, 21.5);
    const barA = s(12.0, 17.5);
    const barB = s(20.0, 17.5);

    for (let y = 0; y < total; y += 1) {
        for (let x = 0; x < total; x += 1) {
            const px = x + 0.5; // supersampled device-pixel space
            const py = y + 0.5;

            const dPlate = sdRoundedRect(px, py, cx, cy, half, half, r);
            const dRing = Math.abs(dPlate) - 0.6 * u; // thin border ring

            const dChev = Math.min(
                sdSegment(px, py, apex[0], apex[1], l[0], l[1]),
                sdSegment(px, py, apex[0], apex[1], rt[0], rt[1])
            ) - stroke / 2;
            const dBar = sdSegment(px, py, barA[0], barA[1], barB[0], barB[1]) - stroke2 / 2;
            const dMark = Math.min(dChev, dBar);

            // coverage via smoothstep on 1 supersampled-pixel edges
            const cov = (d) => Math.max(0, Math.min(1, 0.5 - d / 2));

            const bg = [0x08, 0x08, 0x08];
            const ring = [0x3a, 0x3a, 0x3a];
            const white = [0xff, 0xff, 0xff];

            let rC = bg[0], gC = bg[1], bC = bg[2], alpha = 255;

            const ringCov = (dRing < 0 ? 1 : cov(dRing)) * (dPlate < 0 ? 1 : 0);
            const markCov = cov(dMark);
            // composite: bg <- ring <- mark
            rC = Math.round(bg[0] + (ring[0] - bg[0]) * ringCov);
            gC = Math.round(bg[1] + (ring[1] - bg[1]) * ringCov);
            bC = Math.round(bg[2] + (ring[2] - bg[2]) * ringCov);
            rC = Math.round(rC + (white[0] - rC) * markCov);
            gC = Math.round(gC + (white[1] - gC) * markCov);
            bC = Math.round(bC + (white[2] - bC) * markCov);

            const idx = (y * total + x) * 4;
            img[idx] = rC; img[idx + 1] = gC; img[idx + 2] = bC; img[idx + 3] = alpha;
        }
    }

    // box-downsample SSx -> size
    const out = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            let rS = 0, gS = 0, bS = 0;
            for (let sy = 0; sy < SS; sy += 1) {
                for (let sx = 0; sx < SS; sx += 1) {
                    const idx = ((y * SS + sy) * total + (x * SS + sx)) * 4;
                    rS += img[idx]; gS += img[idx + 1]; bS += img[idx + 2];
                }
            }
            const n = SS * SS;
            const o = (y * size + x) * 4;
            out[o] = Math.round(rS / n);
            out[o + 1] = Math.round(gS / n);
            out[o + 2] = Math.round(bS / n);
            out[o + 3] = 255;
        }
    }
    return out;
}

mkdirSync(join(OUT, "icons"), { recursive: true });

const variants = [
    { file: "icons/pwa-icon-192.png", size: 192, padUnits: 2, rounded: true, markScale: 1.4 },
    { file: "icons/pwa-icon-512.png", size: 512, padUnits: 2, rounded: true, markScale: 1.4 },
    { file: "icons/pwa-maskable-512.png", size: 512, padUnits: 5.5, rounded: false, markScale: 1.25 },
    { file: "apple-touch-icon.png", size: 180, padUnits: 2, rounded: true, markScale: 1.4 }
];

for (const v of variants) {
    const png = encodePng(v.size, v.size, renderIcon(v.size, v));
    writeFileSync(join(OUT, v.file), png);
    console.log(`wrote ${v.file} (${v.size}x${v.size}, ${png.length} bytes)`);
}
console.log("done");
