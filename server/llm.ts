import 'dotenv/config';

// The connection scan sends candidate artifact pairs to an LLM and asks it to
// report only genuinely specific links — the prompt forbids generic platitudes,
// which is the failure mode that would kill the whole product premise.

export interface ArtifactForScan {
  id: number;
  pursuit: string;
  kind: string;
  title: string;
  content: string;
}

export interface FoundConnection {
  artifact_a_id: number;
  artifact_b_id: number;
  explanation_text: string;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super(
      'No LLM API key configured. Copy .env.example to .env and set ANTHROPIC_API_KEY (or OPENAI_API_KEY).',
    );
    this.name = 'LlmNotConfiguredError';
  }
}

// Artifact content is truncated in the prompt so a scan with many pairs stays
// within a sane token budget; 800 chars is enough to convey the idea of a note.
const CONTENT_CAP = 800;

const SYSTEM_PROMPT = `You find genuine intellectual connections between artifacts a person has logged while learning multiple unrelated skills.

You will receive a list of artifacts (each with an id, pursuit, kind, title, content) and a list of candidate pairs to evaluate.

For each candidate pair, decide whether there is a REAL, SPECIFIC connection between the two artifacts. A real connection must:
- reference concrete specifics from BOTH artifacts (a named concept, technique, structure, or observation present in each)
- reveal something the person plausibly had not noticed — a shared underlying principle, a transferable technique, a structural analogy
- survive the test: "would a thoughtful person say 'huh, I hadn't seen it that way'?"

REJECT anything generic. Forbidden: "both require practice", "both involve creativity", "both are about problem solving", "both need patience", or any connection that would be equally true of two random hobbies. Reporting zero connections is a perfectly good outcome — most pairs have none.

Respond with ONLY a JSON array (no markdown fences, no prose). Each element:
{"artifact_a_id": <id>, "artifact_b_id": <id>, "explanation_text": "<2-4 sentences naming the specific concept in each artifact and the underlying link>"}

Only include pairs from the candidate list. Return [] if nothing genuine exists.`;

function buildUserPrompt(artifacts: ArtifactForScan[], pairs: [number, number][]): string {
  const artifactBlock = artifacts
    .map((a) => {
      const content =
        a.content.length > CONTENT_CAP ? a.content.slice(0, CONTENT_CAP) + ' …[truncated]' : a.content;
      return `[id ${a.id}] pursuit: ${a.pursuit} | kind: ${a.kind} | title: ${a.title}\n${content}`;
    })
    .join('\n\n---\n\n');
  const pairBlock = pairs.map(([a, b]) => `(${a}, ${b})`).join(', ');
  return `ARTIFACTS:\n\n${artifactBlock}\n\nCANDIDATE PAIRS: ${pairBlock}`;
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const model = process.env.LLM_MODEL || 'claude-sonnet-4-6';
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

async function callOpenAi(system: string, user: string): Promise<string> {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const model = process.env.LLM_MODEL || 'gpt-4o';
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? '';
}

function parseConnections(raw: string, allowedPairs: Set<string>): FoundConnection[] {
  // Models occasionally wrap JSON in fences despite instructions; strip them.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: FoundConnection[] = [];
  for (const item of parsed) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as FoundConnection).artifact_a_id === 'number' &&
      typeof (item as FoundConnection).artifact_b_id === 'number' &&
      typeof (item as FoundConnection).explanation_text === 'string' &&
      (item as FoundConnection).explanation_text.length > 0
    ) {
      const c = item as FoundConnection;
      const key = pairKey(c.artifact_a_id, c.artifact_b_id);
      // Only accept pairs we actually asked about — the model must not invent pairings.
      if (allowedPairs.has(key)) out.push(c);
    }
  }
  return out;
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

export async function findConnections(
  artifacts: ArtifactForScan[],
  pairs: [number, number][],
): Promise<FoundConnection[]> {
  if (pairs.length === 0) return [];
  if (!llmConfigured()) throw new LlmNotConfiguredError();
  const user = buildUserPrompt(artifacts, pairs);
  const raw = process.env.ANTHROPIC_API_KEY
    ? await callAnthropic(SYSTEM_PROMPT, user)
    : await callOpenAi(SYSTEM_PROMPT, user);
  const allowed = new Set(pairs.map(([a, b]) => pairKey(a, b)));
  return parseConnections(raw, allowed);
}
