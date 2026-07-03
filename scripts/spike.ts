// Spike: validate the core product bet — can the LLM find a genuinely specific
// cross-domain connection, and (just as important) refuse to invent one where
// none exists? Run with: npm run spike
import { findConnections, llmConfigured, type ArtifactForScan } from '../server/llm.js';

const artifacts: ArtifactForScan[] = [
  {
    id: 1,
    pursuit: 'Chess',
    kind: 'note',
    title: 'Zugzwang studies — the burden of the move',
    content:
      'Worked through three king-and-pawn endgames where every legal move worsens the position. ' +
      'The insight: sometimes the obligation to act is itself the losing condition. Strong play here is about ' +
      'passing the tempo — triangulating with the king so the opponent runs out of safe waiting moves first. ' +
      'Losing a tempo on purpose is a weapon.',
  },
  {
    id: 2,
    pursuit: 'Programming',
    kind: 'code',
    title: 'Debounce util for search input',
    content:
      'function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; } ' +
      '// Key realization: the correct behavior is to deliberately NOT respond to every event. ' +
      'Doing nothing on most keystrokes — waiting until the stream of inputs goes quiet — is what makes the system feel right. ' +
      'Acting on every input is the bug.',
  },
  {
    id: 3,
    pursuit: 'Pottery',
    kind: 'note',
    title: 'Centering clay — pressure and patience',
    content:
      'Spent the session centering. You cannot force clay to center with more pressure; you hold steady contact ' +
      'and let the wheel bring the clay to your hands over rotations. Tension in the shoulders transfers into wobble. ' +
      'The clay centers when your hands become the still reference point.',
  },
];

// Pairs (1,2) and (1,3): (1,2) has a real underlying link — deliberately withholding
// action as the correct strategy. (2,3) is the decoy: a good model may find at most a
// weak link, and an honest one should say nothing rather than reach for "both need patience".
const pairs: [number, number][] = [
  [1, 2],
  [1, 3],
  [2, 3],
];

async function main() {
  if (!llmConfigured()) {
    console.error(
      'SPIKE BLOCKED: no LLM key found.\nCopy .env.example to .env and set ANTHROPIC_API_KEY (or OPENAI_API_KEY), then re-run: npm run spike',
    );
    process.exit(2);
  }
  console.log(`Scanning ${pairs.length} candidate pairs across ${artifacts.length} artifacts…\n`);
  const t0 = Date.now();
  const connections = await findConnections(artifacts, pairs);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  if (connections.length === 0) {
    console.log(`No connections reported (${seconds}s). Either the model is being appropriately`);
    console.log('conservative or the prompt needs work — inspect manually before concluding.');
    return;
  }
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  for (const c of connections) {
    const a = byId.get(c.artifact_a_id)!;
    const b = byId.get(c.artifact_b_id)!;
    console.log(`── ${a.pursuit}: "${a.title}"`);
    console.log(`── ${b.pursuit}: "${b.title}"`);
    console.log(`   ${c.explanation_text}\n`);
  }
  console.log(`${connections.length} connection(s) in ${seconds}s.`);
  console.log('\nJudge by hand: does each explanation reference specifics from BOTH artifacts?');
  console.log('If any read as generic platitudes, tighten the system prompt before building UI.');
}

main().catch((err) => {
  console.error('SPIKE FAILED (transient or config error):', err.message ?? err);
  process.exit(1);
});
