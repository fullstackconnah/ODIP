import { inflateRawSync } from 'node:zlib';

type Entry = { name: string; method: number; compressedSize: number; localHeader: number };

/** Every entry, read from the central directory: a streamed ZIP's local headers carry no sizes. */
function entries(zip: Buffer): Entry[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('Not a complete ZIP: no end-of-central-directory record');
  const found: Entry[] = [];
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const nameLength = zip.readUInt16LE(at + 28);
    found.push({
      name: zip.toString('utf8', at + 46, at + 46 + nameLength),
      method: zip.readUInt16LE(at + 10),
      compressedSize: zip.readUInt32LE(at + 20),
      localHeader: zip.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return found;
}

export function zipEntryNames(zip: Buffer): string[] {
  return entries(zip).map(e => e.name);
}

/** One entry's bytes (stored or deflated), or null when the ZIP has no such entry. */
export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  const entry = entries(zip).find(e => e.name === name);
  if (!entry) return null;
  const start = entry.localHeader + 30 + zip.readUInt16LE(entry.localHeader + 26) + zip.readUInt16LE(entry.localHeader + 28);
  const data = zip.subarray(start, start + entry.compressedSize);
  return entry.method === 8 ? inflateRawSync(data) : Buffer.from(data);
}
