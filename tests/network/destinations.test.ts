import { describe, it, expect } from 'vitest';
import { parsePublicUrl, isPublicAddress, resolvePublicDestination } from '../../packages/network/src/index.js';
describe('public capture destinations',()=>{
  it.each(['http://localhost','http://127.0.0.1','http://2130706433','http://0x7f000001','http://[::1]','http://[::ffff:127.0.0.1]','http://169.254.169.254','http://10.1.2.3','http://172.16.1.2','http://192.168.0.1','file:///etc/passwd','http://user:pass@example.com','https://example.com:8080'])('rejects %s',(url)=>{expect(()=>parsePublicUrl(url)).toThrow();});
  it('preserves variant query strings',()=>{expect(parsePublicUrl('https://example.com/item?variant=blue').search).toBe('?variant=blue');});
  it.each(['0.0.0.0','100.64.0.1','224.0.0.1','fc00::1','fe80::1','2001:db8::1'])('rejects special range %s',address=>{expect(isPublicAddress(address)).toBe(false);});
  it('pins a validated public address',async()=>{
    const result=await resolvePublicDestination('https://example.com',async()=>[{address:'93.184.216.34',family:4}]);
    expect(result.address).toBe('93.184.216.34');
  });
  it('rejects mixed public and private DNS answers',async()=>{
    await expect(resolvePublicDestination('https://example.com',async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}])).rejects.toThrow();
  });
});
