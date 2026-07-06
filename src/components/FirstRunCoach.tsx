import { useEffect, useState } from 'react';
import type { AppState } from '../types';
import type { View } from '../App';

interface Props {
  state: AppState;
  navigate: (v: View) => void;
}

// One quiet coach-mark, not a seven-screen tour. A freshly seeded account lands
// with two example pursuits and one real cross-domain connection already on the
// map — so the value is visible immediately. This just points the user at the
// one action that matters next: log their own first artifact. It shows only
// while the account is still all-examples, and retires the moment there's any
// real data (or the user dismisses it).
export default function FirstRunCoach({ state, navigate }: Props) {
  const key = `polygon-coach:v1:${state.user.id}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(key) === '1');

  const hasExamples =
    state.pursuits.some((p) => p.is_example) || state.artifacts.some((a) => a.is_example);
  const hasReal =
    state.pursuits.some((p) => !p.is_example) || state.artifacts.some((a) => !a.is_example);

  // Once real data exists, this milestone is over — persist so it never returns.
  useEffect(() => {
    if (hasReal && localStorage.getItem(key) !== '1') localStorage.setItem(key, '1');
  }, [hasReal, key]);

  if (dismissed || !hasExamples || hasReal) return null;

  const dismiss = () => {
    localStorage.setItem(key, '1');
    setDismissed(true);
  };

  return (
    <div className="coach-mark" role="status">
      <button className="coach-close" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
      <p className="coach-eyebrow">Two examples are already on your map</p>
      <p className="coach-body">
        Open <strong>Connections</strong> to see the link Polygon drew between them — then log your
        own first artifact. The examples are yours to delete anytime.
      </p>
      <div className="coach-actions">
        <button className="btn ghost" onClick={() => navigate('connections')}>
          See the example link
        </button>
        <button
          className="btn primary"
          onClick={() => {
            dismiss();
            navigate('artifacts');
          }}
        >
          Log your first real thing →
        </button>
      </div>
    </div>
  );
}
