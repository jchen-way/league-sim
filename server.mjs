import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const SESSION_COOKIE = "gamesim_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

loadEnvFile(join(__dirname, ".env"));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Configure a Postgres connection before starting the server.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

await initSchema();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";

  try {
    if (method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }

    if (method === "GET" && url.pathname === "/api/me") {
      const user = await getSessionUser(request);
      return sendJson(response, 200, { user });
    }

    if (method === "POST" && url.pathname === "/api/auth/signup") {
      const body = await readJson(request);
      const name = String(body?.name ?? "").trim();
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");

      if (!name) {
        return sendJson(response, 400, { error: "Name is required." });
      }
      if (!isValidEmail(email)) {
        return sendJson(response, 400, { error: "A valid email is required." });
      }
      if (password.length < 8) {
        return sendJson(response, 400, { error: "Password must be at least 8 characters." });
      }

      const user = await createUserAccount({ name, email, password });
      await persistSession(response, user.id);
      return sendJson(response, 201, { user });
    }

    if (method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJson(request);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");

      const user = await validateUserCredentials(email, password);
      await persistSession(response, user.id);
      return sendJson(response, 200, { user });
    }

    if (method === "POST" && url.pathname === "/api/auth/logout") {
      const sessionId = getSessionId(request);
      if (sessionId) {
        await deleteSession(sessionId);
      }
      clearSessionCookie(response);
      return sendJson(response, 200, { ok: true });
    }

    if (method === "GET" && url.pathname === "/api/state") {
      const user = await requireSession(request);
      return sendJson(response, 200, await loadState(user.id));
    }

    if (method === "POST" && url.pathname === "/api/teams") {
      const user = await requireSession(request);
      const body = await readJson(request);
      const name = String(body?.name ?? "").trim();
      if (!name) {
        return sendJson(response, 400, { error: "Team name is required." });
      }

      await createTeam(user.id, name);
      return sendJson(response, 201, await loadState(user.id));
    }

    if (method === "PATCH" && /^\/api\/teams\/[^/]+$/.test(url.pathname)) {
      const user = await requireSession(request);
      const teamId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const body = await readJson(request);
      const name = String(body?.name ?? "").trim();
      if (!name) {
        return sendJson(response, 400, { error: "Team name is required." });
      }

      await updateTeam(user.id, teamId, name);
      return sendJson(response, 200, await loadState(user.id));
    }

    if (method === "DELETE" && /^\/api\/teams\/[^/]+$/.test(url.pathname)) {
      const user = await requireSession(request);
      const teamId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      await deleteTeam(user.id, teamId);
      return sendJson(response, 200, await loadState(user.id));
    }

    if (method === "POST" && url.pathname === "/api/seasons") {
      const user = await requireSession(request);
      const body = await readJson(request);
      const name = String(body?.name ?? "").trim();
      if (!name) {
        return sendJson(response, 400, { error: "Season name is required." });
      }

      await createSeasonRecord(user.id, name);
      return sendJson(response, 201, await loadState(user.id));
    }

    if (method === "DELETE" && /^\/api\/seasons\/[^/]+$/.test(url.pathname)) {
      const user = await requireSession(request);
      const seasonId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      await deleteSeason(user.id, seasonId);
      return sendJson(response, 200, await loadState(user.id));
    }

    if (method === "POST" && /^\/api\/seasons\/[^/]+\/simulate-round$/.test(url.pathname)) {
      const user = await requireSession(request);
      const seasonId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      await simulateRoundRecord(user.id, seasonId);
      return sendJson(response, 200, await loadState(user.id));
    }

    if (method === "POST" && /^\/api\/seasons\/[^/]+\/simulate-season$/.test(url.pathname)) {
      const user = await requireSession(request);
      const seasonId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      await simulateSeasonRecord(user.id, seasonId);
      return sendJson(response, 200, await loadState(user.id));
    }

    if (method === "GET" && /^\/api\/export\/seasons\/[^/]+\.csv$/.test(url.pathname)) {
      const user = await requireSession(request);
      const seasonId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "").replace(/\.csv$/, "");
      const state = await loadState(user.id);
      const season = state.seasons.find((entry) => entry.id === seasonId);
      if (!season) {
        return sendJson(response, 404, { error: "Season not found." });
      }

      return sendCsv(response, `${slugify(season.name)}-stats.csv`, buildSeasonExportRows(season, state.teams));
    }

    if (method === "GET" && /^\/api\/export\/seasons\/[^/]+\/rounds\/\d+\.csv$/.test(url.pathname)) {
      const user = await requireSession(request);
      const [, , , seasonIdToken, , roundToken] = url.pathname.split("/");
      const seasonId = decodeURIComponent(seasonIdToken);
      const roundNumber = Number(roundToken.replace(/\.csv$/, ""));
      const state = await loadState(user.id);
      const season = state.seasons.find((entry) => entry.id === seasonId);
      if (!season) {
        return sendJson(response, 404, { error: "Season not found." });
      }

      return sendCsv(response, `${slugify(season.name)}-round-${roundNumber}.csv`, buildRoundExportRows(season, state.teams, roundNumber));
    }

    if (method === "GET" && url.pathname === "/api/export/all-time.csv") {
      const user = await requireSession(request);
      const state = await loadState(user.id);
      const rows = [statsHeaderRow(), ...buildAllTimeStats(state.seasons, state.teams).map(statsRowToCsv)];
      return sendCsv(response, "all-time-stats.csv", rows);
    }

    if (method === "GET" && /^\/api\/export\/teams\/[^/]+\.csv$/.test(url.pathname)) {
      const user = await requireSession(request);
      const teamId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "").replace(/\.csv$/, "");
      const state = await loadState(user.id);
      const team = state.teams.find((entry) => entry.id === teamId);
      if (!team) {
        return sendJson(response, 404, { error: "Team not found." });
      }

      return sendCsv(response, `${slugify(team.name)}-stats.csv`, buildTeamExportRows(teamId, state));
    }

    if (method === "GET" || method === "HEAD") {
      return serveStaticAsset(response, url.pathname, method === "HEAD");
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    sendJson(response, 400, { error: message });
  }
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position TEXT NOT NULL CHECK (position IN ('GK', 'DF', 'MF', 'FW')),
      squad_number INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed'))
    );

    CREATE TABLE IF NOT EXISTS season_teams (
      season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
      position INTEGER NOT NULL,
      PRIMARY KEY (season_id, team_id)
    );

    CREATE TABLE IF NOT EXISTS rounds (
      season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      simulated_at TIMESTAMPTZ,
      PRIMARY KEY (season_id, number)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL,
      home_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
      away_team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
      home_score INTEGER,
      away_score INTEGER,
      home_shots_on_target INTEGER,
      away_shots_on_target INTEGER,
      home_possession_seconds INTEGER,
      away_possession_seconds INTEGER,
      played_at TIMESTAMPTZ,
      winner_team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS match_events (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      minute INTEGER NOT NULL,
      stoppage_minute INTEGER,
      type TEXT NOT NULL CHECK (type IN ('goal', 'yellow_card', 'red_card', 'substitution')),
      player_name TEXT NOT NULL,
      secondary_player_name TEXT
    );
  `);

  await pool.query(`
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE seasons ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE match_events ADD COLUMN IF NOT EXISTS player_id TEXT;
    ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_name_key;
    CREATE UNIQUE INDEX IF NOT EXISTS teams_user_id_name_key ON teams (user_id, name) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS players_team_id_squad_number_key ON players (team_id, squad_number);
  `);
}

async function createUserAccount({ name, email, password }) {
  const existing = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
  if (existing.rowCount) {
    throw new Error("An account with that email already exists.");
  }

  const user = {
    id: createId("user"),
    name,
    email,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };

  await pool.query(
    "INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
    [user.id, user.name, user.email, user.passwordHash, user.createdAt],
  );

  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

async function validateUserCredentials(email, password) {
  if (!isValidEmail(email)) {
    throw new Error("A valid email is required.");
  }

  const result = await pool.query(
    "SELECT id, name, email, password_hash, created_at FROM users WHERE email = $1",
    [email],
  );
  const row = result.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new Error("Invalid email or password.");
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function getSessionUser(request) {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    return null;
  }

  const result = await pool.query(
    `SELECT users.id, users.name, users.email, users.created_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = $1 AND sessions.expires_at > NOW()`,
    [sessionId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function requireSession(request) {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Error("Please log in to continue.");
  }
  return user;
}

async function persistSession(response, userId) {
  const sessionId = createToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await pool.query(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    [sessionId, userId, now.toISOString(), expiresAt.toISOString()],
  );

  setSessionCookie(response, sessionId, expiresAt);
}

async function deleteSession(sessionId) {
  await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

async function loadState(userId) {
  return {
    teams: await loadTeams(userId),
    seasons: await loadSeasons(userId),
  };
}

async function loadTeams(userId) {
  const result = await pool.query(
    "SELECT id, name, created_at FROM teams WHERE user_id = $1 ORDER BY created_at ASC, name ASC",
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

async function loadPlayers(userId) {
  const result = await pool.query(
    `SELECT players.id, players.team_id, players.name, players.position, players.squad_number, players.created_at
     FROM players
     JOIN teams ON teams.id = players.team_id
     WHERE teams.user_id = $1
     ORDER BY teams.created_at ASC, players.squad_number ASC, players.name ASC`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    position: row.position,
    squadNumber: row.squad_number,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

async function loadSeasons(userId) {
  const [seasonsRes, seasonTeamsRes, roundsRes, matchesRes, matchEventsRes] = await Promise.all([
    pool.query("SELECT id, name, created_at, status FROM seasons WHERE user_id = $1 ORDER BY created_at DESC, name ASC", [userId]),
    pool.query(`
      SELECT season_teams.season_id, season_teams.team_id, season_teams.position
      FROM season_teams
      JOIN seasons ON seasons.id = season_teams.season_id
      WHERE seasons.user_id = $1
      ORDER BY season_teams.season_id, season_teams.position ASC
    `, [userId]),
    pool.query(`
      SELECT rounds.season_id, rounds.number, rounds.simulated_at
      FROM rounds
      JOIN seasons ON seasons.id = rounds.season_id
      WHERE seasons.user_id = $1
      ORDER BY rounds.season_id, rounds.number ASC
    `, [userId]),
    pool.query(`
      SELECT id, season_id, round_number, home_team_id, away_team_id, home_score, away_score,
             home_shots_on_target, away_shots_on_target, home_possession_seconds, away_possession_seconds,
             played_at, winner_team_id
      FROM matches
      WHERE season_id IN (SELECT id FROM seasons WHERE user_id = $1)
      ORDER BY season_id, round_number ASC, id ASC
    `, [userId]),
    pool.query(`
      SELECT match_events.id, match_events.match_id, match_events.team_id, match_events.player_id, match_events.minute, match_events.stoppage_minute,
             match_events.type, match_events.player_name, match_events.secondary_player_name
      FROM match_events
      JOIN matches ON matches.id = match_events.match_id
      JOIN seasons ON seasons.id = matches.season_id
      WHERE seasons.user_id = $1
      ORDER BY matches.season_id, matches.round_number ASC, match_events.minute ASC, match_events.stoppage_minute ASC NULLS FIRST, match_events.id ASC
    `, [userId]),
  ]);

  return seasonsRes.rows.map((season) => ({
    id: season.id,
    name: season.name,
    createdAt: new Date(season.created_at).toISOString(),
    status: season.status,
    teamIds: seasonTeamsRes.rows.filter((row) => row.season_id === season.id).map((row) => row.team_id),
    rounds: roundsRes.rows
      .filter((row) => row.season_id === season.id)
      .map((row) => ({
        number: row.number,
        simulatedAt: row.simulated_at ? new Date(row.simulated_at).toISOString() : null,
        matchIds: matchesRes.rows
          .filter((match) => match.season_id === season.id && match.round_number === row.number)
          .map((match) => match.id),
      })),
    matches: matchesRes.rows
      .filter((row) => row.season_id === season.id)
      .map((row) => ({
        id: row.id,
        roundNumber: row.round_number,
        homeTeamId: row.home_team_id,
        awayTeamId: row.away_team_id,
        homeScore: row.home_score,
        awayScore: row.away_score,
        homeShotsOnTarget: row.home_shots_on_target,
        awayShotsOnTarget: row.away_shots_on_target,
        homePossessionSeconds: row.home_possession_seconds,
        awayPossessionSeconds: row.away_possession_seconds,
        playedAt: row.played_at ? new Date(row.played_at).toISOString() : null,
        winnerTeamId: row.winner_team_id,
        events: matchEventsRes.rows
          .filter((event) => event.match_id === row.id)
          .map((event) => ({
            id: event.id,
            matchId: event.match_id,
            teamId: event.team_id,
            playerId: event.player_id,
            minute: event.minute,
            stoppageMinute: event.stoppage_minute,
            type: event.type,
            playerName: event.player_name,
            secondaryPlayerName: event.secondary_player_name,
          })),
      })),
  }));
}

async function createTeam(userId, name) {
  const teamId = createId("team");
  const createdAt = new Date().toISOString();
  const squad = generatePlayersForTeam(teamId, name);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO teams (id, name, user_id, created_at) VALUES ($1, $2, $3, $4)",
      [teamId, name, userId, createdAt],
    );

    for (const player of squad) {
      await client.query(
        "INSERT INTO players (id, team_id, name, position, squad_number, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [player.id, player.teamId, player.name, player.position, player.squadNumber, player.createdAt],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateTeam(userId, teamId, name) {
  const result = await pool.query("UPDATE teams SET name = $1 WHERE id = $2 AND user_id = $3", [name, teamId, userId]);
  if (result.rowCount === 0) {
    throw new Error("Team not found.");
  }
}

async function deleteTeam(userId, teamId) {
  const usage = await pool.query(
    `SELECT 1
     FROM season_teams
     JOIN seasons ON seasons.id = season_teams.season_id
     WHERE season_teams.team_id = $1 AND seasons.user_id = $2
     LIMIT 1`,
    [teamId, userId],
  );
  if (usage.rowCount) {
    throw new Error("This team is already used in a season and cannot be removed.");
  }

  const result = await pool.query("DELETE FROM teams WHERE id = $1 AND user_id = $2", [teamId, userId]);
  if (result.rowCount === 0) {
    throw new Error("Team not found.");
  }
}

async function createSeasonRecord(userId, name) {
  const teams = await loadTeams(userId);
  if (teams.length < 2) {
    throw new Error("At least two teams are required to create a season.");
  }

  const season = createSeasonShape(name, teams);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO seasons (id, name, user_id, created_at, status) VALUES ($1, $2, $3, $4, $5)",
      [season.id, season.name, userId, season.createdAt, season.status],
    );

    for (const [index, teamId] of season.teamIds.entries()) {
      await client.query(
        "INSERT INTO season_teams (season_id, team_id, position) VALUES ($1, $2, $3)",
        [season.id, teamId, index],
      );
    }

    for (const round of season.rounds) {
      await client.query(
        "INSERT INTO rounds (season_id, number, simulated_at) VALUES ($1, $2, $3)",
        [season.id, round.number, round.simulatedAt],
      );
    }

    for (const match of season.matches) {
      await client.query(
        `INSERT INTO matches (
          id, season_id, round_number, home_team_id, away_team_id, home_score, away_score,
          home_shots_on_target, away_shots_on_target, home_possession_seconds, away_possession_seconds,
          played_at, winner_team_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          match.id,
          season.id,
          match.roundNumber,
          match.homeTeamId,
          match.awayTeamId,
          match.homeScore,
          match.awayScore,
          match.homeShotsOnTarget,
          match.awayShotsOnTarget,
          match.homePossessionSeconds,
          match.awayPossessionSeconds,
          match.playedAt,
          match.winnerTeamId,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteSeason(userId, seasonId) {
  const result = await pool.query("DELETE FROM seasons WHERE id = $1 AND user_id = $2", [seasonId, userId]);
  if (result.rowCount === 0) {
    throw new Error("Season not found.");
  }
}

async function simulateRoundRecord(userId, seasonId) {
  const season = (await loadSeasons(userId)).find((entry) => entry.id === seasonId);
  if (!season) {
    throw new Error("Season not found.");
  }

  const players = await loadPlayers(userId);
  await persistSeasonMutation(userId, simulateRoundShape(season, players));
}

async function simulateSeasonRecord(userId, seasonId) {
  const season = (await loadSeasons(userId)).find((entry) => entry.id === seasonId);
  if (!season) {
    throw new Error("Season not found.");
  }

  const players = await loadPlayers(userId);
  let updated = season;
  while (getNextRound(updated)) {
    updated = simulateRoundShape(updated, players);
  }
  await persistSeasonMutation(userId, { ...updated, status: "completed" });
}

async function persistSeasonMutation(userId, season) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seasonUpdate = await client.query("UPDATE seasons SET status = $1 WHERE id = $2 AND user_id = $3", [season.status, season.id, userId]);
    if (seasonUpdate.rowCount === 0) {
      throw new Error("Season not found.");
    }

    for (const round of season.rounds) {
      await client.query(
        "UPDATE rounds SET simulated_at = $1 WHERE season_id = $2 AND number = $3",
        [round.simulatedAt, season.id, round.number],
      );
    }

    for (const match of season.matches) {
      const matchUpdate = await client.query(
        `UPDATE matches
         SET home_score = $1, away_score = $2, home_shots_on_target = $3, away_shots_on_target = $4,
             home_possession_seconds = $5, away_possession_seconds = $6, played_at = $7, winner_team_id = $8
         WHERE id = $9 AND season_id = $10`,
        [
          match.homeScore,
          match.awayScore,
          match.homeShotsOnTarget,
          match.awayShotsOnTarget,
          match.homePossessionSeconds,
          match.awayPossessionSeconds,
          match.playedAt,
          match.winnerTeamId,
          match.id,
          season.id,
        ],
      );
      if (matchUpdate.rowCount !== 1) {
        throw new Error("Match not found for season.");
      }

      await client.query("DELETE FROM match_events WHERE match_id = $1", [match.id]);

      for (const event of match.events ?? []) {
        if (event.teamId !== match.homeTeamId && event.teamId !== match.awayTeamId) {
          throw new Error("Match event team does not belong to the match.");
        }
        await client.query(
          `INSERT INTO match_events (id, match_id, team_id, player_id, minute, stoppage_minute, type, player_name, secondary_player_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            event.id,
            match.id,
            event.teamId,
            event.playerId,
            event.minute,
            event.stoppageMinute,
            event.type,
            event.playerName,
            event.secondaryPlayerName,
          ],
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function createSeasonShape(name, teams) {
  const teamIds = teams.map((team) => team.id);
  const schedule = createSchedule(teamIds);

  return {
    id: createId("season"),
    name,
    createdAt: new Date().toISOString(),
    status: "active",
    teamIds,
    rounds: schedule.rounds,
    matches: schedule.matches,
  };
}

function createSchedule(teamIds) {
  const sourceIds = [...teamIds];
  if (sourceIds.length < 2) {
    return { rounds: [], matches: [] };
  }
  if (sourceIds.length % 2 === 1) {
    sourceIds.push("bye");
  }

  let rotation = [...sourceIds];
  const rounds = [];
  const matches = [];
  const roundCount = rotation.length - 1;
  const half = rotation.length / 2;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const roundNumber = roundIndex + 1;
    const roundMatchIds = [];

    for (let matchIndex = 0; matchIndex < half; matchIndex += 1) {
      const homeTeamId = rotation[matchIndex];
      const awayTeamId = rotation[rotation.length - 1 - matchIndex];
      if (homeTeamId === "bye" || awayTeamId === "bye") {
        continue;
      }

      const match = {
        id: createId("match"),
        roundNumber,
        homeTeamId: roundIndex % 2 === 0 ? homeTeamId : awayTeamId,
        awayTeamId: roundIndex % 2 === 0 ? awayTeamId : homeTeamId,
        homeScore: null,
        awayScore: null,
        homeShotsOnTarget: null,
        awayShotsOnTarget: null,
        homePossessionSeconds: null,
        awayPossessionSeconds: null,
        playedAt: null,
        winnerTeamId: null,
        events: [],
      };

      matches.push(match);
      roundMatchIds.push(match.id);
    }

    rounds.push({ number: roundNumber, matchIds: roundMatchIds, simulatedAt: null });
    rotation = rotateTeamIds(rotation);
  }

  return { rounds, matches };
}

function rotateTeamIds(ids) {
  const next = [...ids];
  const fixed = next.shift();
  const tail = next.pop();
  return [fixed, tail, ...next];
}

function generatePlayersForTeam(teamId, teamName) {
  const firstNames = [
    "Alex", "Luca", "Noah", "Ethan", "Mason", "Leo", "Kai", "Mateo", "Julian", "Theo",
    "Roman", "Hugo", "Felix", "Adrian", "Jude", "Nico", "Oscar", "Dario", "Rafael", "Tomas",
    "Daniel", "Marco", "Ivan", "Jonah", "Caleb", "Victor", "Samir", "Matias", "Soren", "Elian",
  ];
  const lastNames = [
    "Silva", "Mendez", "Hart", "Ibrahim", "Costa", "Novak", "Reyes", "Keller", "Santos", "Muller",
    "Bennett", "Okafor", "Petrov", "Moretti", "Tanaka", "Walker", "Arias", "Cole", "Ferreira", "Dawson",
    "Navarro", "Lopez", "Rossi", "Yamada", "Barros", "Sule", "Nielsen", "Pereira", "Delgado", "Bauer",
  ];
  const layout = [
    ["GK", 1], ["DF", 2], ["DF", 3], ["DF", 4], ["DF", 5],
    ["MF", 6], ["MF", 7], ["MF", 8], ["MF", 10],
    ["FW", 9], ["FW", 11],
    ["GK", 12], ["DF", 13], ["DF", 14], ["MF", 15], ["MF", 16], ["FW", 17], ["FW", 18],
  ];

  const seed = [...`${teamId}:${teamName}`].reduce((total, character) => total + character.charCodeAt(0), 0);

  return layout.map(([position, squadNumber], index) => ({
    id: createId("player"),
    teamId,
    name: `${firstNames[(seed + index * 7) % firstNames.length]} ${lastNames[(seed * 3 + index * 11) % lastNames.length]}`,
    position,
    squadNumber,
    createdAt: new Date().toISOString(),
  }));
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildMinutePool(count) {
  const minutes = new Set();
  while (minutes.size < count) {
    const minute = 3 + Math.floor(Math.random() * 88);
    minutes.add(minute);
  }
  return [...minutes].sort((left, right) => left - right);
}

function getTeamPlayers(players, teamId) {
  return players.filter((player) => player.teamId === teamId);
}

function createGoalEvents(teamId, squad, count, minutes) {
  const scorers = squad.filter((player) => player.position !== "GK");
  return Array.from({ length: count }, (_, index) => {
    const scorer = pickRandom(scorers);
    return {
      id: createId("event"),
      matchId: "",
      teamId,
      playerId: scorer.id,
      minute: minutes[index],
      stoppageMinute: null,
      type: "goal",
      playerName: scorer.name,
      secondaryPlayerName: null,
    };
  });
}

function createCardEvents(teamId, squad, count, type, minutes) {
  const cardTargets = squad.filter((player) => player.position !== "GK");
  return Array.from({ length: count }, (_, index) => {
    const player = pickRandom(cardTargets);
    return {
      id: createId("event"),
      matchId: "",
      teamId,
      playerId: player.id,
      minute: minutes[index],
      stoppageMinute: null,
      type,
      playerName: player.name,
      secondaryPlayerName: null,
    };
  });
}

function createSubstitutionEvents(teamId, squad, count, minutes) {
  const starters = [...squad.slice(0, 11)];
  const bench = [...squad.slice(11)];
  const substitutionCount = Math.min(count, bench.length, starters.length);
  const events = [];

  for (let index = 0; index < substitutionCount; index += 1) {
    const incomingIndex = Math.floor(Math.random() * bench.length);
    const outgoingIndex = Math.floor(Math.random() * starters.length);
    const incoming = bench.splice(incomingIndex, 1)[0];
    const outgoing = starters.splice(outgoingIndex, 1)[0];
    starters.push(incoming);

    events.push({
      id: createId("event"),
      matchId: "",
      teamId,
      playerId: incoming.id,
      minute: minutes[index],
      stoppageMinute: null,
      type: "substitution",
      playerName: incoming.name,
      secondaryPlayerName: outgoing.name,
    });
  }

  return events;
}

function generateMatchEvents(match, players, { homeScore, awayScore }) {
  const homeSquad = getTeamPlayers(players, match.homeTeamId);
  const awaySquad = getTeamPlayers(players, match.awayTeamId);

  if (homeSquad.length === 0 || awaySquad.length === 0) {
    return [];
  }

  const goalMinutes = buildMinutePool(homeScore + awayScore);
  const homeGoals = createGoalEvents(match.homeTeamId, homeSquad, homeScore, goalMinutes.slice(0, homeScore));
  const awayGoals = createGoalEvents(match.awayTeamId, awaySquad, awayScore, goalMinutes.slice(homeScore));

  const homeYellowCount = Math.floor(Math.random() * 3);
  const awayYellowCount = Math.floor(Math.random() * 3);
  const homeRedCount = Math.random() < 0.12 ? 1 : 0;
  const awayRedCount = Math.random() < 0.12 ? 1 : 0;
  const homeSubsCount = 2 + Math.floor(Math.random() * 3);
  const awaySubsCount = 2 + Math.floor(Math.random() * 3);

  const homeYellows = createCardEvents(match.homeTeamId, homeSquad, homeYellowCount, "yellow_card", buildMinutePool(homeYellowCount));
  const awayYellows = createCardEvents(match.awayTeamId, awaySquad, awayYellowCount, "yellow_card", buildMinutePool(awayYellowCount));
  const homeReds = createCardEvents(match.homeTeamId, homeSquad, homeRedCount, "red_card", buildMinutePool(homeRedCount));
  const awayReds = createCardEvents(match.awayTeamId, awaySquad, awayRedCount, "red_card", buildMinutePool(awayRedCount));
  const homeSubs = createSubstitutionEvents(match.homeTeamId, homeSquad, homeSubsCount, buildMinutePool(homeSubsCount).map((minute) => Math.max(46, minute)));
  const awaySubs = createSubstitutionEvents(match.awayTeamId, awaySquad, awaySubsCount, buildMinutePool(awaySubsCount).map((minute) => Math.max(46, minute)));

  return [...homeGoals, ...awayGoals, ...homeYellows, ...awayYellows, ...homeReds, ...awayReds, ...homeSubs, ...awaySubs]
    .sort((left, right) => left.minute - right.minute)
    .map((event) => ({ ...event, matchId: match.id }));
}

function simulateRoundShape(season, players) {
  const nextRound = getNextRound(season);
  if (!nextRound) {
    return season.status === "completed" ? season : { ...season, status: "completed" };
  }

  const timestamp = new Date().toISOString();
  const matches = season.matches.map((match) => (
    nextRound.matchIds.includes(match.id) ? simulateMatch(match, timestamp, players) : match
  ));
  const rounds = season.rounds.map((round) =>
    round.number === nextRound.number ? { ...round, simulatedAt: timestamp } : round,
  );

  return {
    ...season,
    matches,
    rounds,
    status: rounds.every((round) => round.simulatedAt !== null) ? "completed" : "active",
  };
}

function simulateMatch(match, timestamp, players) {
  const homeScore = Math.floor(Math.random() * 6);
  const awayScore = Math.floor(Math.random() * 6);
  const homeShotsOnTarget = Math.max(homeScore, homeScore + Math.floor(Math.random() * 6) + 1);
  const awayShotsOnTarget = Math.max(awayScore, awayScore + Math.floor(Math.random() * 6) + 1);
  const totalMatchSeconds = 90 * 60;
  const homePossessionSeconds = 1800 + Math.floor(Math.random() * 1801);
  const awayPossessionSeconds = totalMatchSeconds - homePossessionSeconds;
  const events = generateMatchEvents(match, players, { homeScore, awayScore });

  return {
    ...match,
    homeScore,
    awayScore,
    homeShotsOnTarget,
    awayShotsOnTarget,
    homePossessionSeconds,
    awayPossessionSeconds,
    playedAt: timestamp,
    winnerTeamId: homeScore === awayScore ? null : homeScore > awayScore ? match.homeTeamId : match.awayTeamId,
    events,
  };
}

function getNextRound(season) {
  return season.rounds.find((round) => round.simulatedAt === null) ?? null;
}

function emptyStats(teamId, teamName) {
  return {
    teamId,
    teamName,
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    shotsOnTarget: 0,
    possessionSeconds: 0,
    possessionPct: 0,
    points: 0,
  };
}

function buildSeasonStats(season, teams) {
  const statsMap = new Map();
  season.teamIds.forEach((teamId) => {
    const teamName = teams.find((team) => team.id === teamId)?.name ?? "Unknown Team";
    statsMap.set(teamId, emptyStats(teamId, teamName));
  });

  season.matches.forEach((match) => {
    if (match.homeScore === null || match.awayScore === null) {
      return;
    }

    const home = statsMap.get(match.homeTeamId);
    const away = statsMap.get(match.awayTeamId);
    if (!home || !away) {
      return;
    }

    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    home.shotsOnTarget += match.homeShotsOnTarget ?? 0;
    away.shotsOnTarget += match.awayShotsOnTarget ?? 0;
    home.possessionSeconds += match.homePossessionSeconds ?? 0;
    away.possessionSeconds += match.awayPossessionSeconds ?? 0;

    if (match.homeScore === match.awayScore) {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    } else if (match.homeScore > match.awayScore) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
    } else {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
    }
  });

  return [...statsMap.values()].map(finalizeStats).sort(compareStats);
}

function buildAllTimeStats(seasons, teams) {
  const combined = new Map(teams.map((team) => [team.id, emptyStats(team.id, team.name)]));

  seasons.forEach((season) => {
    buildSeasonStats(season, teams).forEach((row) => {
      const current = combined.get(row.teamId);
      if (!current) {
        return;
      }

      current.played += row.played;
      current.wins += row.wins;
      current.losses += row.losses;
      current.draws += row.draws;
      current.goalsFor += row.goalsFor;
      current.goalsAgainst += row.goalsAgainst;
      current.shotsOnTarget += row.shotsOnTarget;
      current.possessionSeconds += row.possessionSeconds;
      current.points += row.points;
    });
  });

  return [...combined.values()].map(finalizeStats).sort(compareStats);
}

function finalizeStats(row) {
  return {
    ...row,
    goalDiff: row.goalsFor - row.goalsAgainst,
    possessionPct: row.played === 0 ? 0 : (row.possessionSeconds / (row.played * 90 * 60)) * 100,
  };
}

function compareStats(left, right) {
  if (right.points !== left.points) {
    return right.points - left.points;
  }
  if (right.goalDiff !== left.goalDiff) {
    return right.goalDiff - left.goalDiff;
  }
  return right.goalsFor - left.goalsFor;
}

function buildSeasonExportRows(season, teams) {
  const teamLookup = new Map(teams.map((team) => [team.id, team.name]));
  return [
    ["season", season.name],
    ["status", season.status],
    [],
    statsHeaderRow(),
    ...buildSeasonStats(season, teams).map(statsRowToCsv),
    [],
    matchHeaderRow(),
    ...season.matches.map((match) => matchRowToCsv(match, teamLookup)),
  ];
}

function buildRoundExportRows(season, teams, roundNumber) {
  const teamLookup = new Map(teams.map((team) => [team.id, team.name]));
  return [
    ["season", season.name],
    ["round", roundNumber],
    [],
    matchHeaderRow(),
    ...season.matches.filter((match) => match.roundNumber === roundNumber).map((match) => matchRowToCsv(match, teamLookup)),
  ];
}

function buildTeamExportRows(teamId, state) {
  const team = state.teams.find((entry) => entry.id === teamId);
  const rows = [["team", team?.name ?? "Unknown Team"], [], ["season", ...statsHeaderRow().slice(1)]];

  state.seasons
    .filter((season) => season.teamIds.includes(teamId))
    .forEach((season) => {
      const stats = buildSeasonStats(season, state.teams).find((entry) => entry.teamId === teamId);
      if (stats) {
        rows.push([season.name, ...statsRowToCsv(stats).slice(1)]);
      }
    });

  const allTime = buildAllTimeStats(state.seasons, state.teams).find((entry) => entry.teamId === teamId);
  if (allTime) {
    rows.push([], ["allTime", ...statsRowToCsv(allTime).slice(1)]);
  }

  return rows;
}

function statsHeaderRow() {
  return ["team", "played", "wins", "draws", "losses", "goals", "goalsAgainst", "goalDiff", "shotsOnTarget", "possessionPct", "points"];
}

function statsRowToCsv(row) {
  return [
    row.teamName,
    row.played,
    row.wins,
    row.draws,
    row.losses,
    row.goalsFor,
    row.goalsAgainst,
    row.goalDiff,
    row.shotsOnTarget,
    row.possessionPct.toFixed(1),
    row.points,
  ];
}

function matchHeaderRow() {
  return [
    "round",
    "homeTeam",
    "awayTeam",
    "homeScore",
    "awayScore",
    "homeShotsOnTarget",
    "awayShotsOnTarget",
    "homeYellowCards",
    "awayYellowCards",
    "homeRedCards",
    "awayRedCards",
    "homeSubstitutions",
    "awaySubstitutions",
    "homePossessionMinutes",
    "awayPossessionMinutes",
    "winnerTeam",
    "playedAt",
  ];
}

function matchRowToCsv(match, teamLookup) {
  const countEvents = (teamId, type) => match.events.filter((event) => event.teamId === teamId && event.type === type).length;

  return [
    match.roundNumber,
    teamLookup.get(match.homeTeamId) ?? "Unknown Team",
    teamLookup.get(match.awayTeamId) ?? "Unknown Team",
    match.homeScore ?? "",
    match.awayScore ?? "",
    match.homeShotsOnTarget ?? "",
    match.awayShotsOnTarget ?? "",
    countEvents(match.homeTeamId, "yellow_card"),
    countEvents(match.awayTeamId, "yellow_card"),
    countEvents(match.homeTeamId, "red_card"),
    countEvents(match.awayTeamId, "red_card"),
    countEvents(match.homeTeamId, "substitution"),
    countEvents(match.awayTeamId, "substitution"),
    match.homePossessionSeconds === null ? "" : (match.homePossessionSeconds / 60).toFixed(1),
    match.awayPossessionSeconds === null ? "" : (match.awayPossessionSeconds / 60).toFixed(1),
    match.homeScore === null || match.awayScore === null
      ? ""
      : match.winnerTeamId
        ? teamLookup.get(match.winnerTeamId) ?? "Unknown Team"
        : "Draw",
    match.playedAt ?? "",
  ];
}

function sendCsv(response, filename, rows) {
  sendText(
    response,
    200,
    rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n"),
    "text/csv;charset=utf-8",
    `attachment; filename="${filename}"`,
  );
}

function serveStaticAsset(response, pathname, headOnly) {
  const targetPath = pathname === "/" ? "/index.html" : pathname;
  const candidatePath = safeJoin(distDir, targetPath);
  const assetPath = candidatePath && existsSync(candidatePath) && statSync(candidatePath).isFile()
    ? candidatePath
    : safeJoin(distDir, "index.html");

  if (!assetPath || !existsSync(assetPath)) {
    sendText(response, 503, "Build assets not found. Run npm run build before starting production.", "text/plain; charset=utf-8");
    return;
  }

  response.writeHead(200, { "Content-Type": getContentType(assetPath) });
  if (headOnly) {
    response.end();
    return;
  }

  createReadStream(assetPath).pipe(response);
}

function safeJoin(basePath, requestedPath) {
  const resolved = normalize(join(basePath, requestedPath));
  return resolved.startsWith(basePath) ? resolved : null;
}

function getContentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON payload."));
      }
    });
    request.on("error", reject);
  });
}

function parseCookies(request) {
  const header = request.headers.cookie ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) {
          return [part, ""];
        }
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getSessionId(request) {
  return parseCookies(request)[SESSION_COOKIE] ?? null;
}

function setSessionCookie(response, sessionId, expiresAt) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(0).toUTCString()}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, body, contentType, disposition) {
  const headers = {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
  };

  if (disposition) {
    headers["Content-Disposition"] = disposition;
  }

  response.writeHead(status, headers);
  response.end(body);
}

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createToken() {
  return randomBytes(24).toString("hex");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHash] = String(storedHash).split(":");
  if (!salt || !expectedHash) {
    return false;
  }

  const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function slugify(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function escapeCsvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
