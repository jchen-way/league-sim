import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createSeason as createSeasonRequest,
  createTeam,
  fetchState,
  removeTeam,
  removeSeason,
  renameTeam,
  simulateRound as simulateRoundRequest,
  simulateSeason as simulateSeasonRequest,
} from "./lib/api";
import { buildAllTimeStats, buildSeasonStats, getNextRound } from "./lib/simulator";
import { downloadFromUrl, formatDateTime } from "./lib/utils";
import { AppState } from "./types";

const emptyState: AppState = {
  teams: [],
  seasons: [],
};

// --- Sorting Types ---
type StatsRow = ReturnType<typeof buildSeasonStats>[0];
type SortOrder = "asc" | "desc";
type SortKey = keyof StatsRow;

function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [teamName, setTeamName] = useState("");
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState("");

  const [seasonName, setSeasonName] = useState("");
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);

  const [feedback, setFeedback] = useState("Loading data from the database...");
  const [isBusy, setIsBusy] = useState(true);

  useEffect(() => {
    void loadState();
  }, []);

  useEffect(() => {
    if (!selectedSeasonId && state.seasons.length > 0) {
      setSelectedSeasonId(state.seasons[0].id);
      return;
    }

    if (selectedSeasonId && !state.seasons.some((season) => season.id === selectedSeasonId)) {
      setSelectedSeasonId(state.seasons[0]?.id ?? null);
    }
  }, [selectedSeasonId, state.seasons]);

  const activeSeason = useMemo(
    () => state.seasons.find((season) => season.id === selectedSeasonId) ?? null,
    [selectedSeasonId, state.seasons],
  );

  const activeSeasonStats = useMemo(
    () => (activeSeason ? buildSeasonStats(activeSeason, state.teams) : []),
    [activeSeason, state.teams],
  );

  const allTimeStats = useMemo(
    () => buildAllTimeStats(state.seasons, state.teams),
    [state.seasons, state.teams],
  );

  // --- API Handlers ---
  async function loadState(message = "Ready to simulate.") {
    setIsBusy(true);
    try {
      const nextState = await fetchState();
      setState(nextState);
      setFeedback(message);
    } catch (error) {
      setFeedback(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function runMutation(work: () => Promise<AppState>, successMessage: string, after?: (state: AppState) => void) {
    setIsBusy(true);
    try {
      const nextState = await work();
      setState(nextState);
      after?.(nextState);
      setFeedback(successMessage);
    } catch (error) {
      setFeedback(getErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  function handleAddTeam(event: FormEvent) {
    event.preventDefault();
    const trimmed = teamName.trim();
    if (!trimmed) {
      setFeedback("Team name is required.");
      return;
    }
    void runMutation(
      () => createTeam(trimmed),
      `Added ${trimmed}.`,
      () => setTeamName(""),
    );
  }

  function handleSaveEditTeam(event: FormEvent) {
    event.preventDefault();
    const trimmed = editTeamName.trim();
    if (!trimmed || !editingTeamId) {
      setEditingTeamId(null);
      return;
    }
    void runMutation(
      () => renameTeam(editingTeamId, trimmed),
      `Team renamed to ${trimmed}.`,
      () => setEditingTeamId(null),
    );
  }

  function handleCancelEditTeam() {
    setEditingTeamId(null);
  }

  function handleDeleteTeam(teamId: string) {
    void runMutation(
      () => removeTeam(teamId),
      "Team removed.",
    );
  }

  function handleCreateSeason(event: FormEvent) {
    event.preventDefault();
    const trimmed = seasonName.trim();
    if (!trimmed) {
      setFeedback("Season name is required.");
      return;
    }
    void runMutation(
      () => createSeasonRequest(trimmed),
      `Created ${trimmed}.`,
      (nextState) => {
        setSeasonName("");
        setSelectedSeasonId(nextState.seasons[0]?.id ?? null);
      },
    );
  }

  function handleDeleteSeason(seasonId: string, seasonName: string) {
    void runMutation(
      () => removeSeason(seasonId),
      `${seasonName} removed.`,
      (nextState) => {
        if (selectedSeasonId === seasonId) {
          setSelectedSeasonId(nextState.seasons[0]?.id ?? null);
        }
      },
    );
  }

  function handleSimulateRound() {
    if (!activeSeason) {
      setFeedback("Select a season first.");
      return;
    }
    const nextRound = getNextRound(activeSeason);
    if (!nextRound) {
      setFeedback("All rounds are already complete.");
      return;
    }
    void runMutation(
      () => simulateRoundRequest(activeSeason.id),
      `Round ${nextRound.number} simulated for ${activeSeason.name}.`,
    );
  }

  function handleSimulateSeason() {
    if (!activeSeason) {
      setFeedback("Select a season first.");
      return;
    }
    void runMutation(
      () => simulateSeasonRequest(activeSeason.id),
      `${activeSeason.name} completed.`,
    );
  }

  const nextRoundMatch = activeSeason ? getNextRound(activeSeason) : null;

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="logo-icon">⚽</span>
          <h1>LeagueSim</h1>
        </div>

        <div className="sidebar-content">
          <div className="side-section">
            <h3>Campaigns</h3>
            <form className="form-row" onSubmit={handleCreateSeason}>
              <input
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value)}
                placeholder="New season name..."
                disabled={isBusy}
              />
              <button type="submit" className="btn-primary" disabled={isBusy}>Add</button>
            </form>

            <div className="side-section" style={{ marginTop: "0.5rem" }}>
              {state.seasons.length === 0 && (
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>No campaigns created.</span>
              )}
              {state.seasons.map((s) => (
                <div key={s.id} className="nav-item-row">
                  <button
                    className={`nav-item ${selectedSeasonId === s.id ? "active" : ""}`}
                    onClick={() => setSelectedSeasonId(s.id)}
                    disabled={isBusy && selectedSeasonId !== s.id}
                  >
                    <span>{s.name}</span>
                    <span className="nav-item-meta">
                      {s.rounds.filter((r) => r.simulatedAt).length}/{s.rounds.length}
                    </span>
                  </button>
                  <button
                    className="btn-danger season-delete"
                    onClick={() => handleDeleteSeason(s.id, s.name)}
                    disabled={isBusy}
                    aria-label={`Delete ${s.name}`}
                    title={`Delete ${s.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="side-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Registered Clubs</h3>
            </div>
            
            <form className="form-row" onSubmit={handleAddTeam}>
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="New club name..."
                disabled={isBusy}
              />
              <button type="submit" className="btn-primary" disabled={isBusy}>Add</button>
            </form>

            <div className="side-section" style={{ marginTop: "0.5rem" }}>
              {state.teams.map((t) => (
                <div key={t.id} className="list-item">
                  {editingTeamId === t.id ? (
                    <form className="form-row" style={{ width: "100%" }} onSubmit={handleSaveEditTeam}>
                      <input
                        autoFocus
                        value={editTeamName}
                        onChange={(e) => setEditTeamName(e.target.value)}
                        disabled={isBusy}
                      />
                      <button type="button" className="btn-secondary" onClick={handleCancelEditTeam} disabled={isBusy}>×</button>
                    </form>
                  ) : (
                    <>
                      <div className="team-cell">
                        <div className="crest">{t.name.charAt(0)}</div>
                        <span className="list-item-name">{t.name}</span>
                      </div>
                      <div style={{ display: "flex", gap: "0.2rem" }}>
                        <button className="btn-text" onClick={() => downloadFromUrl(`/api/export/teams/${t.id}.csv`)} disabled={isBusy}>CSV</button>
                        <button className="btn-text" onClick={() => { setEditingTeamId(t.id); setEditTeamName(t.name); }} disabled={isBusy}>Edit</button>
                        <button className="btn-danger" onClick={() => handleDeleteTeam(t.id)} disabled={isBusy}>×</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        
      </aside>

      <main className="main-canvas">
        <div className="pitch-bg" />

        {activeSeason ? (
          <>
            <header className="topbar">
              <div className="campaign-info">
                <span className={`status-badge ${isBusy ? "live" : ""}`}>
                  {isBusy ? "Syncing db..." : activeSeason.status}
                </span>
                <h2>{activeSeason.name}</h2>
              </div>
              <div className="action-group">
                <button
                  className="btn-primary sim-btn"
                  disabled={isBusy || !nextRoundMatch}
                  onClick={handleSimulateRound}
                >
                  {nextRoundMatch ? `Simulate Matchweek ${nextRoundMatch.number}` : "Campaign Finished"}
                </button>
                <button
                  className="btn-secondary sim-btn"
                  disabled={isBusy || !nextRoundMatch}
                  onClick={handleSimulateSeason}
                >
                  Fast Forward Season
                </button>
              </div>
            </header>

            <div className="dashboard-content">
              <div className="grid-layout">
                <div className="panel table-panel">
                  <div className="panel-header">
                    <h3>League Standings</h3>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <button
                        className="btn-secondary"
                        onClick={() => downloadFromUrl(`/api/export/seasons/${activeSeason.id}.csv`)}
                        disabled={isBusy}
                      >
                        Season CSV
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => downloadFromUrl("/api/export/all-time.csv")}
                        disabled={isBusy}
                      >
                        All-Time CSV
                      </button>
                    </div>
                  </div>
                  <StatsTable rows={activeSeasonStats} />
                </div>

                <div className="panel">
                  <div className="panel-header">
                    <h3>Match Results</h3>
                    {nextRoundMatch ? (
                      <button
                        className="btn-secondary"
                        onClick={() => downloadFromUrl(`/api/export/seasons/${activeSeason.id}/rounds/${nextRoundMatch.number}.csv`)}
                        disabled={isBusy}
                      >
                        Next Round CSV
                      </button>
                    ) : null}
                  </div>
                  <div className="rounds-list" style={{ overflowY: "auto", flex: 1 }}>
                    {activeSeason.rounds.length === 0 && (
                       <div className="table-empty">No matches scheduled.</div>
                    )}
                    {activeSeason.rounds.map((round) => {
                      const matches = activeSeason.matches.filter((m) => round.matchIds.includes(m.id));
                      return (
                        <div key={round.number} className="round-block">
                          <div className="round-header">
                            <span>Round {round.number}</span>
                            <span>{round.simulatedAt ? formatDateTime(round.simulatedAt) : "Upcoming"}</span>
                          </div>
                          <div className="matches-list">
                            {matches.map((m) => {
                              const homeTeam = state.teams.find((t) => t.id === m.homeTeamId)?.name ?? "TBD";
                              const awayTeam = state.teams.find((t) => t.id === m.awayTeamId)?.name ?? "TBD";
                              const isPlayed = m.homeScore !== null && m.awayScore !== null;

                              return (
                                <div key={m.id} className="match-item">
                                  <span className="home">{homeTeam}</span>
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
                                    {isPlayed ? (
                                      <>
                                        <div className="score-box">{m.homeScore} - {m.awayScore}</div>
                                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textAlign: "center" }}>
                                          SOT {m.homeShotsOnTarget} - {m.awayShotsOnTarget}
                                          <br />
                                          POS {((m.homePossessionSeconds ?? 0) / 60).toFixed(1)}m - {((m.awayPossessionSeconds ?? 0) / 60).toFixed(1)}m
                                        </div>
                                      </>
                                    ) : (
                                      <div className="vs-box">VS</div>
                                    )}
                                  </div>
                                  <span className="away">{awayTeam}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="panel table-panel" style={{ marginTop: "1.5rem" }}>
                <div className="panel-header">
                  <h3>All-Time Standings</h3>
                  <button
                    className="btn-secondary"
                    onClick={() => downloadFromUrl("/api/export/all-time.csv")}
                    disabled={isBusy}
                  >
                    Export All-Time CSV
                  </button>
                </div>
                <StatsTable rows={allTimeStats} />
              </div>
            </div>
          </>
        ) : (
          <div className="empty-canvas">
            <div className="icon">🏟️</div>
            <h2>Welcome to LeagueSim Manager</h2>
            <p>Your ultimate sports dashboard. Register your clubs and initiate a new campaign from the sidebar to kick off the simulation.</p>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Data Table Component ---

function StatsTable({ rows }: { rows: StatsRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("points");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aVal = a[sortKey as keyof typeof a];
      const bVal = b[sortKey as keyof typeof b];

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortOrder === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
  }, [rows, sortKey, sortOrder]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  };

  const getSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <span className="sort-icon inactive">↕</span>;
    return sortOrder === "asc" ? <span className="sort-icon active">↑</span> : <span className="sort-icon active">↓</span>;
  };

  if (rows.length === 0) {
    return <div className="table-empty">Run simulations to populate the standings table.</div>;
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th onClick={() => handleSort("teamName")}>Club {getSortIcon("teamName")}</th>
            <th className="num-col" onClick={() => handleSort("played")}>PLD {getSortIcon("played")}</th>
            <th className="num-col" onClick={() => handleSort("wins")}>W {getSortIcon("wins")}</th>
            <th className="num-col" onClick={() => handleSort("draws")}>D {getSortIcon("draws")}</th>
            <th className="num-col" onClick={() => handleSort("losses")}>L {getSortIcon("losses")}</th>
            <th className="num-col" title="Goals For" onClick={() => handleSort("goalsFor")}>GF {getSortIcon("goalsFor")}</th>
            <th className="num-col" title="Goals Against" onClick={() => handleSort("goalsAgainst")}>GA {getSortIcon("goalsAgainst")}</th>
            <th className="num-col" title="Goal Difference" onClick={() => handleSort("goalDiff")}>GD {getSortIcon("goalDiff")}</th>
            <th className="num-col" title="Shots on Target" onClick={() => handleSort("shotsOnTarget")}>SOT {getSortIcon("shotsOnTarget")}</th>
            <th className="num-col" title="Possession Percentage" onClick={() => handleSort("possessionPct")}>POS {getSortIcon("possessionPct")}</th>
            <th className="num-col" onClick={() => handleSort("points")} style={{ color: "var(--brand-gold)" }}>PTS {getSortIcon("points")}</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.teamId} className="table-row-hover">
              <td>
                <div className="team-cell">
                  <div className="crest">{row.teamName.charAt(0)}</div>
                  <span>{row.teamName}</span>
                </div>
              </td>
              <td className="num-col">{row.played}</td>
              <td className="num-col">{row.wins}</td>
              <td className="num-col">{row.draws}</td>
              <td className="num-col">{row.losses}</td>
              <td className="num-col">{row.goalsFor}</td>
              <td className="num-col">{row.goalsAgainst}</td>
              <td className="num-col">
                <span className={`diff-pill ${row.goalDiff > 0 ? "pos" : row.goalDiff < 0 ? "neg" : "neu"}`}>
                  {row.goalDiff > 0 ? "+" : ""}{row.goalDiff}
                </span>
              </td>
              <td className="num-col">{row.shotsOnTarget}</td>
              <td className="num-col">{row.possessionPct.toFixed(1)}%</td>
              <td className="num-col" style={{ fontWeight: 800, color: "var(--brand-gold)" }}>{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export default App;
