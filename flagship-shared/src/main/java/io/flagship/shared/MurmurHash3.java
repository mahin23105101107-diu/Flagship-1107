package io.flagship.shared;

import java.nio.charset.StandardCharsets;

/**
 * Deterministic MurmurHash3 32-bit (x86) bucketing strategy.
 * Bit-identical to src/engine/hashing.ts so FlagShip Server preview and
 * Spring Boot Starter SDK evaluate identical sticky cohorts (FR3 / QA4).
 */
public final class MurmurHash3 {

    private static final int C1 = 0xcc9e2d51;
    private static final int C2 = 0x1b873593;

    private MurmurHash3() {}

    public static long hash32Unsigned(String input, int seed) {
        byte[] data = input.getBytes(StandardCharsets.UTF_8);
        int length = data.length;
        int h1 = seed;
        int nblocks = length >>> 2;

        for (int i = 0; i < nblocks; i++) {
            int idx = i << 2;
            int k1 = (data[idx] & 0xff)
                    | ((data[idx + 1] & 0xff) << 8)
                    | ((data[idx + 2] & 0xff) << 16)
                    | ((data[idx + 3] & 0xff) << 24);

            k1 *= C1;
            k1 = Integer.rotateLeft(k1, 15);
            k1 *= C2;

            h1 ^= k1;
            h1 = Integer.rotateLeft(h1, 13);
            h1 = h1 * 5 + 0xe6546b64;
        }

        int tailIdx = nblocks << 2;
        int k1 = 0;
        switch (length & 3) {
            case 3:
                k1 ^= (data[tailIdx + 2] & 0xff) << 16;
            case 2:
                k1 ^= (data[tailIdx + 1] & 0xff) << 8;
            case 1:
                k1 ^= (data[tailIdx] & 0xff);
                k1 *= C1;
                k1 = Integer.rotateLeft(k1, 15);
                k1 *= C2;
                h1 ^= k1;
            default:
                break;
        }

        h1 ^= length;
        h1 ^= (h1 >>> 16);
        h1 *= 0x85ebca6b;
        h1 ^= (h1 >>> 13);
        h1 *= 0xc2b2ae35;
        h1 ^= (h1 >>> 16);

        return Integer.toUnsignedLong(h1);
    }

    /**
     * Returns a deterministic sticky bucket in [0.00, 100.00).
     */
    public static double computeBucket(String flagKey, String userKey) {
        long hash = hash32Unsigned(flagKey + ":" + userKey, 0);
        return (hash % 10000L) / 100.0;
    }
}
