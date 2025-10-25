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
