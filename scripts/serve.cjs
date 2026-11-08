const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const allowed=new Set(['index.html','app.js','styles.css','management.js','management.css','portal-utils.js','inventory.js','spreadsheet-import.js','assignments.js','completion.js','meeting-invitations.js']);
http.createServer((req,res)=>{
 let file;try{file=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';}catch{res.writeHead(400);res.end();return;}
 if(process.argv.includes('--fixtures') && file==='test-preview'){
   let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
   html=html.replace(/<script\s+src="https:\/\/cdn.jsdelivr.net\/npm\/@supabase\/supabase-js@2"\s*><\/script>/,'<script src="/ui-fixture.js"></script>');
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
 }
 if(process.argv.includes('--fixtures') && file==='ui-fixture.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fs.readFileSync(path.join(root,'tests/ui-fixture.js')));return;}
 if(process.argv.includes('--fixtures') && file==='import-test'){res.writeHead(200,{'Content-Type':'text/html'});res.end(fs.readFileSync(path.join(root,'tests/import-test.html')));return;}
 if(!allowed.has(file)){res.writeHead(404);res.end('Not found');return;}
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)];
 res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-store'});fs.createReadStream(path.join(root,file)).pipe(res);
}).listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log(`Portal: http://127.0.0.1:${Number(process.env.PORT)||4173}`));
