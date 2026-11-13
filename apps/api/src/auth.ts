import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Store } from '../../../packages/storage/src/index.js';

const derive=(password:string,salt:string):Promise<Buffer> => new Promise((resolve,reject) => {
  scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key) => error?reject(error):resolve(key));
});
export async function hashPassword(password:string):Promise<string> {
  const salt=randomBytes(24).toString('hex'); const key=await derive(password,salt);
  return `scrypt:32768:8:1:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password:string,stored:string):Promise<boolean> {
  const parts=stored.split(':'); if (parts.length!==6 || parts[0]!=='scrypt') return false;
  const expected=Buffer.from(parts[5],'hex'); const actual=await derive(password,parts[4]);
  return expected.length===actual.length && timingSafeEqual(actual,expected);
}
export function safeEqual(a:string,b:string):boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
}
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function sessionToken(request:FastifyRequest):string {
  const cookie=request.headers.cookie??'';
  return cookie.split(';').map(item=>item.trim()).find(item=>item.startsWith('mc_session='))?.slice(11)??'';
}
export function authenticated(store:Store,request:FastifyRequest):boolean {
  const token=sessionToken(request); return token.length===64 && store.sessionExists(tokenHash(token),new Date().toISOString());
}
export function setSession(store:Store,reply:FastifyReply,secure:boolean):void {
  const token=randomBytes(32).toString('hex');
  store.pruneSessions(new Date().toISOString());
  store.createSession(tokenHash(token),new Date(Date.now()+12*3600_000).toISOString());
  reply.header('Set-Cookie',`mc_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure?'; Secure':''}`);
}
export function clearSession(store:Store,request:FastifyRequest,reply:FastifyReply,secure:boolean):void {
  const token=sessionToken(request); if(token)store.removeSession(tokenHash(token));
  reply.header('Set-Cookie',`mc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`);
}
