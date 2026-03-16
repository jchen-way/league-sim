# LeagueSim

LeagueSim is a football league simulator with account-based workspaces, season management, match simulation, standings, and CSV exports.

## Features

- Sign up and log in
- User-scoped teams, seasons, and match data
- Club management with auto-generated player squads
- Season creation with round-robin scheduling
- Round-by-round or full-season simulation
- Season and all-time standings
- Match timelines with goals, cards, and substitutions
- CSV exports for season, round, team, and all-time data

## Local Run

LeagueSim requires Postgres.

1. Start Postgres and create a database, for example `game_sim`.
2. Copy `.env.example` to `.env`.
3. Update `DATABASE_URL` if needed.
4. Install dependencies and start the app:

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` starts the API and Vite together. Open the local URL shown in the terminal, create an account, and start building a league.

Docker example:

```bash
docker run --name game-sim-postgres \
  -e POSTGRES_DB=game_sim \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgres:16
```

## Local Verification

Use these commands:

```bash
npm run build
curl http://127.0.0.1:8787/api/health
```

There is no dedicated automated test suite yet, so `npm run build` is the main verification check.

## CSV Exports

- `Season + Matches CSV`
- `All-Time Table CSV`
- `Team CSV`
- Round-level CSV export via API

## Render

The repo includes [render.yaml](./render.yaml) for Render deployment with:

- a Node web service
- a Postgres database
- `npm ci && npm run build`
- `npm start`
- `/api/health` health check

## Production Commands

```bash
npm install
npm run build
npm start
```

The production server serves the built frontend from `dist/` and the API from the same Node process.
