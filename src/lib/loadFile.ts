/**
 * Read an uploaded event-log file into text.
 * Supports plain .json and gzip-compressed .json.gz (decompressed in-browser
 * with pako). Gzip is detected by magic bytes, not just by extension, so a
 * misnamed file still works.
 */
import { ungzip } from "pako";

const GZIP_MAGIC = [0x1f, 0x8b];

export function isGzipped(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 2 &&
    bytes[0] === GZIP_MAGIC[0] &&
    bytes[1] === GZIP_MAGIC[1]
  );
}

export async function readLogFile(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const decoder = new TextDecoder("utf-8");
  if (isGzipped(buf)) {
    try {
      const out = ungzip(buf);
      return decoder.decode(out);
    } catch {
      throw new Error(
        "This file looks gzip-compressed but could not be decompressed. Make sure it is a valid .json.gz event log.",
      );
    }
  }
  return decoder.decode(buf);
}
