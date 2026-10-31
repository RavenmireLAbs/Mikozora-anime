import fs from 'node:fs';
import path from 'node:path';
const files=fs.readdirSync('third_party_licenses').filter(f=>f.endsWith('.txt')).sort();
let out='MOKU — OPEN SOURCE LICENSES\n\n'+fs.readFileSync('LICENSE','utf8')+'\n';
for (const f of files) out+=`\n\n==================== ${f} ====================\n\n`+fs.readFileSync(path.join('third_party_licenses',f),'utf8');
fs.writeFileSync('public/licenses.txt',out);
