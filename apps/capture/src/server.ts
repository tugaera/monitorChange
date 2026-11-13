import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { createCaptureEngine } from './capture.js';
import type { CaptureRequest } from '../../../packages/contracts/src/index.js';

const token = process.env.INTERNAL_TOKEN;
const proxy = process.env.EGRESS_PROXY_URL;
if (!token || token.length < 32 || !proxy) throw new Error('INTERNAL_TOKEN (32+ characters) and EGRESS_PROXY_URL are required.');
const engine = createCaptureEngine(proxy);
const app = Fastify({bodyLimit:16384, logger:{redact:['req.headers.authorization']}});
app.get('/health',async()=>({status:'ok'}));
app.post<{Body:CaptureRequest}>('/capture',{
  schema:{body:{type:'object',additionalProperties:false,required:['url','method','locale'],properties:{
    url:{type:'string',maxLength:4096},method:{enum:['auto','http','browser']},locale:{type:'string',minLength:2,maxLength:35},screenshot:{type:'boolean'},
  }}},
  preHandler:async(request,reply)=>{
    const given = Buffer.from(request.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if(given.length !== expected.length || !timingSafeEqual(given,expected)) return reply.code(401).send({error:'Unauthorized'});
  },
},async(request,reply)=>{
  try { return await engine.capture(request.body); }
  catch { return reply.code(400).send({error:'Invalid capture destination.'}); }
});
app.addHook('onClose',async()=>engine.close());
await app.listen({port:Number(process.env.CAPTURE_PORT || 3101),host:process.env.CAPTURE_HOST || '127.0.0.1'});
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void app.close();});
