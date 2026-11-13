import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type MonitorApp } from '../../apps/api/src/app.js';
import type { CaptureResult, Source } from '../../packages/contracts/src/index.js';
import { DEFAULT_RULE } from '../../packages/contracts/src/index.js';

const apps:MonitorApp[]=[];
const origin='http://localhost';
const capture=(html='<main><h1>Invented item</h1><span data-stock>Out of stock</span></main>'):CaptureResult=>({status:'ok',method:'http',finalUrl:'https://example.com/item',httpStatus:200,html,capturedAt:'2026-11-13T00:00:00.000Z',error:null});
async function setup(options:Parameters<typeof createApp>[0]={}) {
  const app=await createApp({dbPath:':memory:',bootstrapToken:'test-installation-token-12345',scheduler:false,capture:async()=>capture(),...options});apps.push(app);
  const response=await app.inject({method:'POST',url:'/api/v1/setup',headers:{origin},payload:{token:'test-installation-token-12345',password:'long-enough-password'}});
  expect(response.statusCode).toBe(201);
  const cookie=(response.headers['set-cookie'] as string).split(';')[0];
  const headers={origin,cookie};
  return {app,headers};
}
async function createSource(app:MonitorApp,headers:Record<string,string>,criteria:Record<string,unknown>={}) {
  const product=(await app.inject({method:'POST',url:'/api/v1/products',headers,payload:{name:'Invented item',criteria}})).json();
  const response=await app.inject({method:'POST',url:`/api/v1/products/${product.id}/sources`,headers,payload:{name:'Example shop',url:'https://example.com/item',intervalSeconds:60,rule:{...DEFAULT_RULE,scopeSelector:'main',directSeller:'Example shop',confirmedSellerType:'direct',confirmedCondition:'new',confirmedAction:'online_order'}}});
  expect(response.statusCode).toBe(201);return response.json() as Source;
}
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});

describe('local authentication and validated API',()=>{
  it('protects first-user setup, data, origins, sessions, and logout',async()=>{
    const app=await createApp({dbPath:':memory:',bootstrapToken:'test-installation-token-12345',scheduler:false});apps.push(app);
    expect((await app.inject('/api/v1/products')).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/v1/setup',headers:{origin:'http://evil.example'},payload:{token:'test-installation-token-12345',password:'long-enough-password'}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/setup',headers:{origin},payload:{token:'wrong',password:'long-enough-password'}})).statusCode).toBe(401);
    const first=await app.inject({method:'POST',url:'/api/v1/setup',headers:{origin},payload:{token:'test-installation-token-12345',password:'long-enough-password'}});
    expect(first.statusCode).toBe(201);expect(first.headers['set-cookie']).toContain('HttpOnly');expect(first.headers['set-cookie']).toContain('SameSite=Strict');
    const cookie=(first.headers['set-cookie'] as string).split(';')[0];
    expect((await app.inject({url:'/api/v1/session',headers:{cookie}})).json()).toEqual({authenticated:true,needsSetup:false});
    expect((await app.inject({method:'POST',url:'/api/v1/products',headers:{cookie},payload:{name:'Item'}})).statusCode).toBe(403);
    expect((await app.inject({method:'DELETE',url:'/api/v1/session',headers:{cookie,origin}})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/v1/products',headers:{cookie}})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/v1/session',headers:{origin},payload:{password:'long-enough-password'}})).statusCode).toBe(200);
    expect(app.store.getSetting('passwordHash')).not.toContain('long-enough-password');
  });
  it('supports multiple products/sources, default exclusions and rejects unsafe or unknown input',async()=>{
    const {app,headers}=await setup();const source=await createSource(app,headers);const another=await createSource(app,headers);
    expect(source.active).toBe(false);expect(source.id).not.toBe(another.id);
    const product=app.store.product(source.productId)!;expect(product.criteria.sellerPolicy).toBe('direct_only');
    const summary=(await app.inject({url:'/api/v1/summary',headers})).json();expect(summary).toMatchObject({products:2,sources:2,activeSources:0});
    for(const url of ['http://127.0.0.1/internal','http://169.254.169.254/latest','http://router.local','file:///etc/passwd','http://user:pass@example.com/']) {
      expect((await app.inject({method:'POST',url:`/api/v1/products/${product.id}/sources`,headers,payload:{name:'invalid',url}})).statusCode).toBe(400);
    }
    expect((await app.inject({method:'POST',url:'/api/v1/products',headers,payload:{name:'invalid',script:'evil'}})).statusCode).toBe(400);
  });
  it('checks source revisions and keeps history after removal',async()=>{
    const {app,headers}=await setup();const source=await createSource(app,headers);
    const saved=await app.inject({method:'PATCH',url:`/api/v1/sources/${source.id}`,headers,payload:{revision:1,name:'New name'}});expect(saved.statusCode).toBe(200);expect(saved.json().revision).toBe(2);
    expect((await app.inject({method:'PATCH',url:`/api/v1/sources/${source.id}`,headers,payload:{revision:1,name:'Stale'}})).statusCode).toBe(409);
    await app.inject({method:'POST',url:`/api/v1/sources/${source.id}/checks`,headers});await app.scheduler.tick();
    expect(app.store.checks(source.id)).toHaveLength(1);
    expect((await app.inject({method:'DELETE',url:`/api/v1/sources/${source.id}`,headers})).statusCode).toBe(204);
    expect(app.store.source(source.id)).toBeUndefined();expect(app.store.checks(source.id)).toHaveLength(1);
  });
});

describe('persistent scheduler and events',()=>{
  it('coalesces manual jobs, respects intervals and produces one confirmed restock event',async()=>{
    let clock=Date.parse('2026-11-13T00:00:00Z');let stock='Out of stock';
    const {app,headers}=await setup({now:()=>new Date(clock),domainGapMs:0,capture:async()=>capture(`<main><h1>Invented item</h1><span data-stock>${stock}</span><span data-price>100 EUR</span></main>`)});
    const source=await createSource(app,headers);
    const queue=()=>app.inject({method:'POST',url:`/api/v1/sources/${source.id}/checks`,headers});
    const first=(await queue()).json();expect((await queue()).json().jobId).toBe(first.jobId);
    await app.scheduler.tick();expect(app.store.checks(source.id)).toHaveLength(1);expect(app.store.events()).toHaveLength(0);
    await queue();expect(await app.scheduler.tick()).toBe(false);
    stock='In stock';clock+=60_000;await app.scheduler.tick();expect(app.store.events()).toHaveLength(0);
    clock+=60_000;await queue();await app.scheduler.tick();expect(app.store.events()).toHaveLength(1);expect(app.store.events()[0].type).toBe('restocked');
    clock+=60_000;await queue();await app.scheduler.tick();expect(app.store.events()).toHaveLength(1);
    const event=app.store.events()[0];await app.inject({method:'PATCH',url:`/api/v1/events/${event.id}`,headers,payload:{read:true,archived:true}});
    expect(app.store.unreadEvents()).toBe(0);
    clock+=60_000;await queue();await app.scheduler.tick();expect(app.store.events()).toHaveLength(1);
  });
  it('records a late result as obsolete after a configuration edit',async()=>{
    let release!:(result:CaptureResult)=>void;
    const {app,headers}=await setup({capture:()=>new Promise(resolve=>{release=resolve;})});const source=await createSource(app,headers);
    await app.inject({method:'POST',url:`/api/v1/sources/${source.id}/checks`,headers});
    const running=app.scheduler.tick();
    await app.inject({method:'PATCH',url:`/api/v1/sources/${source.id}`,headers,payload:{revision:1,url:'https://example.com/other'}});
    release(capture());await running;
    expect(app.store.checks(source.id)[0].obsolete).toBe(true);expect(app.store.source(source.id)?.lastSuccessAt).toBeNull();expect(app.store.events()).toHaveLength(0);
  });
  it('archive cancels queued work and repeated failures preserve the previous successful observation',async()=>{
    let clock=Date.parse('2026-11-13T00:00:00Z');let failure=false;
    const {app,headers}=await setup({now:()=>new Date(clock),domainGapMs:0,capture:async()=>failure?{...capture(),status:'blocked',error:'Blocked',html:'',retryAfterSeconds:120}:capture()});
    const source=await createSource(app,headers);
    await app.inject({method:'POST',url:`/api/v1/sources/${source.id}/checks`,headers});await app.scheduler.tick();
    const lastSuccessAt=app.store.source(source.id)?.lastSuccessAt;failure=true;clock+=60_000;
    await app.inject({method:'POST',url:`/api/v1/sources/${source.id}/checks`,headers});await app.scheduler.tick();
    expect(app.store.source(source.id)?.lastSuccessAt).toBe(lastSuccessAt);expect(app.store.source(source.id)?.lastStatus).toBe('blocked');
    const response=await app.inject({method:'POST',url:`/api/v1/sources/${source.id}/checks`,headers});expect(Date.parse(response.json().nextCheckAt)).toBeGreaterThan(clock);
    await app.inject({method:'DELETE',url:`/api/v1/products/${source.productId}`,headers});clock+=600_000;
    expect(await app.scheduler.tick()).toBe(false);expect(app.store.source(source.id)?.active).toBe(false);
  });
});
