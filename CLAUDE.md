# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

raptOR is a target-shooting score log (decimal scoring up to 10.9, 10-shot series, 60-shot matches by default). It is a multi-user web app:
- `web/index.html` is the whole front end: inline CSS and vanilla ES5-style JS, no build step and no package manager. It loads Google Fonts, SheetJS `xlsx@0.18.5` (cdnjs) and `@supabase/supabase-js@2.117.0` (jsdelivr UMD).
- `supabase/` holds the backend for project `kmxjerumxxcszvpiiixc`: `migrations/` (tables plus RLS) and `functions/read-scoreboard/` (a Deno Edge Function that reads scoreboard photos with Gemini).
- Static hosting is on Vercel (deploy `web/` only). Design and plan are in `docs/superpowers/`.
- `.env.local` holds `GEMINI_API_KEY` for local experiments only. The live key is a Supabase secret. Never put it in `web/`.

## Running / checking

- Run locally: `python3 -m http.server -d web 8080` and open http://localhost:8080 (no build step).
- Tests: `node --test tests/*.test.mjs` (pure METRICS-block logic, loaded by `tests/load-metrics.mjs`) and `deno test supabase/functions/` (Edge Function validation).
- Single test: `node --test --test-name-pattern="scanCheck" tests/*.test.mjs`.
- The block between `/*==METRICS-START==*/` and `/*==METRICS-END==*/` must stay global and DOM-free; add new pure functions there and export them in `tests/load-metrics.mjs`.
- Debug handle: `window.__raptor` exposes `{state, render, calc, handlers, readFile}`.

## Architecture

**Two script scopes.** The metrics block (`calc`, `compare`, `pool`, `byPosition`, `bySeriesNo`, `dirStats`, `sortSessions`, `niceScale`, `makeId`, …) sits at global scope. Everything else is inside one `'use strict'` IIFE.

**Data model.** A session looks like `{id, date:'YYYY-MM-DD', label, fired, shots:[{n, s, d}], seriesTimes:{seriesNo:'HH:MM'}, screenTotal, note, createdAt, updatedAt}`.
- `id = makeId(date, label)`, so date + label is the identity. Renaming or redating a session deletes the old id and persists a new one (see the `s-date`/`s-label` change handler).
- `n` is the shot number (1-based). Series = `ceil(n/10)`. `d` is one of the 8 arrow glyphs in `DIRS`, or `''`.
- `plain(s)` is the canonical serializer. Use it for anything written to storage or exported.

**Score math is done in integer tenths.** `T(v) = round(v*10)` keeps float error out of sums and thresholds. Follow the same pattern in new metrics. Settings in `cfg` (`tens`, `mark`, `planned`) set the thresholds. Many metrics only appear past a minimum shot count (comparisons need ≥10 shots, the first/second-half fade needs ≥20).

**Accounts and storage (`initStore`, `loadAccount`, `persist`, `removeSession`, `flush`).**
- Supabase Auth uses email and password. `onAuthStateChange` sets `state.user`; signed out (or a `PASSWORD_RECOVERY` link) renders `viewAuth()` with the tabs hidden.
- Tables: `sessions` (PK `(user_id, id)`, with shots as jsonb, epoch-ms `created_at`/`updated_at`), `settings` and `scan_usage`. RLS is `user_id = auth.uid()`. `toRow`/`fromRow` map between camelCase and snake_case.
- Storage is write-ahead. Every change goes to `localStorage['raptor_v3_<uid>_sessions']` and is marked in `pending` (`{id: 'upsert'|'delete'}`, also persisted). A 350 ms debounce then runs `flush()`, which clears a mark only if the session didn't change while its request was in flight. Retries happen on failure (30 s), on `online` and on `visibilitychange`.
- On sign-in, `mergeRemote(cache, remote, pending)` reconciles: pending local upserts beat older remote rows and survive when missing from the server, and pending deletes stay hidden.
- Pre-account local data (`raptor_v2_local`) shows up as `state.stray` with a "move to your account" action.

**Scoreboard scan.**
- `#scan` (Log tab) → `shrink()` (≤1600px JPEG) → `sb.functions.invoke('read-scoreboard')`.
- The function checks auth and the `bump_scan(60)` daily cap, then tries Gemini models in order (`gemini-3.5-flash`, `-lite`, `flash-latest`), skipping on 503/429/404. `validate.ts` cleans the reply into `{date, time, subtotal, sighter, shots:[{n,s,d}]}`. It stores nothing.
- `state.scan` drives `viewScan()`, the review screen: editable date and label, a shot grid editable through `editSheet` in scan mode, `scanCheck` against the subtotal, `scanConflicts` outlines, and a sighter override. Nothing is saved until Save (`saveScan` → `mergeShots` → `persist`).

**UI is string-templated and re-rendered in full.**
- `render()` rebuilds `#tabs`, `#app` (or `viewAuth()` when signed out) (one `view*()` function per tab: summary, log, sessions, trends, data; Log shows `viewScan()` while `state.scan` is set) and `#modal` (the shot-edit sheet) from `state`, then restores the scroll position.
- All user text must go through `esc()`.
- Events are delegated at document level. Click: `[data-act]` → `handlers[act](el, e)`. Change: `[data-field]` is handled in one switch inside the `change` listener.
- To add an action: emit `data-act="x"` in a view and add `handlers.x`.
- Charts are hand-built inline SVG (`dotPlot`, `bucketBars`, `compass`, `lineChart`). `lineChart` hover data goes through the module-level `chartData`, which is reset on every render and wired up by `bindCharts()`.
- Destructive actions use the "tap again" pattern: `state.confirm` is set, then cleared after 5 s.

**Import/export.**
- `readFile` accepts `.json` backups or any sheet SheetJS can read. `parseRows` finds the header row (it needs a `score` column and a shot column).
- Rows whose `Type` isn't "Match" are counted as skipped sighters. A `SESSION TOTAL` row gives the screen total, plus `fired` and the note parsed from its text.
- `shotRows()` writes the same layout back out, so exports re-import cleanly. Keep the import and export formats symmetric.

## Styling conventions

- Mobile-first single column (max-width 720px), sticky header, fixed bottom tab bar, safe-area insets.
- Colors are CSS tokens on `:root`, redefined for dark mode under both `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]`. Update both blocks together.
- Brand colour is Pantone 222 C, `#6C1D45` (`--accent` in light mode). Dark mode uses a lighter tint of the same 330° hue (`#DF86B3`) for contrast. Tier shades are tints and shades of that hue. Keep every text/background pair at 4.5:1 or better.
- Score tiers `--h1..--h5` / `--ht1..--ht5` map to `tier()` (under 7, 7s, 8s, 9s, 10+).
- Touch targets are at least 44px. Inputs use a 16px font so iOS doesn't zoom.

## Deploying

- Database: `supabase db push` (linked to `kmxjerumxxcszvpiiixc`).
- Function: `supabase functions deploy read-scoreboard --project-ref kmxjerumxxcszvpiiixc --use-api` (`--use-api` avoids needing Docker).
- Gemini key: `supabase secrets set GEMINI_API_KEY=...`.
- Site: `npx vercel deploy web --prod`.
