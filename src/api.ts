import type { AppState, ArtifactKind } from './types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  state: () => req<AppState>('/api/state'),
  createPursuit: (name: string, description: string) =>
    req('/api/pursuits', { method: 'POST', body: JSON.stringify({ name, description }) }),
  deletePursuit: (id: number) => req(`/api/pursuits/${id}`, { method: 'DELETE' }),
  createArtifact: (pursuit_id: number, kind: ArtifactKind, title: string, content: string) =>
    req('/api/artifacts', { method: 'POST', body: JSON.stringify({ pursuit_id, kind, title, content }) }),
  updateArtifact: (id: number, kind: ArtifactKind, title: string, content: string) =>
    req(`/api/artifacts/${id}`, { method: 'PUT', body: JSON.stringify({ kind, title, content }) }),
  deleteArtifact: (id: number) => req(`/api/artifacts/${id}`, { method: 'DELETE' }),
  deleteConnection: (id: number) => req(`/api/connections/${id}`, { method: 'DELETE' }),
  scan: async () => {
    const res = await fetch('/api/scan', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
      pairs_scanned?: number;
      pairs_remaining?: number;
    };
    return { httpOk: res.ok, ...body };
  },
};
