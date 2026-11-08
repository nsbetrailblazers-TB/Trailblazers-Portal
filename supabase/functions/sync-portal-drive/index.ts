import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// OAuth credentials stay in Edge Function secrets. The browser supplies only record IDs.
Deno.serve(async (req: Request) => {
 const allowed=(Deno.env.get('PORTAL_ALLOWED_ORIGINS')||'').split(',').map(s=>s.trim());
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':allowed.includes(origin)?origin:'null','Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return reply(405,{error:'POST required'});
 if(!origin||!allowed.includes(origin))return reply(403,{error:'Configure PORTAL_ALLOWED_ORIGINS.'});
 const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 let job:string|null=null;
 try{
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token)return reply(401,{error:'Sign in required'});
  const {data:{user},error:authError}=await service.auth.getUser(token);
  if(authError||!user)return reply(401,{error:'Invalid session'});
  const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
  const {kind,id}=await req.json();
  if(!['cohort','evidence'].includes(kind)||typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))return reply(400,{error:'Choose a cohort or point submission'});
  let point:any=null,member:any=null,cohort:any=null;
  if(kind==='cohort'){
   const {data:admin}=await service.from('portal_admins').select('user_id').eq('user_id',user.id).eq('active',true).maybeSingle();
   if(!admin)return reply(403,{error:'Administrator access required'});
   const r=await service.from('cohorts').select('*').eq('id',id).single();if(r.error)throw new Error('Cohort not found');cohort=r.data;
  }else{
   const p=await caller.from('point_submissions').select('*').eq('id',id).single();if(p.error||!p.data)return reply(403,{error:'Submission access required'});point=p.data;
   if(point.evidence_drive_file_id)return reply(200,{synced:true,url:point.evidence_drive_url});
   if(!point.evidence_path)return reply(400,{error:'This submission has no private evidence file'});
   const m=await service.from('members').select('id,first_name,last_name,cohort_id').eq('id',point.member_id).single();if(m.error)throw new Error('Member not found');member=m.data;
   const c=await service.from('cohorts').select('*').eq('id',member.cohort_id).single();if(c.error)throw new Error('Cohort not found');cohort=c.data;
  }
  const clientId=Deno.env.get('GOOGLE_CLIENT_ID'),clientSecret=Deno.env.get('GOOGLE_CLIENT_SECRET'),refreshToken=Deno.env.get('GOOGLE_REFRESH_TOKEN');
  if(!clientId||!clientSecret||!refreshToken)return reply(503,{error:'Google Drive setup is pending. Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN. Your private portal evidence is already saved.'});
  const claim=await service.rpc('portal_claim_drive_job',{job_key:'portal-drive'});
  if(claim.error)throw new Error('Could not lock Drive synchronization');
  if(!claim.data)return reply(409,{error:'Synchronization is already running. Try again shortly.'});job='portal-drive';
  const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  if(!tokenResponse.ok)throw new Error('Google authorization needs renewal');
  const googleToken=(await tokenResponse.json()).access_token;
  const gh={Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'};
  async function api(path:string,options:RequestInit={}){const r=await fetch('https://www.googleapis.com/drive/v3/'+path,{...options,headers:gh});if(!r.ok)throw new Error(`Google Drive request failed (${r.status})`);return r.json();}
  const escape=(s:string)=>s.replaceAll('\\','\\\\').replaceAll("'","\\'");
  async function folder(name:string,parent:string|null,key:string){
   const q=`trashed=false and mimeType='application/vnd.google-apps.folder' and appProperties has { key='portal_folder' and value='${escape(key)}' }`+(parent?` and '${escape(parent)}' in parents`:'');
   const r=await api('files?'+new URLSearchParams({q,fields:'files(id)',spaces:'drive'}));if(r.files[0])return r.files[0].id;
   return (await api('files?fields=id',{method:'POST',body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',...(parent?{parents:[parent]}:{}),appProperties:{portal_folder:key}})})).id;
  }
  const root=await folder('Trailblazers Portal',null,'root');
  const cf=await folder(cohort.name,root,'cohort:'+cohort.id);
  const evidence=await folder('Point Evidence',cf,'evidence:'+cohort.id);
  await folder('Cohort Documents',cf,'documents:'+cohort.id);await folder('Reports',cf,'reports:'+cohort.id);
  const shared=await folder('Shared Resources',root,'shared');
  for(const category of ['Resume','Internships','Scholarships','Technical','Professional Development'])await folder(category,shared,'resource:'+category);
  const saved=await service.from('cohorts').update({drive_folder_id:cf,drive_folder_url:`https://drive.google.com/drive/folders/${cf}`}).eq('id',cohort.id);if(saved.error)throw new Error('Could not save cohort Drive metadata');
  if(point){
   const parent=await folder(`${member.first_name} ${member.last_name}`,evidence,'member:'+member.id);
   const existing=await api('files?'+new URLSearchParams({q:`trashed=false and appProperties has { key='portal_submission' and value='${escape(point.id)}' }`,fields:'files(id,webViewLink)'}));
   let file=existing.files[0];
   if(!file){
    const source=await service.storage.from('trailblazers-private').download(point.evidence_path);if(source.error||!source.data)throw new Error('Could not read private evidence');
    const start=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink',{method:'POST',headers:{...gh,'X-Upload-Content-Type':source.data.type},body:JSON.stringify({name:`${point.activity_date}-${point.id}.${point.evidence_path.split('.').pop()}`,parents:[parent],appProperties:{portal_submission:point.id}})});
    const uploadURL=start.headers.get('location');if(!start.ok||!uploadURL||new URL(uploadURL).hostname!=='www.googleapis.com')throw new Error('Could not begin Drive upload');
    const upload=await fetch(uploadURL,{method:'PUT',headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':source.data.type},body:source.data});if(!upload.ok)throw new Error('Drive upload failed');file=await upload.json();
   }
   const saved=await service.from('point_submissions').update({evidence_drive_file_id:file.id,evidence_drive_url:file.webViewLink||`https://drive.google.com/file/d/${file.id}/view`}).eq('id',point.id);if(saved.error)throw new Error('Could not save evidence Drive metadata');
  }
  await service.from('activity_log').insert({actor_user_id:user.id,actor_type:'system',action:'drive_synced',entity_type:kind,entity_id:id,details:{cohort_id:cohort.id}});
  return reply(200,{synced:true,url:`https://drive.google.com/drive/folders/${cf}`});
 }catch(e){return reply(400,{error:e instanceof Error?e.message:'Synchronization failed'});}
 finally{if(job)await service.rpc('portal_release_drive_job',{job_key:job});}
});
