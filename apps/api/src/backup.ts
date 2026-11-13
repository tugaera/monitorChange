import { resolve } from 'node:path';
import { Store } from '../../../packages/storage/src/index.js';

const destination=process.argv[2];
if(!destination)throw new Error('Usage: node dist/apps/api/src/backup.js <backup.sqlite>');
const path=resolve(process.env.DB_PATH??'data/monitorchange.sqlite');
if(resolve(destination)===path)throw new Error('Backup destination must differ from the live database.');
const store=new Store(path);
try{await store.backup(resolve(destination));process.stdout.write(`Consistent SQLite backup written to ${resolve(destination)}\n`);}
finally{store.close();}
