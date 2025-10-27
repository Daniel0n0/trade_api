
# Trade API Robinhood Automation Toolkit

This repository provides a TypeScript + Playwright scaffold for launching a visible Chromium/Chrome
session that opens Robinhood, lets you authenticate manually, and removes any cached data as soon as
the automation finishes.

## Prerequisites

- Node.js 20 LTS or newer
- pnpm, npm, or yarn (examples below use `npm`)
- A Robinhood account with manual access to credentials and MFA devices

> ⚠️ **Disclaimer:** Automating Robinhood may violate their Terms of Service. Use at your own risk,
> keep automation limited to supervised, non-trading actions, and never store credentials in this
> repository.

## Installation

```bash
npm install
# Optionally install browser binaries once
npx playwright install chromium
```

## Usage

The project exposes a CLI entry point that opens a non-headless browser session and guides you
through the login flow when needed.

```bash
npm run start:robinhood
```

1. A Chrome/Chromium window opens using a dedicated profile stored at
   `~/.robinhood-playwright-profile` (configurable in `src/config.ts`). The directory is deleted
   automatically when the automation closes the browser so no session or cache data remain on disk.
2. If you are already authenticated, the script goes directly to the dashboard.
3. Otherwise, follow the on-screen prompts to enter credentials and complete MFA manually. The
   script waits for a redirect away from the login page (up to 3 attempts, with 10-second intervals)
   to confirm that you have successfully signed in before continuing.

4. The automation navigates to the portfolio, watchlist, and opens dedicated tabs for the configured
   SPY/SPX modules. The browser remains visible until you close it manually.

### Resetting the Profile

Normally no manual cleanup is required because the profile directory is removed at the end of each
run. If the process crashes or you enabled profile preservation in `src/config.ts`, remove the
directory manually with:

```bash
npm run clean:profile
```

## Project Structure

```
├─ src/
│  ├─ browser.ts          # Launches persistent browser context with tracing support
│  ├─ config.ts           # Centralized configuration values and selectors
│  ├─ login.ts            # Manual-login orchestration and session detection helpers
│  ├─ main.ts             # CLI entry point that keeps the window open
│  └─ nav.ts              # Helpers to visit portfolio and watchlist pages
├─ scripts/
│  └─ clean-profile.ts    # Removes the persistent profile directory
├─ playwright.config.ts   # Basic Playwright configuration (headless disabled)
├─ package.json           # Scripts and dependencies
└─ tsconfig.json          # TypeScript compiler options
```

## Development Tooling

- `npm run lint` – Lints the TypeScript source with ESLint and Prettier rules.
- `npm run format` – Applies Prettier formatting across the project.

Artifacts such as Playwright traces are stored under `artifacts/trace-<timestamp>.zip` whenever a
run completes. Review these files to debug issues or share reproducible traces.

# Trade API Automation Plan

## Overview
This repository currently serves as a placeholder for developing a Playwright-based TypeScript automation that opens Robinhood in a visible browser window, supports manual login, and keeps the session active between runs.

## Development Plan
1. **Scope and Objective**
   - Launch a non-headless Chromium/Chrome instance using Playwright.
   - Support manual authentication, including 2FA.
   - Navigate to core pages such as the portfolio and watchlists while preserving session state.
2. **Security and Compliance**
   - Store credentials securely outside of the codebase (e.g., OS keychain, password manager).
   - Perform login manually and persist the authenticated profile in a dedicated user-data directory.
   - Handle captchas and sensitive prompts manually; avoid logging sensitive tokens or cookies.
3. **Technical Architecture**
   - Stack: Node.js LTS, TypeScript, Playwright.
   - Provide a CLI entry point (e.g., `pnpm start:robinhood`) that creates or reuses a persistent browser context with `headless: false` and `viewport: null` to keep the window visible.
   - Include observability tooling such as screenshots, tracing, and optional video capture on failures.
4. **Login Flow and Persistence**
   - First run: open Robinhood, allow manual credential entry, complete 2FA, and persist the session data.
   - Subsequent runs: reuse the stored session; detect expired sessions and prompt for manual re-authentication when required.
5. **Project Structure**
   - Suggested layout:
     ```
     robinhood-play-browser/
     ├─ src/
     │  ├─ config.ts
     │  ├─ browser.ts
     │  ├─ login.ts
     │  ├─ nav.ts
     │  └─ main.ts
     ├─ scripts/
     │  └─ clean-profile.ts
     ├─ playwright.config.ts
     ├─ package.json
     ├─ tsconfig.json
     └─ README.md
     ```
6. **Browser Configuration Tips**
   - Use `launchPersistentContext` with flags such as `--disable-blink-features=AutomationControlled`.
   - Set default timeouts around 30 seconds and wait for `networkidle` after login actions.
   - Capture tracing data and screenshots on critical errors for easier debugging.
7. **Keeping the Window Visible**
   - Run with `headless: false` to ensure the UI stays on screen.
   - Prevent automatic closure by waiting for the page or process to close explicitly (e.g., `await page.waitForEvent('close')`).
   - Consider OS-level tools if “always-on-top” behavior is required.
8. **Navigation and Validation**
   - Verify dashboard and watchlist pages using stable selectors or ARIA roles.
   - Pause and prompt for manual resolution if security challenges appear.
9. **Error Handling and Resilience**
   - Add limited retries with backoff for network-sensitive steps.
   - Detect session expiration by monitoring for login prompts and restarting the assisted login flow.
10. **QA and Acceptance Criteria**
    - Successful non-headless launch.
    - Manual login flow that persists between runs.
    - Reliable navigation to portfolio and watchlist pages.
    - Resilient handling of session expiration and clean logging.
11. **Supporting Scripts**
    - `start:robinhood` to run the main automation.
    - `clean:profile` to reset the persistent profile directory.
    - `trace:viewer` to inspect generated Playwright traces.
12. **Risks and Mitigations**
    - Respect Robinhood’s Terms of Service and limit automation to supervised use.
    - Abstract selectors to accommodate UI changes.
    - Prepare for enforced MFA or captcha challenges by allowing manual intervention.
13. **Deliverables**
    - Repository scaffold as outlined above.
    - Comprehensive README with setup instructions and login guidance.
    - Dedicated persistent profile directory (e.g., `~/.robinhood-profile`).
    - Optional `.env.example` template without embedded credentials.



1(spy con marco de tiempo 1 dia, 1 hora y 15minutos):
https://robinhood.com/legend/layout/6bb41212-dbb4-4dc0-a0a7-7a75e4aaf9da?default_web_client=WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT

2(spy con marco de tiempo 5 minutos y 1 minuto):
https://robinhood.com/legend/layout/9a624e15-84c5-4a0e-8391-69f32b32d8d5?default_web_client=WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT

3(spy options chain):
https://robinhood.com/legend/layout/c59d5a8e-397f-421a-a6e4-8ffe753c3456?default_web_client=WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT

4(spx options chain):
https://robinhood.com/legend/layout/0413b972-f84e-4ce7-8eae-c0a50b96cc90?default_web_client=WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT
