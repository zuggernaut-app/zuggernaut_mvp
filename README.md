# Zuggernaut MVP

Monorepo for the Zuggernaut V1 MVP: Node.js backend and React (Vite) frontend.

## Layout

| Path | Purpose |
|------|---------|
| `backend/` | Express API, MongoDB (Mongoose), Pino logging, Temporal client/worker packages |
| `frontend/` | React + TypeScript SPA (Vite) |

See `mvp_implementation_plan.md` for phased implementation details.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (LTS recommended; match Vite/engine warnings)
- MongoDB reachable at the URI you set (local or Atlas)

## Backend

```powershell
cd backend
# Create `backend/.env` with PORT, MONGODB_URI, etc. (see plan; do not commit secrets)
npm install
npm start
```

Default URL: `http://localhost:3000` (or `PORT` from `.env`).

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

Dev server defaults to `http://localhost:5173`. Production build: `npm run build`.

Set `VITE_API_BASE_URL` in `frontend/.env` if the API base URL differs from `http://localhost:3000`.

## Environment

- **Backend:** `backend/.env` — never commit secrets. Root `.gitignore` ignores `.env`.
- **Frontend:** `frontend/.env` — use `VITE_*` prefixes for variables exposed to the client.

## Git remote

Remote: `https://github.com/zuggernaut-app/zuggernaut_mvp.git`

After cloning, install dependencies in both `backend` and `frontend` before running.
