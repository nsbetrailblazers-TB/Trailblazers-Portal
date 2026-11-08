const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('assignments.js','utf8');
function fixture(){
 const elements=new Map(['notificationBell','assignmentsList','assignmentRefresh','mf-method','mf-submission_file','mf-submission_link','mf-submission_text'].map(k=>[k,{value:'file',closest:()=>({hidden:false})}]));
 const calls=[];let save;
 const data={student_assignments:[{id:'assignment',active:true,title:'Reflection',deadline:'2026-10-18T23:59:00Z'}],assignment_submissions:[]};
 const environment={window:{},escapeHTML:s=>String(s??''),currentMember:{id:'member'},Date,crypto:{randomUUID:()=> 'upload-id'},document:{getElementById:k=>elements.get(k),querySelector:q=>q.includes('sidebar')?{querySelectorAll:()=>[],after(){}}:null,createElement:()=>({innerHTML:'',lastElementChild:{append(){}},className:''})},supabaseClient:{
  from:t=>({select:()=>({order:async()=>({data:data[t]})})}),auth:{getUser:async()=>({data:{user:{id:'user'}}})},
  rpc:async(fn,args)=>{calls.push({fn,args});return {data:'submission'};},
  storage:{from:bucket=>({upload:async(path,file)=>{calls.push({bucket,path,file});return{data:{}};},remove:async paths=>{calls.push({remove:paths});return{data:{}};}})}
 }};
 vm.runInNewContext(source,environment);
 const context={checked:async p=>{const r=await p;if(r.error)throw new Error(r.error.message);return r.data;},field:(key,title,type,extra)=>({key,title,type,...extra}),showDialog:(title,fields,initial,callback)=>{save=callback;}};
 environment.window.PortalAssignments.init(context);
 return {portal:environment.window.PortalAssignments,calls,elements,environment,save:()=>save};
}
test('missing starts after deadline and reviewed submissions retain their status',()=>{
 const {portal}=fixture(),a={deadline:'2026-10-04T16:00:00Z'},now=Date.parse(a.deadline);
 assert.equal(portal.status(a,null,now),'not_submitted');assert.equal(portal.status(a,null,now+1),'missing');
 for(const status of ['pending','completed','denied'])assert.equal(portal.status(a,{status},now+1),status);
 assert.equal(portal.status({deadline:'2026-10-10T16:00:00Z'},null,now+1),'not_submitted');
 assert.equal(portal.status({},null,now),'not_submitted');
});
test('assignment file submission uses private owner/assignment path and excludes form-only fields',async()=>{
 const f=fixture();await f.portal.refreshMember();await f.elements.get('assignmentsList').onclick({target:{closest:()=>({dataset:{submitAssignment:'assignment'}})}});
 await f.save()({method:'file',submission_file:{name:'my resume.pdf',size:123,type:'application/pdf'}});
 assert.equal(f.calls[0].bucket,'trailblazers-assignments');assert.equal(f.calls[0].path,'user/assignment/upload-id-my_resume.pdf');
 assert.equal(f.calls[1].fn,'portal_assignment');assert.equal(f.calls[1].args.operation,'submit');
 assert.equal(f.calls[1].args.payload.file_name,'my resume.pdf');assert.equal(f.calls[1].args.payload.submission_file,undefined);
});
test('failed submission removes its unpublished upload',async()=>{
 const f=fixture();await f.portal.refreshMember();await f.elements.get('assignmentsList').onclick({target:{closest:()=>({dataset:{submitAssignment:'assignment'}})}});
 f.environment.supabaseClient.rpc=async()=>({error:{message:'Assignment unavailable'}});
 await assert.rejects(f.save()({method:'file',submission_file:{name:'response.txt',size:123}}),/Assignment unavailable/);
 assert.deepEqual(Array.from(f.calls.at(-1).remove),['user/assignment/upload-id-response.txt']);
});
test('empty and oversized files and unsafe links never submit',async()=>{
 const f=fixture();await f.portal.refreshMember();await f.elements.get('assignmentsList').onclick({target:{closest:()=>({dataset:{submitAssignment:'assignment'}})}});
 for(const size of [0,52428801])await assert.rejects(f.save()({method:'file',submission_file:{name:'file',size}}),/nonempty file/);
 await assert.rejects(f.save()({method:'link',submission_link:'javascript:alert(1)'}),/http or https/);
 assert.equal(f.calls.length,0);
});
