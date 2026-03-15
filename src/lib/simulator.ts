import { Match, Round, Season, SeasonStatsRow, Stats, Team } from "../types";
import { createId } from "./utils";

function emptyStats(): Stats {
  return {
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

function getShotValues(match: Match) {
  return {
    homeShotsOnTarget:
      match.homeShotsOnTarget ?? (match.homeScore === null ? 0 : Math.max(match.homeScore, match.homeScore + 2)),
    awayShotsOnTarget:
      match.awayShotsOnTarget ?? (match.awayScore === null ? 0 : Math.max(match.awayScore, match.awayScore + 2)),
  };
}

function getPossessionValues(match: Match) {
  const totalMatchSeconds = 90 * 60;
  return {
    homePossessionSeconds: match.homePossessionSeconds ?? totalMatchSeconds / 2,
    awayPossessionSeconds: match.awayPossessionSeconds ?? totalMatchSeconds / 2,
  };
}

function rotateTeamIds(ids: string[]) {
  const next = [...ids];
  const fixed = next.shift()!;
  const tail = next.pop()!;
  return [fixed, tail, ...next];
}

export function createSchedule(teamIds: string[]): { rounds: Round[]; matches: Match[] } {
  const sourceIds = [...teamIds];

  if (sourceIds.length < 2) {
    return { rounds: [], matches: [] };
  }

  if (sourceIds.length % 2 === 1) {
    sourceIds.push("bye");
  }

  let rotation = [...sourceIds];
  const rounds: Round[] = [];
  const matches: Match[] = [];
  const roundCount = rotation.length - 1;
  const half = rotation.length / 2;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const roundNumber = roundIndex + 1;
    const roundMatchIds: string[] = [];

    for (let matchIndex = 0; matchIndex < half; matchIndex += 1) {
      const homeTeamId = rotation[matchIndex];
      const awayTeamId = rotation[rotation.length - 1 - matchIndex];

      if (homeTeamId === "bye" || awayTeamId === "bye") {
        continue;
      }

      const match: Match = {
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

    rounds.push({
      number: roundNumber,
      matchIds: roundMatchIds,
      simulatedAt: null,
    });

    rotation = rotateTeamIds(rotation);
  }

  return { rounds, matches };
}

export function createSeason(name: string, teams: Team[]): Season {
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

export function simulateMatch(match: Match): Match {
  const homeScore = Math.floor(Math.random() * 6);
  const awayScore = Math.floor(Math.random() * 6);
  const homeShotsOnTarget = Math.max(homeScore, homeScore + Math.floor(Math.random() * 6) + 1);
  const awayShotsOnTarget = Math.max(awayScore, awayScore + Math.floor(Math.random() * 6) + 1);
  const totalMatchSeconds = 90 * 60;
  const homePossessionSeconds = 1800 + Math.floor(Math.random() * 1801);
  const awayPossessionSeconds = totalMatchSeconds - homePossessionSeconds;
  const winnerTeamId =
    homeScore === awayScore
      ? null
      : homeScore > awayScore
        ? match.homeTeamId
        : match.awayTeamId;

  return {
    ...match,
    homeScore,
    awayScore,
    homeShotsOnTarget,
    awayShotsOnTarget,
    homePossessionSeconds,
    awayPossessionSeconds,
    winnerTeamId,
    playedAt: new Date().toISOString(),
  };
}

export function getNextRound(season: Season) {
  return season.rounds.find((round) => round.simulatedAt === null) ?? null;
}

export function simulateRound(season: Season): Season {
  const nextRound = getNextRound(season);

  if (!nextRound) {
    return season.status === "completed"
      ? season
      : { ...season, status: "completed" };
  }

  const matches = season.matches.map((match) =>
    nextRound.matchIds.includes(match.id) ? simulateMatch(match) : match,
  );

  const rounds = season.rounds.map((round) =>
    round.number === nextRound.number
      ? { ...round, simulatedAt: new Date().toISOString() }
      : round,
  );

  const isComplete = rounds.every((round) => round.simulatedAt !== null);

  return {
    ...season,
    matches,
    rounds,
    status: isComplete ? "completed" : "active",
  };
}

export function simulateSeason(season: Season): Season {
  let next = season;

  while (getNextRound(next)) {
    next = simulateRound(next);
  }

  return { ...next, status: "completed" };
}

export function buildSeasonStats(season: Season, teams: Team[]): SeasonStatsRow[] {
  const statsMap = new Map<string, SeasonStatsRow>();

  for (const teamId of season.teamIds) {
    const teamName = teams.find((team) => team.id === teamId)?.name ?? "Unknown Team";
    statsMap.set(teamId, { teamId, teamName, ...emptyStats() });
  }

  for (const match of season.matches) {
    if (match.homeScore === null || match.awayScore === null) {
      continue;
    }

    const home = statsMap.get(match.homeTeamId);
    const away = statsMap.get(match.awayTeamId);
    const shots = getShotValues(match);
    const possession = getPossessionValues(match);

    if (!home || !away) {
      continue;
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
  }

  const rows = [...statsMap.values()].map((row) => ({
    ...row,
    goalDiff: row.goalsFor - row.goalsAgainst,
    possessionPct: row.played === 0 ? 0 : (row.possessionSeconds / (row.played * 90 * 60)) * 100,
  }));

  return rows.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }

    if (b.goalDiff !== a.goalDiff) {
      return b.goalDiff - a.goalDiff;
    }

    return b.goalsFor - a.goalsFor;
  });
}

export function buildAllTimeStats(seasons: Season[], teams: Team[]): SeasonStatsRow[] {
  const combined = new Map<string, SeasonStatsRow>();

  for (const team of teams) {
    combined.set(team.id, { teamId: team.id, teamName: team.name, ...emptyStats() });
  }

  for (const season of seasons) {
    for (const row of buildSeasonStats(season, teams)) {
      const current = combined.get(row.teamId);

      if (!current) {
        continue;
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
    }
  }

  return [...combined.values()]
    .map((row) => ({
      ...row,
      goalDiff: row.goalsFor - row.goalsAgainst,
      possessionPct: row.played === 0 ? 0 : (row.possessionSeconds / (row.played * 90 * 60)) * 100,
    }))
    .sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }

      if (b.goalDiff !== a.goalDiff) {
        return b.goalDiff - a.goalDiff;
      }

      return b.goalsFor - a.goalsFor;
    });
}
