import { randomInt } from 'node:crypto';
import { createServer, preview } from 'vite';

// The dynamic/private range excludes Fetch's bad ports, including SIP 5060/5061.
// https://fetch.spec.whatwg.org/#port-blocking
export async function startLiveServer({root,production=true,signal,first=randomInt(16384),previewServer=preview,createDevServer=createServer}) {
  if(!Number.isInteger(first)||first<0||first>=16384)throw Error('live_port_seed_invalid');
  for(let attempt=0;attempt<32;attempt++) {
    if(signal?.aborted)throw Error('live_start_cancelled');
    const port=49152+(first+attempt*7919)%16384;
    const options={host:'127.0.0.1',port,strictPort:true};let server;
    try {
      server=production?await previewServer({root,preview:options}):await createDevServer({root,server:options});
      if(!production)await server.listen();
      if(signal?.aborted)throw Error('live_start_cancelled');
      const address=server.httpServer?.address();
      if(!address||typeof address==='string'||address.address!=='127.0.0.1'||address.port!==port)throw Error('live_bound_address_invalid');
      return server;
    } catch(error) {
      if(server)await server.close();
      if(signal?.aborted)throw Error('live_start_cancelled');
      // Vite wraps EADDRINUSE with this exact message, without retaining code.
      if(error.code!=='EADDRINUSE'&&error.message!==`Port ${port} is already in use`)throw error;
    }
  }
  throw Error('live_port_exhausted');
}
