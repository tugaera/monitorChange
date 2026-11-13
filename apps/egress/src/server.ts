import http from 'node:http';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { resolvePublicDestination } from '../../../packages/network/src/index.js';

/** A forward proxy whose sockets are pinned to the exact public IP that passed validation. */
export function createEgressProxy() {
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 45000 }, async (incoming, outgoing) => {
    try {
      const target = await resolvePublicDestination(incoming.url || '');
      if (target.url.protocol !== 'http:') throw new Error('HTTPS requires CONNECT.');
      if (!['GET', 'HEAD', 'POST', 'OPTIONS'].includes(incoming.method || '')) throw new Error('Method not supported.');
      const headers: Record<string, string | string[] | undefined> = { ...incoming.headers, host: target.url.host };
      for (const key of ['proxy-authorization', 'proxy-connection', 'connection', 'upgrade']) delete headers[key];
      const upstream = http.request({
        hostname: target.address, family: target.family, port: Number(target.url.port || 80),
        path: target.url.pathname + target.url.search, method: incoming.method, headers, timeout: 45000,
      }, response => {
        outgoing.writeHead(response.statusCode || 502, response.headers);
        response.pipe(outgoing);
        response.on('error', () => outgoing.destroy());
      });
      upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout.')));
      upstream.on('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end('Upstream connection failed.');
      });
      let bytes = 0;
      incoming.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) upstream.destroy(); });
      incoming.on('aborted', () => upstream.destroy());
      outgoing.on('close', () => upstream.destroy());
      incoming.pipe(upstream);
    } catch {
      outgoing.writeHead(403, { 'content-type': 'text/plain' });
      outgoing.end('Destination blocked by network policy.');
    }
  });
  server.maxConnections = 64;
  server.on('connect', async (request, socket, head) => {
    try {
      const target = await resolvePublicDestination(`https://${request.url || ''}`);
      if (target.url.pathname !== '/' || target.url.search || target.url.hash) throw new Error('Invalid CONNECT target.');
      const upstream = net.connect({ host: target.address, family: target.family, port: Number(target.url.port || 443) });
      upstream.setTimeout(45000, () => upstream.destroy());
      (socket as net.Socket).setTimeout(45000, () => socket.destroy());
      upstream.once('connect', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(socket); socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
      upstream.on('close', () => socket.destroy());
    } catch {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.EGRESS_PORT || 3128);
  createEgressProxy().listen(port, process.env.EGRESS_HOST || '127.0.0.1', () => {
    console.log(JSON.stringify({ service: 'egress', port }));
  });
}
