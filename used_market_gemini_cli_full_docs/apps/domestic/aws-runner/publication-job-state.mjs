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
      if (value.current?.status === 'running') this.update({ status: 'interrupted', finished_at: new Date().toISOString() });
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
  admit(key) {
    if (typeof key !== 'string' || !key || key.length > 256) throw new Error('INVALID_PUBLICATION_JOB_KEY');
    if (this.error) throw new Error(this.error);
    const previous = [this.current, ...this.value.recent].find(job => job?.key === key);
    if (previous) return previous;
    if (['queued', 'running', 'interrupted'].includes(this.current?.status)) throw new Error('PC_PUBLICATION_JOB_BUSY_OR_UNCERTAIN');
    const job = { key, status: 'queued', accepted_at: new Date().toISOString(), started_at: null, finished_at: null };
    this.save({ current: job, recent: [this.current, ...this.value.recent].filter(Boolean).slice(0, 8) });
    return job;
  }
}
