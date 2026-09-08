import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=path.join(root,'.runtime/factor-research-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
function run(command,args){const r=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status || 1);}
if(!fs.existsSync(python))run('uv',['venv','--python','3.11',path.join(root,'.runtime/factor-research-venv')]);
run('uv',['pip','sync','--python',python,'research/requirements.lock']);
run(python,['research/test_engine.py']);
console.log('RESEARCH_SETUP=PASSED (PySR first fit initializes Julia separately)');
