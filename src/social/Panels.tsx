import { useEffect, useState } from 'react';
import { socialApi, toggleHidden } from './api';
import type { PursuitDetail, ProfileDetail } from './types';

// Side panels for the Atlas: pursuit detail (the people inside a node) and
// member profile (their public polygon + artifacts + follow).

interface PursuitPanelProps {
  norm: string;
  displayName: string;
  onOpenProfile: (userId: string) => void;
  onClose: () => void;
  selfId: string;
}

export function PursuitPanel({ norm, displayName, onOpenProfile, onClose, selfId }: PursuitPanelProps) {
  const [detail, setDetail] = useState<PursuitDetail | null>(null);

  useEffect(() => {
    setDetail(null);
    socialApi.pursuit(norm).then(setDetail).catch(() => setDetail({ members: [], artifacts: [] }));
  }, [norm]);

  return (
    <div className="atlas-panel">
      <div className="atlas-panel-head">
        <h3>{displayName}</h3>
        <button className="btn ghost" onClick={onClose}>×</button>
      </div>
      {!detail ? (
        <p className="empty">Looking closer…</p>
      ) : (
        <>
          <div className="panel-section-label">
            {detail.members.length} {detail.members.length === 1 ? 'polymath' : 'polymaths'} here
          </div>
          {detail.members.map((m) => (
            <button className="panel-member" key={m.id} onClick={() => onOpenProfile(m.id)}>
              {m.image_url ? (
                <img className="member-avatar tiny" src={m.image_url} alt="" />
              ) : (
                <span className="member-avatar tiny placeholder">⬡</span>
              )}
              <span className="panel-member-name">
                {m.name}
                {m.id === selfId && <span className="you-tag"> — you</span>}
              </span>
              <span className="panel-member-meta">
                {m.public_artifacts} artifact{m.public_artifacts === 1 ? '' : 's'}
                {m.overlap > 0 && m.id !== selfId && ` · ${m.overlap} shared`}
              </span>
            </button>
          ))}
          <div className="panel-section-label" style={{ marginTop: 14 }}>
            recent work
          </div>
          {detail.artifacts.length === 0 && <p className="empty">Nothing logged yet.</p>}
          {detail.artifacts.map((a) => (
            <div className="panel-artifact" key={a.id}>
              <div className="feed-title">{a.title}</div>
              <div className="panel-member-meta">
                {a.owner_name} · {a.kind} · {new Date(a.created_at + 'Z').toLocaleDateString()}
              </div>
              {a.snippet && <p className="feed-snippet">{a.snippet}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

interface ProfilePanelProps {
  userId: string;
  selfId: string;
  onClose: () => void;
  onHiddenChange: (hidden: Set<string>) => void;
}

export function ProfilePanel({ userId, selfId, onClose, onHiddenChange }: ProfilePanelProps) {
  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => socialApi.profile(userId).then(setProfile).catch(() => onClose());

  useEffect(() => {
    setProfile(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!profile) {
    return (
      <div className="atlas-panel">
        <p className="empty">Fetching profile…</p>
      </div>
    );
  }

  const isSelf = userId === selfId;

  return (
    <div className="atlas-panel">
      <div className="atlas-panel-head">
        <div className="profile-id">
          {profile.user.image_url ? (
            <img className="member-avatar" src={profile.user.image_url} alt="" />
          ) : (
            <span className="member-avatar placeholder">⬡</span>
          )}
          <div>
            <h3>
              {profile.user.name}
              {isSelf && <span className="you-tag"> — you</span>}
            </h3>
            <div className="panel-member-meta">
              {profile.followers} follower{profile.followers === 1 ? '' : 's'} · {profile.following}{' '}
              following
              {profile.follows_you && !isSelf && ' · follows you'}
              {profile.overlap > 0 && !isSelf && ` · ${profile.overlap} shared pursuit${profile.overlap === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
        <button className="btn ghost" onClick={onClose}>×</button>
      </div>

      {!isSelf && (
        <div className="profile-actions">
          <button
            className={`btn ${profile.is_following ? '' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (profile.is_following) await socialApi.unfollow(userId);
                else await socialApi.follow(userId);
                await load();
              } finally {
                setBusy(false);
              }
            }}
          >
            {profile.is_following ? 'Following ✓' : 'Follow'}
          </button>
          <button className="btn ghost" onClick={() => onHiddenChange(toggleHidden(userId))}>
            hide
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              const reason = prompt('What’s wrong with this profile?') ?? '';
              if (reason.trim()) void socialApi.report('user', userId, reason);
            }}
          >
            report
          </button>
        </div>
      )}

      <div className="panel-section-label">their polygon</div>
      {profile.pursuits.length === 0 && <p className="empty">No public pursuits.</p>}
      <div className="profile-pursuits">
        {profile.pursuits.map((p) => (
          <span className="pursuit-chip" key={p.id} title={p.description}>
            {p.name} <span className="chip-count">{p.artifact_count}</span>
          </span>
        ))}
      </div>

      <div className="panel-section-label" style={{ marginTop: 14 }}>
        recent work
      </div>
      {profile.artifacts.length === 0 && <p className="empty">Nothing public yet.</p>}
      {profile.artifacts.map((a) => (
        <div className="panel-artifact" key={a.id}>
          <div className="feed-title">{a.title}</div>
          <div className="panel-member-meta">
            {a.pursuit_name} · {a.kind} · {new Date(a.created_at + 'Z').toLocaleDateString()}
          </div>
          {a.snippet && <p className="feed-snippet">{a.snippet}</p>}
        </div>
      ))}
    </div>
  );
}
