import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { DEFAULT_CRITERIA, DEFAULT_REGION, DEFAULT_RULE, type Criteria, type Product, type ReadRule, type Region, type Source } from '../../../packages/contracts/src/index.js';
import { Store } from '../../../packages/storage/src/index.js';
import { evaluateOffer } from '../../../packages/domain/src/index.js';
import { extractOffers } from '../../../packages/extractors/src/index.js';
import { authenticated, clearSession, hashPassword, safeEqual, setSession, verifyPassword } from './auth.js';
import { createCaptureClient, type Capture } from './capture-client.js';
import { Scheduler } from './scheduler.js';
import { analyzeSchema, idParams, object, productFields, sourceCreate, sourcePatch } from './schemas.js';

export interface AppOptions {
  dbPath?:string; bootstrapToken?:string; capture?:Capture; publicOrigin?:string; secureCookies?:boolean;
  scheduler?:boolean; webRoot?:string; logger?:boolean; now?:()=>Date; domainGapMs?:number;
}
export type MonitorApp = FastifyInstance & { store:Store; scheduler:Scheduler };
type SourceInput = Partial<Pick<Source,'name'|'url'|'method'|'intervalSeconds'|'region'|'rule'|'criteria'>> & {revision?:number};
const error=(statusCode:number,message:string)=>Object.assign(new Error(message),{statusCode});
const body=<T>(request:FastifyRequest)=>request.body as T;
const id=(request:FastifyRequest)=>(request.params as {id:string}).id;
const productInput=<T extends object>(defaults:T,overrides:Partial<T>|undefined):T=>({...structuredClone(defaults),...overrides});

/** Early input rejection; capture egress still resolves and validates every destination and redirect. */
export function validatePublicUrl(value:string):string {
  let parsed:URL;try{parsed=new URL(value);}catch{throw error(400,'Enter a valid public HTTP(S) URL.');}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw error(400,'Only public HTTP(S) URLs without credentials are supported.');
  const host=parsed.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(!host.includes('.')&&!isIP(host)||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal'))throw error(400,'Local and internal destinations are not permitted.');
  if(isIP(host)) {
    if(isIP(host)===6)throw error(400,'Use a public hostname rather than an IPv6 literal.');
    const [a,b]=host.split('.').map(Number);
    if(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19)))throw error(400,'Local and reserved IP destinations are not permitted.');
  }
  if(parsed.port&&!['80','443'].includes(parsed.port))throw error(400,'Only standard HTTP and HTTPS ports are permitted.');
  return parsed.href;
}

