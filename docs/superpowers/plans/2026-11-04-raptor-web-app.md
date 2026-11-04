# raptOR Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-file raptOR app into a multi-user web app. Each shooter's history lives in Supabase, and scoreboard photos are read by Gemini through a Supabase Edge Function.

**Architecture:**
- Keep the vanilla-JS single page and swap only its storage layer for supabase-js (auth plus two RLS-protected tables), with a localStorage write-ahead queue.
- New pure logic (merge, checks, remote reconcile) goes in the existing global `METRICS` block so Node can test it.
- One Deno Edge Function, `read-scoreboard`, holds the Gemini key, enforces a per-user daily cap, validates the model's reply and stores nothing.

**Tech Stack:**
- vanilla JS, `@supabase/supabase-js@2.117.0` (UMD from jsdelivr), SheetJS 0.18.5 (already used)
- Supabase Postgres, Auth and Edge Functions (Deno 2)
- Gemini REST `generateContent`
- Vercel static hosting
- Tests: `node --test` (Node 26) and `deno test`

**Spec:** `docs/superpowers/specs/2026-11-04-raptor-web-app-design.md`

## Global Constraints

- Supabase project ref `kmxjerumxxcszvpiiixc`.
- The Gemini key is only ever a Supabase secret (`GEMINI_API_KEY`). It is never in `web/` and never deployed to Vercel. `.env.local` is never deployed or committed.
- Every table has RLS on with `user_id = auth.uid()` for select, insert, update and delete.
- Scores are 0.0–10.9 with one decimal; shot numbers are integers from 1 to 200. Directions are exactly `↖ ↑ ↗ ← → ↙ ↓ ↘` or `''`.
- Score sums are compared in integer tenths (`T()`), never as floats.
- Gemini model order: `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-flash-latest`. Move to the next model on 503 or 429. Request with `responseMimeType: "application/json"` and `temperature: 0`.
- The per-user daily scan cap is 60.
- The client shrinks photos to at most 1600px on the long side, as JPEG at quality 0.8.
- Labels from screen time: before 12:00 is `Morning`, 12:00–16:59 is `Afternoon`, and 17:00 onward is `Evening`.
- Nothing from a scan is saved without the review screen.
- The scan screen shows this copy: "Photos are read by Google Gemini's free tier. Google may use them to improve its products. raptOR doesn't keep your photos."
- No git commits unless the owner asks. The folder is not a git repo.

## Review Focus

1. **A session created offline that hasn't uploaded yet.** After the remote fetch it must still be there and still queued, not dropped because the server lacks it. Test: `mergeRemote keeps pending local-only session` (Task 2).
2. **Renaming a session** (a delete plus an upsert queued while offline). The old id must not come back from the remote list before the delete flushes. Test: `mergeRemote hides pending delete` (Task 2).
3. **The real photo's scores against the 95.7 subtotal.** This must report a match despite float sums like 95.69999. Test: `scanCheck real photo matches` (Task 2).
4. **A model reply with a duplicated shot number, or a subtotal returned as the string `"95.7-3*"`.** Validation keeps the last duplicate and parses the leading number. Tests in `validate_test.ts` (Task 4).
5. **A wrong date from the model,** for example day and month swapped. The date isn't checkable, so the review screen must show it prominently and let the shooter edit it before saving. Manual check in Task 6, step 6.

---

### Task 1: Layout and test harness

**Files:**
- Move: `raptOR.html` → `web/index.html` (unchanged contents)
- Create: `tests/metrics.test.mjs`, `.gitignore`
- Modify: `CLAUDE.md` (paths and commands)

**Interfaces:**
- Produces: `tests/load-metrics.mjs` with `export function loadMetrics(): object`. It reads `web/index.html`, takes the text between `/*==METRICS-START==*/` and `/*==METRICS-END==*/`, and evaluates it with `new Function(src + '; return {calc, T, seriesNo, makeId, DIRS, DEFAULT_CFG' + EXTRA + '}')()`. Task 2 extends the returned names.

