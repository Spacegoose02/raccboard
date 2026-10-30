import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// server modules open the database on import, so point them at a throwaway data folder first.
let sniffImage;
let buildIcs;
beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-unit-'));
  ({ sniffImage } = await import('../../server/api.js'));
  ({ buildIcs } = await import('../../server/dates.js'));
});

describe('sniffImage', () => {
  const pad = (bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);
  it('recognises raster formats by their bytes', () => {
    expect(sniffImage(pad([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(sniffImage(pad([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(sniffImage(pad([...Buffer.from('GIF89a')]))).toBe('image/gif');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });
  it('refuses SVG and short files', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('tiny'))).toBeNull();
  });
});

describe('buildIcs', () => {
  it('produces a calendar with CRLF line endings', () => {
    const ics = buildIcs([], 'Test');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});
