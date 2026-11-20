package io.flagship.sdk.autoconfigure;

import java.lang.annotation.*;

/**
 * AOP Guard Annotation (FR4).
 * When the referenced feature flag evaluates to false, the guarded method does not execute
 * and either returns null/default, invokes fallbackMethod, or throws FeatureDisabledException.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface FeatureFlag {
    String value();
    String fallbackMethod() default "";
    boolean defaultValue() default false;
}
