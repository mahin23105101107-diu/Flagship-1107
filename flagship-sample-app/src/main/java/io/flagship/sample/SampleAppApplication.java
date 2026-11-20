package io.flagship.sample;

import io.flagship.sdk.autoconfigure.FeatureFlag;
import io.flagship.sdk.autoconfigure.FlagShipClient;
import io.flagship.shared.EvaluationEngine.EvaluationContext;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@SpringBootApplication
@RestController
public class SampleAppApplication {

    private final FlagShipClient flagShipClient;

    public SampleAppApplication(FlagShipClient flagShipClient) {
        this.flagShipClient = flagShipClient;
    }

    public static void main(String[] args) {
        SpringApplication.run(SampleAppApplication.class, args);
    }

    @FeatureFlag(value = "new-checkout-flow", fallbackMethod = "legacyCheckout")
    @GetMapping("/api/checkout")
    public Map<String, Object> newCheckout(@RequestParam(defaultValue = "alice@acme.io") String userId) {
        EvaluationContext ctx = EvaluationContext.builder(userId)
                .attribute("plan", "enterprise")
                .build();
        String layout = flagShipClient.getString("homepage-layout", ctx, "classic-grid");
        return Map.of("flow", "one-step-checkout", "layout", layout, "userId", userId);
    }

    public Map<String, Object> legacyCheckout() {
        return Map.of("flow", "legacy-multi-step-checkout", "fallback", true);
    }
}
