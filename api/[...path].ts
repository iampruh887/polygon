// Vercel serverless entry: wraps the whole Express app as one function.
// The catch-all filename routes every /api/* request here; Express then does
// its own routing. The app is built once per warm instance and reused.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../server/app';

let appPromise: ReturnType<typeof buildApp> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  appPromise ??= buildApp();
  const app = await appPromise;
  // Express is itself a (req, res) handler.
  (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
