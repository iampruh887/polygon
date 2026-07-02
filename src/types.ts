export interface User {
  id: string;
  name: string;
  image_url: string;
}

export interface Pursuit {
  id: number;
  user_id: string;
  name: string;
  description: string;
  is_public: number;
  created_at: string;
  artifact_count: number;
  last_artifact_at: string | null;
}

export type ArtifactKind = 'note' | 'code' | 'image' | 'puzzle';

export interface Artifact {
  id: number;
  pursuit_id: number;
  kind: ArtifactKind;
  title: string;
  content: string;
  created_at: string;
  pursuit_name: string;
}

export interface Connection {
  id: number;
  artifact_a_id: number;
  artifact_b_id: number;
  explanation_text: string;
  created_at: string;
  a_title: string;
  b_title: string;
  a_pursuit: string;
  b_pursuit: string;
}

export interface AppState {
  user: User;
  pursuits: Pursuit[];
  artifacts: Artifact[];
  connections: Connection[];
  unscanned_pair_count: number;
  llm_configured: boolean;
  clerk_enabled: boolean;
}

export interface CommunityMember extends User {
  public_pursuits: number;
  public_artifacts: number;
  pursuit_names: string;
}

export interface PublicConnection extends Connection {
  owner_id: string;
  owner_name: string;
  owner_image: string;
}

export interface CommunityData {
  members: CommunityMember[];
  feed: PublicConnection[];
}

export type ScanStatus = 'idle' | 'scanning' | 'found' | 'none_found' | 'failed' | 'not_configured' | 'empty';
