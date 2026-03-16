export type Team = {
  id: string;
  name: string;
  createdAt: string;
};

export type MatchEventType = "goal" | "yellow_card" | "red_card" | "substitution";

export type MatchEvent = {
  id: string;
  matchId: string;
  teamId: string;
  playerId: string;
  minute: number;
  stoppageMinute: number | null;
  type: MatchEventType;
  playerName: string;
  secondaryPlayerName: string | null;
};

export type Match = {
  id: string;
  roundNumber: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  homeShotsOnTarget: number | null;
  awayShotsOnTarget: number | null;
  homePossessionSeconds: number | null;
  awayPossessionSeconds: number | null;
  playedAt: string | null;
  winnerTeamId: string | null;
  events: MatchEvent[];
};

export type Round = {
  number: number;
  matchIds: string[];
  simulatedAt: string | null;
};

export type SeasonStatus = "active" | "completed";

export type Season = {
  id: string;
  name: string;
  createdAt: string;
  status: SeasonStatus;
  teamIds: string[];
  rounds: Round[];
  matches: Match[];
};

export type Stats = {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  shotsOnTarget: number;
  possessionSeconds: number;
  possessionPct: number;
  points: number;
};

export type SeasonStatsRow = Stats & {
  teamId: string;
  teamName: string;
};

export type AppState = {
  teams: Team[];
  seasons: Season[];
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type AuthResponse = {
  user: AuthUser;
};
