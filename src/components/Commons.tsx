import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AppState, CommunityData } from '../types';

interface Props {
  state: AppState;
}

// The Commons: every member's public pursuits, and a feed of connections
// discovered inside public pursuits. Private stays private — pursuits are
// opt-in via the ○/◉ toggle on the Pursuits page.
export default function Commons({ state }: Props) {
  const [data, setData] = useState<CommunityData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .community()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the Commons'));
  }, []);

  if (error) return <div className="page narrow"><div className="notice">{error}</div></div>;
  if (!data) return <div className="page narrow"><p className="empty">Opening the Commons…</p></div>;

  return (
    <div className="page">
      <section>
        <h2>
          Members <span className="count">{data.members.length}</span>
        </h2>
        <hr className="section-rule" />
        <div className="member-row">
          {data.members.map((m) => (
            <div className="member-card" key={m.id}>
              {m.image_url ? (
                <img className="member-avatar" src={m.image_url} alt="" />
              ) : (
                <span className="member-avatar placeholder">⬡</span>
              )}
              <div>
                <div className="member-name">
                  {m.name}
                  {m.id === state.user.id && <span className="you-tag"> — you</span>}
                </div>
                <div className="member-meta">
                  {m.public_pursuits} public pursuit{m.public_pursuits === 1 ? '' : 's'} ·{' '}
                  {m.public_artifacts} artifact{m.public_artifacts === 1 ? '' : 's'}
                </div>
                {m.pursuit_names && <div className="member-pursuits">{m.pursuit_names}</div>}
              </div>
            </div>
          ))}
        </div>
        {!state.pursuits.some((p) => p.is_public) && (
          <p className="empty">
            All your pursuits are private. Flip one to ◉ public on the Pursuits page to appear
            here with more than a name.
          </p>
        )}
      </section>

      <section>
        <h2>
          Discoveries <span className="count">{data.feed.length}</span>
        </h2>
        <hr className="section-rule" />
        {data.feed.length === 0 ? (
          <p className="empty">
            No public connections yet. The first member to share a pursuit and scan starts the
            conversation.
          </p>
        ) : (
          data.feed.map((c) => (
            <div className="connection-card" key={c.id}>
              <div className="feed-owner">
                {c.owner_image ? (
                  <img className="member-avatar tiny" src={c.owner_image} alt="" />
                ) : (
                  <span className="member-avatar tiny placeholder">⬡</span>
                )}
                <span>{c.owner_name}</span>
              </div>
              <div className="endpoints">
                <span>{c.a_title}</span>
                <span className="pursuit-tag">{c.a_pursuit}</span>
                <span className="link-mark">⟷</span>
                <span>{c.b_title}</span>
                <span className="pursuit-tag">{c.b_pursuit}</span>
              </div>
              <p className="explanation">{c.explanation_text}</p>
              <div className="when">{new Date(c.created_at + 'Z').toLocaleString()}</div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
