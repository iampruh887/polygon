export interface Pursuit {
  id: number;
  name: string;
  description: string;
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
  pursuits: Pursuit[];
  artifacts: Artifact[];
  connections: Connection[];
  unscanned_pair_count: number;
  llm_configured: boolean;
}

export type ScanStatus = 'idle' | 'scanning' | 'found' | 'none_found' | 'failed' | 'not_configured' | 'empty';
