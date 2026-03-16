import { Match, Season, SeasonStatsRow, Stats, Team } from "../types";

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

export function getNextRound(season: Season) {
  return season.rounds.find((round) => round.simulatedAt === null) ?? null;
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
