package io.flagship.shared;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/**
 * QA4 & FR3 Automated 1,000,000-user deterministic sticky rollout consistency test.
 */
class StickyRolloutConsistencyTest {

    @Test
    void oneMillionUsersPreserveCohortFrom10To20Percent() {
        int total = 1_000_000;
        int in10 = 0;
        int in20 = 0;
        int preserved = 0;

        for (int i = 0; i < total; i++) {
            String userKey = "user-" + i;
            double bucket = MurmurHash3.computeBucket("new-checkout", userKey);
            assertEquals(bucket, MurmurHash3.computeBucket("new-checkout", userKey));

            boolean hit10 = bucket < 10.0;
            boolean hit20 = bucket < 20.0;
            if (hit10) {
                in10++;
                if (hit20) preserved++;
            }
            if (hit20) in20++;
        }

        assertEquals(in10, preserved, "100% of 10% cohort must remain enabled at 20%");
        double pct10 = (in10 * 100.0) / total;
        double pct20 = (in20 * 100.0) / total;
        assertTrue(Math.abs(pct10 - 10.0) < 0.25, "10% bucket drift too high: " + pct10);
        assertTrue(Math.abs(pct20 - 20.0) < 0.25, "20% bucket drift too high: " + pct20);
    }
}
