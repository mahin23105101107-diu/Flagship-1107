package io.flagship.sdk.autoconfigure;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "flagship")
public class FlagShipProperties {
    private boolean enabled = true;
    private String serverUrl = "http://localhost:8080";
    private String sdkKey = "";
    private int startupTimeoutMs = 1500;
    private String snapshotPath = "./data/flagship-snapshot.json";
    private boolean sseEnabled = true;
    private long pollingFallbackIntervalMs = 30_000L;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getServerUrl() { return serverUrl; }
    public void setServerUrl(String serverUrl) { this.serverUrl = serverUrl; }
    public String getSdkKey() { return sdkKey; }
    public void setSdkKey(String sdkKey) { this.sdkKey = sdkKey; }
    public int getStartupTimeoutMs() { return startupTimeoutMs; }
    public void setStartupTimeoutMs(int startupTimeoutMs) { this.startupTimeoutMs = startupTimeoutMs; }
    public String getSnapshotPath() { return snapshotPath; }
    public void setSnapshotPath(String snapshotPath) { this.snapshotPath = snapshotPath; }
    public boolean isSseEnabled() { return sseEnabled; }
    public void setSseEnabled(boolean sseEnabled) { this.sseEnabled = sseEnabled; }
    public long getPollingFallbackIntervalMs() { return pollingFallbackIntervalMs; }
    public void setPollingFallbackIntervalMs(long pollingFallbackIntervalMs) { this.pollingFallbackIntervalMs = pollingFallbackIntervalMs; }
}
