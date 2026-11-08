const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const destination=path.join(root,'release');
fs.mkdirSync(destination,{recursive:true});
for(const name of ['index.html','app.js','styles.css','management.js','management.css','portal-utils.js','inventory.js','spreadsheet-import.js','assignments.js','completion.js','meeting-invitations.js']){
 const source=fs.readFileSync(path.join(root,name),'utf8');
 if(/sb_secret_|SUPABASE_SERVICE_ROLE_KEY\s*=/.test(source))throw new Error('A server secret must not be published: '+name);
 fs.writeFileSync(path.join(destination,name),source);
}
console.log('Static portal written to release/. Database scripts, tests, and server functions are excluded.');
