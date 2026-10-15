import { verifyStoredStatsOnAws } from './pc-stats-readback.mjs';
import { DatabaseSync } from 'node:sqlite';
import { reconcilePublication } from './reconcile-publication.mjs';

let body = '';
for await (const chunk of process.stdin) {
  body += chunk;
  if (Buffer.byteLength(body) > 65536) throw new Error('PC_STATS_INPUT_TOO_LARGE');
}
const input = JSON.parse(body);
const options = {
  importUrl: process.env.D1_STATS_IMPORT_URL,
  token: process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN || '',
  publication: input
};
let verification;
if (input.reconcile === true) {
  const db = new DatabaseSync(process.env.RUNNER_INDEX_PATH, { readOnly: true });
  try { verification = await reconcilePublication({ ...options, db, intent: input.intent }); }
  finally { db.close(); }
} else verification = await verifyStoredStatsOnAws(options);
console.log(JSON.stringify({ verified: true, ...verification }));
