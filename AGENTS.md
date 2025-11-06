# Repository Guidelines

## Project Structure & Module Organization
- `backend/` hosts the FastAPI service: `main.py` exposes APIs, `lock.py` coordinates seat holds, `parser.py` ingests the Excel chart, and `models.py`/`schemas.py` define shared types.
- `frontend/` is the Vite + React + TypeScript client (`src/App.tsx`, reusable UI in `src/components/`, API helpers in `src/lib/`).
- `data/` stores generated artifacts (`seats.db`, `seats.json`) plus the spreadsheet source; regenerate rather than editing manually.
- `tools/dev.py` starts both servers with env defaults (`BACKEND_PORT`, `FRONTEND_PORT`); root also carries `.env.example` and the `Makefile`.

## Build, Test, and Development Commands
- `make init` creates the virtualenv, installs backend deps, and runs `backend.parser` to rebuild SQLite and JSON.
- `make dev` launches FastAPI reload alongside the Vite dev server.
- `python -m backend.parser --excel data/<source>.xlsx` refreshes seats after layout tweaks.
- `uvicorn backend.main:app --reload --port 8000` runs the API alone.
- From `frontend/`, `npm run dev` serves the client and `npm run build` type-checks then bundles for production.

## Coding Style & Naming Conventions
- Python uses four-space indents, type hints on new endpoints, and `snake_case`; keep SQLAlchemy models and Pydantic schemas in `PascalCase`.
- Acquire sessions via `backend.database.get_session`, and keep hold coordination inside `lock.py`.
- TypeScript components live in `PascalCase.tsx`, utilities in `src/lib/*.ts`, and props/state stay `camelCase`; split SVG-heavy logic into focused pieces.
- No formatter is enforced, so verify any `black`, `ruff`, or `prettier` output keeps the existing wrapping (about 100 columns).

## Testing Guidelines
- Place backend tests under `backend/tests/test_*.py` with `pytest`; exercise `backend.main.app` through `httpx.AsyncClient` and seed temporary SQLite state to cover conflict paths.
- Add regression checks for Redis-disabled hold races so conflict payloads surface instead of raw integrity errors.
- Frontend tests should lean on Vitest with React Testing Library; snapshot only stable SVG regions and call out manual QA in the PR when automation is missing.

## Commit & Pull Request Guidelines
- Git history is unavailable here, so follow Conventional Commits (`feat:`, `fix:`, `chore:`) with imperative, <=72 character subjects and body context for nuances.
- Keep PRs focused, describe intent, list verification steps (`pytest`, manual browsers, Redis toggles), and link issues or tasks.
- Share before/after visuals for UI updates and highlight follow-up commands such as `python -m backend.parser`.
