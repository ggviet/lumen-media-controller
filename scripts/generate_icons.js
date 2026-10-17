/**
 * scripts/generate_icons.js
 * Generates valid 256x256 RGBA PNG (assets/icon.png) and Windows ICO (assets/icon.ico)
 * for LUMEN PRO standalone packaging using only Node.js built-in modules.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 Lookup Table for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(typeStr, dataBuf) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(dataBuf.length, 0);
  const typeBuf = Buffer.from(typeStr, 'ascii');
  const crcInput = Buffer.concat([typeBuf, dataBuf]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, dataBuf, crcBuf]);
}

function generateLumenPng(width = 256, height = 256) {
  // Raw scanlines: each row starts with filter byte 0x00 followed by width * 4 RGBA bytes
  const rawData = Buffer.alloc(height * (1 + width * 4));
  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded-square dark broadcast badge background (#0c0c14) with cyan/crimson L-beam emblem
      const margin = 16;
      const inBox = x >= margin && x < width - margin && y >= margin && y < height - margin;

      if (!inBox) {
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
        continue;
      }

      // Base dark obsidian color
      let r = 14;
      let g = 16;
      let b = 26;
      let a = 255;

      // Outer glowing ring
      if (dist > 88 && dist < 96) {
        r = 59;
        g = 130;
        b = 246; // Accent blue
      } else if (dist <= 88) {
        // Stylized 'L' + Play prism inside the badge
        const inLVertical = x >= 84 && x <= 108 && y >= 72 && y <= 184;
        const inLHorizontal = x >= 84 && x <= 172 && y >= 160 && y <= 184;
        const inPrism = x >= 122 && x <= 172 && y >= 76 && y <= 136 && (x - 122) <= (136 - Math.abs(y - 106)) * 1.4;

        if (inLVertical || inLHorizontal) {
          r = 244;
          g = 244;
          b = 246;
        } else if (inPrism) {
          r = 239;
          g = 68;
          b = 68; // Broadcast PGM Red
        }
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // Bit depth 8
  ihdr[9] = 6;  // Color type 6 (RGBA)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const idatData = zlib.deflateSync(rawData, { level: 9 });
  const iendData = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idatData),
    makePngChunk('IEND', iendData)
  ]);
}

function wrapPngInIco(pngBuffer) {
  // Standard 6-byte ICONDIR + 16-byte ICONDIRENTRY = 22-byte header wrapping a 256x256 PNG
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);      // Reserved (0)
  header.writeUInt16LE(1, 2);      // Type (1 = ICO)
  header.writeUInt16LE(1, 4);      // Image count (1)

  header.writeUInt8(0, 6);         // Width (0 means 256px)
  header.writeUInt8(0, 7);         // Height (0 means 256px)
  header.writeUInt8(0, 8);         // Color palette count (0)
  header.writeUInt8(0, 9);         // Reserved (0)
  header.writeUInt16LE(1, 10);     // Color planes (1)
  header.writeUInt16LE(32, 12);    // Bits per pixel (32)
  header.writeUInt32LE(pngBuffer.length, 14); // Size of PNG payload
  header.writeUInt32LE(22, 18);    // Offset of PNG payload (22 bytes)

  return Buffer.concat([header, pngBuffer]);
}

const assetsDir = path.join(__dirname, '../assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

const pngBuf = generateLumenPng(256, 256);
const icoBuf = wrapPngInIco(pngBuf);

const pngPath = path.join(assetsDir, 'icon.png');
const icoPath = path.join(assetsDir, 'icon.ico');

fs.writeFileSync(pngPath, pngBuf);
fs.writeFileSync(icoPath, icoBuf);

console.log(`Generated ${pngPath} (${pngBuf.length} bytes)`);
console.log(`Generated ${icoPath} (${icoBuf.length} bytes)`);
