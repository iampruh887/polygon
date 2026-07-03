// Seed demo polymaths so the Atlas has a world in it before real friends
// arrive. Run: npm run seed:demo — remove with: npm run seed:demo -- --clean
// All demo rows use user ids prefixed 'demo_' and are safe to delete anytime.
import { query, tx } from '../server/pg';

const clean = process.argv.includes('--clean');

const DEMO_USERS = [
  { id: 'demo_ada', name: 'Ada (demo)', pursuits: [
    { name: 'Chess', description: 'endgame obsessive', artifacts: [
      { kind: 'note', title: 'Opposition and the square rule', content: 'King endgames: whoever runs out of useful waiting moves first loses. The square rule saves calculation — if the king stands inside the pawn\'s square, it catches it.' },
      { kind: 'puzzle', title: 'Réti study, solved', content: 'The king walks a diagonal that chases two goals at once — geometry beats speed. Diagonal paths are the same length as straight ones on a chessboard.' },
    ]},
    { name: 'Pottery', description: 'wheel thrown, mostly bowls', artifacts: [
      { kind: 'note', title: 'Centering is posture, not force', content: 'Braced my elbow against my hip and the clay centered itself. The wheel does the work; the hands are a fixed reference frame.' },
    ]},
  ]},
  { id: 'demo_ben', name: 'Ben (demo)', pursuits: [
    { name: 'Semi conductor Fabrication', description: 'garage litho experiments', artifacts: [
      { kind: 'note', title: 'Spin coating with a PC fan', content: 'A 12V PC fan at ~3000rpm gives surprisingly even photoresist coats on 1cm dies. Viscosity matters more than RPM precision.' },
      { kind: 'image', title: 'First UV exposure mask', content: 'Printed a mask on transparency film at 1200dpi. Feature size limit ~50 microns — enough for a simple diode array.' },
    ]},
    { name: 'Baking', description: 'sourdough and enriched doughs', artifacts: [
      { kind: 'note', title: 'Autolyse is patience made visible', content: 'Letting flour and water rest 40 minutes before adding starter develops gluten with zero kneading. Doing nothing IS the technique.' },
    ]},
  ]},
  { id: 'demo_chiara', name: 'Chiara (demo)', pursuits: [
    { name: 'Chess', description: 'attacking player, learning restraint', artifacts: [
      { kind: 'note', title: 'Prophylaxis notes from Karpov games', content: 'Karpov improves his worst piece before starting any attack. Ask: what does my opponent want? Prevent that first.' },
    ]},
    { name: 'Watercolor', description: 'landscapes, wet on wet', artifacts: [
      { kind: 'image', title: 'Wet-on-wet sky study', content: 'You cannot control where pigment blooms in wet paper — you control the water, and the water controls the paint. Indirect control.' },
      { kind: 'note', title: 'Reserving whites', content: 'Watercolor has no white paint worth using; the paper is the light. Every highlight must be planned before the first wash. Irreversibility forces planning.' },
    ]},
  ]},
];

async function cleanDemo() {
  const ids = DEMO_USERS.map((u) => u.id);
  await query(`DELETE FROM feed_events WHERE user_id = ANY($1)`, [ids]);
  await query(`DELETE FROM follows WHERE follower_id = ANY($1) OR followee_id = ANY($1)`, [ids]);
  await query(`DELETE FROM pursuits WHERE user_id = ANY($1)`, [ids]); // cascades artifacts/connections
  await query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
  console.log('Demo data removed.');
}

async function seed() {
  await tx(async (q) => {
    for (const u of DEMO_USERS) {
      await q(`INSERT INTO users (id, name, image_url) VALUES ($1,$2,'') ON CONFLICT (id) DO NOTHING`, [u.id, u.name]);
      for (const p of u.pursuits) {
        const pr = await q(
          `INSERT INTO pursuits (user_id, name, description, is_public) VALUES ($1,$2,$3,1) RETURNING id`,
          [u.id, p.name, p.description],
        );
        const pid = (pr.rows[0] as { id: number }).id;
        await q(`INSERT INTO feed_events (user_id, kind, ref_id) VALUES ($1,'pursuit_public',$2)`, [u.id, pid]);
        for (const a of p.artifacts) {
          const ar = await q(
            `INSERT INTO artifacts (pursuit_id, kind, title, content) VALUES ($1,$2,$3,$4) RETURNING id`,
            [pid, a.kind, a.title, a.content],
          );
          const aid = (ar.rows[0] as { id: number }).id;
          await q(`INSERT INTO feed_events (user_id, kind, ref_id) VALUES ($1,'artifact',$2)`, [u.id, aid]);
        }
      }
    }
  });
  console.log(`Seeded ${DEMO_USERS.length} demo polymaths. Remove anytime: npm run seed:demo -- --clean`);
}

(clean ? cleanDemo() : seed())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Seed failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
