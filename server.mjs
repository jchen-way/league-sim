import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "data");
const distDir = join(__dirname, "dist");
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, "game-sim.sqlite"));
db.exec("PRAGMA foreign_keys = ON;");
initSchema();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";

  try {
    if (method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true });
    }

    if (method === "GET" && url.pathname === "/api/state") {
      return sendJson(response, 200, loadState());
    }

    if (method === "POST" && url.pathname === "/api/teams") {
      const body = await readJson(request);
      const name = String(body?.name ?? "").trim();
      if (!name) {
        return sendJson(response, 400, { error: "Team name is required." });
      }

      createTeam(name);
      return sendJson(response, 201, loadState());
    }

    if (method === "PATCH" && /^\/api\/teams\/[^/]+$/.test(url.pathname)) {
      const teamId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const body = await readJson(request);
      const name = String(body?.name ?? "").trim();
      if (!name) {
        return sendJson(response, 400, { error: "Team name is required." });
      }

      updateTeam(teamId, name);
      return sendJson(response, 200, loadState());
    }

    if (method === "DELETE" && /^\/api\/teams\/[^/]+$/.test(url.pathname)) {
      const teamId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      deleteTeam(teamId);
      return sendJson(response, 200, loadState());
    }

    if (method === "POST" && url.pathname === "/api/seasons") {
      const body = await readJson(request);
      const name = String(body?.name ?? "").trim();
      if (!name) {
        return sendJson(response, 400, { error: "Season name is required." });
      }

      createSeasonRecord(name);
      return sendJson(response, 201, loadState());
    }

    if (method === "DELETE" && /^\/api\/seasons\/[^/]+$/.test(url.pathname)) {
      const seasonId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      deleteSeason(seasonId);
      return sendJson(response, 200, loadState());
    }

    if (method === "POST" && /^\/api\/seasons\/[^/]+\/simulate-round$/.test(url.pathname)) {
      const seasonId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      simulateRoundRecord(seasonId);
      return sendJson(response, 200, loadState());
    }

    if (method === "POST" && /^\/api\/seasons\/[^/]+\/simulate-season$/.test(url.pathname)) {
      const seasonId = decodeURIComponent(url.pathname.split("/")[3] ?? "");
      simulateSeasonRecord(seasonId);
      return sendJson(response, 200, loadState());
    }

    if (method === "GET" && /^\/api\/export\/seasons\/[^/]+\.csv$/.test(url.pathname)) {
      const seasonId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "").replace(/\.csv$/, "");
      const state = loadState();
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
      const state = loadState();
      const season = state.seasons.find((entry) => entry.id === seasonId);
      if (!season) {
        return sendJson(response, 404, { error: "Season not found." });
      }

      return sendCsv(response, `${slugify(season.name)}-round-${roundNumber}.csv`, buildRoundExportRows(season, state.teams, roundNumber));
    }

    if (method === "GET" && url.pathname === "/api/export/all-time.csv") {
      const state = loadState();
      const rows = [
        statsHeaderRow(),
        ...buildAllTimeStats(state.seasons, state.teams).map(statsRowToCsv),
      ];
      return sendCsv(response, "all-time-stats.csv", rows);
    }

    if (method === "GET" && /^\/api\/export\/teams\/[^/]+\.csv$/.test(url.pathname)) {
      const teamId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "").replace(/\.csv$/, "");
      const state = loadState();
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

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed'))
    );

    CREATE TABLE IF NOT EXISTS season_teams (
      season_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (season_id, team_id),
      FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS rounds (
      season_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      simulated_at TEXT,
      PRIMARY KEY (season_id, number),
      FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      home_shots_on_target INTEGER,
      away_shots_on_target INTEGER,
      home_possession_seconds INTEGER,
      away_possession_seconds INTEGER,
      played_at TEXT,
      winner_team_id TEXT,
      FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
      FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE RESTRICT,
      FOREIGN KEY (winner_team_id) REFERENCES teams(id) ON DELETE RESTRICT
    );
  `);

  addColumnIfMissing("matches", "home_shots_on_target", "INTEGER");
  addColumnIfMissing("matches", "away_shots_on_target", "INTEGER");
  addColumnIfMissing("matches", "home_possession_seconds", "INTEGER");
  addColumnIfMissing("matches", "away_possession_seconds", "INTEGER");
}

function addColumnIfMissing(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function loadState() {
  return { teams: loadTeams(), seasons: loadSeasons() };
}

function loadTeams() {
  return db
    .prepare("SELECT id, name, created_at FROM teams ORDER BY datetime(created_at) ASC, name ASC")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
    }));
}

function loadSeasons() {
  const seasons = db
    .prepare("SELECT id, name, created_at, status FROM seasons ORDER BY datetime(created_at) DESC, name ASC")
    .all();
  const seasonTeams = db.prepare("SELECT season_id, team_id, position FROM season_teams ORDER BY season_id, position ASC").all();
  const rounds = db.prepare("SELECT season_id, number, simulated_at FROM rounds ORDER BY season_id, number ASC").all();
  const matches = db.prepare(`
    SELECT id, season_id, round_number, home_team_id, away_team_id, home_score, away_score,
           home_shots_on_target, away_shots_on_target, home_possession_seconds, away_possession_seconds,
           played_at, winner_team_id
    FROM matches
    ORDER BY season_id, round_number ASC, id ASC
  `).all();

  return seasons.map((season) => ({
    id: season.id,
    name: season.name,
    createdAt: season.created_at,
    status: season.status,
    teamIds: seasonTeams.filter((row) => row.season_id === season.id).map((row) => row.team_id),
    rounds: rounds
      .filter((row) => row.season_id === season.id)
      .map((row) => ({
        number: row.number,
        simulatedAt: row.simulated_at,
        matchIds: matches
          .filter((match) => match.season_id === season.id && match.round_number === row.number)
          .map((match) => match.id),
      })),
    matches: matches
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
        playedAt: row.played_at,
        winnerTeamId: row.winner_team_id,
      })),
  }));
}

function createTeam(name) {
  db.prepare("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)").run(createId("team"), name, new Date().toISOString());
}

function updateTeam(teamId, name) {
  const result = db.prepare("UPDATE teams SET name = ? WHERE id = ?").run(name, teamId);
  if (result.changes === 0) {
    throw new Error("Team not found.");
  }
}

function deleteTeam(teamId) {
  const usage = db.prepare("SELECT 1 FROM season_teams WHERE team_id = ? LIMIT 1").get(teamId);
  if (usage) {
    throw new Error("This team is already used in a season and cannot be removed.");
  }

  const result = db.prepare("DELETE FROM teams WHERE id = ?").run(teamId);
  if (result.changes === 0) {
    throw new Error("Team not found.");
  }
}

function createSeasonRecord(name) {
  const teams = loadTeams();
  if (teams.length < 2) {
    throw new Error("At least two teams are required to create a season.");
  }

  const season = createSeasonShape(name, teams);
  const insertSeason = db.prepare("INSERT INTO seasons (id, name, created_at, status) VALUES (?, ?, ?, ?)");
  const insertSeasonTeam = db.prepare("INSERT INTO season_teams (season_id, team_id, position) VALUES (?, ?, ?)");
  const insertRound = db.prepare("INSERT INTO rounds (season_id, number, simulated_at) VALUES (?, ?, ?)");
  const insertMatch = db.prepare(`
    INSERT INTO matches (
      id, season_id, round_number, home_team_id, away_team_id, home_score, away_score,
      home_shots_on_target, away_shots_on_target, home_possession_seconds, away_possession_seconds,
      played_at, winner_team_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    insertSeason.run(season.id, season.name, season.createdAt, season.status);
    season.teamIds.forEach((teamId, index) => insertSeasonTeam.run(season.id, teamId, index));
    season.rounds.forEach((round) => insertRound.run(season.id, round.number, round.simulatedAt));
    season.matches.forEach((match) => {
      insertMatch.run(
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
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function deleteSeason(seasonId) {
  const result = db.prepare("DELETE FROM seasons WHERE id = ?").run(seasonId);
  if (result.changes === 0) {
    throw new Error("Season not found.");
  }
}

function simulateRoundRecord(seasonId) {
  const season = loadSeasons().find((entry) => entry.id === seasonId);
  if (!season) {
    throw new Error("Season not found.");
  }

  persistSeasonMutation(simulateRoundShape(season));
}

function simulateSeasonRecord(seasonId) {
  const season = loadSeasons().find((entry) => entry.id === seasonId);
  if (!season) {
    throw new Error("Season not found.");
  }

  let updated = season;
  while (getNextRound(updated)) {
    updated = simulateRoundShape(updated);
  }

  persistSeasonMutation({ ...updated, status: "completed" });
}

function persistSeasonMutation(season) {
  const updateSeason = db.prepare("UPDATE seasons SET status = ? WHERE id = ?");
  const updateRound = db.prepare("UPDATE rounds SET simulated_at = ? WHERE season_id = ? AND number = ?");
  const updateMatch = db.prepare(`
    UPDATE matches
    SET home_score = ?, away_score = ?, home_shots_on_target = ?, away_shots_on_target = ?,
        home_possession_seconds = ?, away_possession_seconds = ?, played_at = ?, winner_team_id = ?
    WHERE id = ?
  `);

  db.exec("BEGIN");
  try {
    updateSeason.run(season.status, season.id);
    season.rounds.forEach((round) => updateRound.run(round.simulatedAt, season.id, round.number));
    season.matches.forEach((match) => {
      updateMatch.run(
        match.homeScore,
        match.awayScore,
        match.homeShotsOnTarget,
        match.awayShotsOnTarget,
        match.homePossessionSeconds,
        match.awayPossessionSeconds,
        match.playedAt,
        match.winnerTeamId,
        match.id,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
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
  const matches = season.matches.map((match) => {
    if (!nextRound.matchIds.includes(match.id)) {
      return match;
    }

    return simulateMatch(match, timestamp);
  });
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
    const shots = getShotValues(match);
    const possession = getPossessionValues(match);
    if (!home || !away) {
      return;
    }

    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    home.shotsOnTarget += shots.homeShotsOnTarget;
    away.shotsOnTarget += shots.awayShotsOnTarget;
    home.possessionSeconds += possession.homePossessionSeconds;
    away.possessionSeconds += possession.awayPossessionSeconds;

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

  return [...statsMap.values()]
    .map(finalizeStats)
    .sort(compareStats);
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
  const rows = [
    ["team", team?.name ?? "Unknown Team"],
    [],
    ["season", ...statsHeaderRow().slice(1)],
  ];

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
  const shots = getShotValues(match);
  const possession = getPossessionValues(match);
  return [
    match.roundNumber,
    teamLookup.get(match.homeTeamId) ?? "Unknown Team",
    teamLookup.get(match.awayTeamId) ?? "Unknown Team",
    match.homeScore ?? "",
    match.awayScore ?? "",
    match.homeScore === null ? "" : shots.homeShotsOnTarget,
    match.awayScore === null ? "" : shots.awayShotsOnTarget,
    match.homeScore === null ? "" : (possession.homePossessionSeconds / 60).toFixed(1),
    match.awayScore === null ? "" : (possession.awayPossessionSeconds / 60).toFixed(1),
    match.homeScore === null || match.awayScore === null
      ? ""
      : match.winnerTeamId
        ? teamLookup.get(match.winnerTeamId) ?? "Unknown Team"
        : "Draw",
    match.playedAt ?? "",
  ];
}

function getShotValues(match) {
  return {
    homeShotsOnTarget: match.homeShotsOnTarget ?? (match.homeScore === null ? 0 : Math.max(match.homeScore, match.homeScore + 2)),
    awayShotsOnTarget: match.awayShotsOnTarget ?? (match.awayScore === null ? 0 : Math.max(match.awayScore, match.awayScore + 2)),
  };
}

function getPossessionValues(match) {
  const totalMatchSeconds = 90 * 60;
  return {
    homePossessionSeconds: match.homePossessionSeconds ?? totalMatchSeconds / 2,
    awayPossessionSeconds: match.awayPossessionSeconds ?? totalMatchSeconds / 2,
  };
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

  const contentType = getContentType(assetPath);
  response.writeHead(200, { "Content-Type": contentType });

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
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    "Access-Control-Allow-Origin": "*",
  });
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
