import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function createAssetLinks(packageId, fingerprints) {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/.test(packageId || '')) {
    throw new Error('Pass the confirmed Play package with --package.');
  }
  if (!fingerprints?.length) throw new Error('Pass the actual Play app-signing SHA-256 with --play-sha256.');
  const normalized = fingerprints.map(value => {
    const fingerprint = value.trim().toUpperCase();
    if (!/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint)) {
      throw new Error('SHA-256 must contain exactly 32 colon-separated hex bytes.');
    }
    if (new Set(fingerprint.split(':')).size === 1) {
      throw new Error('Repeated-byte dummy fingerprints are not accepted.');
    }
    return fingerprint;
  });
  return [{ relation: ['delegate_permission/common.handle_all_urls'], target: {
    namespace: 'android_app', package_name: packageId,
    sha256_cert_fingerprints: [...new Set(normalized)],
  } }];
}

async function main() {
  const { values } = parseArgs({ options: {
    package: { type: 'string' }, 'play-sha256': { type: 'string', multiple: true },
  } });
  const links = createAssetLinks(values.package, values['play-sha256']);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const out = path.join(root, 'artifacts');
  await mkdir(out, { recursive: true });
  if (await realpath(out) !== path.join(await realpath(root), 'artifacts')) {
    throw new Error('artifacts/ must stay inside mobile/.');
  }
  const file = path.join(out, 'assetlinks.json');
  // Exclusive creation protects a previously reviewed candidate from replacement.
  await writeFile(file, `${JSON.stringify(links, null, 2)}\n`, { flag: 'wx' });
  console.log(`Candidate only: ${file}\nVerify certificate provenance in Play Console before the primary publishes it. No upload performed.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
