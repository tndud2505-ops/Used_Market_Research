import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { SearchIndex } from './search-index.mjs';
import { PcPartsLedger } from './pc-parts-ledger.mjs';
import { PcShadowPipeline } from './pc-shadow-pipeline.mjs';

export function daangnPublicationItems(record) {
  if (record.status !== 'OK' || !Array.isArray(record.items)
    || record.diagnostics?.scope !== 'PUBLIC_SEARCH_PAGE'
    || !Number.isFinite(Date.parse(record.diagnostics.observed_at))) throw Error('INVALID_DAANGN_RECORD');
  return record.items.map(candidate => {
    const url = new URL(candidate.url);
    const match = /^\/kr\/buy-sell\/([^/]+)\/$/u.exec(url.pathname);
    const slug = match && decodeURIComponent(match[1]);
    const expectedId = slug && (slug.match(/-([a-z\d]+)$/iu)?.[1] || slug);
    if (url.origin !== 'https://www.daangn.com' || url.username || url.password
      || url.search || url.hash || !slug || /[/?#\\\u0000-\u0020]/u.test(slug)
      || !candidate.id || candidate.id !== expectedId
      || candidate.shipping_evidence !== 'BUY_NOW_BADGE' || candidate.shipping_fee !== null
      || candidate.lifecycle_status !== 'ACTIVE' || candidate.currency !== 'KRW'
      || candidate.observed_at !== record.diagnostics.observed_at
      || typeof candidate.title !== 'string' || !candidate.title.trim()
      || !Number.isFinite(candidate.price) || candidate.price < 0) throw Error('INVALID_DAANGN_CANDIDATE');
    // Never use the searched model or a stored classifier prediction as identity.
    return { id: `daangn:${candidate.id}`, item_id: `daangn:${candidate.id}`,
      source_listing_id: candidate.id, site: 'daangn', category_id: 'pc',
      title: candidate.title, description: candidate.description, price: candidate.price,
      currency: candidate.currency, url: candidate.url, image_url: candidate.image_url,
      location: candidate.location, lifecycle_status: candidate.lifecycle_status,
      shipping_evidence: candidate.shipping_evidence, shipping_fee: null,
      observed_at: candidate.observed_at, search_area: candidate.search_area };
  });
}

export class DaangnTrialPublisher {
  constructor({ root = '/var/lib/used-market-runner/daangn-trial',
    indexPath = '/var/lib/used-market-runner/search-index.sqlite', index, pipeline } = {}) {
    this.root = root; this.indexPath = indexPath;
    this.index = index; this.pipeline = pipeline; this.ownsIndex = !index;
  }
  open() {
    if (this.index) return;
    this.index = new SearchIndex({ filePath: this.indexPath, requireExistingSchema: true });
    try {
      this.index.db.exec('PRAGMA cache_size = -8192');
      const ledger = new PcPartsLedger({ db: this.index.db });
      if (!ledger.getActivePipelineVersion() || !ledger.getSource('daangn')) throw Error('DAANGN_LEDGER_NOT_READY');
      // Use the Runner's existing master/version. Do not migrate, reinitialize
      // source governance, or reclassify any previous sources during import.
      this.pipeline = new PcShadowPipeline({ ledger });
      this.pipeline.initialized = true;
    } catch (error) { this.close(); throw error; }
  }
  async publishFile(day, name) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || !/^\d{3}\.json$/u.test(name)) throw Error('INVALID_DAANGN_PATH');
    const directory = path.join(this.root, day);
    const text = await readFile(path.join(directory, name), 'utf8');
    const record = JSON.parse(text);
    if (record.status !== 'OK') return { skipped: true, reason: 'FAILED_SEARCH' };
    const items = daangnPublicationItems(record);
    const checksum = createHash('sha256').update(text).digest('hex');
    const receiptPath = path.join(directory, 'publication.json');
    let receipt;
    try { receipt = JSON.parse(await readFile(receiptPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; receipt = { day, files: {} }; }
    if (receipt.day !== day || !receipt.files) throw Error('INVALID_DAANGN_PUBLICATION_RECEIPT');
    if (receipt.files[name]?.checksum === checksum) return { skipped: true, reason: 'ALREADY_PUBLISHED' };
    this.open();
    let inserted = 0, updated = 0, olderSkipped = 0;
    for (const item of items) {
      const previous = this.index.db.prepare('SELECT site, last_checked_at FROM listings WHERE item_id=?').get(item.item_id);
      if (previous && previous.site !== 'daangn') throw Error('DAANGN_IDENTITY_COLLISION');
      if (previous && previous.last_checked_at > item.observed_at) { olderSkipped++; continue; }
      const projection = this.pipeline.recordItem(item, item.observed_at, { reclassification: true });
      const result = this.index.upsertPublicProjections([projection], { observedAt: item.observed_at });
      inserted += result.inserted; updated += result.updated;
      // Keep the public Runner responsive during catch-up of saved files.
      await new Promise(resolve => setImmediate(resolve));
    }
    const result = { checksum, observations: items.length, inserted, updated, older_skipped: olderSkipped };
    receipt.files[name] = result;
    receipt.finished_at = new Date().toISOString();
    receipt.observations = Object.values(receipt.files).reduce((n, file) => n + file.observations, 0);
    receipt.scope = 'PUBLIC_LISTINGS_ONLY_SHIPPING_COST_UNVERIFIED';
    await writeFile(`${receiptPath}.tmp`, JSON.stringify(receipt), { mode: 0o600, flush: true });
    await rename(`${receiptPath}.tmp`, receiptPath);
    return result;
  }
  async publishDay(day) {
    const results = [];
    for (const name of (await readdir(path.join(this.root, day))).filter(name => /^\d{3}\.json$/u.test(name)).sort()) {
      results.push(await this.publishFile(day, name));
    }
    return { files: results.length, published_files: results.filter(result => !result.skipped).length,
      inserted: results.reduce((n, result) => n + (result.inserted || 0), 0),
      updated: results.reduce((n, result) => n + (result.updated || 0), 0) };
  }
  close() { if (this.ownsIndex) this.index?.close(); this.index = null; this.pipeline = null; }
}
