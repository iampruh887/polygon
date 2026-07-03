// Local dev / self-host entry. Builds the Express app and listens. On Vercel
// the app is served by api/[...path].ts instead, and static files by Vercel's
// CDN, so this file never runs there.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { buildApp } from './app';
import { llmConfigured } from './llm';

const app = await buildApp();

// Self-hosted production (`npm run start`): serve the built frontend too.
if (process.env.NODE_ENV === 'production') {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const dist = join(root, 'dist');
  app.use(express.static(dist));
  app.get('{*splat}', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

const PORT = Number(process.env.PORT || 3141);
app.listen(PORT, () => {
  console.log(
    `Polygon server on http://localhost:${PORT} (llm ${llmConfigured() ? 'configured' : 'NOT configured'}, auth ${process.env.CLERK_SECRET_KEY ? 'clerk' : 'solo mode'})`,
  );
});
