import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Check, MonitorEvent, Product, Source } from '../../contracts/src/index.js';
import { migrations } from './migrations.js';

export interface Job {
  id: string; source_id: string; revision: number; reason: 'manual' | 'scheduled'; due_at: string;
  status: 'queued' | 'running' | 'done' | 'cancelled'; lease_token: string | null;
  lease_expires_at: string | null; created_at: string;
}
const parse = <T>(row: unknown): T | undefined => row ? JSON.parse((row as { data: string }).data) as T : undefined;

/** One application process owns this connection and every write. */
export class Store {
  readonly db: Database.Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    const current = this.db.pragma('user_version', { simple: true }) as number;
    const newest = migrations.at(-1)?.version ?? 0;
    if (current > newest) { this.db.close(); throw new Error('Database schema is newer than this application. Restore a compatible version.'); }
    for (const migration of migrations.filter(item => item.version > current)) {
      this.db.transaction(() => { this.db.exec(migration.sql); this.db.pragma(`user_version = ${migration.version}`); })();
    }
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T { return this.db.transaction(fn)(); }
  getSetting(key: string): string | undefined { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as {value:string} | undefined)?.value; }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value); }
  products(): Product[] { return this.db.prepare("SELECT data FROM products ORDER BY json_extract(data,'$.createdAt') DESC").all().map(row => parse<Product>(row)!); }
  product(id: string): Product | undefined { return parse(this.db.prepare('SELECT data FROM products WHERE id=?').get(id)); }
  saveProduct(product: Product) { this.db.prepare('INSERT INTO products(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(product.id, JSON.stringify(product)); }
  sources(productId?: string): Source[] {
    const statement = productId ? this.db.prepare('SELECT data FROM sources WHERE product_id=? AND deleted=0 ORDER BY rowid') : this.db.prepare('SELECT data FROM sources WHERE deleted=0 ORDER BY rowid');
    return (productId ? statement.all(productId) : statement.all()).map(row => parse<Source>(row)!);
  }
  source(id: string, includeDeleted=false): Source | undefined { return parse(this.db.prepare(`SELECT data FROM sources WHERE id=? ${includeDeleted ? '' : 'AND deleted=0'}`).get(id)); }
  saveSource(source: Source) { this.db.prepare('INSERT INTO sources(id,product_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(source.id, source.productId, JSON.stringify(source)); }
  deleteSource(id: string) { this.transaction(() => { this.cancelJobs(id); this.db.prepare('UPDATE sources SET deleted=1 WHERE id=?').run(id); }); }
  checks(sourceId: string, limit=30): Check[] { return this.db.prepare('SELECT data FROM checks WHERE source_id=? ORDER BY finished_at DESC,rowid DESC LIMIT ?').all(sourceId,limit).map(row => parse<Check>(row)!); }
  saveCheck(check: Check) { this.db.prepare('INSERT OR IGNORE INTO checks(id,source_id,finished_at,data) VALUES(?,?,?,?)').run(check.id,check.sourceId,check.finishedAt,JSON.stringify(check)); }
  getTracking<T>(id: string): T | null { return parse<T>(this.db.prepare('SELECT data FROM tracking WHERE source_id=?').get(id)) ?? null; }
  saveTracking(id: string, data: unknown) { this.db.prepare('INSERT INTO tracking(source_id,data) VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(data)); }
  resetTracking(id: string) { this.db.prepare('DELETE FROM tracking WHERE source_id=?').run(id); }
  events(limit=50,offset=0,unread=false,archived?: boolean): MonitorEvent[] {
    let where = '1=1';
    if (unread) where += " AND json_extract(data,'$.readAt') IS NULL";
    if (archived !== undefined) where += ` AND json_extract(data,'$.archivedAt') IS ${archived ? 'NOT ' : ''}NULL`;
    return this.db.prepare(`SELECT data FROM events WHERE ${where} ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?`).all(limit,offset).map(row => parse<MonitorEvent>(row)!);
  }
  event(id: string): MonitorEvent | undefined { return parse(this.db.prepare('SELECT data FROM events WHERE id=?').get(id)); }
  saveEvent(event: MonitorEvent, dedupKey?: string) {
    if (dedupKey) this.db.prepare('INSERT OR IGNORE INTO events(id,source_id,created_at,dedup_key,data) VALUES(?,?,?,?,?)').run(event.id,event.sourceId,event.createdAt,dedupKey,JSON.stringify(event));
    else this.db.prepare('UPDATE events SET data=? WHERE id=?').run(JSON.stringify(event),event.id);
  }
  unreadEvents(): number { return (this.db.prepare("SELECT COUNT(*) n FROM events WHERE json_extract(data,'$.readAt') IS NULL AND json_extract(data,'$.archivedAt') IS NULL").get() as {n:number}).n; }
  cancelJobs(sourceId: string) { this.db.prepare("UPDATE jobs SET status='cancelled' WHERE source_id=? AND status IN ('queued','running')").run(sourceId); }
  activeJob(sourceId: string): Job | undefined { return this.db.prepare("SELECT * FROM jobs WHERE source_id=? AND status IN ('queued','running')").get(sourceId) as Job | undefined; }
  job(id: string): Job | undefined { return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as Job | undefined; }
  queue(source: Source, reason: Job['reason'], now: string): Job {
    return this.transaction(() => {
      const existing = this.activeJob(source.id);
      if (existing) return existing;
      const hostname = new URL(source.url).hostname;
      const last = source.lastAttemptAt ? new Date(source.lastAttemptAt).getTime() + source.intervalSeconds * 1000 : 0;
      const domain = this.domainNext(hostname);
      const due = new Date(Math.max(Date.parse(now), last, domain ? Date.parse(domain) : 0)).toISOString();
      const job: Job = { id:randomUUID(), source_id:source.id, revision:source.revision, reason, due_at:due, status:'queued', lease_token:null, lease_expires_at:null, created_at:now };
      this.db.prepare('INSERT INTO jobs(id,source_id,revision,reason,due_at,status,created_at) VALUES(?,?,?,?,?,?,?)').run(job.id,job.source_id,job.revision,job.reason,job.due_at,job.status,job.created_at);
      source.nextCheckAt = due; this.saveSource(source);
      return job;
    });
  }
  domainNext(hostname: string): string | null { return (this.db.prepare('SELECT next_allowed_at FROM domains WHERE hostname=?').get(hostname) as {next_allowed_at:string} | undefined)?.next_allowed_at ?? null; }
  blockDomain(hostname: string, until: string) { this.db.prepare('INSERT INTO domains(hostname,next_allowed_at) VALUES(?,?) ON CONFLICT(hostname) DO UPDATE SET next_allowed_at=MAX(next_allowed_at,excluded.next_allowed_at)').run(hostname,until); }
  claim(now: string, leaseMs: number, domainGapMs: number): Job | null {
    return this.transaction(() => {
      // Expired workers lose their token: a late result cannot commit over a new lease.
      this.db.prepare("UPDATE jobs SET status='queued',lease_token=NULL,lease_expires_at=NULL WHERE status='running' AND lease_expires_at<=?").run(now);
      const jobs = this.db.prepare("SELECT * FROM jobs WHERE status='queued' AND due_at<=? ORDER BY due_at,created_at LIMIT 100").all(now) as Job[];
      for (const job of jobs) {
        const source = this.source(job.source_id);
        const product = source && this.product(source.productId);
        if (!source || !product || product.archived || source.revision !== job.revision || (!source.active && job.reason !== 'manual')) {
          this.db.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(job.id); continue;
        }
        const hostname = new URL(source.url).hostname;
        const domainNext = this.domainNext(hostname);
        if (domainNext && domainNext > now) {
          this.db.prepare('UPDATE jobs SET due_at=? WHERE id=?').run(domainNext,job.id);
          source.nextCheckAt=domainNext; this.saveSource(source); continue;
        }
        job.status='running'; job.lease_token=randomUUID(); job.lease_expires_at=new Date(Date.parse(now)+leaseMs).toISOString();
        this.db.prepare("UPDATE jobs SET status='running',lease_token=?,lease_expires_at=? WHERE id=?").run(job.lease_token,job.lease_expires_at,job.id);
        this.blockDomain(hostname,new Date(Date.parse(now)+domainGapMs).toISOString());
        source.lastAttemptAt=now; source.nextCheckAt=null; this.saveSource(source);
        return job;
      }
      return null;
    });
  }
  owns(job: Job): boolean { const current=this.job(job.id); return current?.status==='running' && current.lease_token===job.lease_token; }
  complete(job: Job) { this.db.prepare("UPDATE jobs SET status='done',lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=? AND status='running'").run(job.id,job.lease_token); }
  createSession(hash: string, expiresAt: string) { this.db.prepare('INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)').run(hash,expiresAt); }
  sessionExists(hash: string, now: string): boolean { return !!this.db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?').get(hash,now); }
  removeSession(hash: string) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); }
  pruneSessions(now: string) { this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now); }
  async backup(path: string) { await this.db.backup(path); }
}
