# Frontend

React 19 + TypeScript (strict) + Vite, in `frontend/`. It talks to the API through a dev proxy
(`/api` → `localhost:8000`), so there is no CORS setup.

## Run

```bash
# terminal 1 (repo root)
uvicorn app.main:app --host 0.0.0.0 --port 8000
# terminal 2
cd frontend && npm install && npm run dev      # http://localhost:5173
npm test            # vitest + testing-library
npm run typecheck
npm run build
```

In Codespaces, open the forwarded port 5173. To point at another API set `VITE_API_BASE`.

## Pages

- **Customers**: list, create (blank/whitespace names rejected before any request).
- **Plans**: create with a tier editor, readable tier summary, and a price calculator (calls `/plans/{id}/quote`).
- **Customer**: subscriptions (start / change plan / end), usage (record, retry, history), invoices (generate, list).

## Design decisions

- **Money is never a float.** The API sends decimals as strings; the UI keeps them as strings, compares them
  with `compareDecimal`, and uses `Intl` only to display. (`src/lib/money.ts`)
- **Safe retries.** The usage form's idempotency key changes only after a success. A failed or unanswered
  request keeps the key, so pressing the button again can't double-count. "Retry the same request" re-sends the
  last request and the UI says *Already recorded* when the API answers 200 instead of 201.
  Invoice generation distinguishes *created* (201) from *already issued* (200).
- **Double-submit guard** in `useSubmit`, independent of the disabled button.
- **Errors tell you what to do next.** `describeError` (`src/lib/errors.ts`) maps every API error code to a
  title and a hint; validation errors are placed on the field they name (`tiers.1.up_to`); network failures say
  the API may be down; unknown codes fall back to the server's message plus the code to quote.
- **Client validation mirrors server rules** (`src/lib/planForm.ts`) for fast feedback; the server stays the
  authority and its errors render too.
- **Loading / empty / failure states** for every list, with a retry button. Stale responses can't overwrite
  newer ones (`useAsync`).
- **All times are UTC** and labelled as such; billing months are UTC calendar months.
- Accessible forms (labels, `aria-invalid`, `aria-describedby`), light/dark theme, works at phone width.

## Tests

50 tests: pure helpers, API client (mocked fetch), form validation, hooks, and page-level tests that run the
real components against a mocked API (error mapping, duplicate retries, key retention after failure, 201 vs 200).
