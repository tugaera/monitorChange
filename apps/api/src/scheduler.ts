import { randomUUID } from 'node:crypto';
import type { CaptureResult, Check, Criteria, MonitorEvent, Source } from '../../../packages/contracts/src/index.js';
import { advanceTracking, evaluateOffer, type SourceTrackingState } from '../../../packages/domain/src/index.js';
import { extractOffers } from '../../../packages/extractors/src/index.js';
import { Store, type Job } from '../../../packages/storage/src/index.js';
import type { Capture } from './capture-client.js';

export interface SchedulerOptions { now?:()=>Date; leaseMs?:number; domainGapMs?:number; }
export class Scheduler {
  private timer:ReturnType<typeof setInterval>|null=null;
  private running:Promise<boolean>|null=null;
  private stopping=false;
  private readonly now:()=>Date;
  private readonly leaseMs:number;
  private readonly domainGapMs:number;
  constructor(readonly store:Store,private capture:Capture,options:SchedulerOptions={}) {
    this.now=options.now??(()=>new Date());this.leaseMs=options.leaseMs??120_000;this.domainGapMs=options.domainGapMs??10_000;
  }
  start() { if(this.timer)return;this.stopping=false;this.timer=setInterval(()=>{void this.tick().catch(()=>{/* Persisted lease makes failed jobs recoverable. */});},1000);this.timer.unref();void this.tick().catch(()=>{}); }
  async stop() {this.stopping=true;if(this.timer)clearInterval(this.timer);this.timer=null;await this.running;}
  tick():Promise<boolean> {
    if(this.running)return this.running;
    if(this.stopping)return Promise.resolve(false);
    this.running=this.processOne().finally(()=>{this.running=null;});return this.running;
  }
  queue(id:string,reason:Job['reason']='manual'):Job {
    const source=this.store.source(id);if(!source)throw new Error('Source not found.');
    return this.store.queue(source,reason,this.now().toISOString());
  }
  private async processOne():Promise<boolean> {
    const now=this.now().toISOString();
    for(const source of this.store.sources()) {
      if(source.active && !this.store.product(source.productId)?.archived && (!source.nextCheckAt || source.nextCheckAt<=now)) this.store.queue(source,'scheduled',now);
    }
    const job=this.store.claim(now,this.leaseMs,this.domainGapMs);if(!job)return false;
    const source=this.store.source(job.source_id)!;const product=this.store.product(source.productId)!;
    const criteria=source.criteria??product.criteria;
    let captured:CaptureResult;
    try {captured=await this.capture({url:source.url,method:source.method,locale:source.region.locale});}
    catch(error) {captured={status:'capture_error',method:source.method==='browser'?'browser':'http',finalUrl:source.url,httpStatus:null,html:'',capturedAt:this.now().toISOString(),error:error instanceof Error?error.message:'Capture failed.'};}
    const finishedAt=this.now().toISOString();
    let offers:Check['offers']=[];let warnings:string[]=[];let complete=false;
    if(captured.status==='ok') {
      try {const extraction=extractOffers(captured.html,captured.finalUrl||source.url,source.rule);offers=extraction.offers.map(offer=>evaluateOffer(offer,criteria));warnings=extraction.warnings;complete=extraction.complete;}
      catch(error) {captured.status='capture_error';captured.error=error instanceof Error?error.message:'Page analysis failed.';}
    }
    const check:Check={id:randomUUID(),sourceId:source.id,revision:job.revision,startedAt:now,finishedAt,status:captured.status,method:captured.method,error:captured.error,offers,warnings,obsolete:false};
    this.store.transaction(()=>{
      const current=this.store.source(source.id);
      const valid=this.store.owns(job)&&!!current&&current.revision===job.revision&&!this.store.product(source.productId)?.archived;
      check.obsolete=!valid;this.store.saveCheck(check);
      if(!valid) {this.store.complete(job);return;}
      const result=advanceTracking(this.store.getTracking<SourceTrackingState>(source.id),offers,{
        revision:job.revision,checkId:check.id,now:finishedAt,captureOk:captured.status==='ok',complete,criteria,
        minConfirmationMs:Math.min(source.intervalSeconds*1000,30_000),maxConfirmationAgeMs:Math.max(source.intervalSeconds*3*1000,90_000),
      });
      this.store.saveTracking(source.id,result.state);
      for(const event of result.events) {
        const labels:Record<string,string>={restocked:'Stock disponível novamente',eligible_offer_found:'Nova oferta elegível',price_eligible:'Preço dentro do limite',initial_available:'Disponibilidade inicial',diagnostic:'Diagnóstico'};
        const record:MonitorEvent={id:randomUUID(),productId:product.id,sourceId:source.id,sourceName:source.name,productName:product.name,type:event.type,title:labels[event.type]??event.type,message:event.reasons.join(' · '),createdAt:finishedAt,readAt:null,archivedAt:null,url:source.url};
        this.store.saveEvent(record,`${source.id}:${job.revision}:${event.dedupKey}`);
      }
      current!.lastStatus=captured.status;current!.lastError=captured.error;
      current!.failureCount=captured.status==='ok'?0:current!.failureCount+1;
      if(captured.status==='ok'&&complete)current!.lastSuccessAt=finishedAt;
      if(captured.status!=='ok') {
        const seconds=Math.max(captured.retryAfterSeconds??0,Math.min(3600,source.intervalSeconds*2**Math.min(current!.failureCount,6)));
        this.store.blockDomain(new URL(source.url).hostname,new Date(Date.parse(finishedAt)+seconds*1000).toISOString());
        if(current!.failureCount===3) this.store.saveEvent({id:randomUUID(),productId:product.id,sourceId:source.id,sourceName:source.name,productName:product.name,type:'diagnostic',title:'Verificações falharam repetidamente',message:captured.error??captured.status,createdAt:finishedAt,readAt:null,archivedAt:null,url:source.url},`${source.id}:${job.revision}:failure:${check.id}`);
      }
      current!.nextCheckAt=current!.active?new Date(Math.max(Date.parse(now)+source.intervalSeconds*1000,Date.parse(this.store.domainNext(new URL(source.url).hostname)??finishedAt))).toISOString():null;
      this.store.saveSource(current!);this.store.complete(job);
    });
    return true;
  }
}
