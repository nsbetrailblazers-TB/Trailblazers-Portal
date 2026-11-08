import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import nodemailer from 'npm:nodemailer@6.10.1';
import { emailAllowed, staffEmailAllowed } from './preferences.mjs';

Deno.serve(async request => {
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 if(request.method!=='POST')return reply(405,{error:'POST required'});
 const secret=Deno.env.get('WEBHOOK_SECRET');
 if(!secret||request.headers.get('x-webhook-secret')!==secret)return reply(401,{error:'Unauthorized'});
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const user=Deno.env.get('GMAIL_SMTP_USER'),pass=Deno.env.get('GMAIL_SMTP_APP_PASSWORD');
 if(!url||!key||!user||!pass)return reply(503,{error:'Configure Gmail SMTP secrets'});
 let payload;
 try { payload=await request.json(); } catch {return reply(400,{error:'Invalid JSON'});}
 const table=payload.table,id=payload.record?.id;
 if(!['member_notifications','director_notifications','portal_admin_notifications'].includes(table)||typeof id!=='string')return reply(400,{error:'Valid notification table and ID required'});
 const db=createClient(url,key,{auth:{persistSession:false}});
 const {data:n,error}=await db.from(table).select('*').eq('id',id).maybeSingle();
 if(error)return reply(500,{error:'Could not read notification'});
 if(!n||n.email_status!=='queued')return reply(200,{skipped:true});
 let email:string|undefined,allowed=false,staffUserId:string|undefined;
 if(table==='director_notifications') {
  const {data:d,error:e}=await db.from('directors').select('email,active,auth_user_id').eq('id',n.director_id).maybeSingle();
  if(e)return reply(500,{error:'Could not read director'});
  email=d?.email;allowed=d?.active===true;
  staffUserId=d?.auth_user_id;
 } else if(table==='portal_admin_notifications') {
  const {data:a,error:e}=await db.from('portal_admins').select('active').eq('user_id',n.admin_user_id).maybeSingle();
  if(e)return reply(500,{error:'Could not read administrator'});
  const account=await db.auth.admin.getUserById(n.admin_user_id);
  if(account.error)return reply(500,{error:'Could not read administrator account'});
  email=account.data.user?.email;
  allowed=a?.active===true;
  staffUserId=n.admin_user_id;
 } else {
  const [member,prefs]=await Promise.all([
   db.from('members').select('uf_email,program_status').eq('id',n.member_id).maybeSingle(),
   db.from('member_notification_preferences').select('*').eq('member_id',n.member_id).maybeSingle()
  ]);
  if(member.error||prefs.error)return reply(500,{error:'Could not verify email preferences'});
  email=member.data?.uf_email;allowed=emailAllowed(member.data,prefs.data,n.notification_type,n.target_page);
 }
 if(staffUserId && allowed) {
  const prefs=await db.from('staff_notification_preferences').select('*').eq('user_id',staffUserId).maybeSingle();
  if(prefs.error)return reply(500,{error:'Could not verify staff email preferences'});
  allowed=staffEmailAllowed(prefs.data,n);
 }
 if(!email||!allowed) {
  const {error:e}=await db.from(table).update({email_status:'skipped'}).eq('id',id).eq('email_status','queued');
  return reply(e?500:200,e?{error:'Could not record skipped delivery'}:{skipped:true});
 }
 // Atomic claim prevents duplicate webhook deliveries. SMTP has no idempotency API.
 const claim=await db.from(table).update({email_status:'sending'}).eq('id',id).eq('email_status','queued').select('id').maybeSingle();
 if(claim.error)return reply(500,{error:'Could not claim email'});
 if(!claim.data)return reply(200,{skipped:true});
 const transport=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user,pass},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});
 let sendError:unknown=null;
 try {
  for(let attempt=1;attempt<=3;attempt++) {
   try {
    await transport.sendMail({from:{name:'Trailblazers Portal',address:user},to:email,subject:n.title,text:n.body||'There is an update in your Trailblazers Portal.',messageId:`<${table}-${id}@trailblazers-portal.vercel.app>`});
    sendError=null;
    break;
   } catch(error) {
    const smtpError=error as {code?:unknown;responseCode?:unknown;command?:unknown};
    // Gmail returns 421 at DATA when bulk notifications arrive together. It has
    // explicitly refused the message, so stagger a bounded retry to reduce bursts.
    if(smtpError?.responseCode===421 && attempt<3) {
     await new Promise(resolve=>setTimeout(resolve,3000*attempt+Math.floor(Math.random()*4000)));
     continue;
    }
    sendError=error;
    console.error('Gmail SMTP send failed',{
     code:typeof smtpError?.code==='string'?smtpError.code:'unknown',
     responseCode:typeof smtpError?.responseCode==='number'?smtpError.responseCode:null,
     command:typeof smtpError?.command==='string'?smtpError.command:'unknown',
     attempts:attempt
    });
    break;
   }
  }
 } finally {transport.close();}
 if(sendError) {
  await db.from(table).update({email_status:'failed'}).eq('id',id).eq('email_status','sending');
  return reply(502,{error:'Gmail delivery failed. Check SMTP configuration; review before retrying.'});
 }
 const saved=await db.from(table).update({email_status:'sent'}).eq('id',id).eq('email_status','sending');
 if(saved.error)return reply(500,{error:'Email accepted by Gmail, but status could not be saved. Do not resend automatically.'});
 return reply(200,{ok:true});
});
