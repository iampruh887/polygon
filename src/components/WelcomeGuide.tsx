import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppState } from '../types';
import type { View } from '../App';

interface Props {
  state: AppState;
  view: View;
  navigate: (view: View) => void;
}

interface GuideCopy {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  action?: {
    label: string;
    view: View;
  };
}

const GUIDE_VERSION = 'v1';
const VIEWS: View[] = ['home', 'pursuits', 'artifacts', 'connections', 'map', 'commons', 'discover'];

const GUIDE: Record<View, GuideCopy> = {
  home: {
    eyebrow: 'Start here',
    title: 'Welcome to Polygon',
    body: 'Polygon turns separate interests into one connected map. The vertices are the main rooms.',
    points: ['Create pursuits first.', 'Log artifacts inside them.', 'Scan for links once you have material.'],
    action: { label: 'Go to Pursuits', view: 'pursuits' },
  },
  pursuits: {
    eyebrow: 'Step 1',
    title: 'Name the sides of your work',
    body: 'A pursuit is one domain you care about: chess, watercolor, systems design, language study.',
    points: ['Add at least two pursuits for useful connections.', 'Public is opt-in; everything starts private.'],
    action: { label: 'Log an Artifact', view: 'artifacts' },
  },
  artifacts: {
    eyebrow: 'Step 2',
    title: 'Log concrete artifacts',
    body: 'Artifacts are the raw evidence: notes, code, images, puzzles, positions, drafts, and insights.',
    points: ['Choose a pursuit before saving.', 'Specific details make better connection scans.'],
    action: { label: 'See Connections', view: 'connections' },
  },
  connections: {
    eyebrow: 'Step 3',
    title: 'Ask Polygon to find links',
    body: 'After you have artifacts in more than one pursuit, scan for specific cross-domain connections.',
    points: ['Only new artifact pairs are scanned.', 'A no-result scan is useful too; silence beats vague links.'],
    action: { label: 'Open Map', view: 'map' },
  },
  map: {
    eyebrow: 'Your map',
    title: 'Watch the structure emerge',
    body: 'The map draws pursuits, artifacts, and the bridges Polygon has found between them.',
    points: ['Drag nodes to inspect dense areas.', 'Click bridge edges to read connection details.'],
    action: { label: 'Visit Commons', view: 'commons' },
  },
  commons: {
    eyebrow: 'Community',
    title: 'Share only what you choose',
    body: 'The Commons shows members, public pursuits, and public discoveries from shared work.',
    points: ['Flip a pursuit to public from the Pursuits page.', 'Private pursuits and artifacts stay private.'],
    action: { label: 'Open Discover', view: 'discover' },
  },
  discover: {
    eyebrow: 'The Atlas',
    title: 'Explore the shared pursuit graph',
    body: 'Discover merges public pursuits into one navigable Atlas with live community activity.',
    points: ['Open pursuit clusters to see who is working nearby.', 'Hide or report content from profile panels.'],
  },
};

function storageKey(userId: string, suffix: string): string {
  return `polygon-welcome:${GUIDE_VERSION}:${userId}:${suffix}`;
}

function readSeen(key: string): Set<View> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((v): v is View => VIEWS.includes(v as View)));
  } catch {
    return new Set();
  }
}

export default function WelcomeGuide({ state, view, navigate }: Props) {
  const keys = useMemo(
    () => ({
      active: storageKey(state.user.id, 'active'),
      seen: storageKey(state.user.id, 'seen'),
      skipped: storageKey(state.user.id, 'skipped'),
      completed: storageKey(state.user.id, 'completed'),
    }),
    [state.user.id],
  );

  const accountIsEmpty =
    state.pursuits.length === 0 && state.artifacts.length === 0 && state.connections.length === 0;

  const [active, setActive] = useState(false);
  const [seen, setSeen] = useState<Set<View>>(() => readSeen(keys.seen));

  useEffect(() => {
    const skipped = localStorage.getItem(keys.skipped) === '1';
    const completed = localStorage.getItem(keys.completed) === '1';
    const alreadyActive = localStorage.getItem(keys.active) === '1';
    const shouldStart = !skipped && !completed && (alreadyActive || accountIsEmpty);

    setActive(shouldStart);
    setSeen(readSeen(keys.seen));
    if (shouldStart) localStorage.setItem(keys.active, '1');
  }, [accountIsEmpty, keys.active, keys.completed, keys.seen, keys.skipped]);

  const finish = useCallback(() => {
    localStorage.removeItem(keys.active);
    localStorage.setItem(keys.completed, '1');
    setActive(false);
  }, [keys.active, keys.completed]);

  const markCurrentSeen = useCallback(() => {
    setSeen((current) => {
      const next = new Set(current).add(view);
      localStorage.setItem(keys.seen, JSON.stringify([...next]));
      if (VIEWS.every((v) => next.has(v))) {
        localStorage.removeItem(keys.active);
        localStorage.setItem(keys.completed, '1');
        setActive(false);
      }
      return next;
    });
  }, [keys.active, keys.completed, keys.seen, view]);

  const skipGuide = useCallback(() => {
    localStorage.setItem(keys.skipped, '1');
    localStorage.removeItem(keys.active);
    setActive(false);
  }, [keys.active, keys.skipped]);

  const copy = GUIDE[view];
  if (!active || seen.has(view)) return null;

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <div className="welcome-head">
          <span className="welcome-eyebrow">{copy.eyebrow}</span>
          <button className="btn ghost" onClick={skipGuide} aria-label="Skip welcome guide">
            ×
          </button>
        </div>
        <h2 id="welcome-title">{copy.title}</h2>
        <p>{copy.body}</p>
        <ul>
          {copy.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <div className="welcome-actions">
          <button className="btn" onClick={skipGuide}>
            Skip guide
          </button>
          {copy.action ? (
            <button
              className="btn primary"
              onClick={() => {
                markCurrentSeen();
                navigate(copy.action!.view);
              }}
            >
              {copy.action.label}
            </button>
          ) : (
            <button className="btn primary" onClick={finish}>
              Finish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
