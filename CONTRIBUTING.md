# Contributing

## Setup

Requirements: Python 3.12+.

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

The API runs on <http://localhost:8000>. Local development uses SQLite and
`DEV_MODE=true`, so no account is needed.

To serve the frontend from the backend instead of a separate static server:

```bash
FRONTEND_DIR=../frontend uvicorn app.main:app --reload
```

## Frontend

The frontend is plain HTML/CSS/JS with no build step. Serve `frontend/` with any
static server, for example:

```bash
python -m http.server 5500 --directory frontend
```

Then open <http://localhost:5500>. `frontend/static/js/config.js` points to
`http://localhost:8000` by default.

## Checks

Run these before opening a pull request:

```bash
cd backend
ruff check .
pytest -q
```

## Guidelines

- Keep the stack small: no frontend framework and no build step without a clear
  reason.
- Match the existing black-and-white monospace design.
- Add or update tests for backend behaviour changes.
- Do not commit secrets, `.env` files, or database files.
- Keep pull requests focused. Describe the problem and the change.
