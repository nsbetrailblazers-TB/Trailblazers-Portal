/* Shared invitation inbox, independent of assigned director requirements. */
window.PortalMeetings = (() => {
  const esc = escapeHTML;
  const checked = async query => { const r=await query;if(r.error)throw new Error(r.error.message);return r.data; };
  let directory=null;
  const date = value => new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});
  const button = (label,action,id='') => `<button type="button" class="secondary-button" data-meeting-action="${action}" data-id="${esc(id)}">${label}</button>`;
  function panel() {
    return '<section class="dashboard-card meeting-inbox" aria-label="One-on-one invitations"><h2>Invitations</h2><p>Invite up to one director and two Trailblazers. Everyone accepts before the meeting is scheduled. Meetings take place in person.</p><div class="management-actions">'+button('Invite to a one-on-one','create')+button('Refresh invitations','refresh')+'</div><p class="meeting-message" role="status" aria-live="polite"></p><div class="meeting-invitation-list"></div></section>';
  }
  async function mount(host,afterChange,isAdmin=false) {
    if(!host)return;
    let box=host.querySelector('.meeting-inbox');
    if(!box){host.insertAdjacentHTML('afterbegin',panel());box=host.querySelector('.meeting-inbox');}
    box.isAdmin=isAdmin;
    box.afterChange=afterChange||(async()=>{
      if(currentMember&&document.getElementById('dashboard')?.style.display!=='none')await refreshMemberData();
      else if(currentDirector&&document.getElementById('directorDashboard')?.style.display!=='none')await refreshDirectorData();
    });
    box.onclick=async event=>{
      const b=event.target.closest('[data-meeting-action]');if(!b||b.disabled)return;
      b.disabled=true;const message=box.querySelector('.meeting-message');message.textContent='';
      try {
        if(b.dataset.meetingAction==='create')await create(box);
        else if(b.dataset.meetingAction==='refresh')await refresh(box);
        else {await checked(supabaseClient.rpc('portal_respond_meeting_invitation',{record_id:b.dataset.id,decision:b.dataset.meetingAction}));await refresh(box);message.textContent='Meeting updated.';await box.afterChange?.();}
      } catch(e){message.textContent=e.message;}finally{b.disabled=false;}
    };
    try{await refresh(box);}catch(e){box.querySelector('.meeting-message').textContent=e.message;}
  }
  async function refresh(box) {
    const user=await supabaseClient.auth.getUser();if(user.error)throw user.error;
    const uid=user.data.user?.id;
    const [people, rows]=await Promise.all([
      checked(supabaseClient.rpc('portal_meeting_directory')),
      checked(supabaseClient.from('one_on_one_invitations').select('*').order('scheduled_date',{ascending:false}))
    ]);
    if(!box.isConnected)return;
    directory=people;
    const ownKeys=[...people.members.filter(p=>p.self).map(p=>'member:'+p.id),...people.directors.filter(p=>p.self).map(p=>'director:'+p.id)];
    const list=box.querySelector('.meeting-invitation-list');
    list.innerHTML=rows.length?rows.map(r=>{
      const mine=ownKeys.filter(k=>k in r.responses),waiting=mine.some(k=>r.responses[k]==='pending');
      const future=new Date(r.scheduled_date)>new Date();
      return `<article class="meeting-invitation"><h3>${r.participants.map(p=>esc(p.name)).join(' · ')}</h3><p>${esc(date(r.scheduled_date))} · ${esc(r.location)}</p><p><strong>${esc(r.status==='pending'&&!future?'Time passed — contact the organizer':r.status.replace(/^./,c=>c.toUpperCase()))}</strong></p><ul>${r.participants.map(p=>`<li>${esc(p.name)}: ${esc(r.responses[p.key])}</li>`).join('')}</ul><div class="management-actions">${r.status==='pending'&&future&&waiting?button('Accept invitation','accept',r.id)+button('Decline invitation','decline',r.id):''}${['pending','scheduled'].includes(r.status)&&(r.organizer_id===uid||box.isAdmin)?button('Cancel meeting','cancel',r.id):''}${r.status==='scheduled'&&!future&&(box.isAdmin||ownKeys.includes('director:'+r.director_id))?button('Mark completed','complete',r.id):''}</div></article>`;
    }).join(''):'<p>No invitations yet. New invitations will appear here.</p>';
  }
  async function create(box, selectedDirector='',selectedMember='') {
    directory=await checked(supabaseClient.rpc('portal_meeting_directory'));
    let dialog=document.getElementById('meetingInviteDialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='meetingInviteDialog';dialog.className='management-dialog';document.body.append(dialog);}
    const option=p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.self?' (you)':''}</option>`;
    const ownMember=directory.members.find(p=>p.self),ownDirector=directory.directors.find(p=>p.self);
    const requestId=crypto.randomUUID();
    dialog.innerHTML=`<form class="stacked-form"><h2>Invite to a one-on-one</h2><p>Choose one or two Trailblazers and an optional director. Include yourself unless you are scheduling as an administrator. Times use your device time zone.</p><label>Director (optional)<select name="director"><option value="">No director</option>${directory.directors.map(option).join('')}</select></label><label>Trailblazer 1<select name="member1" required><option value="">Select a Trailblazer</option>${directory.members.map(option).join('')}</select></label><label>Trailblazer 2 (optional)<select name="member2"><option value="">No second Trailblazer</option>${directory.members.map(option).join('')}</select></label><label>Date and time<input name="scheduled" type="datetime-local" required></label><label>In-person location<input name="location" maxlength="500" required></label><p role="alert" class="meeting-form-error"></p><div class="management-actions"><button type="submit" class="primary-button">Send invitation</button><button type="button" data-close class="secondary-button">Close</button></div></form>`;
    const form=dialog.querySelector('form');
    form.elements.member1.value=selectedMember||ownMember?.id||'';
    form.elements.director.value=selectedDirector||ownDirector?.id||'';
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    form.onsubmit=async event=>{
      event.preventDefault();const submit=form.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;
      const error=dialog.querySelector('.meeting-form-error');error.textContent='';
      try {
        const members=[form.elements.member1.value,form.elements.member2.value].filter(Boolean);
        if(new Set(members).size!==members.length)throw new Error('Choose two different Trailblazers.');
        if(!form.elements.director.value&&members.length!==2)throw new Error('Choose a director or a second Trailblazer.');
        const scheduled=new Date(form.elements.scheduled.value);
        if(Number.isNaN(scheduled.getTime())||scheduled<=new Date())throw new Error('Choose a future date and time.');
        await checked(supabaseClient.rpc('portal_create_meeting_invitation',{request_id:requestId,member_ids:members,director_id:form.elements.director.value||null,scheduled_date:scheduled.toISOString(),location:form.elements.location.value.trim()}));
        dialog.close();if(box?.isConnected){await refresh(box);box.querySelector('.meeting-message').textContent='Invitation sent. Waiting for participants to accept.';await box.afterChange?.();}
      }catch(e){error.textContent=e.message;}finally{submit.disabled=false;}
    };
    dialog.showModal();
  }
  async function calendarEvents(role,id) {
    let query=supabaseClient.from('one_on_one_invitations').select('*').eq('status','scheduled');
    query=role==='member'?query.contains('member_ids',[id]):query.eq('director_id',id);
    const rows=await checked(query);
    return rows.map(r=>({id:'invitation-'+r.id,is_one_on_one:true,title:'One-on-one: '+r.participants.map(p=>p.name).join(' · '),start_time:r.scheduled_date,end_time:null,location:r.location,description:'Accepted in-person one-on-one.',meeting_type:'One-on-one',event_category:'one_on_one',all_day:false}));
  }
  function open(box,selectedDirector='',selectedMember=''){create(box,selectedDirector,selectedMember).catch(e=>alert(e.message));}
  return {mount,create,open,panel,calendarEvents};
})();