- [ ] **Step 1:** Move the file. Write `tests/load-metrics.mjs`, then `tests/metrics.test.mjs` with `test('calc sums in tenths')`: `calc({shots:[{n:1,s:10.5},{n:2,s:9.8},{n:3,s:10.0}]})` returns `n === 3`, `sum === 30.3` and `tensN === 2`.
- [ ] **Step 2:** Run `node --test tests/`. Expected: 1 pass.
- [ ] **Step 3:** Write `.gitignore` containing `.env.local`, `.DS_Store`, `.vercel` and `supabase/.temp`. Update `CLAUDE.md`: the app is now `web/index.html`, the test command is `node --test tests/`, and add `deno test supabase/functions/` (Task 4).

### Task 2: Pure scan and sync logic

**Files:**
- Modify: `web/index.html` (METRICS block, before `/*==METRICS-END==*/`)
- Modify: `tests/load-metrics.mjs` (export new names), `tests/metrics.test.mjs`

**Interfaces (all in the global METRICS block, used by Tasks 5–6):**
- `labelFromTime(hm: string|null) -> 'Morning'|'Afternoon'|'Evening'|'Other'`. An empty or invalid value returns `'Other'`.
- `scanCheck(shots: {n,s,d}[], subtotal: number|null) -> {sum:number, subtotal:number|null, ok:boolean|null}`. `ok` is null when the subtotal is null; it compares `T` sums.
- `scanConflicts(session|null, shots) -> number[]`: shot numbers already in the session with a different `s` or `d`.
- `mergeShots(session, shots, time: string|null) -> session`. Returns a **new** object: shots replaced by `n` and sorted, `fired = max(fired, max n)`, and `seriesTimes[seriesNo(n)]` set to `time` only where empty. It never mutates its input.
- `mergeRemote(local: session[], remote: session[], pending: {[id]: 'upsert'|'delete'}) -> session[]`:
  - a remote row loses to the local copy when `pending[id] === 'upsert'` and the local `updatedAt >= ` the remote one;
  - local sessions with a pending upsert that are missing from remote are kept;
  - ids with a pending delete are dropped;
  - every other remote row wins, and local rows not in remote without a pending entry are dropped.

- [ ] **Step 1: Write failing tests** in `tests/metrics.test.mjs`. Use the photo's shots as the fixture `REAL`: `[{n:11,s:9.8,d:'↘'},{n:12,s:10.6,d:'↓'},{n:13,s:10.3,d:'↖'},{n:14,s:8.4,d:'→'},{n:15,s:9.6,d:'↙'},{n:16,s:10.2,d:'↗'},{n:17,s:8.5,d:'↗'},{n:18,s:8.9,d:'↗'},{n:19,s:9.7,d:'↙'},{n:20,s:9.7,d:'↗'}]`.
  - `labelFromTime`: `'08:33'` gives Morning, `'12:00'` Afternoon, `'16:59'` Afternoon, `'17:00'` Evening, and `null` gives Other.
  - `scanCheck real photo matches`: `scanCheck(REAL, 95.7)` deep-equals `{sum:95.7, subtotal:95.7, ok:true}`. `scanCheck(REAL, 95.8).ok === false`, and `scanCheck(REAL, null).ok === null`.
  - `mergeShots partial series`:
    - merging `REAL.slice(0,4)` (shots 11–14) into a session holding shots 1–10 with `fired:60` gives 14 shots, `fired === 60`, and `seriesTimes[2] === '08:33'`;
    - the input session's `shots.length` stays 10;
    - `calc(merged).missing` starts with `[15, 16]`.
  - `mergeShots replaces by n`: merging `{n:12, s:10.1, d:'↓'}` over REAL makes shot 12 equal 10.1, and the count stays at 10.
  - `scanConflicts`: against a session holding REAL, `[{n:12,s:10.6,d:'↓'},{n:13,s:10.3,d:'↗'},{n:21,s:9,d:''}]` gives `[13]`. A null session gives `[]`.
  - `mergeRemote keeps pending local-only session`: `local=[A]`, `remote=[]`, `pending={A:'upsert'}` gives `[A]`.
  - `mergeRemote hides pending delete`: `local=[]`, `remote=[B]`, `pending={B:'delete'}` gives `[]`.
  - `mergeRemote newer pending local wins`: local A with `updatedAt` 200, remote A with 100, pending upsert gives the local A. With no pending entry it gives the remote A.
- [ ] **Step 2:** Run `node --test tests/`. Expected: the new tests fail with "is not a function".
- [ ] **Step 3:** Implement the five functions in the METRICS block in the file's ES5 style, and export them from `load-metrics.mjs`.
- [ ] **Step 4:** Run `node --test tests/`. Expected: all pass.

