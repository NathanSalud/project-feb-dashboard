# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Multi-tenant analytics dashboard for **Great Deals E-Commerce Corp (GDEC)**, a Philippine e-commerce enabler that runs brand stores on Shopee, Lazada, TikTok Shop, and Zalora. Each brand/distributor logs in and sees only their own sales, shop, product, geo, discount, and inventory (DOI) data; a `gdec_admin` account sees everything.

The repo is a two-app monorepo with **no root tooling** — `backend/` and `frontend/` are independent npm packages, each opened and run on its own.

- `backend/` — NestJS 11 API; pulls from Snowflake, caches in memory, serves JWT-protected endpoints.
- `frontend/` — React 19 + Vite SPA; single dashboard view with charts (Recharts) and React Query.

## Commands

Run these from inside `backend/` or `frontend/` respectively (not the repo root).

> **Git gotcha (Windows):** `git` only works reliably from an external Windows Command Prompt, **not** the VS Code integrated terminal, due to a PATH issue. Run git commands in a standalone `cmd` window.

### Backend (`cd backend`)
- `npm run start:dev` — watch-mode dev server (port 3000; note the bumped `--max-old-space-size=4096`).
- `npm run build` — `nest build` → `dist/`.
- `npm run start:prod` — run compiled `dist/main` (this is what the `Procfile` runs).
- `npm run lint` — ESLint with `--fix`.
- `npm test` — Jest unit tests (`*.spec.ts` co-located in `src/`).
- `npx jest src/auth/auth.service.spec.ts` — run a single test file.
- `npx jest -t "partial test name"` — run tests matching a name.

### Frontend (`cd frontend`)
- `npm run dev` — Vite dev server (port 5173).
- `npm run build` — `tsc -b && vite build` (type-check then bundle; **type errors fail the build** — Vercel deploys go through this).
- `npm run lint` — ESLint.

## Architecture

### The cache layer is the heart of the backend
`CacheService` (`backend/src/cache/cache.service.ts`) is the key design decision: **no dashboard request ever hits Snowflake directly.** On `onModuleInit` it runs ~8 broad aggregation queries against `GDEC_DATAMART.GOLD_SCHEMA` and stores the full result sets in an in-memory `Map`. A `node-cron` job re-runs all queries nightly at **16:00 UTC = midnight Philippine Time (UTC+8)**.

Consequences to keep in mind:
- Every query in `refreshAll()` pulls **all companies' data at once** (`WHERE ORDER_DATE >= '2023-01-01'`, no per-tenant filter in SQL). Tenant isolation happens **after** the fetch, in the getter methods.
- Date-range filtering (`dateFrom`/`dateTo`) is also applied in-memory in the getters, **not** in SQL — so changing date ranges is instant and never re-queries.
- The DOI (Days of Inventory) dataset is the exception: it's a point-in-time inventory snapshot vs. 90-day order velocity and **ignores the date filters entirely**.
- Adding a new dataset = add a `refreshX()` (push to `refreshAll()`'s `Promise.all`) + a public getter + a `DashboardService` method + a controller route + a `frontend/src/api.ts` call.

### Request flow
`DashboardController` → `DashboardService` (validates `YYYY-MM-DD` dates, handles pagination) → `CacheService` getters. `SnowflakeService.query()` self-heals: it calls `ensureConnection()` (via `isValidAsync()`) and reconnects before each query — this fixed nightly cron failures from stale connections.

### Auth & multi-tenancy (this is the security boundary)
- **Users are hardcoded**, not in a database: see the `USERS` array in `backend/src/auth/auth.service.ts`. Each entry maps a username → `companyName`, `accountNames`, `platforms`, `isAdmin`. All accounts share one bcrypt hash constant (`HASH`).
- Login issues a JWT whose payload carries `companyName`, `isAdmin`, and `customerIds` (from `CUSTOMER_ID_MAP`, used only for DOI filtering).
- `JwtGuard` (`backend/src/auth/jwt/jwt.guard.ts`) verifies the token and attaches the decoded payload to `req.user`. Controllers read `req.user.companyName` / `req.user.isAdmin` and pass them down.
- **Tenant isolation = `filterCompany()` / `filterAndDate()` in `CacheService`**: non-admins get rows where `COMPANY_NAME === companyName`; `isAdmin` bypasses the filter and returns everything. `companyName` strings in `USERS` must exactly match `COMPANY_NAME` values in Snowflake or a tenant sees nothing. When touching any getter, preserve the `isAdmin` bypass and the company filter — that is the entire access-control model.

### Insights (Anthropic)
`InsightsService` (`backend/src/insights/insights.service.ts`) sends the current dashboard payload to the Claude API (`claude-sonnet-4-6`) for executive-summary insights. Uses `@anthropic-ai/sdk`. Note: `frontend/src/Dashboard.tsx`'s `generateInsights()` currently calls `http://localhost:3000/insights/generate` via a hardcoded URL (not the `api.ts` axios instance), so it does not pick up `VITE_API_URL` in production.

### Frontend
- `App.tsx` is the entire router: `useAuth()` → show `Login` if no user, else `Dashboard`.
- `AuthContext` persists `token` + `user` in `localStorage`; the `api.ts` axios interceptor attaches the bearer token and, on any `401`, clears storage and redirects to `/`.
- `Dashboard.tsx` (~630 lines) is the whole UI: all tabs (`breakdown`, `shops`, `products`, `doi`), client-side filters (platform/account/granularity), Recharts charts, CSV export, and the insights panel. React Query (`staleTime`-cached) fetches each dataset once per session.

## Environment variables

Not committed. `backend/.env`: `SNOWFLAKE_*` (ACCOUNT, USERNAME, PASSWORD, DATABASE, SCHEMA, WAREHOUSE, ROLE), `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `ANTHROPIC_API_KEY`, `FRONTEND_URL` (CORS origin). `frontend/.env.local`: `VITE_API_URL` (backend base URL).

## Deploy notes
- Frontend deploys to **Vercel** (auto on push to `main`); a TypeScript error in `npm run build` will fail the deploy, so keep the tree type-clean.
- Backend runs on **EC2**, deployed via **SSM Session Manager**. Deploy steps on the instance: `git pull`, `npm run build`, `pm2 restart project-feb-backend`. (The `Procfile`'s `web: node dist/main.js` is the underlying run command.)
- The `gold_schema` table names in the cache SQL (`FACT_PLATFORM_ORDER_ITEMS`, `DIM_MARKETPLACE_ACCOUNTS`, `FACT_WMS_INVENTORY`, `FACT_WMS_ORDER_ITEMS`) are the Snowflake source of truth; the `ITEM_STATUS IN (...)` and `ACCOUNT_NAME != 's'` / `IS_ACTIVE = TRUE` guards are intentional data-quality filters — carry them into any new query.
