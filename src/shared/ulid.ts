// Minimal ULID: time-prefixed, lexicographically sortable, 26 chars.
// Crockford base32. Sufficient for local single-process use.

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number, len: number): string {
  let out = "";
  let n = now;
  for (let i = len - 1; i >= 0; i--) {
    const mod = n % ENCODING_LEN;
    out = ENCODING.charAt(mod) + out;
    n = (n - mod) / ENCODING_LEN;
  }
  return out;
}

function encodeRandom(len: number): string {
  let out = "";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) {
    out += ENCODING.charAt((buf[i] ?? 0) % ENCODING_LEN);
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now, TIME_LEN) + encodeRandom(RANDOM_LEN);
}
