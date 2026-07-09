import { useCallback, useEffect, useState } from 'react';
import type { AppState } from '../types';
import type { AtlasNode, FeedItem } from './types';
import { socialApi, hiddenUsers, useLiveTick } from './api';
import AtlasGraph from './AtlasGraph';
import FeedRail from './FeedRail';
import { PursuitPanel, ProfilePanel, ArtifactPanel } from './Panels';

interface Props {
  state: AppState;
}

type Panel =
  | { type: 'none' }
  | { type: 'pursuit'; norm: string; name: string }
  | { type: 'profile'; userId: string }
  | { type: 'artifact'; artifactId: number };

// The Atlas: one shared knowledge map. Everyone's public pursuits merged into
// a collective graph; the feed rail runs alongside; profiles and follows live
// inside the map. All of it lazy-loaded — the core app never pays for it.
export default function Discover({ state }: Props) {
  const [atlas, setAtlas] = useState<{ nodes: AtlasNode[]; total: number } | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [panel, setPanel] = useState<Panel>({ type: 'none' });
  const [hidden, setHidden] = useState<Set<string>>(hiddenUsers());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    socialApi
      .atlas()
      .then(setAtlas)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not reach the Atlas'));
    socialApi
      .feed()
      .then((r) => setFeed(r.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Polling floor + SSE when the server supports it → refetch on change.
  useLiveTick(reload, state.sse_enabled);

  const openProfile = useCallback((userId: string) => setPanel({ type: 'profile', userId }), []);
  const openArtifact = useCallback((artifactId: number) => setPanel({ type: 'artifact', artifactId }), []);

  const onReport = useCallback((kind: string, id: string | number) => {
    const reason = prompt('What’s wrong with this content?') ?? '';
    if (reason.trim()) void socialApi.report(kind, id, reason);
  }, []);

  if (error) {
    return (
      <div className="page narrow">
        <div className="notice">{error}</div>
      </div>
    );
  }

  return (
    <div className="discover-layout">
      <div className="atlas-stage">
        {!state.clerk_enabled && (
          <div className="atlas-solo-note">
            solo mode — you're alone in the Atlas. Deploy Polygon to a shared host and invite
            people to make this a world.
          </div>
        )}
        {atlas && atlas.nodes.length === 0 ? (
          <div className="graph-empty">
            The Atlas is dark. It lights up when someone makes a pursuit public.
          </div>
        ) : atlas ? (
          <AtlasGraph nodes={atlas.nodes} onSelect={(norm) => {
            const n = atlas.nodes.find((x) => x.norm === norm);
            setPanel({ type: 'pursuit', norm, name: n?.display_name ?? norm });
          }} />
        ) : (
          <div className="graph-empty">Unrolling the map…</div>
        )}
        {atlas && atlas.total > atlas.nodes.length && (
          <div className="atlas-cap-note">
            showing the {atlas.nodes.length} most active of {atlas.total} pursuits
          </div>
        )}

        {panel.type === 'pursuit' && (
          <PursuitPanel
            norm={panel.norm}
            displayName={panel.name}
            selfId={state.user.id}
            onOpenProfile={openProfile}
            onClose={() => setPanel({ type: 'none' })}
          />
        )}
        {panel.type === 'profile' && (
          <ProfilePanel
            userId={panel.userId}
            selfId={state.user.id}
            onClose={() => setPanel({ type: 'none' })}
            onHiddenChange={setHidden}
          />
        )}
        {panel.type === 'artifact' && (
          <ArtifactPanel
            artifactId={panel.artifactId}
            onOpenProfile={openProfile}
            onReport={onReport}
            onClose={() => setPanel({ type: 'none' })}
          />
        )}
      </div>

      <FeedRail
        items={feed}
        hidden={hidden}
        onOpenProfile={openProfile}
        onOpenArtifact={openArtifact}
        onReport={onReport}
      />
    </div>
  );
}
