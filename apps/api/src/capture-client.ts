import type { CaptureRequest, CaptureResult } from '../../../packages/contracts/src/index.js';
export type Capture = (request:CaptureRequest)=>Promise<CaptureResult>;
export function createCaptureClient(url:string|undefined,token:string|undefined):Capture {
  return async(request)=>{
    if(!url || !token) throw new Error('Capture service is not configured. Set CAPTURE_URL and INTERNAL_TOKEN.');
    const response=await fetch(`${url.replace(/\/$/,'')}/capture`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify(request),signal:AbortSignal.timeout(90_000),redirect:'error',
    });
    if(!response.ok) throw new Error(`Capture service returned HTTP ${response.status}.`);
    const maxBytes=12*1024*1024; let size=0; const chunks:Uint8Array[]=[];
    const reader=response.body?.getReader();
    if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('Capture service response exceeds the limit.');}chunks.push(value);}
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8')) as CaptureResult;
    if(!result || !['ok','timeout','http_error','blocked','login_required','limit_exceeded','capture_error'].includes(result.status) || typeof result.html!=='string' || !['http','browser'].includes(result.method)) throw new Error('Invalid capture service response.');
    return result;
  };
}
