import { createApp } from './app.js';
const app=await createApp({logger:true});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
try {await app.listen({port:Number(process.env.PORT??3100),host:process.env.HOST??'127.0.0.1'});}
catch(error){app.log.error(error);await app.close();process.exitCode=1;}
