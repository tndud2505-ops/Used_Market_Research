import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import path from 'node:path';

// One small durable receipt prevents accepting a daily trigger and then losing it.
// A restarted in-flight job is ambiguous: never automatically publish it again.
export class PublicationJobState {
  constructor(file) {
    this.file = file;
    this.value = { current: null, recent: [] };
    this.error = null;
    try {
      const raw = readFileSync(file, 'utf8');
      if (Buffer.byteLength(raw) > 32768) throw new Error('Invalid job state');
      const value = JSON.parse(raw);
      const valid = job => job && typeof job.key === 'string' && job.key.length <= 256
        && ['queued', 'running', 'completed', 'partial_success', 'failed', 'interrupted'].includes(job.status);
      if (!Array.isArray(value.recent) || value.recent.length > 8 || value.recent.some(job => !valid(job))
        || (value.current !== null && !valid(value.current))) throw new Error('Invalid job state');
      this.value = value;
      if (value.current?.status === 'running') this.update({
        // New publishers cannot write D1 until the Runner persists their intent.
        // An unmarked legacy job has no such proof and remains interrupted.
        status: value.current.intent_required === true && !value.current.intent ? 'failed' : 'interrupted',
        finished_at: new Date().toISOString()
      });
    } catch (error) {
      if (error.code !== 'ENOENT') this.error = 'PC_PUBLICATION_JOB_STATE_UNAVAILABLE';
    }
  }
  get current() { return this.error ? { status: 'blocked', error: this.error } : this.value.current; }
  save(next) {
    if (this.error) throw new Error(this.error);
    const fd = openSync(`${this.file}.tmp`, 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(`${this.file}.tmp`, this.file);
    if (process.platform !== 'win32') {
      const directory = openSync(path.dirname(this.file), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    this.value = next;
  }
  update(fields) {
    this.save({ ...this.value, current: { ...this.value.current, ...fields } });
    return this.current;
  }
  prepare(key, intent) {
    if (this.current?.key !== key || this.current?.status !== 'running') throw new Error('PUBLICATION_JOB_NOT_RUNNING');
    if (!intent || typeof intent.publication_id !== 'string' || !intent.publication_id
      || !/^[a-f0-9]{64}$/.test(intent.checksum) || !/^[a-f0-9]{64}$/.test(intent.local_checksum)
      || !Number.isSafeInteger(intent.expected_row_count) || intent.expected_row_count < 1
      || !Number.isSafeInteger(intent.expected_chunk_count) || intent.expected_chunk_count < 1
      || !intent.expected_previous_publication || Buffer.byteLength(JSON.stringify(intent)) > 4096)
      throw new Error('INVALID_PUBLICATION_INTENT');
    if (this.current.intent && JSON.stringify(this.current.intent) !== JSON.stringify(intent))
      throw new Error('PUBLICATION_INTENT_CONFLICT');
    return this.update({ intent });
  }
  finish(status) {
    // A failed transport after preparation can hide a successful activation.
    return this.update({ status: status === 'failed' && this.current?.intent ? 'interrupted' : status,
      finished_at: new Date().toISOString() });
  }
  reconcile(key, proof) {
    const job = this.current;
    if (job?.key !== key || job.status !== 'interrupted' || !job.intent
      || proof?.verified !== true || proof?.publication_id !== job.intent.publication_id || proof?.checksum !== job.intent.checksum
      || !['published', 'never_activated'].includes(proof.outcome)) throw new Error('PUBLICATION_RECONCILIATION_REJECTED');
    return this.update({ status: proof.outcome === 'published' ? 'partial_success' : 'failed',
      reconciled_at: new Date().toISOString(), reconciliation: proof.outcome });
  }
  admit(key) {
    if (typeof key !== 'string' || !key || key.length > 256) throw new Error('INVALID_PUBLICATION_JOB_KEY');
    if (this.error) throw new Error(this.error);
    const previous = [this.current, ...this.value.recent].find(job => job?.key === key);
    if (previous) return previous;
    if (['queued', 'running', 'interrupted'].includes(this.current?.status)) throw new Error('PC_PUBLICATION_JOB_BUSY_OR_UNCERTAIN');
    const job = { key, status: 'queued', intent_required: true, accepted_at: new Date().toISOString(), started_at: null, finished_at: null };
    this.save({ current: job, recent: [this.current, ...this.value.recent].filter(Boolean).slice(0, 8) });
    return job;
  }
}
