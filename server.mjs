import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");

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

    if (method === "GET" && url.pathname === "/api/state") {
      return sendJson(response, 200, await loadState());
    }

    if (method === "POST" && url.pathname === "/api/teams") {
      const body = await readJson(request);
      const name = String(body?.name ?? "").trim();
      if (!name) {
        return sendJson(response, 400, { error: "Team name is required." });
      }

      await createTeam(name);
      return sendJson(response, 201, await loadState());
    }

    if (method === "PATCH" && /^\/api\/teams\/[^/]+$/.test(url.pathname)) {
      const teamId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const body = await readJson(request);
      const name = String(body?.name ?? "").trim();
      if (!name) {
        return sendJson(response, 400, { error: "Team name is required." });
      }

      await updateTeam(teamId, name);
      return sendJson(response, 200, await loadState());
    }

    if (method === "DELETE" && /^\/api\/teams\/[^/]+$/.test(url.pathname)) {
      const teamId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      await deleteTeam(teamId);
      return sendJson(response, 200, await loadState());
    }

    if (method === "POST" && url.pathname === "/api/seasons") {
      const body = await readJson(request);
      const name = String(body?.name ?? "").trim();
      if (!name) {
        return sendJson(response, 400, { error: "Season name is required." });
      }

      await createSeasonRecord(name);
      return sendJson(response, 201, await loadState());
    }

    if (method === "DELETE" && /^\/api\/seasons\/[^/]+$/.test(url.pathname)) {
      const seasonId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      await deleteSeason(seasonId);
      return sendJson(response, 200, await loadState());
    }

    if (method === "POST" && /^\/api\/seasons\/[^/]+\/simulate-round$/.test(url.pathname)) {
      const seasonId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      await simulateRoundRecord(seasonId);
      return sendJson(response, 200, await loadState());
    }

    if (method === "POST" && /^\/api\/seasons\/[^/]+\/simulate-season$/.test(url.pathname)) {
      const seasonId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      await simulateSeasonRecord(seasonId);
      return sendJson(response, 200, await loadState());
    }

    if (method === "GET" && /^\/api\/export\/seasons\/[^/]+\.csv$/.test(url.pathname)) {
      const seasonId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "").replace(/\.csv$/, "");
      const state = await loadState();
      const season = state.seasons.find((entry) => entry.id === seasonId);
      if (!season) {
        return sendJson(response, 404, { error: "Season not found." });
      }

      return sendCsv(response, `${slugify(season.name)}-stats.csv`, buildSeasonExportRows(season, state.teams));
    }

    if (method === "GET" && /^\/api\/export\/seasons\/[^/]+\/rounds\/\d+\.csv$/.test(url.pathname)) {
      const [, , , seasonIdToken, , roundToken] = url.pathname.split("/");
      const seasonId = decodeURIComponent(seasonIdToken);
      const roundNumber = Number(roundToken.replace(/\.csv$/, ""));
      const state = await loadState();
      const season = state.seasons.find((entry) => entry.id === seasonId);
      if (!season) {
        return sendJson(response, 404, { error: "Season not found." });
      }

      return sendCsv(response, `${slugify(season.name)}-round-${roundNumber}.csv`, buildRoundExportRows(season, state.teams, roundNumber));
    }

    if (method === "GET" && url.pathname === "/api/export/all-time.csv") {
      const state = await loadState();
      const rows = [statsHeaderRow(), ...buildAllTimeStats(state.seasons, state.teams).map(statsRowToCsv)];
      return sendCsv(response, "all-time-stats.csv", rows);
    }

    if (method === "GET" && /^\/api\/export\/teams\/[^/]+\.csv$/.test(url.pathname)) {
      const teamId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "").replace(/\.csv$/, "");
      const state = await loadState();
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
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
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
  `);
}

async function loadState() {
  return {
    teams: await loadTeams(),
    seasons: await loadSeasons(),
  };
}

async function loadTeams() {
  const result = await pool.query(
    "SELECT id, name, created_at FROM teams ORDER BY created_at ASC, name ASC",
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

async function loadSeasons() {
  const [seasonsRes, seasonTeamsRes, roundsRes, matchesRes] = await Promise.all([
    pool.query("SELECT id, name, created_at, status FROM seasons ORDER BY created_at DESC, name ASC"),
    pool.query("SELECT season_id, team_id, position FROM season_teams ORDER BY season_id, position ASC"),
    pool.query("SELECT season_id, number, simulated_at FROM rounds ORDER BY season_id, number ASC"),
    pool.query(`
      SELECT id, season_id, round_number, home_team_id, away_team_id, home_score, away_score,
             home_shots_on_target, away_shots_on_target, home_possession_seconds, away_possession_seconds,
             played_at, winner_team_id
      FROM matches
      ORDER BY season_id, round_number ASC, id ASC
    `),
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
      })),
  }));
}

async function createTeam(name) {
  await pool.query(
    "INSERT INTO teams (id, name, created_at) VALUES ($1, $2, $3)",
    [createId("team"), name, new Date().toISOString()],
  );
}

async function updateTeam(teamId, name) {
  const result = await pool.query("UPDATE teams SET name = $1 WHERE id = $2", [name, teamId]);
  if (result.rowCount === 0) {
    throw new Error("Team not found.");
  }
}

async function deleteTeam(teamId) {
  const usage = await pool.query("SELECT 1 FROM season_teams WHERE team_id = $1 LIMIT 1", [teamId]);
  if (usage.rowCount) {
    throw new Error("This team is already used in a season and cannot be removed.");
  }

  const result = await pool.query("DELETE FROM teams WHERE id = $1", [teamId]);
  if (result.rowCount === 0) {
    throw new Error("Team not found.");
  }
}

async function createSeasonRecord(name) {
  const teams = await loadTeams();
  if (teams.length < 2) {
    throw new Error("At least two teams are required to create a season.");
  }

  const season = createSeasonShape(name, teams);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO seasons (id, name, created_at, status) VALUES ($1, $2, $3, $4)",
      [season.id, season.name, season.createdAt, season.status],
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

async function deleteSeason(seasonId) {
  const result = await pool.query("DELETE FROM seasons WHERE id = $1", [seasonId]);
  if (result.rowCount === 0) {
    throw new Error("Season not found.");
  }
}

async function simulateRoundRecord(seasonId) {
  const season = (await loadSeasons()).find((entry) => entry.id === seasonId);
  if (!season) {
    throw new Error("Season not found.");
  }

  await persistSeasonMutation(simulateRoundShape(season));
}

async function simulateSeasonRecord(seasonId) {
  const season = (await loadSeasons()).find((entry) => entry.id === seasonId);
  if (!season) {
    throw new Error("Season not found.");
  }

  let updated = season;
  while (getNextRound(updated)) {
    updated = simulateRoundShape(updated);
  }
  await persistSeasonMutation({ ...updated, status: "completed" });
}

async function persistSeasonMutation(season) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE seasons SET status = $1 WHERE id = $2", [season.status, season.id]);

    for (const round of season.rounds) {
      await client.query(
        "UPDATE rounds SET simulated_at = $1 WHERE season_id = $2 AND number = $3",
        [round.simulatedAt, season.id, round.number],
      );
    }

    for (const match of season.matches) {
      await client.query(
        `UPDATE matches
         SET home_score = $1, away_score = $2, home_shots_on_target = $3, away_shots_on_target = $4,
             home_possession_seconds = $5, away_possession_seconds = $6, played_at = $7, winner_team_id = $8
         WHERE id = $9`,
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

function simulateRoundShape(season) {
  const nextRound = getNextRound(season);
  if (!nextRound) {
    return season.status === "completed" ? season : { ...season, status: "completed" };
  }

  const timestamp = new Date().toISOString();
  const matches = season.matches.map((match) => (nextRound.matchIds.includes(match.id) ? simulateMatch(match, timestamp) : match));
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

function simulateMatch(match, timestamp) {
  const homeScore = Math.floor(Math.random() * 6);
  const awayScore = Math.floor(Math.random() * 6);
  const homeShotsOnTarget = Math.max(homeScore, homeScore + Math.floor(Math.random() * 6) + 1);
  const awayShotsOnTarget = Math.max(awayScore, awayScore + Math.floor(Math.random() * 6) + 1);
  const totalMatchSeconds = 90 * 60;
  const homePossessionSeconds = 1800 + Math.floor(Math.random() * 1801);
  const awayPossessionSeconds = totalMatchSeconds - homePossessionSeconds;

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
  return ["round", "homeTeam", "awayTeam", "homeScore", "awayScore", "homeShotsOnTarget", "awayShotsOnTarget", "homePossessionMinutes", "awayPossessionMinutes", "winnerTeam", "playedAt"];
}

function matchRowToCsv(match, teamLookup) {
  return [
    match.roundNumber,
    teamLookup.get(match.homeTeamId) ?? "Unknown Team",
    teamLookup.get(match.awayTeamId) ?? "Unknown Team",
    match.homeScore ?? "",
    match.awayScore ?? "",
    match.homeShotsOnTarget ?? "",
    match.awayShotsOnTarget ?? "",
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

function slugify(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function escapeCsvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
