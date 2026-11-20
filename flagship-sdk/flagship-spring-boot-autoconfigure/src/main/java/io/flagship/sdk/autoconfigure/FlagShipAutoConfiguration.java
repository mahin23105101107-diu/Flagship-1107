package io.flagship.sdk.autoconfigure;

import io.flagship.shared.EvaluationEngine.EvaluationContext;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.boot.actuate.endpoint.annotation.Endpoint;
import org.springframework.boot.actuate.endpoint.annotation.ReadOperation;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.ObjectProvider;

import java.lang.reflect.Method;
import java.util.Map;

@AutoConfiguration
@EnableConfigurationProperties(FlagShipProperties.class)
@ConditionalOnProperty(prefix = "flagship", name = "enabled", havingValue = "true", matchIfMissing = true)
public class FlagShipAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public FlagShipClient flagShipClient(FlagShipProperties properties, ObjectProvider<MeterRegistry> registry) {
        return new FlagShipClient(properties, registry.getIfAvailable());
    }

    @Bean
    @ConditionalOnMissingBean
    public FeatureFlagAspect featureFlagAspect(FlagShipClient client) {
        return new FeatureFlagAspect(client);
    }

    @Bean
    @ConditionalOnMissingBean
    public FlagShipActuatorEndpoint flagShipActuatorEndpoint(FlagShipClient client) {
        return new FlagShipActuatorEndpoint(client);
    }

    @Aspect
    public static class FeatureFlagAspect {
        private final FlagShipClient client;

        public FeatureFlagAspect(FlagShipClient client) {
            this.client = client;
        }

        @Around("@annotation(featureFlag)")
        public Object guardFeature(ProceedingJoinPoint pjp, FeatureFlag featureFlag) throws Throwable {
            EvaluationContext ctx = extractContext(pjp.getArgs());
            boolean enabled = client.isEnabled(featureFlag.value(), ctx, featureFlag.defaultValue());
            if (enabled) {
                return pjp.proceed();
            }
            if (!featureFlag.fallbackMethod().isBlank()) {
                Method fallback = pjp.getTarget().getClass().getDeclaredMethod(featureFlag.fallbackMethod());
                fallback.setAccessible(true);
                return fallback.invoke(pjp.getTarget());
            }
            return null;
        }

        private EvaluationContext extractContext(Object[] args) {
            for (Object arg : args) {
                if (arg instanceof EvaluationContext ctx) return ctx;
                if (arg instanceof String s && !s.isBlank()) return EvaluationContext.builder(s).build();
            }
            return EvaluationContext.builder("anonymous").build();
        }
    }

    @Endpoint(id = "flagship")
    public static class FlagShipActuatorEndpoint {
        private final FlagShipClient client;

        public FlagShipActuatorEndpoint(FlagShipClient client) {
            this.client = client;
        }

        @ReadOperation
        public Map<String, Object> status() {
            return Map.of(
                    "offlineMode", client.isOfflineMode(),
                    "cachedFlags", client.getCachedFlagCount(),
                    "lastSyncAt", client.getLastSyncAt() != null ? client.getLastSyncAt().toString() : "never"
            );
        }
    }
}
