---
name: Backend Architecture Guidelines
description: Best practices for data modeling and API design.
---

# Backend Architecture Guidelines

## Database Schema Design
- **Teams Table**: `id`, `name`, `createdAt`.
- **Seasons Table**: `id`, `name`, `status` (active/completed).
- **Matches/Rounds Table**: Links teams together for specific dates/rounds.
- **Statistics Table**: Stores wins, losses, scores per team per season.

## API Endpoints
- Organize routes logically (e.g., `/api/teams`, `/api/seasons`, `/api/simulate`).
- Ensure the simulation logic is robust, handling transactions safely to prevent partial data updates if a simulation fails midway.

## Export Logic
- Generate CSV/Excel files efficiently on the server side and stream the response to the client or provide a download URL.
