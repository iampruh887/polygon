import { useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import type { AppState, ArtifactKind } from '../types';

interface Props {
  state: AppState;
  refresh: () => Promise<void>;
}

const KINDS: ArtifactKind[] = ['note', 'code', 'image', 'puzzle'];

// Images are stored inline in the artifact's `content` column as a base64 data
// URL — no storage bucket needed, and the server already accepts 4mb bodies.
// What actually has to fit that limit is the *encoded* data URL, so we budget
// against its byte length (base64 inflates raw bytes by ~33%) and leave headroom
// for the rest of the JSON body.
const TARGET_DATAURL_BYTES = Math.floor(3.2 * 1024 * 1024);
// Longest edge we downscale to before touching quality — plenty for on-screen
// display, and the first big lever for shrinking a huge photo.
const MAX_IMAGE_DIMENSION = 2000;

function isImageSrc(s: string): boolean {
  return /^data:image\//.test(s) || /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(s);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode that image'));
    img.src = src;
  });
}

// Re-encode an image to a JPEG data URL that fits `targetBytes`. We shrink the
// cheapest way first (quality), then step the dimensions down and try again,
// so a photo loses detail before it loses resolution. Returns the smallest
// data URL we produced even if it never quite reached the target.
async function compressImage(sourceDataUrl: string, targetBytes: number): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return sourceDataUrl; // no canvas support — fall back to the original

  // Start no larger than MAX_IMAGE_DIMENSION on the longest edge.
  let scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  let best = sourceDataUrl;

  for (let pass = 0; pass < 6; pass++) {
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    // JPEG has no alpha; paint white first so transparent PNGs don't go black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
      const candidate = canvas.toDataURL('image/jpeg', quality);
      if (candidate.length < best.length) best = candidate;
      if (candidate.length <= targetBytes) return candidate;
    }
    scale *= 0.75; // still too big at every quality — drop the resolution and retry
  }
  return best;
}

// Obsidian-Polygon mix: a file-list rail on the left, a quiet full-height
// writing surface on the right. The editor is the page; chrome stays out of
// the way of the words.
export default function ArtifactEditor({ state, refresh }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pursuitId, setPursuitId] = useState<number | ''>('');
  const [kind, setKind] = useState<ArtifactKind>('note');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function loadArtifact(id: number) {
    const a = state.artifacts.find((x) => x.id === id);
    if (!a) return;
    setSelectedId(a.id);
    setPursuitId(a.pursuit_id);
    setKind(a.kind);
    setTitle(a.title);
    setContent(a.content);
    setStatus(null);
    setDirty(false);
  }

  function startNew() {
    setSelectedId(null);
    setTitle('');
    setContent('');
    setStatus(null);
    setDirty(false);
    // keep pursuit + kind — logging several artifacts in a row usually stays
    // within the same pursuit, and re-picking every time is friction.
  }

  async function save() {
    if (pursuitId === '' || !title.trim()) return;
    try {
      if (selectedId === null) {
        const created = (await api.createArtifact(pursuitId, kind, title, content)) as { id: number };
        setSelectedId(created.id);
        setStatus('Logged.');
        toast(`Artifact “${title.trim()}” logged`);
      } else {
        await api.updateArtifact(selectedId, kind, title, content);
        setStatus('Saved.');
        toast('Artifact saved');
      }
      setDirty(false);
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save');
    }
  }

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('That is not an image file');
      return;
    }
    try {
      let dataUrl = await readAsDataUrl(file);
      let compressed = false;
      // SVGs are vector text, not raster — canvas can't meaningfully shrink them,
      // so we only compress bitmap formats that overflow the budget.
      if (dataUrl.length > TARGET_DATAURL_BYTES && file.type !== 'image/svg+xml') {
        setStatus('Compressing image…');
        dataUrl = await compressImage(dataUrl, TARGET_DATAURL_BYTES);
        compressed = true;
      }
      if (dataUrl.length > TARGET_DATAURL_BYTES) {
        setStatus('Image is too large even after compression — try a smaller one');
        return;
      }
      setContent(dataUrl);
      setDirty(true);
      setStatus(compressed ? 'Image compressed to fit' : null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not read that image');
    }
  }

  const selected = selectedId !== null ? state.artifacts.find((a) => a.id === selectedId) : null;

  return (
    <div className="editor-layout">
      <aside className="editor-rail">
        <button className="btn primary" style={{ width: '100%' }} onClick={startNew}>
          + New artifact
        </button>
        <div className="rail-list">
          {state.artifacts.length === 0 && (
            <p className="empty">Nothing logged yet. The first artifact starts the map.</p>
          )}
          {state.artifacts.map((a) => (
            <div
              key={a.id}
              className={`rail-item ${a.id === selectedId ? 'active' : ''}`}
              onClick={() => loadArtifact(a.id)}
            >
              <div className="rail-title">
                {a.title}
                {a.is_example && <span className="example-badge">example</span>}
              </div>
              <div className="rail-meta">
                {a.pursuit_name} · {a.kind} · {new Date(a.created_at + 'Z').toLocaleDateString()}
              </div>
              <button
                className="btn ghost delete"
                title="Delete artifact (its connections go with it)"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${a.title}"? Its connections are removed too.`)) {
                    await api.deleteArtifact(a.id);
                    toast(`“${a.title}” deleted`, 'error');
                    if (a.id === selectedId) startNew();
                    await refresh();
                  }
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="editor-pane">
        <input
          className="editor-title"
          placeholder="What did you make or figure out?"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
        />
        <div className="editor-meta">
          <select
            value={pursuitId}
            onChange={(e) => {
              setPursuitId(e.target.value === '' ? '' : Number(e.target.value));
              setDirty(true);
            }}
          >
            <option value="">Pursuit…</option>
            {state.pursuits.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ArtifactKind);
              setDirty(true);
            }}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {selected && <span className="editor-when">logged {new Date(selected.created_at + 'Z').toLocaleString()}</span>}
          <span className="editor-status">{dirty ? 'unsaved' : status}</span>
          <button className="btn primary" onClick={() => void save()} disabled={pursuitId === '' || !title.trim()}>
            {selectedId === null ? 'Log artifact' : 'Save'}
          </button>
        </div>
        {state.pursuits.length === 0 && (
          <div className="notice" style={{ marginBottom: 12 }}>
            No pursuits yet — create one on the Pursuits page first.
          </div>
        )}
        {kind === 'image' ? (
          <div className="editor-body image-drop">
            {isImageSrc(content) ? (
              <div className="image-preview">
                <img src={content} alt={title || 'artifact image'} />
                <div className="image-actions">
                  <label className="btn">
                    Replace image
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => void onPickImage(e.target.files?.[0])}
                    />
                  </label>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setContent('');
                      setDirty(true);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="image-dropzone">
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => void onPickImage(e.target.files?.[0])}
                />
                <span className="image-dropzone-title">Upload an image</span>
                <span className="image-dropzone-hint">PNG, JPG, GIF, WebP or SVG · large images are compressed automatically</span>
                {content.trim() && (
                  // Legacy image artifacts stored a text description in content —
                  // keep it visible so nothing is silently lost.
                  <span className="image-dropzone-legacy">{content}</span>
                )}
              </label>
            )}
          </div>
        ) : (
          <textarea
            className={`editor-body ${kind === 'code' ? 'code' : ''}`}
            placeholder="The artifact itself — the note, the code, the insight, the position. Specifics feed the connection engine."
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                void save();
              }
            }}
          />
        )}
      </main>
    </div>
  );
}