export async function createApp(options:AppOptions={}):Promise<MonitorApp> {
  const app=Fastify({logger:options.logger??false,bodyLimit:128*1024,trustProxy:false,ajv:{customOptions:{removeAdditional:false}}}) as unknown as MonitorApp;
  const store=new Store(options.dbPath??process.env.DB_PATH??'data/monitorchange.sqlite');
  const capture=options.capture??createCaptureClient(process.env.CAPTURE_URL,process.env.INTERNAL_TOKEN);
  const scheduler=new Scheduler(store,capture,{now:options.now,domainGapMs:options.domainGapMs});
  app.decorate('store',store);app.decorate('scheduler',scheduler);
  const configuredOrigin=options.publicOrigin??process.env.PUBLIC_ORIGIN;
  const secure=options.secureCookies??configuredOrigin?.startsWith('https:')??false;
  const bootstrap=options.bootstrapToken??process.env.BOOTSTRAP_TOKEN;
  const allowedOrigin=configuredOrigin?new URL(configuredOrigin).origin:null;
  const allowedHost=allowedOrigin?new URL(allowedOrigin).host:null;
  const authAttempts=new Map<string,{count:number;until:number}>();
  const now=()=>new Date().toISOString();
  const getProduct=(productId:string)=>{const product=store.product(productId);if(!product)throw error(404,'Product not found.');return product;};
  const getSource=(sourceId:string)=>{const source=store.source(sourceId);if(!source)throw error(404,'Source not found.');return source;};
  const detail=(source:Source)=>({...source,checks:store.checks(source.id)});
  const failAuth=(request:FastifyRequest)=>{
    const key=request.ip;const current=authAttempts.get(key);const entry=current&&current.until>Date.now()?current:{count:0,until:Date.now()+15*60_000};
    entry.count++;authAttempts.set(key,entry);
    if(authAttempts.size>1000)for(const [ip,item]of authAttempts)if(item.until<Date.now())authAttempts.delete(ip);
  };
  const checkAuthLimit=(request:FastifyRequest)=>{const value=authAttempts.get(request.ip);if(value&&value.until>Date.now()&&value.count>=10)throw error(429,'Too many login attempts. Try again in 15 minutes.');};

  app.addHook('onRequest',async(request,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY');
    reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
    const host=request.headers.host??'';
    if(allowedHost?host!==allowedHost:!/^((localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?)$/.test(host))throw error(403,'Host not allowed. Configure PUBLIC_ORIGIN for this server.');
    const path=request.url.split('?')[0];
    if(!['GET','HEAD','OPTIONS'].includes(request.method)) {
      const expected=allowedOrigin??new URL(`${secure?'https':'http'}://${host}`).origin;
      if(request.headers.origin!==expected||request.headers['sec-fetch-site']==='cross-site')throw error(403,'The request origin is not allowed.');
    }
    if(path.startsWith('/api/'))reply.header('Cache-Control','no-store');
    if(path.startsWith('/api/')&&!['/api/v1/session','/api/v1/setup','/api/health'].includes(path)&&!authenticated(store,request))throw error(401,'Authentication required.');
  });
  app.setErrorHandler((caught,request,reply)=>{
    const err=caught as Error&{statusCode?:number;validation?:unknown};const status=err.validation?400:err.statusCode??500;
    if(status>=500)request.log.error({err},'request failed');
    reply.code(status).send({error:status>=500?'internal_error':status===401?'unauthorized':status===409?'conflict':'invalid_request',message:status>=500?'The operation could not be completed. Check server logs.':err.message});
  });
  app.get('/api/health',async()=>({status:'ok',schema:store.db.pragma('user_version',{simple:true})}));
  app.get('/api/v1/session',async(request)=>({authenticated:authenticated(store,request),needsSetup:!store.getSetting('passwordHash')}));
  app.post('/api/v1/setup',{schema:{body:object({token:{type:'string',minLength:1,maxLength:500},password:{type:'string',minLength:12,maxLength:200}},['token','password'])}},async(request,reply)=>{
    checkAuthLimit(request);if(store.getSetting('passwordHash'))throw error(409,'Setup has already been completed.');
    const data=body<{token:string;password:string}>(request);
    if(!bootstrap||!safeEqual(data.token,bootstrap)){failAuth(request);throw error(401,'Invalid installation token.');}
    const hash=await hashPassword(data.password);
    store.transaction(()=>{if(store.getSetting('passwordHash'))throw error(409,'Setup has already been completed.');store.setSetting('passwordHash',hash);});
    setSession(store,reply,secure);reply.code(201);return{authenticated:true,needsSetup:false};
  });
  app.post('/api/v1/session',{schema:{body:object({password:{type:'string',minLength:1,maxLength:200}},['password'])}},async(request,reply)=>{
    checkAuthLimit(request);const stored=store.getSetting('passwordHash');const data=body<{password:string}>(request);
    if(!stored||!await verifyPassword(data.password,stored)){failAuth(request);throw error(401,'Invalid password.');}
    authAttempts.delete(request.ip);setSession(store,reply,secure);return{authenticated:true,needsSetup:false};
  });
  app.delete('/api/v1/session',async(request,reply)=>{clearSession(store,request,reply,secure);return{authenticated:false,needsSetup:!store.getSetting('passwordHash')};});
  app.post('/api/v1/password',{schema:{body:object({currentPassword:{type:'string',minLength:1,maxLength:200},newPassword:{type:'string',minLength:12,maxLength:200}},['currentPassword','newPassword'])}},async(request,reply)=>{
    checkAuthLimit(request);const data=body<{currentPassword:string;newPassword:string}>(request);const stored=store.getSetting('passwordHash');
    if(!stored||!await verifyPassword(data.currentPassword,stored)){failAuth(request);throw error(401,'Invalid password.');}
    const hash=await hashPassword(data.newPassword);
    store.transaction(()=>{store.setSetting('passwordHash',hash);store.db.prepare('DELETE FROM sessions').run();});
    setSession(store,reply,secure);return{changed:true};
  });
  app.get('/api/v1/summary',async()=>{const products=store.products().filter(item=>!item.archived);const sources=store.sources().filter(item=>products.some(product=>product.id===item.productId));return{products:products.length,sources:sources.length,activeSources:sources.filter(item=>item.active).length,unreadEvents:store.unreadEvents()};});
  app.get('/api/v1/products',async()=>store.products());
  app.post('/api/v1/products',{schema:{body:object({name:productFields.name,criteria:productFields.criteria},['name'])}},async(request,reply)=>{
    const data=body<{name:string;criteria?:Partial<Criteria>}>(request);if(!data.name.trim())throw error(400,'Product name is required.');
    const product:Product={id:randomUUID(),name:data.name.trim(),criteria:productInput(DEFAULT_CRITERIA,data.criteria),archived:false,createdAt:now(),updatedAt:now()};store.saveProduct(product);reply.code(201);return product;
  });
  const updateProduct=(product:Product,data:Partial<Pick<Product,'name'|'criteria'|'archived'>>)=>store.transaction(()=>{
    if(data.name!==undefined){if(!data.name.trim())throw error(400,'Product name is required.');product.name=data.name.trim();}
    if(data.criteria)product.criteria=productInput(product.criteria,data.criteria);
    if(data.archived!==undefined)product.archived=data.archived;
    product.updatedAt=now();store.saveProduct(product);
    for(const source of store.sources(product.id)) {
      if(data.archived===true){source.active=false;source.nextCheckAt=null;store.cancelJobs(source.id);}
      if(data.criteria&&!source.criteria){source.revision++;source.nextCheckAt=source.active?now():null;store.cancelJobs(source.id);store.resetTracking(source.id);}
      store.saveSource(source);
    }
    return product;
  });
  app.patch('/api/v1/products/:id',{schema:{params:idParams,body:object(productFields)}},async(request)=>updateProduct(getProduct(id(request)),body(request)));
  app.delete('/api/v1/products/:id',{schema:{params:idParams}},async(request)=>updateProduct(getProduct(id(request)),{archived:true}));
  app.get('/api/v1/products/:id/sources',{schema:{params:idParams}},async(request)=>{getProduct(id(request));return store.sources(id(request));});
  app.post('/api/v1/products/:id/sources',{schema:{params:idParams,body:sourceCreate}},async(request,reply)=>{
    const product=getProduct(id(request));if(product.archived)throw error(409,'Restore the product before adding sources.');
    const data=body<SourceInput>(request);if(!data.name?.trim())throw error(400,'Source name is required.');
    const source:Source={id:randomUUID(),productId:product.id,name:data.name.trim(),url:validatePublicUrl(data.url!),active:false,revision:1,intervalSeconds:data.intervalSeconds??600,method:data.method??'auto',region:productInput(DEFAULT_REGION,data.region),rule:productInput(DEFAULT_RULE,data.rule),criteria:data.criteria?productInput(product.criteria,data.criteria):null,createdAt:now(),updatedAt:now(),nextCheckAt:null,lastAttemptAt:null,lastSuccessAt:null,lastStatus:null,lastError:null,failureCount:0};
    store.saveSource(source);reply.code(201);return detail(source);
  });
  app.get('/api/v1/sources/:id',{schema:{params:idParams}},async(request)=>detail(getSource(id(request))));
  app.patch('/api/v1/sources/:id',{schema:{params:idParams,body:sourcePatch}},async(request)=>store.transaction(()=>{
    const source=getSource(id(request));const data=body<SourceInput>(request);
    if(data.revision!==source.revision)throw error(409,'This source was changed elsewhere. Reload it before saving.');
    if(data.name!==undefined){if(!data.name.trim())throw error(400,'Source name is required.');source.name=data.name.trim();}
    if(data.url!==undefined)source.url=validatePublicUrl(data.url);
    if(data.method)source.method=data.method;
    if(data.intervalSeconds)source.intervalSeconds=data.intervalSeconds;
    if(data.region)source.region=productInput(source.region,data.region);
    if(data.rule)source.rule=productInput(source.rule,data.rule);
    if(data.criteria!==undefined)source.criteria=data.criteria===null?null:productInput(source.criteria??getProduct(source.productId).criteria,data.criteria);
    const material=['url','method','region','rule','criteria'].some(key=>Object.hasOwn(data,key));
    source.revision++;source.updatedAt=now();source.nextCheckAt=source.active?now():null;
    store.cancelJobs(source.id);
    // Revision changes invalidate in-flight results. Baseline survives cosmetic/interval edits.
    if(material)store.resetTracking(source.id);
    else {const tracking=store.getTracking<{revision:number}>(source.id);if(tracking){tracking.revision=source.revision;store.saveTracking(source.id,tracking);}}
    store.saveSource(source);return detail(source);
  }));
  app.delete('/api/v1/sources/:id',{schema:{params:idParams}},async(request,reply)=>{getSource(id(request));store.deleteSource(id(request));reply.code(204).send();});
  app.post('/api/v1/sources/:id/pause',{schema:{params:idParams}},async(request)=>store.transaction(()=>{const source=getSource(id(request));source.active=false;source.nextCheckAt=null;source.updatedAt=now();store.cancelJobs(source.id);store.saveSource(source);return detail(source);}));
  app.post('/api/v1/sources/:id/resume',{schema:{params:idParams}},async(request)=>{const source=getSource(id(request));if(getProduct(source.productId).archived)throw error(409,'Restore the product before resuming sources.');source.active=true;source.nextCheckAt=now();source.updatedAt=now();store.saveSource(source);scheduler.queue(source.id,'scheduled');return detail(getSource(source.id));});
  app.post('/api/v1/sources/:id/checks',{schema:{params:idParams}},async(request,reply)=>{const source=getSource(id(request));if(getProduct(source.productId).archived)throw error(409,'The product is archived.');const job=scheduler.queue(source.id);reply.code(202);return{queued:true,jobId:job.id,nextCheckAt:job.due_at};});
  app.post('/api/v1/analyze',{schema:{body:analyzeSchema}},async(request)=>{
    const data=body<{url:string;method?:Source['method'];region?:Partial<Region>;rule?:Partial<ReadRule>;criteria?:Partial<Criteria>}>(request);
    const url=validatePublicUrl(data.url);const region=productInput(DEFAULT_REGION,data.region);
    const result=await capture({url,method:data.method??'auto',locale:region.locale,screenshot:true});
    const extraction=result.status==='ok'?extractOffers(result.html,result.finalUrl||url,productInput(DEFAULT_RULE,data.rule)):{title:'',offers:[],warnings:[result.error??result.status],complete:false};
    const {html:_html,...safeCapture}=result;
    return{capture:safeCapture,extraction,offers:extraction.offers.map(offer=>evaluateOffer(offer,productInput(DEFAULT_CRITERIA,data.criteria)))};
  });
  app.get('/api/v1/events',{schema:{querystring:object({limit:{type:'integer',minimum:1,maximum:200},offset:{type:'integer',minimum:0,maximum:100000},unread:{type:'boolean'},archived:{type:'boolean'}})}},async(request)=>{const q=request.query as {limit?:number;offset?:number;unread?:boolean;archived?:boolean};return store.events(q.limit??50,q.offset??0,q.unread??false,q.archived);});
  app.patch('/api/v1/events/:id',{schema:{params:idParams,body:object({read:{type:'boolean'},archived:{type:'boolean'}})}},async(request)=>{const event=store.event(id(request));if(!event)throw error(404,'Event not found.');const data=body<{read?:boolean;archived?:boolean}>(request);if(data.read!==undefined)event.readAt=data.read?now():null;if(data.archived!==undefined)event.archivedAt=data.archived?now():null;store.saveEvent(event);return event;});

  const configSchema=object({format:{const:'monitorchange'},version:{const:1},exportedAt:{type:'string',maxLength:50},products:{type:'array',maxItems:100,items:object({...productFields,sources:{type:'array',maxItems:1000,items:sourceCreate}},['name','criteria','sources'])}},['format','version','products']);
  app.get('/api/v1/config/export',async()=>({format:'monitorchange',version:1,exportedAt:now(),products:store.products().map(product=>({name:product.name,criteria:product.criteria,archived:product.archived,sources:store.sources(product.id).map(source=>({name:source.name,url:source.url,intervalSeconds:source.intervalSeconds,method:source.method,region:source.region,rule:source.rule,criteria:source.criteria}))}))}));
  app.post('/api/v1/config/import',{bodyLimit:2*1024*1024,schema:{body:object({config:configSchema,apply:{type:'boolean'}},['config','apply'])}},async(request,reply)=>{
    const data=body<{config:{products:Array<{name:string;criteria:Criteria;archived?:boolean;sources:SourceInput[]}>};apply:boolean}>(request);
    const count=data.config.products.reduce((sum,product)=>sum+product.sources.length,0);if(count>1000)throw error(400,'Import is limited to 1000 sources.');
    for(const product of data.config.products){if(!product.name.trim())throw error(400,'Every product needs a name.');for(const source of product.sources){if(!source.name?.trim())throw error(400,'Every source needs a name.');validatePublicUrl(source.url!);}}
    const summary={products:data.config.products.length,sources:count,warnings:['Import creates new copies. All imported sources start paused. Existing items and history remain unchanged.'],applied:data.apply};
    if(!data.apply)return summary;
    store.transaction(()=>{for(const item of data.config.products){
      const product:Product={id:randomUUID(),name:item.name.trim(),criteria:productInput(DEFAULT_CRITERIA,item.criteria),archived:item.archived??false,createdAt:now(),updatedAt:now()};store.saveProduct(product);
      for(const input of item.sources){const source:Source={id:randomUUID(),productId:product.id,name:input.name!.trim(),url:validatePublicUrl(input.url!),active:false,revision:1,intervalSeconds:input.intervalSeconds??600,method:input.method??'auto',region:productInput(DEFAULT_REGION,input.region),rule:productInput(DEFAULT_RULE,input.rule),criteria:input.criteria?productInput(product.criteria,input.criteria):null,createdAt:now(),updatedAt:now(),nextCheckAt:null,lastAttemptAt:null,lastSuccessAt:null,lastStatus:null,lastError:null,failureCount:0};store.saveSource(source);}
    }});reply.code(201);return summary;
  });

  const webRoot=options.webRoot??resolve('apps/web/dist');
  if(existsSync(resolve(webRoot,'index.html'))) {
    await app.register(fastifyStatic,{root:webRoot,prefix:'/',index:['index.html']});
    app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api/')?reply.code(404).send({error:'not_found',message:'Route not found.'}):reply.sendFile('index.html'));
  }
  app.addHook('onClose',async()=>{await scheduler.stop();store.close();});
  if(options.scheduler!==false)app.addHook('onReady',async()=>{scheduler.start();});
  return app;
}
