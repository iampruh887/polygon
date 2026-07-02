import type { AppState, ArtifactKind, CommunityData } from './types';

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
  updatePursuit: (id: number, name: string, description: string, is_public: boolean) =>
    req(`/api/pursuits/${id}`, { method: 'PUT', body: JSON.stringify({ name, description, is_public }) }),
  deletePursuit: (id: number) => req(`/api/pursuits/${id}`, { method: 'DELETE' }),
  community: () => req<CommunityData>('/api/community'),
  importDb: async (file: File) => {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: await file.arrayBuffer(),
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      pursuits?: number;
      artifacts?: number;
      connections?: number;
    };
    if (!res.ok) throw new Error(body.error ?? `Import failed (${res.status})`);
    return body;
  },
  createArtifact: (pursuit_id: number, kind: ArtifactKind, title: string, content: string) =>
    req('/api/artifacts', { method: 'POST', body: JSON.stringify({ pursuit_id, kind, title, content }) }),
  updateArtifact: (id: number, kind: ArtifactKind, title: string, content: string) =>
    req(`/api/artifacts/${id}`, { method: 'PUT', body: JSON.stringify({ kind, title, content }) }),
  deleteArtifact: (id: number) => req(`/api/artifacts/${id}`, { method: 'DELETE' }),
  deleteConnection: (id: number) => req(`/api/connections/${id}`, { method: 'DELETE' }),
  saveOpenAiApiKey: (apiKey: string) =>
    req('/api/settings/openai-key', { method: 'PUT', body: JSON.stringify({ api_key: apiKey }) }),
  deleteOpenAiApiKey: () => req('/api/settings/openai-key', { method: 'DELETE' }),
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
