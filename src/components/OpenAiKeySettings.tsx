import { useState, type FormEvent } from 'react';
import { api } from '../api';

interface Props {
  configured: boolean;
  serverConfigured: boolean;
  refresh: () => Promise<void>;
}

export default function OpenAiKeySettings({ configured, serverConfigured, refresh }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    setStatus(null);
    try {
      await api.saveOpenAiApiKey(apiKey);
      setApiKey('');
      setStatus('OpenAI key saved.');
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save key');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setStatus(null);
    try {
      await api.deleteOpenAiApiKey();
      setStatus('OpenAI key removed.');
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not remove key');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="api-key-panel" onSubmit={(e) => void save(e)}>
      <div className="api-key-head">
        <span>OpenAI key</span>
        <span className={configured || serverConfigured ? 'key-state ready' : 'key-state'}>
          {configured ? 'saved' : serverConfigured ? 'server' : 'missing'}
        </span>
      </div>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={configured ? 'Replace saved key' : 'sk-...'}
        autoComplete="off"
      />
      <div className="api-key-actions">
        <button className="btn primary" type="submit" disabled={!apiKey.trim() || saving}>
          {configured ? 'Replace' : 'Save'}
        </button>
        {configured && (
          <button className="btn" type="button" onClick={() => void remove()} disabled={saving}>
            Remove
          </button>
        )}
      </div>
      {status && <div className="api-key-status">{status}</div>}
    </form>
  );
}
