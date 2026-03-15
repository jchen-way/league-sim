# Game Simulator

A Vite + React + TypeScript game simulator built from the local `.agents` requirements.

## Features

- Create and delete teams
- Start seasons with an auto-generated round-robin schedule
- Simulate the next round or the full remaining season
- Track season standings and cumulative all-time stats
- Export teams and season tables to CSV
- Export teams, seasons, and all-time stats to Excel

## Run

```bash
npm install
npm run dev
```

## Production

```bash
npm install
npm run build
npm start
```

The production server serves the built frontend from `dist/` and the API from the same Node process.

## Deploy

This repo includes [render.yaml](/Users/jiaweichen/Downloads/game-sim/render.yaml) for a Render web service with a persistent disk mounted at `data/` for the SQLite database.
