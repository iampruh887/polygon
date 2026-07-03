// Vercel serverless entry: wraps the whole Express app as one function.
// A rewrite in vercel.json funnels every /api/* path (any depth) to this file;
// Express then does its own routing. Built once per warm instance and reused.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../server/app.js';

let appPromise: ReturnType<typeof buildApp> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  appPromise ??= buildApp();
  const app = await appPromise;
  // Express is itself a (req, res) handler.
  (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
