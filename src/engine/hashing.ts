/**
 * Deterministic MurmurHash3 (32-bit x86) bucketing strategy.
 * Produces identical 32-bit unsigned hashes and [0.00, 100.00) buckets across
 * TypeScript (Node + Browser) and the Java Spring Boot Starter (flagship-shared).
 *
 * Guarantees (FR3 / QA4):
 * - Deterministic across restarts and instances
 * - Independent across different flag keys (hashes `${flagKey}:${userKey}`)
 * - Cohort-preserving: raising rollout from 10% to 20% preserves every user in [0, 10)
 */

export interface BucketingStrategy {
  readonly name: string;
  computeBucket(flagKey: string, userKey: string): number;
}

export function murmurHash3_32(input: string, seed = 0): number {
  let h1 = seed >>> 0;
  const len = input.length;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  // Encode ASCII / UTF-8 bytes identically to Java String.getBytes(StandardCharsets.UTF_8)
  const bytes: number[] = [];
  for (let i = 0; i < len; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      i++;
      const cp = 0x10000 + (((code & 0x3ff) << 10) | (input.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }

  const byteLen = bytes.length;
  const nblocks = byteLen >>> 2;

  for (let i = 0; i < nblocks; i++) {
    const idx = i << 2;
    let k1 =
      (bytes[idx] & 0xff) |
      ((bytes[idx + 1] & 0xff) << 8) |
      ((bytes[idx + 2] & 0xff) << 16) |
      ((bytes[idx + 3] & 0xff) << 24);

    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  const tailIdx = nblocks << 2;
  let k1 = 0;
  switch (byteLen & 3) {
    case 3:
      k1 ^= (bytes[tailIdx + 2] & 0xff) << 16;
    // falls through
    case 2:
      k1 ^= (bytes[tailIdx + 1] & 0xff) << 8;
    // falls through
    case 1:
      k1 ^= bytes[tailIdx] & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
  }

  h1 ^= byteLen;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

export class Murmur3BucketingStrategy implements BucketingStrategy {
  readonly name = 'MURMUR3_32';

  /**
   * Returns a deterministic bucket in [0, 100) with 0.01% precision (10,000 slots).
   */
  computeBucket(flagKey: string, userKey: string): number {
    const hash = murmurHash3_32(`${flagKey}:${userKey}`, 0);
    return (hash % 10000) / 100;
  }
}

export const defaultBucketingStrategy = new Murmur3BucketingStrategy();