### Task 3: Database schema

**Files:**
- Create: `supabase/config.toml` (via `supabase init`), `supabase/migrations/20261104000000_init.sql`

**Interfaces (used by Tasks 4–5):**
- `public.sessions`:
  - columns: `user_id uuid not null default auth.uid() references auth.users on delete cascade`, `id text not null`, `date date not null`, `label text not null`, `fired int not null default 0`, `shots jsonb not null default '[]'`, `series_times jsonb not null default '{}'`, `screen_total numeric(5,1)`, `note text not null default ''`, `created_at bigint not null`, `updated_at bigint not null`;
  - primary key `(user_id, id)`;
  - `created_at` and `updated_at` are epoch milliseconds, matching the app's `Date.now()`.
- `public.settings`: `user_id uuid primary key default auth.uid() references auth.users on delete cascade`, `tens numeric(3,1) not null default 10`, `mark numeric(3,1) not null default 10.2`, `planned int not null default 60`.
- `public.scan_usage`: `user_id uuid`, `day date`, `count int`, with primary key `(user_id, day)`. RLS is on with **no** policies, so it's reachable only through the function below.
- `public.bump_scan(cap int) returns boolean`:
  - `security definer`, `set search_path = public`;
  - upserts today's row (UTC) for `auth.uid()` with `count + 1`;
  - returns `count <= cap`; returns false when `auth.uid()` is null;
  - `grant execute` to `authenticated` only, `revoke` from `anon` and `public`.

- [ ] **Step 1:** Write the migration with RLS enabled on all three tables. Add the four `user_id = auth.uid()` policies (`using` and `with check`) on `sessions` and `settings`.
- [ ] **Step 2:** Apply it, through the Supabase MCP `apply_migration` once authenticated, or with `supabase link --project-ref kmxjerumxxcszvpiiixc && supabase db push`. Expected: success.
- [ ] **Step 3:** Run the Supabase security advisors (MCP `get_advisors` type `security`). Expected: no RLS or function warnings for these tables.
- [ ] **Step 4:** RLS check with `execute_sql`, in one transaction, rolled back:
  - set `request.jwt.claims` to user X, insert a session, and switch to role `authenticated`;
  - switch the claims to user Y and `select count(*) from sessions`. Expected: 0.

### Task 4: `read-scoreboard` Edge Function

**Files:**
- Create: `supabase/functions/read-scoreboard/index.ts`, `validate.ts`, `validate_test.ts`

**Interfaces:**
- Request: `POST` with `Authorization: Bearer <user JWT>` and body `{image: base64 string, mime: 'image/jpeg'}`.
- Responses:
  - `200 {date:'YYYY-MM-DD', time:'HH:MM'|null, subtotal:number|null, sighter:boolean, shots:[{n,s,d}]}`;
  - `429 {error:'daily_limit'}`;
  - `502 {error:'busy'}` when all models fail;
  - `422 {error:'unreadable'}` when validation leaves no shots.
- Shot keys are `n`, `s` and `d`, the same as the app's model.
- `validateReading(raw: unknown) -> Reading`, exported from `validate.ts`. It throws `Error('unreadable')`. It accepts the model's keys `{date, time, subtotal, sighter, shots:[{n, dir, score}]}` and:
  - drops shots outside the 1–200 or 0–10.9 bounds;
  - rounds scores to one decimal;
  - maps unknown `dir` values to `''`;
  - keeps the **last** entry for a duplicate `n`;
  - parses `subtotal` from a number or the leading number of a string;
  - checks `date` is a real calendar date and returns `''` otherwise.

- [ ] **Step 1: Write the failing tests** in `validate_test.ts` (`Deno.test`):
  - the photo's model JSON (shape as in the spec's test evidence) gives 10 shots, `subtotal === 95.7` and `date === '2026-11-04'`;
  - `subtotal: "95.7-3*"` gives 95.7;
  - a duplicate `n:12` (10.6, then 10.1) gives a single shot 12 with `s === 10.1`;
  - `score: 11.2` is dropped; `dir: 'NE'` gives `''`; `date: '2026-02-30'` gives `''`;
  - `{shots: []}` throws `'unreadable'`.
