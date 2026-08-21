import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface DedupeRecord {
  item_id: string;
  expires_at: string;
  seller: string;
  sent_at: string;
}

interface FingerprintRecord {
  fingerprint: string;
  expires_at: string;
  item_id: string;
  seller: string;
  sent_at: string;
}

interface DedupeState {
  items: DedupeRecord[];
  fingerprints: FingerprintRecord[];
}

const KOREA_TIME_ZONE = "Asia/Seoul";

export class DedupeStoreError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "DedupeStoreError";
  }
}

export class ReporterDedupeStore {
  constructor(private readonly filePath = path.resolve(process.cwd(), "merge/result/reporter/dedupe-store.json")) {}

  isDuplicate(itemId: string, now = new Date()): boolean {
    const state = this.read();
    this.prune(state, now);
    return state.items.some((record) => record.item_id === itemId && new Date(record.expires_at).getTime() > now.getTime());
  }

  isFingerprintDuplicate(fingerprint: string, now = new Date()): boolean {
    if (!fingerprint.trim()) return false;
    const state = this.read();
    this.prune(state, now);
    return state.fingerprints.some((record) => (
      record.fingerprint === fingerprint
      && new Date(record.expires_at).getTime() > now.getTime()
    ));
  }

  countSellerSentToday(seller: string, now = new Date()): number {
    const state = this.read();
    this.prune(state, now);
    const yyyyMmDd = formatDateKey(now);
    return state.items.filter((record) => (
      record.seller === seller
      && formatDateKey(new Date(record.sent_at)) === yyyyMmDd
    )).length;
  }

  markSent(itemId: string, seller: string, ttlHours: number, now = new Date(), fingerprint?: string): void {
    const state = this.read();
    this.prune(state, now);
    const expires = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();

    state.items = state.items.filter((record) => record.item_id !== itemId);
    state.items.push({
      item_id: itemId,
      expires_at: expires,
      seller,
      sent_at: now.toISOString()
    });

    if (fingerprint?.trim()) {
      state.fingerprints = state.fingerprints.filter((record) => record.fingerprint !== fingerprint);
      state.fingerprints.push({
        fingerprint,
        expires_at: expires,
        item_id: itemId,
        seller,
        sent_at: now.toISOString()
      });
    }

    this.write(state);
  }

  private read(): DedupeState {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<DedupeState>;
      return {
        items: Array.isArray(parsed.items) ? parsed.items : [],
        fingerprints: Array.isArray(parsed.fingerprints) ? parsed.fingerprints : []
      };
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException;
      if (maybeError?.code === "ENOENT") {
        return { items: [], fingerprints: [] };
      }
      throw new DedupeStoreError("failed_to_read_dedupe_store", error);
    }
  }

  private write(state: DedupeState): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(state, null, 2), "utf-8");
    } catch (error) {
      throw new DedupeStoreError("failed_to_write_dedupe_store", error);
    }
  }

  private prune(state: DedupeState, now: Date): void {
    const beforeItems = state.items.length;
    const beforeFingerprints = state.fingerprints.length;
    state.items = state.items.filter((record) => new Date(record.expires_at).getTime() > now.getTime());
    state.fingerprints = state.fingerprints.filter((record) => new Date(record.expires_at).getTime() > now.getTime());
    if (state.items.length !== beforeItems || state.fingerprints.length !== beforeFingerprints) {
      this.write(state);
    }
  }
}

function formatDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
