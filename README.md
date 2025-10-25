# Trade API Robinhood Automation Toolkit

This repository provides a TypeScript + Playwright scaffold for launching a visible Chromium/Chrome
session that opens Robinhood, lets you authenticate manually, and keeps the session alive between
runs by reusing a persistent browser profile.

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

1. A Chrome/Chromium window opens using a persistent profile stored at
   `~/.robinhood-playwright-profile` (configurable in `src/config.ts`).
2. If you are already authenticated, the script goes directly to the dashboard.
3. Otherwise, follow the on-screen prompts to enter credentials and complete MFA manually. When the
dashboard is visible, return to the terminal and press **Enter** to continue.
4. The automation navigates to the portfolio and watchlist pages, keeping the window visible until
you close it manually.

### Resetting the Profile

If the persistent session becomes invalid or corrupted, remove it with:

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
