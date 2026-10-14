import { verifyStoredStatsOnAws } from './pc-stats-readback.mjs';

let body = '';
for await (const chunk of process.stdin) {
  body += chunk;
  if (Buffer.byteLength(body) > 65536) throw new Error('PC_STATS_INPUT_TOO_LARGE');
}
const verification = await verifyStoredStatsOnAws({
  importUrl: process.env.D1_STATS_IMPORT_URL,
  token: process.env.CLOUDFLARE_MANUAL_RUN_TOKEN || process.env.IMPORT_TOKEN || '',
  publication: JSON.parse(body)
});
console.log(JSON.stringify({ verified: true, ...verification }));
