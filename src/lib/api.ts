import { AppState } from "../types";

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let message = "Request failed.";

    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Ignore malformed error bodies and keep the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function fetchState() {
  return request<AppState>("/api/state");
}

export function createTeam(name: string) {
  return request<AppState>("/api/teams", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function renameTeam(teamId: string, name: string) {
  return request<AppState>(`/api/teams/${teamId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function removeTeam(teamId: string) {
  return request<AppState>(`/api/teams/${teamId}`, {
    method: "DELETE",
  });
}

export function createSeason(name: string) {
  return request<AppState>("/api/seasons", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function removeSeason(seasonId: string) {
  return request<AppState>(`/api/seasons/${seasonId}`, {
    method: "DELETE",
  });
}

export function simulateRound(seasonId: string) {
  return request<AppState>(`/api/seasons/${seasonId}/simulate-round`, {
    method: "POST",
  });
}

export function simulateSeason(seasonId: string) {
  return request<AppState>(`/api/seasons/${seasonId}/simulate-season`, {
    method: "POST",
  });
}
