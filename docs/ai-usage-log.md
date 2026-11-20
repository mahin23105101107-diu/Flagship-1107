# AI Usage Log & Process Evidence (C11)

## Tools Used
- **Google AI Studio Build**: Architecture design, full-stack TypeScript/React implementation, Java 21 Spring Boot Starter authoring, automated `node:test` suites, and Playwright headless browser verification.

## Key Engineering Prompts & Decisions
1. Workspace runtime audit before coding to determine which toolchains exist locally (`node`/`npm`/`playwright-cli` vs. absent `java`/`mvn`/`docker`).
2. Enforcing bit-identical MurmurHash3 32-bit unsigned arithmetic across Java (`MurmurHash3.java`) and TypeScript (`src/engine/hashing.ts`).
3. Enforcing Tailwind CSS v4 `@custom-variant dark` and WCAG contrast across all 18 dashboard pages.

## Recorded Corrections & Engineering Adjustments (Honest Process Log)

### Correction 1: JavaScript Signed 32-Bit Multiplication Overflow in MurmurHash3
- **Initial Issue**: Standard JS `*` multiplication on 32-bit integers loses lower bits when products exceed `2^53`, diverging from Java's 32-bit wrapping `int` multiplication.
- **Fix Applied**: Used `Math.imul()` for every 32-bit multiply step and `>>> 0` on the final unsigned conversion in `src/engine/hashing.ts`, matching `Integer.toUnsignedLong(h1)` in `MurmurHash3.java`.
- **Verification**: Validated uniform distribution across 1,000,000 keys (`10%=9.956%`, `20%=19.966%`, 100% cohort preservation).

### Correction 2: Tailwind CSS v4 Dark Mode Class Toggling
- **Initial Issue**: In Tailwind v4 (`@import "tailwindcss";`), `dark:*` utilities follow OS `prefers-color-scheme` by default and ignore `<html class="dark">`.
- **Fix Applied**: Declared `@custom-variant dark (&:where(.dark, .dark *));` immediately below `@import "tailwindcss";` in `src/index.css` so the Settings / Header dark mode switch works reliably in all browsers.
- **Verification**: Verified live light/dark class toggle in Chromium via Playwright.

### Correction 3: Protecting Self-Approval Enforcement Server-Side
- **Initial Issue**: Relying only on a disabled UI button in the Approval Center could be bypassed via direct `POST /api/v1/approvals/:id/approve` API calls.
- **Fix Applied**: Enforced `if (cr.authorId === req.user.id)` in `server/routes.ts` returning HTTP `403 Forbidden` with RFC 9457 `application/problem+json` Problem Details, in addition to the clear UI indicator.
- **Verification**: Verified both UI guard and backend 403 rejection.
