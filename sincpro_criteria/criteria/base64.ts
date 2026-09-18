/**
 * base64url, by hand and with no dependencies.
 *
 * `btoa`, `atob`, `Buffer` and `TextEncoder` all exist in the browser, in Node and in
 * Hermes — but not all four in all three, and not in every version. This package runs in
 * all three, so the forty lines are written once here and nobody gets a surprise from a
 * React Native release again.
 *
 * Unpadded: the `=` is escaped by some clients and not by others, which would turn one
 * request into two URLs. It is the same technique the engine's own cursor travels with.
 *
 * @module
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** A string as its UTF-8 bytes. */
function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let point = text.charCodeAt(index);
    // A surrogate pair is two 16-bit units that stand for ONE character (emoji, and
    // anything above U+FFFF). Without this they travel as two pieces of garbage.
    if (point >= 0xd800 && point <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        point = (point - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        index += 1;
      }
    }
    if (point < 0x80) {
      bytes.push(point);
    } else if (point < 0x800) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return bytes;
}

/** UTF-8 bytes back into a string. */
function utf8Text(bytes: number[]): string {
  let text = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index] ?? 0;
    let point: number;
    if (first < 0x80) {
      point = first;
      index += 1;
    } else if (first < 0xe0) {
      point = ((first & 0x1f) << 6) | ((bytes[index + 1] ?? 0) & 0x3f);
      index += 2;
    } else if (first < 0xf0) {
      point =
        ((first & 0x0f) << 12) |
        (((bytes[index + 1] ?? 0) & 0x3f) << 6) |
        ((bytes[index + 2] ?? 0) & 0x3f);
      index += 3;
    } else {
      point =
        ((first & 0x07) << 18) |
        (((bytes[index + 1] ?? 0) & 0x3f) << 12) |
        (((bytes[index + 2] ?? 0) & 0x3f) << 6) |
        ((bytes[index + 3] ?? 0) & 0x3f);
      index += 4;
    }
    text += String.fromCodePoint(point);
  }
  return text;
}

/**
 * A string as unpadded base64url.
 *
 * @example
 * encodeBase64Url('{"limit":80}'); // "eyJsaW1pdCI6ODB9"
 */
export function encodeBase64Url(text: string): string {
  const bytes = utf8Bytes(text);
  let written = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const block = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    written += ALPHABET.charAt((block >> 18) & 0x3f);
    written += ALPHABET.charAt((block >> 12) & 0x3f);
    if (second !== undefined) written += ALPHABET.charAt((block >> 6) & 0x3f);
    if (third !== undefined) written += ALPHABET.charAt(block & 0x3f);
  }
  return written;
}

/**
 * The inverse of {@link encodeBase64Url}. Reads padded and classic base64 as well.
 */
export function decodeBase64Url(written: string): string {
  const bytes: number[] = [];
  let block = 0;
  let bits = 0;
  for (const letter of written) {
    // `+` and `/` are the classic base64 alphabet and mean the same as `-` and `_`, so this
    // reads both spellings. Padding `=` and any line break are skipped.
    const value = letter === "+" ? 62 : letter === "/" ? 63 : ALPHABET.indexOf(letter);
    if (value < 0) continue;
    block = (block << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((block >> bits) & 0xff);
    }
  }
  return utf8Text(bytes);
}