- [ ] **Step 2:** Run `deno test supabase/functions/read-scoreboard/`. Expected: fail (module missing).
- [ ] **Step 3:** Implement `validate.ts`, then `index.ts` with `Deno.serve`:
  - CORS: `Access-Control-Allow-Origin: *`, and allow headers `authorization, x-client-info, apikey, content-type`;
  - answer `OPTIONS` with 204;
  - build a supabase client from `SUPABASE_URL`, `SUPABASE_ANON_KEY` and the request's Authorization header, then call `rpc('bump_scan', {cap: 60})`, returning 429 on false;
  - call Gemini through the model order in Global Constraints, using the prompt from `gemini_test.py` in the session scratchpad plus "set sighter true if the screen is in sighting/practice mode";
  - `validateReading`, then respond.
- [ ] **Step 4:** Run `deno test supabase/functions/read-scoreboard/`. Expected: all pass.
- [ ] **Step 5:** Set the secret and deploy:
  - `supabase secrets set --project-ref kmxjerumxxcszvpiiixc GEMINI_API_KEY=$(sed -n 's/^GEMINI_API_KEY=//p' .env.local)`;
  - `supabase functions deploy read-scoreboard --project-ref kmxjerumxxcszvpiiixc`. JWT verification is left at its default, which is on.
  - Expected: deployed.
- [ ] **Step 6:** Smoke test:
  - `curl` without auth. Expected: 401.
  - Sign in a test user through the Auth REST API, then post the shrunk `score_image.jpg` with that token. Expected: 200, with all 10 `REAL` shots and `subtotal: 95.7`.

### Task 5: Client auth and storage swap

**Files:**
- Modify: `web/index.html`: the storage section (`lsGet`…`initStore`), `viewData`, `offerFile`, the `move-stray` handler, `render`, plus a `<script>` tag for supabase-js

**Interfaces:**
- Consumes: the Task 3 tables, plus `mergeRemote` from Task 2.
- Produces (for Task 6):
  - `sb`, the supabase client;
  - `persist(s)` and `removeSession(id)`, with unchanged signatures;
  - `state.user` (`{id, email}` or null);
  - constants `SUPABASE_URL = 'https://kmxjerumxxcszvpiiixc.supabase.co'` and `SUPABASE_ANON_KEY`, the anon key from the project's API settings, which is public by design.
- localStorage keys per user: `raptor_v3_<uid>_sessions`, `raptor_v3_<uid>_pending` (`{id: 'upsert'|'delete'}`) and `raptor_v3_<uid>_cfg`.
- Row ↔ session mapping is in `toRow(s)` and `fromRow(r)`: `seriesTimes`↔`series_times`, `screenTotal`↔`screen_total`, `createdAt`↔`created_at`, `updatedAt`↔`updated_at`.

- [ ] **Step 1:** Add a signed-out view, replacing `#app` and hiding the tabs:
  - email and password fields, and buttons for Sign in, Create account and Forgot password;
  - `signUp` shows "Check your email to confirm";
  - `resetPasswordForEmail(email, {redirectTo: location.origin})`;
  - on the `PASSWORD_RECOVERY` event, a new-password form calls `updateUser({password})`.
- [ ] **Step 2:** Replace the storage layer:
  - on sign-in, load the cache and pending entries, render, then `select *` from sessions and settings and set `state.sessions = mergeRemote(cache, remote, pending)`, then flush pending;
  - `persist` writes the cache, sets pending to `upsert` and debounces 350 ms into `upsert(toRow(s))`, clearing pending on success; `removeSession` does the same with `delete`;
  - on failure, keep pending and set `state.sync = 'slow'`;
  - retry the flush on `online`, on `visibilitychange` to visible, and every 30 s while anything is pending;
  - `saveCfg` upserts settings;
  - sync labels: `cloud` reads "Saved", `slow` reads "Offline · will sync", `connecting` reads "Connecting".
- [ ] **Step 3:** Remove every `window.claude` use. `offerFile` always downloads through `Blob`, `URL.createObjectURL` and `<a download>`, and `state.text` goes. `state.stray` holds old `raptor_v2_local` sessions missing from the account, and `move-stray` persists them and then clears `raptor_v2_local`. Add an Account card to `viewData` showing the email and a Sign out button. Rewrite the "Where your data lives" copy for the account.
- [ ] **Step 4: Verify:**
  - Run `node --test tests/`. Expected: pass.
  - Serve with `python3 -m http.server -d web 8080`, sign up, confirm the email, and log 3 shots by hand. `select jsonb_array_length(shots) from sessions` returns 3.
  - Reload: the shots are still there.
  - Turn on DevTools offline, log 1 shot, and reload. The header shows "Offline · will sync" and the shot is there.
  - Go back online. The row now has 4 shots.
  - A second account sees no sessions.

