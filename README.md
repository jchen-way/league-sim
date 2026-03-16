# Game Simulator

A Vite + React + TypeScript football league simulator with a Node API and Postgres persistence.

## Features

- Create and delete clubs
- Create and delete seasons with auto-generated round-robin schedules
- Simulate the next round or the full remaining season
- Track per-season and all-time standings
- Track football stats including goals, shots on target, and possession
- Export season, round, all-time, and per-team stats as CSV

## Local Run

This app now requires Postgres. Set `DATABASE_URL` before starting the API.

Example:

```bash
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/game_sim"
npm install
npm run dev
```

`npm run dev` starts the Node API and Vite together. The backend auto-creates its schema on startup.

## Production

```bash
npm install
npm run build
npm start
```

The production server serves the built frontend from `dist/` and the API from the same Node process.
