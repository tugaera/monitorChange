import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Store } from '../../packages/storage/src/index.js';
import { DEFAULT_CRITERIA, DEFAULT_REGION, DEFAULT_RULE, type Source } from '../../packages/contracts/src/index.js';

const directories:string[]=[];const stores:Store[]=[];
afterEach(()=>{for(const store of stores.splice(0))try{store.close();}catch{}for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
const folder=()=>{const dir=mkdtempSync(join(tmpdir(),'monitorchange-test-'));directories.push(dir);return dir;};
const sourceFixture=():Source=>({id:'source-one',productId:'product-one',name:'Example source',url:'https://example.com/item',active:true,revision:1,intervalSeconds:60,method:'http',region:DEFAULT_REGION,rule:DEFAULT_RULE,criteria:null,createdAt:'2026-11-13T00:00:00.000Z',updatedAt:'2026-11-13T00:00:00.000Z',nextCheckAt:null,lastAttemptAt:null,lastSuccessAt:null,lastStatus:null,lastError:null,failureCount:0});
function seed(store:Store){store.saveProduct({id:'product-one',name:'Item',criteria:DEFAULT_CRITERIA,archived:false,createdAt:'2026-11-13T00:00:00.000Z',updatedAt:'2026-11-13T00:00:00.000Z'});store.saveSource(sourceFixture());}
describe('SQLite persistence and lease ownership',()=>{
  it('applies versioned migrations and restores a live WAL backup consistently',async()=>{
    const dir=folder();const path=join(dir,'db.sqlite');const store=new Store(path);stores.push(store);seed(store);
    store.setSetting('test','kept');store.saveTracking('source-one',{episode:5});
    expect(store.db.pragma('journal_mode',{simple:true})).toBe('wal');
    const backup=join(dir,'backup.sqlite');await store.backup(backup);
    const restored=new Store(backup);stores.push(restored);expect(restored.products()).toHaveLength(1);expect(restored.sources()).toHaveLength(1);expect(restored.getTracking('source-one')).toEqual({episode:5});expect(restored.getSetting('test')).toBe('kept');
  });
  it('rejects schema newer than the running app',()=>{
    const path=join(folder(),'future.sqlite');const db=new Database(path);db.pragma('user_version=999');db.close();expect(()=>new Store(path)).toThrow('newer');
  });
  it('recovers expired leases and prevents an old worker from completing the new lease',()=>{
    const store=new Store(':memory:');stores.push(store);seed(store);const now='2026-11-13T00:00:00.000Z';store.queue(sourceFixture(),'manual',now);
    const old=store.claim(now,30_000,0)!;expect(old.status).toBe('running');
    const fresh=store.claim('2026-11-13T00:00:31.000Z',30_000,0)!;expect(fresh.id).toBe(old.id);expect(fresh.lease_token).not.toBe(old.lease_token);expect(store.owns(old)).toBe(false);
    store.complete(old);expect(store.job(fresh.id)?.status).toBe('running');store.complete(fresh);expect(store.job(fresh.id)?.status).toBe('done');
  });
  it('rolls back state and events together when a transaction fails',()=>{
    const store=new Store(':memory:');stores.push(store);seed(store);
    expect(()=>store.transaction(()=>{store.saveTracking('source-one',{episode:9});throw new Error('simulated write failure');})).toThrow('simulated');
    expect(store.getTracking('source-one')).toBeNull();
  });
});
