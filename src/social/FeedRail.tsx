import type { FeedItem } from './types';

interface Props {
  items: FeedItem[];
  hidden: Set<string>;
  onOpenProfile: (userId: string) => void;
  onOpenArtifact: (id: number) => void;
  onReport: (kind: string, id: string | number) => void;
}

function when(iso: string): string {
  return new Date(iso + 'Z').toLocaleString();
}

export default function FeedRail({ items, hidden, onOpenProfile, onOpenArtifact, onReport }: Props) {
  const visible = items.filter((i) => !hidden.has(i.user.id));
  return (
    <aside className="feed-rail">
      <h2>The Feed</h2>
      <hr className="section-rule" />
      {visible.length === 0 && (
        <p className="empty">
          Quiet so far. Someone's first public artifact starts the world.
        </p>
      )}
      {visible.map((item) => (
        <div className="feed-item" key={item.event_id}>
          <button className="feed-owner-btn" onClick={() => onOpenProfile(item.user.id)}>
            {item.user.image_url ? (
              <img className="member-avatar tiny" src={item.user.image_url} alt="" />
            ) : (
              <span className="member-avatar tiny placeholder">⬡</span>
            )}
            <span>{item.user.name}</span>
          </button>

          {item.kind === 'artifact' && item.artifact && (
            <button
              className="feed-artifact-open"
              onClick={() => onOpenArtifact(item.artifact!.id)}
              title="Open this artifact"
            >
              <div className="feed-verb">
                logged <span className="kind-inline">{item.artifact.kind}</span> in{' '}
                <em>{item.artifact.pursuit_name}</em>
              </div>
              <div className="feed-title">{item.artifact.title}</div>
              {item.artifact.has_image ? (
                <img
                  className="feed-image-thumb"
                  src={`/api/social/artifact/${item.artifact.id}/image`}
                  alt={item.artifact.title}
                  loading="lazy"
                />
              ) : (
                item.artifact.snippet && <p className="feed-snippet">{item.artifact.snippet}</p>
              )}
            </button>
          )}
          {item.kind === 'connection' && item.connection && (
            <>
              <div className="feed-verb">discovered a connection</div>
              <div className="feed-title">
                {item.connection.a_title} <span className="link-mark">⟷</span>{' '}
                {item.connection.b_title}
              </div>
              <p className="feed-snippet serif">{item.connection.explanation_text}</p>
            </>
          )}
          {item.kind === 'pursuit_public' && item.pursuit && (
            <>
              <div className="feed-verb">opened a pursuit to the world</div>
              <div className="feed-title">{item.pursuit.name}</div>
              {item.pursuit.description && <p className="feed-snippet">{item.pursuit.description}</p>}
            </>
          )}

          <div className="feed-foot">
            <span className="when">{when(item.created_at)}</span>
            <button
              className="btn ghost report-btn"
              title="Report this content"
              onClick={() =>
                onReport(
                  item.kind === 'artifact'
                    ? 'artifact'
                    : item.kind === 'connection'
                      ? 'connection'
                      : 'pursuit',
                  item.artifact?.id ?? item.connection?.id ?? item.pursuit?.id ?? '',
                )
              }
            >
              report
            </button>
          </div>
        </div>
      ))}
    </aside>
  );
}