### Task 6: Scan and review flow

**Files:**
- Modify: `web/index.html`: `viewLog`, `editSheet`, the `edit-save`/`edit-del` handlers, the `change` listener, `state`, CSS for the review rows

**Interfaces:**
- Consumes: `sb` (Task 5); `labelFromTime`, `scanCheck`, `scanConflicts` and `mergeShots` (Task 2); the Task 4 response.
- Produces: `state.scan = {date, time, label, subtotal, sighter, shots:[{n,s,d}], separate:boolean, override:boolean, busy:boolean}` or null, and `shrink(file: File) -> Promise<Blob>`.

- [ ] **Step 1:** On the Log tab, add a "Scan scoreboard" label button for a hidden `<input type="file" id="scan" accept="image/*" capture="environment">`. It shows both before and during a session.
- [ ] **Step 2:** In the `change` listener for `#scan`:
  - `shrink`, base64, then `sb.functions.invoke('read-scoreboard', {body:{image, mime:'image/jpeg'}})`;
  - on success, set `state.scan` with `label = labelFromTime(time)`, or the active session's label when the date matches the active session;
  - on errors, toast the matching message: `daily_limit` is "Daily scan limit reached (60)", `busy` is "Gemini is busy, try again in a minute", and `unreadable` is "Couldn't read that photo. Try again closer and straighter";
  - while busy, show "Reading photo…".
- [ ] **Step 3:** When `state.scan` is set, `viewLog` renders the review instead of the pad:
  - date and label inputs at the top;
  - one row per shot (`n`, arrow glyph, score with the `t<tier>` class), where tapping opens `editSheet` in scan mode (`state.edit = {scan:true, n, …}`). `edit-save`/`edit-del` write to `state.scan.shots` when `E.scan`;
  - the `scanCheck` line: ok reads "Matches screen subtotal 95.7", a mismatch shows a `.note` warning "Shots add up to X, screen says Y. Check before saving.", and null reads "No subtotal on screen to check";
  - `scanConflicts` rows highlighted, with a choice between "Replace saved shots" and "Save as separate session (Other)";
  - for a sighter, a warning plus an override checkbox, with Save disabled until it's ticked;
  - the missing-shots note from `calc(mergeShots(...)).missing`;
  - the Global Constraints copy;
  - Save and Discard buttons.
- [ ] **Step 4:** Save resolves the target id with `makeId(date, separate ? 'Other' : label)`. If there's no such session, it creates one with `fired: cfg().planned`. Then it calls `persist(mergeShots(target, shots, time))`, clears `state.scan`, sets that session as `state.log.active`, and toasts "N shots saved to <nameOf>".
- [ ] **Step 5:** Run `node --test tests/`. Expected: pass.
- [ ] **Step 6: Manual check** with `score_image.jpg` on a phone-width viewport:
  - the review shows all 10 `REAL` shots with the correct arrows, "Matches screen subtotal 95.7", and Tue 4 Nov · Morning;
  - edit shot 13's arrow, confirm the date field is editable, and save;
  - the session holds shots 11–20, and the missing note lists 1–10 and 21–60;
  - scan again: no conflicts show, because the values are identical;
  - change one shot in review, and it's highlighted as a conflict.

### Task 7: Deploy

**Files:** none new. Vercel is linked to `web/`.

- [ ] **Step 1:** Run `npx vercel@latest deploy web --prod`. The owner runs `! npx vercel@latest login` first if needed. Expected: a production URL.
- [ ] **Step 2:** In Supabase Auth URL settings (dashboard, Authentication → URL Configuration; the owner does this unless the MCP exposes it), set the Site URL to the Vercel URL and add it to the redirect URLs.
- [ ] **Step 3:** On the production URL, sign up a fresh account, confirm by email, scan `score_image.jpg` and save. Check the session in a fresh browser.
- [ ] **Step 4:** Tell the owner what's left: test at least five more scoreboard photos (different glare and angles, a partial series, many 10.x scores), and rotate the Gemini key, which was pasted in chat, then reset the secret.
