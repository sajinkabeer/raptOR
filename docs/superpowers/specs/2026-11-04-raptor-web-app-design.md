# raptOR web app: accounts, Supabase history, scoreboard photo import

Date: 2026-11-04 · Status: draft for review

## Why

Today the owner photographs the electronic scoreboard after each series. Claude chat turns the photos into an Excel sheet, and every time they upload their **entire** history plus today's shots into raptOR so it can compare sessions. They want past sessions saved once, and to add only today's shots, by photo, straight from the app.

Direction arrows matter very much. They tell a shooter where shots land, which is how they correct their shot. A reading that gets arrows wrong is worse than no reading.

## Goals

- Any shooter can sign up and keep their own private history.
- History lives in Supabase (project ref `kmxjerumxxcszvpiiixc`). A session is added once and is never re-uploaded.
- A photo of the scoreboard turns into saved shots: shot number, score and direction. The shooter reviews the reading before it is saved.
- Every comparison and chart raptOR has today keeps working against the stored history.

## Non-goals (for now)

- Sharing between shooters, coach views, leaderboards.
- Keeping the photos themselves after reading.
- A native mobile app.
- Paid Gemini.

## Anti-goals (a failure even if it "works")

- A wrong arrow or score saved without the shooter having a chance to catch it.
- A shooter seeing or changing another shooter's data.
- Losing shots logged at the range because the signal dropped.
- The Gemini key reachable from the browser.

## What exists

`raptOR.html` is a single-file, vanilla-JS phone app (see `CLAUDE.md`). It has tabs for Summary, Log, Sessions, Trends and Data, plus shot-by-shot entry with direction pads, Excel/CSV/JSON import and export, and all the metrics.
- Storage today is the Claude Artifact `db`, falling back to localStorage. It sits behind `initStore`, `persist`, `removeSession` and `saveCfg`.
- A session is `{id, date, label, fired, shots:[{n,s,d}], seriesTimes, screenTotal, note, createdAt, updatedAt}`, with `id = date_label`.

## Decided by the owner

- Photo reading uses **Google Gemini on the free tier**. The owner's key is in `.env.local` (`GEMINI_API_KEY`). It was also pasted into chat, so rotate it before launch.
- OCR.space was tested and rejected: it got 10/10 scores right but only 6/10 arrows.
- **Supabase** for accounts and data. **Other shooters can sign up**, with sign-up open to anyone; fewer than 5 users are expected for now.
- **Everyone uses the same scoreboard model.**
- **One photo per series of 10.** Some photos will show fewer than 10 shots, such as the end of a session or a mid-series photo.

## Test evidence

Photo: `score_image.jpg`, showing shots 11–20, 4.11.2026 08:33, subtotal 95.7.
- `gemini-3.5-flash` (served as 3.6-flash) and `gemini-3.5-flash-lite` both returned all 10 shot numbers, arrows and scores correctly, plus the date, time and subtotal, as JSON.
- `gemini-3.8-flash` and `gemini-flash-latest` returned 503 "high demand".
- `gemini-2.5-flash` returned 404: no longer offered to new users.
- The prompt and request shape that worked are in the session scratchpad, `gemini_test.py`. In short: image plus instructions, `responseMimeType: application/json`, `temperature: 0`, and a prompt telling the model to use the subtotal printed **below** the listed shots. The screen also shows the previous series' subtotal above the list.

This is one photo. Before launch, test at least five more, covering different glare, angles, a partial series and a 10.x-heavy series.

## Design

### Accounts and data (my calls)

- Supabase Auth with email and password, email confirmation, and a reset-password flow.
- Tables, all with RLS `user_id = auth.uid()` for select, insert, update and delete:
  - `sessions`: `user_id`, `id` (the existing `date_label` text id; primary key `(user_id, id)`), `date`, `label`, `fired`, `shots jsonb`, `series_times jsonb`, `screen_total`, `note`, `created_at`, `updated_at`. Shots stay as JSON in the row, matching the existing model, so `calc()` and the views don't change.
  - `settings`: `user_id` primary key, `tens`, `mark`, `planned`.
