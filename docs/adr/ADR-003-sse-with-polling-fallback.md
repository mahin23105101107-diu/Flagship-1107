# ADR-003: Server-Sent Events (SSE) with Polling Fallback for Live SDK Updates

- **Status**: Accepted
- **Date**: 2026-11-20

## Context
FR5 and QA3 require flag changes—especially emergency kill switches—to reach connected SDK instances within 5 seconds at p95 without hammering the server with high-frequency HTTP polling.

## Problem
Choosing the transport protocol for server-to-SDK configuration notifications that works cleanly over standard HTTP, proxies, and Spring Boot without heavyweight broker infrastructure.

## Options Considered
1. **Short Polling (every 1s)**: Wastes bandwidth and DB reads; still risks >5s tail latency under load.
2. **WebSockets / STOMP**: Full-duplex complexity unnecessary for unidirectional config push; harder through corporate HTTP proxies.
3. **Server-Sent Events (SSE) + Scheduled Polling Fallback**: Native unidirectional HTTP push (`text/event-stream`) with automatic reconnect and a 30s polling safety net.

## Decision
Use **SSE (`/api/v1/sdk/stream`)** driven by an Observer `FlagShipEventBus`, backed by automatic **30-second HTTP snapshot polling** if an SSE stream drops or is blocked by a proxy.

## Consequences
- **Positive**: Sub-second push propagation for kill switches and approved rollouts; zero extra message broker dependencies; works directly in browsers (`EventSource`) and Java `HttpClient`.
- **Negative**: Requires proxy buffering disabled (`X-Accel-Buffering: no`) and periodic 20s heartbeats to keep idle connections alive.
