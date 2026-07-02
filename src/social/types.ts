export interface AtlasNode {
  norm: string;
  display_name: string;
  member_count: number;
  active24h: number;
  events30d: number;
}

export interface FeedItem {
  event_id: number;
  kind: 'artifact' | 'connection' | 'pursuit_public';
  created_at: string;
  user: { id: string; name: string; image_url: string };
  artifact?: { id: number; title: string; kind: string; snippet: string; pursuit_name: string };
  connection?: {
    id: number;
    a_title: string;
    b_title: string;
    a_pursuit: string;
    b_pursuit: string;
    explanation_text: string;
  };
  pursuit?: { id: number; name: string; description: string };
}

export interface PursuitMember {
  id: string;
  name: string;
  image_url: string;
  public_artifacts: number;
  overlap: number;
  is_following: boolean;
}

export interface PursuitDetail {
  members: PursuitMember[];
  artifacts: {
    id: number;
    title: string;
    kind: string;
    snippet: string;
    created_at: string;
    owner_name: string;
    owner_id: string;
  }[];
}

export interface ProfileDetail {
  user: { id: string; name: string; image_url: string };
  pursuits: { id: number; name: string; description: string; artifact_count: number }[];
  artifacts: {
    id: number;
    title: string;
    kind: string;
    snippet: string;
    created_at: string;
    pursuit_name: string;
  }[];
  followers: number;
  following: number;
  is_following: boolean;
  follows_you: boolean;
  overlap: number;
}
