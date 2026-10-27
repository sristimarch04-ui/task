# Reimbursement Claims System

Full-stack demo based on `Live task Reimbursement claims API.pdf`.

## Requirements
- Node.js 20+
- npm

## Run
Open two terminals:

### API
```bash
cd backend
npm install
npm run dev
```
API runs at http://localhost:4000. Health check: `GET /health`.

### UI
```bash
cd frontend
npm install
npm run dev
```
Open the Vite URL shown in the terminal (usually http://localhost:5173).

The UI switches demo identity using the role selector. The API treats `X-User-Id` as already authenticated, as required by the exercise. This is a demo-only authentication assumption, not production authentication.

## Seed identities
- Asha — `u1` — employee
- Ravi — `u2` — employee
- Meera — `u3` — manager
- Farhan — `u4` — finance

## API endpoints
- `POST /claims` (requires `Idempotency-Key`)
- `GET /claims?status=&category=&page=&limit=`
- `GET /claims/:id`
- `POST /claims/:id/approve`
- `POST /claims/:id/reject` body `{ "reason": "..." }`
- `POST /claims/:id/pay`
- `POST /claims/:id/cancel`
- `GET /claims/:id/history`
- `GET /users`
- `GET /limits`

Errors use `{ "error": { "code": "...", "message": "..." } }`.

## Rules implemented
- New claims start as `SUBMITTED`.
- Only direct manager can approve/reject; manager cannot approve own claim.
- Rejection requires a reason.
- Finance can pay only `APPROVED` claims and sees only `APPROVED` / `PAID`.
- Employee can cancel only their own `SUBMITTED` claim.
- Employee sees own claims; manager sees direct reports' claims.
- Amount > 0 with at most 2 decimal places; allowed categories from limits.
- Expense date must not be in the future or older than 60 days.
- Monthly limits are scoped to employee + category + calendar month. `REJECTED` and `CANCELLED` don't count.
- Idempotency key prevents duplicate claim creation for the same user/key and same request body.
- Every status change is appended to claim history with actor, timestamp, old/new status and optional reason.
- Pagination max is 50.

## Important design note
Storage is in-memory as allowed by the brief. Data resets when the API process restarts. For production, replace it with a database and use a database transaction/locking or a conditional atomic write for monthly-limit enforcement and idempotency.


## Deploy online (single service)
The API serves the built UI, so one service hosts everything (UI and API on the same URL).
- **Render**: push to GitHub, then New + -> Blueprint (uses `render.yaml`).
- **Anything else** (Railway, Fly.io, Koyeb): deploy the included `Dockerfile`; it listens on `$PORT`.
Data is in-memory and resets on restart. `X-User-Id` is demo-only auth.
