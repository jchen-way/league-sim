import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createSeason as createSeasonRequest,
  createTeam,
  fetchCurrentUser,
  fetchState,
  logIn,
  logOut,
  removeSeason,
  removeTeam,
  renameTeam,
  signUp,
  simulateRound as simulateRoundRequest,
  simulateSeason as simulateSeasonRequest,
} from "./lib/api";
import { downloadFromUrl, formatDateTime } from "./lib/utils";
import { buildAllTimeStats, buildSeasonStats, getNextRound } from "./lib/simulator";
import { AppState, AuthUser, Match, MatchEvent } from "./types";

const emptyState: AppState = { teams: [], seasons: [] };

type StatsRow = ReturnType<typeof buildSeasonStats>[0];
type SortOrder = "asc" | "desc";
type SortKey = keyof StatsRow;
type PublicView = "landing" | "login" | "signup";

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [publicView, setPublicView] = useState<PublicView>("landing");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthBusy, setIsAuthBusy] = useState(true);

  useEffect(() => {
    void bootstrapSession();
  }, []);

  async function bootstrapSession() {
    setIsAuthBusy(true);
    try {
      const response = await fetchCurrentUser();
      setUser(response.user);
    } catch (error) {
      setAuthMessage(getErrorMessage(error));
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function handleAuthSubmit(event: FormEvent) {
    event.preventDefault();
    setIsAuthBusy(true);

    try {
      const response = publicView === "signup"
        ? await signUp(authName.trim(), authEmail.trim(), authPassword)
        : await logIn(authEmail.trim(), authPassword);

      setUser(response.user);
      setAuthPassword("");
      setAuthName("");
      setAuthMessage("");
    } catch (error) {
      setAuthMessage(getErrorMessage(error));
    } finally {
      setIsAuthBusy(false);
    }
  }

  async function handleLogout() {
    setIsAuthBusy(true);
    try {
      await logOut();
      setUser(null);
      setPublicView("landing");
      setAuthPassword("");
      setAuthMessage("");
    } catch (error) {
      setAuthMessage(getErrorMessage(error));
    } finally {
      setIsAuthBusy(false);
    }
  }

  function handleChangePublicView(nextView: PublicView) {
    setAuthMessage("");
    setPublicView(nextView);
  }

  if (!user) {
    return (
      <PublicSite
        view={publicView}
        authName={authName}
        authEmail={authEmail}
        authPassword={authPassword}
        authMessage={authMessage}
        isBusy={isAuthBusy}
        onChangeView={handleChangePublicView}
        onNameChange={setAuthName}
        onEmailChange={setAuthEmail}
        onPasswordChange={setAuthPassword}
        onSubmit={handleAuthSubmit}
      />
    );
  }

  return <DashboardShell user={user} onLogout={handleLogout} />;
}

function PublicSite(props: {
  view: PublicView;
  authName: string;
  authEmail: string;
  authPassword: string;
  authMessage: string;
  isBusy: boolean;
  onChangeView: (view: PublicView) => void;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const {
    view,
    authName,
    authEmail,
    authPassword,
    authMessage,
    isBusy,
    onChangeView,
    onNameChange,
    onEmailChange,
    onPasswordChange,
    onSubmit,
  } = props;

  if (view === "login" || view === "signup") {
    return (
      <AuthPage
        mode={view}
        authName={authName}
        authEmail={authEmail}
        authPassword={authPassword}
        authMessage={authMessage}
        isBusy={isBusy}
        onBack={() => onChangeView("landing")}
        onSwitchMode={() => onChangeView(view === "signup" ? "login" : "signup")}
        onNameChange={onNameChange}
        onEmailChange={onEmailChange}
        onPasswordChange={onPasswordChange}
        onSubmit={onSubmit}
      />
    );
  }

  return <LandingPage onChangeView={onChangeView} />;
}

function LandingPage({ onChangeView }: { onChangeView: (view: PublicView) => void }) {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <button className="brand-mark brand-button" type="button" onClick={() => onChangeView("landing")}>
          <span className="brand-badge" aria-hidden="true">
            <span className="brand-glyph" />
          </span>
          <span className="brand-copy">
            <strong>LeagueSim</strong>
            <small>Season simulation workspace</small>
          </span>
        </button>

        <nav className="landing-nav">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <a href="#exports">Exports</a>
        </nav>

        <div className="landing-actions">
          <button className="btn-ghost" type="button" onClick={() => onChangeView("login")}>Log in</button>
          <button className="btn-primary" type="button" onClick={() => onChangeView("signup")}>Create account</button>
        </div>
      </header>

      <main className="landing-content">
        <section className="hero-layout">
          <div className="hero-column">
            <p className="section-label">League management without spreadsheet drift</p>
            <h1>Run your league.</h1>
            <p className="hero-summary">
              Register clubs, generate a season, simulate rounds, and track the table in one workspace.
            </p>

            <div className="hero-actions">
              <button className="btn-primary btn-large" type="button" onClick={() => onChangeView("signup")}>
                Start a league
              </button>
              <button className="btn-secondary btn-large" type="button" onClick={() => onChangeView("login")}>
                Return to dashboard
              </button>
            </div>

            <div className="signal-strip">
              <div>
                <strong>Team registry</strong>
                <span>Create, rename, and remove clubs.</span>
              </div>
              <div>
                <strong>Season engine</strong>
                <span>Round-robin schedule generation and simulation.</span>
              </div>
              <div>
                <strong>Data exports</strong>
                <span>Season, round, team, and all-time CSV output.</span>
              </div>
            </div>
          </div>

          <div className="hero-preview">
            <div className="preview-frame">
              <div className="preview-topline">
                <span>Platform overview</span>
                <span>Workflow preview</span>
              </div>

              <div className="preview-overview preview-overview-dual">
                <div className="preview-stat-card">
                  <span>Team setup</span>
                  <strong>Create clubs</strong>
                  <small>Rename, remove, organize</small>
                </div>
                <div className="preview-stat-card">
                  <span>Season engine</span>
                  <strong>Generate schedule</strong>
                  <small>Round-robin structure</small>
                </div>
              </div>

              <div className="preview-season-card">
                <div className="preview-season-header">
                  <div>
                    <strong>Simulation flow</strong>
                    <span>From setup to export</span>
                  </div>
                  <em>Core loop</em>
                </div>

                <div className="preview-progress">
                  <span style={{ width: "100%" }} />
                </div>

                <div className="preview-actions">
                  <span>Add teams</span>
                  <span>Create season</span>
                  <span>Simulate rounds</span>
                  <span>Export CSV</span>
                </div>
              </div>

              <div className="preview-capabilities">
                <div className="preview-capability">
                  <strong>Teams</strong>
                  <span>Create and manage the league roster.</span>
                </div>
                <div className="preview-capability">
                  <strong>Seasons</strong>
                  <span>Generate schedules and follow round progress.</span>
                </div>
                <div className="preview-capability">
                  <strong>Exports</strong>
                  <span>Download standings and match data as CSV.</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="landing-section">
          <div className="section-heading">
            <p className="section-label">How it works</p>
            <h2>A direct workflow from setup to standings.</h2>
          </div>

          <div className="workflow-grid">
            <article className="workflow-card">
              <span>01</span>
              <h3>Register clubs</h3>
              <p>Build the pool of teams that will participate in the league.</p>
            </article>
            <article className="workflow-card">
              <span>02</span>
              <h3>Create a season</h3>
              <p>Generate a complete round-robin schedule from your registered teams.</p>
            </article>
            <article className="workflow-card">
              <span>03</span>
              <h3>Simulate progress</h3>
              <p>Run the next round or complete the entire season with one action.</p>
            </article>
            <article className="workflow-card">
              <span>04</span>
              <h3>Export results</h3>
              <p>Download standings and match data as CSV whenever you need it.</p>
            </article>
          </div>
        </section>

        <section id="features" className="landing-section split-section">
          <div className="section-heading">
            <p className="section-label">Core features</p>
            <h2>Everything needed to run and track a simulated league season.</h2>
          </div>

          <div className="feature-stack">
            <article className="feature-panel">
              <h3>Season and all-time standings</h3>
              <p>Track current campaign tables alongside combined historical performance.</p>
            </article>
            <article className="feature-panel">
              <h3>Per-round and per-team exports</h3>
              <p>Move data out of the app without rebuilding reports manually.</p>
            </article>
            <article className="feature-panel">
              <h3>Protected personal workspace</h3>
              <p>Your teams and seasons are scoped to your account after login.</p>
            </article>
          </div>
        </section>

        <section id="exports" className="landing-section cta-panel">
          <div>
            <p className="section-label">Ready to use</p>
            <h2>Start managing your league in a dedicated workspace.</h2>
            <p className="cta-copy">
              Create an account to set up clubs, run simulations, and keep your own season data separate from everyone else.
            </p>
          </div>

          <div className="cta-actions">
            <button className="btn-primary btn-large" type="button" onClick={() => onChangeView("signup")}>
              Create account
            </button>
            <button className="btn-ghost btn-large" type="button" onClick={() => onChangeView("login")}>
              Log in
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function AuthPage(props: {
  mode: "login" | "signup";
  authName: string;
  authEmail: string;
  authPassword: string;
  authMessage: string;
  isBusy: boolean;
  onBack: () => void;
  onSwitchMode: () => void;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const {
    mode,
    authName,
    authEmail,
    authPassword,
    authMessage,
    isBusy,
    onBack,
    onSwitchMode,
    onNameChange,
    onEmailChange,
    onPasswordChange,
    onSubmit,
  } = props;

  const isSignup = mode === "signup";

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <button className="auth-back" type="button" onClick={onBack}>Back to landing</button>

        <div className="auth-layout">
          <section className="auth-intro">
            <p className="section-label">{isSignup ? "Create account" : "Log in"}</p>
            <h1>{isSignup ? "Set up your league workspace." : "Pick up where your season left off."}</h1>
            <p>
              {isSignup
                ? "Your account gets a private workspace for teams, seasons, standings, and exports."
                : "Sign in to access your teams, current season state, and CSV exports."}
            </p>
          </section>

          <section className="auth-panel">
            <form className="auth-form" onSubmit={onSubmit}>
              {isSignup && (
                <label>
                  <span>Name</span>
                  <input
                    value={authName}
                    onChange={(event) => onNameChange(event.target.value)}
                    placeholder="Your name"
                    disabled={isBusy}
                  />
                </label>
              )}

              <label>
                <span>Email</span>
                <input
                  value={authEmail}
                  onChange={(event) => onEmailChange(event.target.value)}
                  placeholder="name@example.com"
                  type="email"
                  disabled={isBusy}
                />
              </label>

              <label>
                <span>Password</span>
                <input
                  value={authPassword}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="At least 8 characters"
                  type="password"
                  disabled={isBusy}
                />
              </label>

              <button className="btn-primary auth-submit" type="submit" disabled={isBusy}>
                {isBusy ? "Working..." : isSignup ? "Create account" : "Log in"}
              </button>
            </form>

            <p className="auth-message">{authMessage}</p>

            <p className="auth-switch-copy">
              {isSignup ? "Already have an account?" : "Need an account?"}
              <button className="auth-inline-link" type="button" onClick={onSwitchMode}>
                {isSignup ? "Log in" : "Create one"}
              </button>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function DashboardShell({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [teamName, setTeamName] = useState("");
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState("");
  const [seasonName, setSeasonName] = useState("");
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [expandedRoundNumber, setExpandedRoundNumber] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("Loading your league operations room...");
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

  const nextRoundMatch = activeSeason ? getNextRound(activeSeason) : null;

  useEffect(() => {
    if (!activeSeason) {
      setExpandedRoundNumber(null);
      return;
    }

    const lastRound = activeSeason.rounds[activeSeason.rounds.length - 1] ?? null;
    const preferredRound = getNextRound(activeSeason)?.number ?? lastRound?.number ?? null;
    if (preferredRound === null) {
      setExpandedRoundNumber(null);
      return;
    }

    setExpandedRoundNumber((current) =>
      current && activeSeason.rounds.some((round) => round.number === current) ? current : preferredRound,
    );
  }, [activeSeason]);

  async function loadState(message = "Command center synced.") {
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

  async function runMutation(work: () => Promise<AppState>, successMessage: string, after?: (nextState: AppState) => void) {
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
    void runMutation(() => createTeam(trimmed), `Added ${trimmed}.`, () => setTeamName(""));
  }

  function handleSaveEditTeam(event: FormEvent) {
    event.preventDefault();
    const trimmed = editTeamName.trim();
    if (!trimmed || !editingTeamId) {
      setEditingTeamId(null);
      return;
    }
    void runMutation(() => renameTeam(editingTeamId, trimmed), `Team renamed to ${trimmed}.`, () => setEditingTeamId(null));
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

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-badge" aria-hidden="true">
            <span className="brand-glyph" />
          </div>
          <div className="sidebar-brand-copy">
            <h1>LeagueSim</h1>
            <p>{user.name}</p>
          </div>
        </div>

        <div className="sidebar-content">
          <div className="status-card">
            <span>Session status</span>
            <strong>{feedback}</strong>
            <button className="btn-secondary" type="button" onClick={() => void onLogout()}>
              Log out
            </button>
          </div>

          <div className="side-section">
            <h3>Campaigns</h3>
            <form className="form-row" onSubmit={handleCreateSeason}>
              <input
                value={seasonName}
                onChange={(event) => setSeasonName(event.target.value)}
                placeholder="New season name..."
                disabled={isBusy}
              />
              <button type="submit" className="btn-primary" disabled={isBusy}>Add</button>
            </form>

            <div className="side-section compact-stack">
              {state.seasons.length === 0 && <span className="muted-copy">No campaigns created.</span>}
              {state.seasons.map((season) => (
                <div key={season.id} className="nav-item-row">
                  <button
                    className={`nav-item ${selectedSeasonId === season.id ? "active" : ""}`}
                    onClick={() => setSelectedSeasonId(season.id)}
                    disabled={isBusy && selectedSeasonId !== season.id}
                  >
                    <span>{season.name}</span>
                    <span className="nav-item-meta">
                      {season.rounds.filter((round) => round.simulatedAt).length}/{season.rounds.length}
                    </span>
                  </button>
                  <button
                    className="btn-danger season-delete"
                    onClick={() => void runMutation(() => removeSeason(season.id), `${season.name} removed.`)}
                    disabled={isBusy}
                    type="button"
                    aria-label={`Delete ${season.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="side-section">
            <h3>Registered Clubs</h3>
            <form className="form-row" onSubmit={handleAddTeam}>
              <input
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="New club name..."
                disabled={isBusy}
              />
              <button type="submit" className="btn-primary" disabled={isBusy}>Add</button>
            </form>

            <div className="side-section compact-stack">
              {state.teams.map((team) => (
                <div key={team.id} className="list-item">
                  {editingTeamId === team.id ? (
                    <form className="form-row full-width" onSubmit={handleSaveEditTeam}>
                      <input
                        autoFocus
                        value={editTeamName}
                        onChange={(event) => setEditTeamName(event.target.value)}
                        disabled={isBusy}
                      />
                      <button type="button" className="btn-secondary" onClick={() => setEditingTeamId(null)} disabled={isBusy}>×</button>
                    </form>
                  ) : (
                    <>
                      <div className="team-cell">
                        <div className="crest">{team.name.charAt(0)}</div>
                        <span className="list-item-name">{team.name}</span>
                      </div>
                      <div className="inline-actions">
                        <button className="btn-text" type="button" onClick={() => downloadFromUrl(`/api/export/teams/${team.id}.csv`)} disabled={isBusy}>Team CSV</button>
                        <button className="btn-text" type="button" onClick={() => { setEditingTeamId(team.id); setEditTeamName(team.name); }} disabled={isBusy}>Edit</button>
                        <button className="btn-danger" type="button" onClick={() => void runMutation(() => removeTeam(team.id), "Team removed.")} disabled={isBusy}>×</button>
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
                <button className="btn-primary sim-btn" disabled={isBusy || !nextRoundMatch} onClick={() => void runMutation(() => simulateRoundRequest(activeSeason.id), `Round ${nextRoundMatch?.number ?? ""} simulated for ${activeSeason.name}.`)}>
                  {nextRoundMatch ? `Simulate Matchweek ${nextRoundMatch.number}` : "Campaign Finished"}
                </button>
                <button className="btn-secondary sim-btn" disabled={isBusy || !nextRoundMatch} onClick={() => void runMutation(() => simulateSeasonRequest(activeSeason.id), `${activeSeason.name} completed.`)}>
                  Fast Forward Season
                </button>
              </div>
            </header>

            <div className="dashboard-content">
              <div className="grid-layout">
                <div className="left-column">
                  <div className="panel table-panel">
                    <div className="panel-header">
                      <h3>League Standings</h3>
                      <div className="inline-actions">
                        <button className="btn-secondary" onClick={() => downloadFromUrl(`/api/export/seasons/${activeSeason.id}.csv`)} disabled={isBusy}>Season + Matches CSV</button>
                        <button className="btn-secondary" onClick={() => downloadFromUrl("/api/export/all-time.csv")} disabled={isBusy}>All-Time Table CSV</button>
                      </div>
                    </div>
                    <StatsTable rows={activeSeasonStats} />
                  </div>

                  <div className="panel table-panel">
                    <div className="panel-header">
                      <h3>All-Time Standings</h3>
                      <button className="btn-secondary" onClick={() => downloadFromUrl("/api/export/all-time.csv")} disabled={isBusy}>Export All-Time Table CSV</button>
                    </div>
                    <StatsTable rows={allTimeStats} />
                  </div>
                </div>

                <div className="panel right-column-panel">
                  <div className="panel-header">
                    <h3>Match Results</h3>
                  </div>

                  <div className="rounds-list">
                    {activeSeason.rounds.length === 0 && <div className="table-empty">No matches scheduled.</div>}
                    {activeSeason.rounds.map((round) => {
                      const matches = activeSeason.matches.filter((match) => round.matchIds.includes(match.id));
                      const isExpanded = expandedRoundNumber === round.number;
                      return (
                        <div key={round.number} className={`round-block ${isExpanded ? "round-block-expanded" : ""}`}>
                          <button
                            className="round-toggle"
                            type="button"
                            onClick={() => setExpandedRoundNumber((current) => (current === round.number ? null : round.number))}
                          >
                            <div className="round-toggle-main">
                              <span>Round {round.number}</span>
                              <small>{matches.length} matches</small>
                            </div>
                            <div className="round-toggle-meta">
                              <span>{round.simulatedAt ? formatDateTime(round.simulatedAt) : "Upcoming"}</span>
                              <strong>{isExpanded ? "−" : "+"}</strong>
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="matches-list">
                              {matches.map((match) => {
                                const homeTeam = state.teams.find((team) => team.id === match.homeTeamId)?.name ?? "TBD";
                                const awayTeam = state.teams.find((team) => team.id === match.awayTeamId)?.name ?? "TBD";
                                const isPlayed = match.homeScore !== null && match.awayScore !== null;

                                return (
                                  <div key={match.id} className="match-item compact-match-item">
                                    <div className="compact-match-line">
                                      <span className="compact-team">{homeTeam}</span>
                                      {isPlayed ? (
                                        <span className="score-box">{match.homeScore} - {match.awayScore}</span>
                                      ) : (
                                        <span className="vs-box">VS</span>
                                      )}
                                      <span className="compact-team compact-team-away">{awayTeam}</span>
                                    </div>

                                    {isPlayed && (
                                      <>
                                        <div className="match-meta compact-match-meta">
                                          <span>SOT {match.homeShotsOnTarget} - {match.awayShotsOnTarget}</span>
                                          <span>POS {((match.homePossessionSeconds ?? 0) / 60).toFixed(1)}m - {((match.awayPossessionSeconds ?? 0) / 60).toFixed(1)}m</span>
                                        </div>
                                        <MatchTimeline
                                          match={match}
                                          homeTeam={homeTeam}
                                          awayTeam={awayTeam}
                                        />
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-canvas">
            <div className="icon">🏟️</div>
            <h2>Welcome to the control room</h2>
            <p>Register clubs and start a season from the left rail to begin simulating.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function MatchTimeline({
  match,
  homeTeam,
  awayTeam,
}: {
  match: Match;
  homeTeam: string;
  awayTeam: string;
}) {
  if (!match.events.length) {
    return null;
  }

  const sideCounts = new Map<string, number>();

  return (
    <div className="timeline-card">
      <div className="timeline-track">
        <span className="timeline-track-line" />
        {match.events.map((event) => {
          const sideKey = `${event.teamId}:${event.minute}`;
          const sideIndex = sideCounts.get(sideKey) ?? 0;
          sideCounts.set(sideKey, sideIndex + 1);
          const basePercent = (event.minute / 90) * 100;
          const direction = basePercent > 88 ? -1 : 1;
          const horizontalOffset = sideIndex * 12 * direction;
          const clampedPercent = Math.max(4, Math.min(96, basePercent));

          return (
            <div
              key={event.id}
              className={`timeline-marker ${event.teamId === match.homeTeamId ? "timeline-marker-home" : "timeline-marker-away"}`}
              style={{ left: `calc(${clampedPercent}% + ${horizontalOffset}px)` }}
              title={`${formatEventMinute(event)} ${describeEvent(event, event.teamId === match.homeTeamId ? homeTeam : awayTeam)}`}
            >
              <span className={`timeline-icon timeline-icon-${event.type}`}>{getEventIcon(event.type)}</span>
            </div>
          );
        })}
      </div>

      <div className="timeline-list">
        {match.events.map((event) => (
          <div key={event.id} className="timeline-list-item">
            <span className={`timeline-list-icon timeline-icon-${event.type}`}>{getEventIcon(event.type)}</span>
            <strong>{formatEventMinute(event)}</strong>
            <span>{describeEvent(event, event.teamId === match.homeTeamId ? homeTeam : awayTeam)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getEventIcon(type: MatchEvent["type"]) {
  switch (type) {
    case "goal":
      return "●";
    case "yellow_card":
      return "■";
    case "red_card":
      return "■";
    case "substitution":
      return "⇄";
  }
}

function formatEventMinute(event: MatchEvent) {
  return event.stoppageMinute ? `${event.minute}+${event.stoppageMinute}'` : `${event.minute}'`;
}

function describeEvent(event: MatchEvent, teamName: string) {
  switch (event.type) {
    case "goal":
      return `${teamName} goal by ${event.playerName}`;
    case "yellow_card":
      return `${event.playerName} booked for ${teamName}`;
    case "red_card":
      return `${event.playerName} sent off for ${teamName}`;
    case "substitution":
      return `${teamName} sub: ${event.playerName} on for ${event.secondaryPlayerName ?? "teammate"}`;
  }
}

function StatsTable({ rows }: { rows: StatsRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("points");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aValue = a[sortKey];
      const bValue = b[sortKey];

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortOrder === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      }

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
      }

      return 0;
    });
  }, [rows, sortKey, sortOrder]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(key);
    setSortOrder("desc");
  }

  function getSortIcon(key: SortKey) {
    if (sortKey !== key) {
      return <span className="sort-icon inactive">↕</span>;
    }
    return sortOrder === "asc" ? <span className="sort-icon active">↑</span> : <span className="sort-icon active">↓</span>;
  }

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
            <th className="num-col" onClick={() => handleSort("goalsFor")}>GF {getSortIcon("goalsFor")}</th>
            <th className="num-col" onClick={() => handleSort("goalsAgainst")}>GA {getSortIcon("goalsAgainst")}</th>
            <th className="num-col" onClick={() => handleSort("goalDiff")}>GD {getSortIcon("goalDiff")}</th>
            <th className="num-col" onClick={() => handleSort("shotsOnTarget")}>SOT {getSortIcon("shotsOnTarget")}</th>
            <th className="num-col" onClick={() => handleSort("possessionPct")}>POS {getSortIcon("possessionPct")}</th>
            <th className="num-col points-col" onClick={() => handleSort("points")}>PTS {getSortIcon("points")}</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.teamId}>
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
              <td className="num-col points-col">{row.points}</td>
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
