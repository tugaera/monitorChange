import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export class DestinationError extends Error {
  constructor(message: string) { super(message); this.name = 'DestinationError'; }
}
export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address.replace(/^\[|\]$/g, '')).range() === 'unicast'; }
  catch { return false; }
}
export function parsePublicUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new DestinationError('Invalid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new DestinationError('Only HTTP and HTTPS are supported.');
  if (url.username || url.password) throw new DestinationError('URLs containing credentials are not allowed.');
  if (url.port && !['80', '443'].includes(url.port)) throw new DestinationError('Only ports 80 and 443 are allowed.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || /\.(localhost|local|internal|home|lan)$/.test(host)) {
    throw new DestinationError('Local network destinations are not allowed.');
  }
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new DestinationError('Non-public addresses are not allowed.');
  return url;
}
export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
export async function resolvePublicDestination(value: string, resolver: Resolver = hostname => lookup(hostname, { all: true })): Promise<{url: URL; address: string; family: number}> {
  const url = parsePublicUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4 }]
    : await resolver(hostname);
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new DestinationError('DNS resolved to a prohibited destination.');
  }
  return { url, ...addresses[0] };
}
