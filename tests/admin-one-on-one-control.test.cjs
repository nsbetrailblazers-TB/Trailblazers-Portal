const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../management.js'),'utf8');
test('admin past meeting form includes inactive unassigned directors and saves directly',async()=>{
 const elements={'managementShell':{hidden:false},'mf-member_id':{value:'member'},'mf-director_id':{innerHTML:''}};
 let dialog,rpc;
 const ctx={mode:'admin',data:{members:[{id:'member',program_status:'active',cohort_id:'class'}],directors:[{id:'former',first_name:'Former',last_name:'Director',active:false}],director_assignments:[]},
  $:id=>elements[id],scoped:x=>x,options:x=>x.map(r=>[r.id,r.first_name||r.id]),field:(key,title,type,extra)=>({key,title,type,...extra}),
  showDialog:(title,fields,initial,save)=>{dialog={title,fields,initial,save};},PortalCompletion:{today:()=> '2026-11-01'},name:p=>p.first_name+' '+p.last_name,esc:x=>x,
  checked:async x=>x,refresh:async()=>{},notify:()=>{},supabaseClient:{rpc:(name,args)=>{rpc={name,args};return {};}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  async function reportMeeting('),source.indexOf('  async function saveAnnouncementWithFlyer(')),ctx);
 await ctx.reportMeeting(true,'member');
 assert.equal(dialog.initial.member_id,'member');
 assert.match(elements['mf-director_id'].innerHTML,/Former Director/);
 const payload={member_id:'member',director_id:'former',completed_at:'2025-10-01T12:00:00Z'};
 await dialog.save(payload);
 assert.equal(rpc.name,'portal_one_on_one_completion');assert.equal(rpc.args.operation,'record');assert.equal(rpc.args.payload,payload);
});
test('one-on-one checklist exposes manual point entry only in admin controls',()=>{
 const ctx={window:{},escapeHTML:x=>x,PortalUtils:require('../portal-utils.js')};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../completion.js'),'utf8'),ctx);
 const m={id:'member',cohort_id:'class'},rules=[{id:'rule',name:'Director one-on-ones',active:true,is_required:true,required_count:4,completion_source:'director_meetings'}];
 const checklist=ctx.window.PortalCompletion.checklist;
 assert.match(checklist(m,rules,[],[],[],true,true),/data-action="check-activity"/);
 assert.doesNotMatch(checklist(m,rules,[],[],[],true,false),/data-action="check-activity"/);
 assert.doesNotMatch(checklist(m,rules,[],[],[],false),/data-action="check-activity"/);
});
