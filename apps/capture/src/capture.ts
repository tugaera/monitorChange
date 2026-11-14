import { randomUUID } from 'node:crypto';
import { fetch, ProxyAgent } from 'undici';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { parsePublicUrl } from '../../../packages/network/src/index.js';
import type { CaptureRequest, CaptureResult, CaptureStatus, ElementCandidate } from '../../../packages/contracts/src/index.js';

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_BROWSER_BYTES = 25 * 1024 * 1024;
function failure(status: CaptureStatus, method: 'http'|'browser', url: string, message: string, httpStatus: number|null = null): CaptureResult {
  return { status, method, finalUrl: url, httpStatus, html: '', capturedAt: new Date().toISOString(), error: message };
}
function classify(status: number, html: string): CaptureStatus {
  if (status === 429 || status === 403) return 'blocked';
  if (status === 401) return 'login_required';
  if (status >= 400) return 'http_error';
  if (/challenge-platform|cf-chl-|<title>\s*(just a moment|access denied|verify you are human)/i.test(html)) return 'blocked';
  return 'ok';
}
function captureError(status: CaptureStatus, httpStatus: number): string | null {
  if (status === 'ok') return null;
  if (status === 'blocked') return httpStatus === 403 || httpStatus === 429
    ? `A página recusou a leitura (HTTP ${httpStatus}).`
    : `A página devolveu conteúdo que parece ser uma verificação de acesso (HTTP ${httpStatus}).`;
  if (status === 'login_required') return `A página exige autenticação (HTTP ${httpStatus}).`;
  return `A página devolveu um erro HTTP ${httpStatus}.`;
}
export function createCaptureEngine(proxyUrl: string) {
  if (!/^http:\/\//.test(proxyUrl)) throw new Error('An HTTP egress proxy is required.');
  const dispatcher = new ProxyAgent(proxyUrl);
  let browser: Browser | null = null;
  let browserBusy = false;

  async function httpCapture(input: CaptureRequest): Promise<CaptureResult> {
    let url = parsePublicUrl(input.url).href;
    const signal = AbortSignal.timeout(20000);
    try {
      for (let hop = 0; hop <= 5; hop++) {
        const response = await fetch(url, { dispatcher, redirect: 'manual', signal,
          headers: { 'user-agent': 'MonitorChange/0.1', 'accept-language': input.locale, accept: 'text/html,application/xhtml+xml' } });
        if ([301,302,303,307,308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location) return failure('http_error','http',url,'Redirect without a destination.',response.status);
          url = parsePublicUrl(new URL(location,url).href).href;
          continue;
        }
        const mediaType = response.headers.get('content-type') || '';
        if (!/text\/html|application\/xhtml\+xml/i.test(mediaType)) {
          await response.body?.cancel();
          return failure('capture_error','http',url,'The response is not an HTML page.',response.status);
        }
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        if (response.body) for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > MAX_HTML_BYTES) return failure('limit_exceeded','http',url,'HTML exceeds 5 MiB.',response.status);
          chunks.push(chunk);
        }
        const html = Buffer.concat(chunks).toString('utf8');
        const status = classify(response.status,html);
        const retryValue = response.headers.get('retry-after');
        const retry = retryValue ? (/^\d+$/.test(retryValue) ? Number(retryValue) : Math.max(0,(Date.parse(retryValue)-Date.now())/1000)) : undefined;
        return { status,method:'http',finalUrl:url,httpStatus:response.status,html:status === 'ok' ? html : '',
          capturedAt:new Date().toISOString(),error:captureError(status,response.status),
          ...(retry !== undefined && Number.isFinite(retry) ? {retryAfterSeconds:Math.ceil(retry)} : {}) };
      }
      return failure('limit_exceeded','http',url,'Too many redirects.');
    } catch (error) {
      return failure(signal.aborted ? 'timeout' : 'capture_error','http',url,error instanceof Error ? error.message : 'Capture failed.');
    }
  }

  async function browserCapture(input: CaptureRequest): Promise<CaptureResult> {
    parsePublicUrl(input.url);
    if (browserBusy) return failure('capture_error','browser',input.url,'Browser busy; retry later.');
    browserBusy = true;
    let context: BrowserContext | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
      if (!browser?.isConnected()) browser = await chromium.launch({
        headless: true, chromiumSandbox: true, proxy: { server: proxyUrl },
        args: ['--proxy-bypass-list=<-loopback>', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
      });
      context = await browser.newContext({ locale:input.locale, viewport:{width:1280,height:900},
        serviceWorkers:'block', acceptDownloads:false, ignoreHTTPSErrors:false });
      timer = setTimeout(() => { expired = true; void context?.close(); },45000);
      let requests = 0;
      let loadedBytes = 0;
      let exceeded = false;
      await context.route('**/*', async route => {
        try {
          parsePublicUrl(route.request().url());
          if (++requests > 200) { exceeded = true; return await route.abort(); }
          if (['media','font'].includes(route.request().resourceType())) return await route.abort();
          await route.continue();
        } catch { await route.abort(); }
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      const page = await context.newPage();
      page.on('popup', popup => { void popup.close(); });
      page.on('dialog', dialog => { void dialog.dismiss(); });
      page.on('response', async response => {
        try {
          const size = Number(response.headers()['content-length'] || 0);
          loadedBytes += Number.isFinite(size) ? size : 0;
          if (loadedBytes > MAX_BROWSER_BYTES) { exceeded = true; await page.close(); }
        } catch { /* Context can close while a response is arriving. */ }
      });
      const response = await page.goto(input.url,{waitUntil:'domcontentloaded',timeout:25000});
      await page.locator('body').waitFor({timeout:5000});
      // A bounded settle period covers asynchronous rendering without waiting for endless analytics.
      await page.waitForTimeout(1500);
      const html = await page.content();
      if (exceeded || Buffer.byteLength(html) > MAX_HTML_BYTES) return failure('limit_exceeded','browser',page.url(),'Page capture limit exceeded.');
      const statusCode = response?.status() || 200;
      const status = classify(statusCode,html);
      const result: CaptureResult = {status,method:'browser',finalUrl:page.url(),httpStatus:statusCode,
        html:status==='ok'?html:'',capturedAt:new Date().toISOString(),error:captureError(status,statusCode)};
      if (input.screenshot && status === 'ok') {
        result.captureId = randomUUID();
        result.elements = await page.evaluate(() => {
          const candidates: ElementCandidate[] = [];
          for (const element of Array.from(document.querySelectorAll('button,a,p,span,[role="button"],h1,h2,[itemprop]'))) {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const text = (element.textContent || '').replace(/\s+/g,' ').trim();
            if (!text || text.length > 180 || rect.width < 3 || rect.height < 3 || rect.y < 0 || rect.y > 900 || style.visibility==='hidden' || style.display==='none') continue;
            let selector = element.id ? '#' + CSS.escape(element.id) : '';
            if (!selector) {
              const parts: string[] = [];
              let current: Element | null = element;
              while (current && current !== document.body && parts.length < 7) {
                const tag = current.tagName.toLowerCase();
                const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(x=>x.tagName===current!.tagName) : [];
                parts.unshift(tag+(siblings.length>1?`:nth-of-type(${siblings.indexOf(current)+1})`:''));
                current = current.parentElement;
              }
              selector = parts.join(' > ');
            }
            candidates.push({id:String(candidates.length),tag:element.tagName.toLowerCase(),text,selector,x:rect.x,y:rect.y,width:rect.width,height:rect.height});
            if(candidates.length>=150)break;
          }
          return candidates;
        });
        result.screenshot = (await page.screenshot({type:'png',fullPage:false,animations:'disabled'})).toString('base64');
      }
      return result;
    } catch(error) {
      return failure(expired?'timeout':'capture_error','browser',input.url,error instanceof Error?error.message:'Browser unavailable.');
    } finally {
      if(timer)clearTimeout(timer);
      await context?.close().catch(()=>{});
      browserBusy = false;
    }
  }

  return {
    async capture(input: CaptureRequest): Promise<CaptureResult> {
      if(input.method==='browser' || input.screenshot) return browserCapture(input);
      const result = await httpCapture(input);
      if(input.method==='auto') {
        if (result.retryAfterSeconds === undefined &&
          (result.status === 'http_error' || (result.status === 'blocked' && result.httpStatus === 403))) {
          return browserCapture(input);
        }
        if(result.status==='ok') {
          const content = result.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').trim();
          if(content.length<100) return browserCapture(input);
        }
      }
      return result;
    },
    async close() { await browser?.close(); await dispatcher.close(); },
  };
}
