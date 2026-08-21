import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const FEEDBACK_BASE = resolve(process.cwd(), 'merge/result/ux-feedback');

export interface UxFeedback {
  feedback_type?: 'search_truth' | 'ui_parity';
  benchmark?: string;
  screen?: string;
  query?: string;
  overall: number;
  speed?: number;
  relevance?: number;
  clarity?: number;
  trust?: number;
  note?: string;
  competitor_note?: string;
}

export class FeedbackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedbackValidationError';
  }
}

export async function saveUxFeedback(input: Record<string, unknown>) {
  const feedback = validateFeedback(input);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const id = `${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const directory = resolve(FEEDBACK_BASE, day);
  await mkdir(directory, { recursive: true });
  const record = {
    id,
    created_at: now.toISOString(),
    ...feedback
  };
  await writeFile(resolve(directory, `${id}.json`), JSON.stringify(record, null, 2), 'utf-8');
  return record;
}

export async function getUxFeedbackSummary() {
  const records = await readFeedbackRecords();
  const ratings = records.map((record) => record.overall).filter((value): value is number => typeof value === 'number');
  const average = ratings.length > 0
    ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10
    : null;

  return {
    status: 'success',
    data: {
      total: records.length,
      average_overall: average,
      recent: records.slice(-8).reverse(),
      by_benchmark: groupCount(records, 'benchmark'),
      by_screen: groupCount(records, 'screen'),
      by_type: groupCount(records, 'feedback_type')
    }
  };
}

function validateFeedback(input: Record<string, unknown>): UxFeedback {
  const overall = readRating(input.overall, 'overall');
  return {
    feedback_type: input.feedback_type === 'ui_parity' ? 'ui_parity' : 'search_truth',
    benchmark: readText(input.benchmark, 'moajung'),
    screen: readText(input.screen, 'search'),
    query: readText(input.query, ''),
    overall,
    speed: readOptionalRating(input.speed, 'speed'),
    relevance: readOptionalRating(input.relevance, 'relevance'),
    clarity: readOptionalRating(input.clarity, 'clarity'),
    trust: readOptionalRating(input.trust, 'trust'),
    note: readText(input.note, '').slice(0, 1000),
    competitor_note: readText(input.competitor_note, '').slice(0, 1000)
  };
}

function readRating(value: unknown, field: string) {
  const rating = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new FeedbackValidationError(`${field} must be an integer between 1 and 5`);
  }
  return rating;
}

function readOptionalRating(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return undefined;
  return readRating(value, field);
}

function readText(value: unknown, fallback: string) {
  return typeof value === 'string' ? value.trim() : fallback;
}

async function readFeedbackRecords() {
  const records: Array<Record<string, unknown>> = [];
  let days: string[] = [];
  try {
    days = await readdir(FEEDBACK_BASE);
  } catch {
    return records;
  }

  for (const day of days.sort()) {
    let files: string[] = [];
    try {
      files = await readdir(resolve(FEEDBACK_BASE, day));
    } catch {
      continue;
    }
    for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
      try {
        const parsed: unknown = JSON.parse(await readFile(resolve(FEEDBACK_BASE, day, file), 'utf-8'));
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          records.push(parsed as Record<string, unknown>);
        }
      } catch {
        // A broken feedback file should not make the feedback dashboard unavailable.
      }
    }
  }

  return records;
}

function groupCount(records: Array<Record<string, unknown>>, key: string) {
  return records.reduce<Record<string, number>>((result, record) => {
    const value = typeof record[key] === 'string' && record[key] ? record[key] as string : 'unknown';
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}
