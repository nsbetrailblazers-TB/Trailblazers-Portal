/* Assignment access and mutations are enforced by the authenticated database RPC. */
window.PortalAssignments = (() => {
 'use strict';
 const esc=escapeHTML, $=id=>document.getElementById(id);
 let context, assignments=[], submissions=[], memberRequest=0;
 const status=(a,s,now=Date.now())=>s?s.status:a.deadline&&new Date(a.deadline).getTime()<now?'missing':'not_submitted';
 const badge=s=>`<span class="assignment-status assignment-${esc(s)}">${esc({completed:'Completed',denied:'Denied',pending:'Pending',missing:'Missing',not_submitted:'Not submitted'}[s]||s)}</span>`;
 const due=a=>a.deadline?new Date(a.deadline).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'No deadline';
 const rpc=(operation,id,payload={})=>context.checked(supabaseClient.rpc('portal_assignment',{operation,record_id:id||null,payload}));
 function render(c,html){
  if(c.tab==='overview')return html+'<div class="management-toolbar">'+c.button(`Assignments awaiting review (${(c.data.assignment_submissions||[]).filter(s=>s.status==='pending').length})`,'assignment-awaiting')+'</div>';
  if(!['student-assignments','assignment-reviews'].includes(c.tab))return html;
  const rows=c.scoped(c.data.student_assignments||[]), all=c.data.assignment_submissions||[];
  if(c.tab==='assignment-reviews')return '<h2>Awaiting assignment review</h2>'+c.table(['Trailblazer','Assignment','Submitted','Status','Review'],all.filter(s=>s.status==='pending').map(s=>{const a=(c.data.student_assignments||[]).find(a=>a.id===s.assignment_id);return [esc(c.name(c.data.members.find(m=>m.id===s.member_id))),esc(a?.title),c.date(s.submitted_at),badge(s.status),c.button('Review submission','assignment-review',s.id)];}));
  return '<h2>Assignments</h2><div class="management-toolbar">'+c.button('Create assignment','assignment-create')+c.button(`Awaiting review (${all.filter(s=>s.status==='pending').length})`,'assignment-awaiting')+'</div>'+c.table(['Assignment','Deadline','Audience','Submitted','Actions'],rows.map(a=>[esc(a.title)+`<p>${esc(a.description)}</p>`,due(a),a.targeted?`${(c.data.assignment_recipients||[]).filter(r=>r.assignment_id===a.id).length} selected Trailblazers`:'Entire cohort',all.filter(s=>s.assignment_id===a.id).length,c.button('Overview','assignment-overview',a.id)+c.button('Edit / deadline','assignment-edit',a.id)+c.button('Remove','assignment-remove',a.id)]));
 }
 async function action(action,id,c){
  if(!action.startsWith('assignment-'))return false;
  context=c;
  if(action==='assignment-awaiting'){c.navigate('assignment-reviews');return true;}
  const a=(c.data.student_assignments||[]).find(a=>a.id===id);
  if(action==='assignment-create'||action==='assignment-edit'){
   const fields=[c.field('cohort_id','Cohort','select',{required:true,readonly:!!a,options:c.data.cohorts.filter(x=>x.status==='active').map(x=>[x.id,x.name])}),c.field('title','Title','text',{required:true}),c.field('description','Short description and instructions','textarea'),c.field('deadline','Deadline (optional)','datetime-local'),c.boolField('active','Published'),c.boolField('targeted','Only selected Trailblazers',false)];
   c.showDialog(a?'Edit assignment':'Create assignment',fields,a||{cohort_id:c.cohort},async v=>{v.recipients=[...document.querySelectorAll('[name="assignment-recipient"]:checked')].map(el=>el.value);await rpc('save',a?.id,v);await c.refresh();},'You can change the deadline at any time. Late submissions remain available and are marked late for reviewers.');
   const picked=new Set((c.data.assignment_recipients||[]).filter(r=>r.assignment_id===id).map(r=>r.member_id));
   const recipients=document.createElement('fieldset');recipients.innerHTML='<legend>Select Trailblazers</legend><div id="assignmentRecipients"></div>';$('managementDialogFields').append(recipients);
   const update=()=>{const cid=$('mf-cohort_id').value;recipients.hidden=!$('mf-targeted').checked;$('assignmentRecipients').innerHTML=c.data.members.filter(m=>m.program_status==='active'&&m.cohort_id===cid).map(m=>`<label class="assignment-recipient"><input type="checkbox" name="assignment-recipient" value="${m.id}" ${picked.has(m.id)?'checked':''}>${esc(c.name(m))}</label>`).join('');};
   $('mf-cohort_id').onchange=update;$('mf-targeted').onchange=()=>{recipients.hidden=!$('mf-targeted').checked;};update();return true;
  }
  if(action==='assignment-remove'){
   c.showDialog('Remove assignment',[c.boolField('confirmed','Remove this assignment and all its submissions',false)],{},async v=>{if(!v.confirmed)throw new Error('Check the confirmation to remove this assignment.');await rpc('remove',id);await c.refresh();},'This removes the assignment from student portals and deletes its submission records.');return true;
  }
  if(action==='assignment-overview'){
   const recipients=new Set((c.data.assignment_recipients||[]).filter(r=>r.assignment_id===id).map(r=>r.member_id));
   const members=c.data.members.filter(m=>m.program_status==='active'&&m.cohort_id===a.cohort_id&&(!a.targeted||recipients.has(m.id)));
   c.details(a.title,`<p>${esc(a.description)}</p><p>Deadline: ${esc(due(a))}</p>`+c.table(['Trailblazer','Status','Feedback','Review'],members.map(m=>{const s=c.data.assignment_submissions.find(s=>s.assignment_id===id&&s.member_id===m.id);return[esc(c.name(m)),badge(status(a,s)),esc(s?.feedback||'—'),s?c.button('Review submission','assignment-review',s.id):'—'];})));
   $('managementDialogFields').onclick=async e=>{const b=e.target.closest('[data-action="assignment-review"]');if(b){$('managementDialog').close();try{await actionHandler(b.dataset.id,c);}catch(err){c.notify(err.message,true);}}};return true;
  }
  if(action==='assignment-review'){await actionHandler(id,c);return true;}
  return true;
 }
 async function actionHandler(id,c){
  const s=c.data.assignment_submissions.find(s=>s.id===id),a=c.data.student_assignments.find(a=>a.id===s.assignment_id);
  c.showDialog('Review assignment',[c.field('status','Status','select',{options:[['completed','Completed'],['denied','Denied'],['pending','Pending']]}),c.field('feedback','Feedback for the Trailblazer','textarea')],s,async v=>{await rpc('review',id,{...v,expected_submitted_at:s.submitted_at});await c.refresh();},`${a.title} · ${c.name(c.data.members.find(m=>m.id===s.member_id))} · Submitted ${c.date(s.submitted_at)}${a.deadline&&new Date(s.submitted_at)>new Date(a.deadline)?' · Late submission':''}`);
  const evidence=document.createElement('section');evidence.className='assignment-evidence';
  if(s.method==='text'){const p=document.createElement('p');p.textContent=s.content;evidence.append(p);}
  else {let url=s.content;if(s.method==='file')url=(await c.checked(supabaseClient.storage.from('trailblazers-assignments').createSignedUrl(s.file_path,300))).signedUrl;if(/^https?:\/\//i.test(url||'')){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=s.file_name||'Open submitted link';evidence.append(link);}}
  $('managementDialogFields').prepend(evidence);
 }
 async function refreshMember(){
  if(!currentMember||!$('assignmentsList'))return;
  const ticket=++memberRequest;
  try {const values=await Promise.all(['student_assignments','assignment_submissions'].map(t=>context.checked(supabaseClient.from(t).select('*').order(t==='student_assignments'?'created_at':'submitted_at'))));if(ticket!==memberRequest)return;assignments=values[0];submissions=values[1].filter(s=>s.member_id===currentMember.id);renderMember();}
  catch(e){$('assignmentsList').textContent='Assignments are not available yet: '+e.message;}
 }
 function renderMember(){
  $('assignmentsList').innerHTML=assignments.length?assignments.filter(a=>a.active).map(a=>{const s=submissions.find(s=>s.assignment_id===a.id);return `<article class="assignment-card"><div class="assignment-card-header"><h2>${esc(a.title)}</h2>${badge(status(a,s))}</div><p>${esc(a.description)}</p><p class="assignment-deadline">Deadline: ${esc(due(a))}</p>${s?`<p>Submitted ${esc(new Date(s.submitted_at).toLocaleString())}</p>`:''}${s?.feedback?`<div class="assignment-feedback"><strong>Director feedback</strong><p>${esc(s.feedback)}</p></div>`:''}<button class="secondary-button" data-submit-assignment="${a.id}">${s?'View / resubmit':'Submit assignment'}</button></article>`;}).join(''):'<div class="empty-state">No assignments published for you yet.</div>';
 }
 async function submitDialog(id){
  const a=assignments.find(a=>a.id===id),s=submissions.find(s=>s.assignment_id===id);
  context.showDialog(a.title,[context.field('method','Submission type','select',{options:[['file','File upload'],['link','Website / Google Drive link'],['text','Text entry']]}),context.field('submission_file','Choose a file','file',{hint:'Upload a document, image, presentation, or other file · up to 50 MB'}),context.field('submission_link','Website or Google Drive link','url'),context.field('submission_text','Your response','textarea')],{method:s?.method||'file',submission_link:s?.method==='link'?s.content:'',submission_text:s?.method==='text'?s.content:''},async v=>{
   const payload={method:v.method};let path=null,saved=false;
   try{
    if(v.method==='file'){const f=v.submission_file;if(!f||!f.size||f.size>50*1024*1024)throw new Error('Choose a nonempty file up to 50 MB.');const auth=await context.checked(supabaseClient.auth.getUser());path=`${auth.user.id}/${id}/${crypto.randomUUID()}-${f.name.replace(/[^A-Za-z0-9._-]/g,'_').slice(-120)}`;await context.checked(supabaseClient.storage.from('trailblazers-assignments').upload(path,f,{upsert:false,contentType:f.type||'application/octet-stream'}));payload.file_path=path;payload.file_name=f.name;}
    else {payload.content=v.method==='link'?v.submission_link:v.submission_text;if(!payload.content)throw new Error('Enter your response or link.');if(v.method==='link'&&!/^https?:\/\//i.test(payload.content))throw new Error('Use an http or https link.');}
    await rpc('submit',id,payload);saved=true;await refreshMember();
   }catch(e){if(path&&!saved)await supabaseClient.storage.from('trailblazers-assignments').remove([path]);throw e;}
  },`Deadline: ${due(a)}${s?.feedback?' · Feedback: '+s.feedback:''}. Resubmitting returns the assignment to Pending.`);
  const update=()=>{for(const [key,method] of [['submission_file','file'],['submission_link','link'],['submission_text','text']]){$('mf-'+key).closest('label').hidden=$('mf-method').value!==method;$('mf-'+key).disabled=$('mf-method').value!==method;}};$('mf-method').onchange=update;update();
  if(s?.method==='file'||s?.method==='link'){const url=s.method==='file'?(await context.checked(supabaseClient.storage.from('trailblazers-assignments').createSignedUrl(s.file_path,300))).signedUrl:s.content;if(/^https?:\/\//i.test(url||'')){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View current submission'+(s.file_name?': '+s.file_name:'');$('managementDialogFields').prepend(link);}}
 }
 function init(c){context=c;$('assignmentsList').onclick=e=>{const b=e.target.closest('[data-submit-assignment]');if(b)submitDialog(b.dataset.submitAssignment).catch(err=>{$('managementDialogMessage').textContent=err.message;});};$('assignmentRefresh').onclick=refreshMember;
  $('notificationBell').onclick=()=>showPage('notifications');
  const nav=document.querySelector('.sidebar .nav-links');
  const more=document.createElement('details');more.className='member-more';more.innerHTML='<summary>More</summary><div class="member-more-menu"></div>';
  for(const b of [...nav.querySelectorAll('[data-page]')])if(!['home','assignments','points','oneonones','calendar','resources'].includes(b.dataset.page)){more.lastElementChild.append(b);b.addEventListener('click',()=>{more.open=false;});}
  nav.after(more);
  const announcement=document.querySelector('#homePage .home-announcement'),next=document.querySelector('#homePage .next-meeting');
  if(announcement&&next){const updates=document.createElement('div');updates.className='home-updates';announcement.before(updates);updates.append(announcement,next);}
 }
 return {render,action,init,refreshMember,status};
})();