- The browser uses supabase-js with the public anon key. The anon key is safe in the page; RLS is what protects the data.
- Swap the storage layer only: `initStore`, `persist`, `removeSession`, `saveCfg` and the sync indicator. Keep the existing localStorage mirror as a write-ahead cache. Write locally first, push to Supabase, and keep unsynced sessions queued and retried, so a dead signal at the range loses nothing. The existing "updatedAt wins while a write is pending" merge rule carries over.
- Remove the Claude Artifact paths (`window.claude.use`). File export falls back to a normal browser download.
- Existing history gets in through the existing import: sign in, import the current Excel file once, and it lands in the account.

### Photo import (my calls)

1. On the Log tab, a "Scan scoreboard" button opens `<input type="file" accept="image/*" capture="environment">`.
2. The browser shrinks the photo to about 1600px on the long side as JPEG. The test used this size.
3. It posts to a Supabase Edge Function, `read-scoreboard`, with the user's session token.
4. The Edge Function:
   - rejects unauthenticated calls;
   - applies a per-user daily cap, so the shared free quota can't be drained by one account (a number like 60/day is the builder's call);
   - calls Gemini with a fallback list (`gemini-3.5-flash`, then `gemini-3.5-flash-lite`, then whatever is current), retrying on 503/429;
   - **validates** the reply: `n` is an integer from 1 to 200, the score is 0.0–10.9 with one decimal, the direction is one of the 8 arrows or empty, and the date is a real date;
   - returns `{date, time, subtotal, shots:[{n, dir, score}]}` and stores nothing.
   The Gemini key is a Supabase secret.
5. A review screen shows the reading before anything is saved:
   - each shot with its score tier colour and arrow, editable with the existing whole/decimal/direction pads;
   - the **subtotal check**: the sum of the read shots compared with the screen subtotal, shown as a match or a clear warning, or "no subtotal to check" when absent;
   - the target session: the date comes from the photo; the label comes from the time (before 12:00 Morning, 12–17 Afternoon, after that Evening), and the shooter can change either;
   - any shot that would **replace** an already-saved shot with a different value, highlighted;
   - a missing-shots note against the session's match length, such as "shots 31–40 not logged yet".
6. Saving merges by shot number into that session, with the newer reading winning, then persists. Photos can arrive in any order.
7. Two sessions with the same date and label would share an id. If a scan's shot numbers already exist in the target session with different values, the review screen offers "save as a separate session" (label Other) alongside "replace". This is my call.
8. The prompt also asks Gemini to flag a sighter screen. A flagged photo shows a warning and isn't saved as match shots unless the shooter overrides it. The existing Excel import already skips sighters. This is my call.
9. A one-line note on the scan screen says photos are sent to Google Gemini's free tier, where Google may use them to improve its products.

The merge-and-check logic goes in the global metrics block, which can be tested in Node (see `CLAUDE.md`), with a small self-check covering a partial series, a replaced shot and a subtotal mismatch.

### Hosting (my call)

- The static site goes on Vercel's free plan, with the Edge Function on Supabase.
- `.env.local` and the Gemini key are never deployed or committed.

## Left to the builder

- File layout: keep one HTML file or split CSS/JS; the supabase-js loading method (pin an exact version).
- The exact daily cap, the retry/backoff timings and the Gemini prompt wording, keeping the tested shape.
- Visual design of the review screen, within the existing look (see `CLAUDE.md` styling conventions).
- Sign-in screen layout.

## Open questions for the owner

None left. Answered 2026-11-04:
- **Sign-up is open to anyone.** Fewer than 5 users are expected for now, so no invites or allow-list are needed. The per-user daily cap is the only quota protection.
- **Every shooter uses the same scoreboard model** as `score_image.jpg`. The prompt can be written for that layout, and launch testing only needs photos from that screen.
