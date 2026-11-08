/* Management workflows share the existing authenticated Supabase client. */
window.PortalManagement = (() => {
  'use strict';
  const esc = escapeHTML;
  const $ = id => document.getElementById(id);
  let access = { is_admin: false, assignments: [] }, mode = 'director', tab = 'overview', cohort = '', data = {}, generation = 0;
  let dialogSave = null, returnFocus = null, submissionKey = crypto.randomUUID(), showClosedDirectors = false, selectedPointsMember = '', selectedPointsCohort = '';
  let memberChannel = null, channelMemberId = null, refreshTimer = null, adminChannel = null, adminRefreshTimer = null, adminRealtimeStatus = 'CONNECTING', previewMemberId = '';
  let excuseDirectorLabels = new Map();
  let notificationPreferences = {}, preferencesUserId = null, preferencesError = '';
  let pointsView='overview';
  const notificationOptions = [
    ['points_email_enabled','Points','New point submissions awaiting review.'],
    ['meetings_email_enabled','Meetings and events','One-on-one requests, cancellations, and event notices.'],
    ['resumes_email_enabled','Resume reviews','New resumes submitted for review.'],
    ['excuses_email_enabled','Excuse forms','Absence notices and supporting forms.'],
    ['birthdays_email_enabled','Birthdays','Trailblazer birthday reminders.'],
    ['portal_email_enabled','Portal updates','Announcements, resources, and other portal notices.']
  ];
  let updateManagementNav = () => {};
  const capabilities = ['points','strikes','resumes','content','events','meetings','care'];
  const label = s => String(s || '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
  const name = m => m ? `${m.preferred_name || m.first_name} ${m.last_name}` : 'Unknown member';
  const date = s => s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleString([], s.length === 10 ? {dateStyle:'medium'} : {dateStyle:'medium',timeStyle:'short'}) : '—';
  const badge = (s, colored = false) => {
    const status = s === 'denied' ? 'rejected' : s;
    const colorClass = colored && ['approved','rejected','pending','needs_review','removed'].includes(status) ? ` point-status-${status}` : '';
    return `<span class="management-badge${colorClass}">${esc(label(status))}</span>`;
  };
  const awaitingPointReview = s => !['approved','denied','rejected'].includes(String(s||'').toLowerCase());
  const button = (text, action, id = '') => `<button type="button" class="secondary-button" data-action="${action}" data-id="${esc(id)}">${esc(text)}</button>`;
  const flyerTypes = new Set(['application/pdf','image/jpeg','image/png','image/webp']);
  const flyerMaxSize = 50 * 1024 * 1024;
  const publicFlyerUrl = path => supabaseClient.storage.from('trailblazers-resources').getPublicUrl(path).data.publicUrl;
  const flyerLink = item => item?.attachment_path ? `<a class="announcement-flyer-link" href="${esc(publicFlyerUrl(item.attachment_path))}" target="_blank" rel="noopener noreferrer">View attached flyer${item.attachment_name ? `: ${esc(item.attachment_name)}` : ''}</a>` : '';
  const member = id => (data.members || []).find(m => m.id === id);
  const options = rows => rows.map(r => [r.id, r.name || name(r)]);
  function notify(message, error = false) { $('managementMessage').textContent = message; $('managementMessage').classList.toggle('error', error); }
  async function checked(result) { const r = await result; if (r.error) { let message=r.error.message; try { const body=await r.error.context?.json(); message=body?.error||body?.message||message; } catch {} throw new Error(message); } return r.data; }
  async function mutate(kind, record_id, payload) { return checked(supabaseClient.rpc('portal_mutate', { kind, record_id: record_id || null, payload })); }
  async function all(table, order = table === 'portal_admins' ? 'user_id' : table === 'assignment_recipients' ? 'assignment_id' : 'id') {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const columns=table==='strikes'?'id,member_id,reason,issued_by,issued_at,status,resolved_at,resolution_note':'*';
      let query = supabaseClient.from(table).select(columns).order(order);
      if (table === 'assignment_recipients') query = query.order('member_id');
      const rows = await checked(query.range(from, from + 999));
      out.push(...rows); if (rows.length < 1000) return out;
    }
  }
  function allowed(cap) { return mode === 'admin' && access.is_admin || access.assignments.some(a => (!cohort || a.cohort_id === cohort) && (!cap || a.capabilities.includes(cap))); }
  function scoped(rows) { return rows.filter(r => !cohort || r.cohort_id === cohort); }
  function byMember(rows) { const ids = new Set(scoped(data.members || []).map(m => m.id)); return rows.filter(r => ids.has(r.member_id)); }
  function stats(m) { if(m.program_status==='archived'&&m.completion_snapshot)return m.completion_snapshot; return PortalUtils.progress(m, data.point_submissions, data.one_on_ones, data.strikes, data.director_assignments.filter(a=>data.directors.some(d=>d.id===a.director_id&&d.active)),
    data.cohorts.find(c => c.id === m.cohort_id)?.point_requirement || 10, data.point_rules); }
  const activityStats=m=>PortalUtils.activityProgress(m,data.point_rules,data.point_submissions,data.one_on_ones,data.director_assignments.filter(a=>data.directors.some(d=>d.id===a.director_id&&d.active)));
  const canMeet=o=>mode==='admin'||o.director_id===currentDirector?.id&&access.assignments.some(a=>a.cohort_id===member(o.member_id)?.cohort_id&&a.capabilities.includes('meetings'));
  const meetingActions=o=>!canMeet(o)?'':(o.scheduled_date?button('Edit meeting details','edit-past-meeting',o.id):'')+(o.status==='completed'?(mode==='admin'?button('Undo completion','reopen-meeting',o.id):''):(o.status==='pending'&&o.director_id===currentDirector?.id?button('Accept invitation','accept-meeting',o.id)+button('Decline invitation','decline-meeting',o.id):'')+(o.status==='completion_pending'?button('Approve completion','approve-meeting',o.id)+button('Request correction','reject-meeting',o.id):button('Mark completed','complete-meeting',o.id)+button('Manage schedule','edit-meeting',o.id)));
  async function loadAccess() {
    const result = await supabaseClient.rpc('portal_initialize');
    if (result.error) throw new Error(`Could not verify portal permissions: ${result.error.message}`);
    access = result.data;
    document.querySelectorAll('[data-open-management="admin"]').forEach(b => b.hidden = !access.is_admin);
    document.querySelectorAll('[data-open-management="director"]').forEach(b => b.hidden = !access.assignments.length);
    if ($('openDirectorViewButton')) $('openDirectorViewButton').hidden = !access.assignments.length;
    return access;
  }
  async function refresh() {
    const ticket = ++generation;
    notify('Loading…');
    try {
      await loadAccess();
      if (mode === 'admin' && !access.is_admin || mode === 'director' && !access.assignments.length) throw new Error('Your access has changed. Sign in again.');
      const tables = ['cohorts','members','directors','director_assignments','point_submissions','one_on_ones','one_on_one_history','strikes','resume_submissions','announcements','resources','meetings','excuse_submissions'];
      tables.push('student_assignments','assignment_recipients','assignment_submissions','hub_sections','point_rules','director_notifications','one_on_one_invitations');
      if (mode === 'admin') tables.push('portal_settings','portal_admins','email_templates');
      const values = await Promise.all(tables.map(t => all(t)));
      if (ticket !== generation) return;
      data = Object.fromEntries(tables.map((t, i) => [t, values[i]]));
      await loadNotificationPreferences();
      if (ticket !== generation) return;
      if (mode === 'director') {
        const ids = new Set(access.assignments.map(a => a.cohort_id));
        data.cohorts = data.cohorts.filter(c => ids.has(c.id));
        data.members = data.members.filter(m => ids.has(m.cohort_id));
        if (!ids.has(cohort)) cohort = data.cohorts[0]?.id || '';
      }
      $('managementCohort').innerHTML = (mode === 'admin' ? '<option value="">All cohorts</option>' : '') + data.cohorts.map(c => `<option value="${c.id}">${esc(c.name)}${c.status === 'archived' ? ' (archived)' : ''}</option>`).join('');
      $('managementCohort').value = cohort;
      notify(''); render();
    } catch (e) { notify(e.message, true); }
  }
  function table(headers, rows) {
    const sortable = new Set(['Member','Trailblazer','Name','Alumnus']);
    return rows.length ? `<div class="management-table-wrap"><table class="management-table"><thead><tr>${headers.map((h,i) => `<th scope="col">${sortable.has(h) ? `<button type="button" class="table-sort" data-sort-column="${i}" aria-label="Sort ${esc(h)} alphabetically">${esc(h)} <span aria-hidden="true">↕</span></button>` : esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells => `<tr>${cells.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No records to show.</div>';
  }
  const memberCell = id => esc(name(member(id)));
  const adminSections = [
    ['overview','Overview',['overview']],
    ['people','People',['members','cohorts','directors','assignments','import','director-import','member-preview','birthdays']],
    ['reviews','Reviews',['student-assignments','assignment-reviews','points','pending-points','resumes','strikes','excuses']],
    ['schedule','Schedule',['calendar','meetings','events']],
    ['content','Content',['announcements','resources','hub']],
    ['reports','Reports',['reports','audit']],
    ['settings','Settings',['settings','admins','templates']]
  ];
  const adminSectionTabs = {};
  async function loadNotificationPreferences() {
    preferencesError = '';
    notificationPreferences = {};
    preferencesUserId = null;
    try {
      const account = await checked(supabaseClient.auth.getUser());
      if (!account?.user?.id) throw new Error('Sign in again to manage notification settings.');
      const userId = account.user.id;
      const preferences = await checked(supabaseClient.from('staff_notification_preferences').select('*').eq('user_id',userId).maybeSingle());
      preferencesUserId = userId;
      notificationPreferences = preferences || {};
    } catch (e) {
      preferencesError = `Notification settings could not be loaded. Refresh to try again. ${e.message}`;
    }
  }
  function notificationSettings() {
    if (preferencesError) return `<p class="management-message error" role="alert">${esc(preferencesError)}</p>`;
    const enabled = notificationPreferences.email_enabled !== false;
    return `<section class="notification-settings"><h3>Email notifications</h3><p>Choose which emails you receive for your account across the admin and director views. Preferences apply to future deliveries. A category only sends emails when a matching portal notification is available.</p><form id="staffNotificationForm"><label class="notification-setting-row"><span><strong>All email notifications</strong><small>Turn all portal notification emails on or off.</small></span><input type="checkbox" role="switch" name="email_enabled" ${enabled?'checked':''}></label><fieldset id="staffNotificationCategories" ${enabled?'':'disabled'}><legend>Notification categories</legend>${notificationOptions.map(([key,title,description])=>`<label class="notification-setting-row"><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span><input type="checkbox" role="switch" name="${key}" ${notificationPreferences[key]!==false?'checked':''}></label>`).join('')}</fieldset><button type="submit" class="primary-button">Save notification settings</button><p id="staffNotificationMessage" class="management-message" role="status" aria-live="polite"></p></form></section>`;
  }
  function render() {
    if (!Array.isArray(data.cohorts) || !Array.isArray(data.members)) {
      notify('Portal data has not loaded. Select Refresh to try again.', true);
      return;
    }
    const tabs = [['overview','Overview'],['members',mode === 'director' ? 'Trailblazers' : 'Members'],['meetings','One-on-ones'],['events','Events'],['points','Points'],['strikes','Strikes'],['resumes','Resume reviews'],['announcements','Announcements'],['resources','Resources']];
    tabs.push(['pending-points','Pending points'],['student-assignments','Assignments'],['assignment-reviews','Assignment reviews']);
    if (mode === 'admin' || allowed('meetings')) tabs.push(['excuses','Excuse forms']);
    if (mode === 'admin') tabs.push(['member-preview','Member preview'],['cohorts','Cohorts'],['directors','Directors'],['assignments','Director assignments'],['import','Roster import'],['admins','Admin access'],['audit','Audit log']);
    tabs.push(['settings','Settings']);
    PortalInventory.addTabs(tabs,mode);
    const sections=adminSections.map(([id,title,ids])=>[id,title,ids.filter(id=>tabs.some(t=>t[0]===id))]).filter(([, ,ids])=>ids.length);
    const section = sections.find(([, , ids])=>ids.includes(tab)) || sections[0];
    if (section) adminSectionTabs[`${mode}:${section[0]}`] = tab;
    $('managementNav').innerHTML = section
      ? sections.map(([id,title])=>`<button type="button" data-section="${id}" ${section[0]===id?'aria-current="page"':''}>${title}</button>`).join('')
      : tabs.map(([id,title]) => `<button type="button" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${title}</button>`).join('');
    requestAnimationFrame(updateManagementNav);
    const sectionNav = section && section[2].length > 1
      ? `<nav class="management-section-nav" aria-label="${esc(section[1])} tools">${section[2].map(id=>[id,tabs.find(t=>t[0]===id)?.[1]]).filter(([,title])=>title).map(([id,title])=>`<button type="button" data-tab="${id}" ${tab===id?'aria-current="page"':''}>${esc(title)}</button>`).join('')}</nav>` : '';
    const q = $('managementSearch').value.trim().toLowerCase();
    const matches = (...values) => values.filter(Boolean).join(' ').toLowerCase().includes(q);
    let html = `<h2>${tabs.find(t => t[0] === tab)?.[1] || 'Overview'}</h2>`;
    const members = scoped(data.members).filter(m => matches(name(m),m.uf_email,m.program_status,m.major,m.minor,m.college,m.graduation_year,m.organizations,m.career_interests));
    if (tab === 'member-preview' && mode === 'admin') {
      const people = data.members.slice().sort((a,b)=>name(a).localeCompare(name(b),undefined,{sensitivity:'base'}));
      if (!people.some(m=>m.id===previewMemberId)) previewMemberId=people[0]?.id||'';
      const selected=member(previewMemberId);
      html += `<div class="member-preview-toolbar"><label>Preview Trailblazer <select id="memberPreviewSelect">${people.map(m=>`<option value="${esc(m.id)}" ${m.id===previewMemberId?'selected':''}>${esc(name(m))}${m.program_status==='archived'?' · Alumni':''}</option>`).join('')}</select></label>${button('Refresh preview','refresh-preview')}</div>`;
      if (selected) {
        const progress=stats(selected), cohortName=data.cohorts.find(c=>c.id===selected.cohort_id)?.name||'Alumni';
        const now=Date.now();
        const announcements=data.announcements.filter(a=>a.active&&a.audience==='members'&&(!a.cohort_id||a.cohort_id===selected.cohort_id)&&(!a.publish_at||new Date(a.publish_at).getTime()<=now)&&(!a.expires_at||new Date(a.expires_at).getTime()>now)).sort((a,b)=>(b.pinned===true)-(a.pinned===true)||(b.publish_at||'').localeCompare(a.publish_at||'')).slice(0,4);
        const resources=data.resources.filter(r=>r.active&&(!r.cohort_id||r.cohort_id===selected.cohort_id)).sort((a,b)=>(a.display_order||0)-(b.display_order||0)).slice(0,6);
        const upcoming=data.meetings.filter(e=>e.active&&(!e.cohort_id||e.cohort_id===selected.cohort_id)&&new Date(e.all_day?`${e.all_day_start}T23:59:59`:e.start_time).getTime()>=now).sort((a,b)=>new Date(a.start_time||a.all_day_start)-new Date(b.start_time||b.all_day_start)).slice(0,4);
        const points=data.point_submissions.filter(p=>p.member_id===selected.id).sort((a,b)=>(b.submitted_at||'').localeCompare(a.submitted_at||'')).slice(0,5);
        const oneOnOnes=data.one_on_ones.filter(o=>o.member_id===selected.id&&o.status==='scheduled').sort((a,b)=>(a.scheduled_date||'').localeCompare(b.scheduled_date||'')).slice(0,3);
        const realtimeReady=adminRealtimeStatus==='SUBSCRIBED';
        html += `<div class="member-preview-banner"><div><p class="eyebrow">READ-ONLY MEMBER PORTAL PREVIEW</p><h3>${esc(name(selected))} · ${esc(cohortName)}</h3><p>${realtimeReady?'Updates stream in automatically while this preview is open.':'Live updates are not connected; use Refresh preview to load the latest changes.'} This does not impersonate the member or allow changes on their behalf.</p></div><span class="preview-live-indicator ${realtimeReady?'is-live':''}">${realtimeReady?'Live updates on':'Refresh to update'}</span></div>`;
        html += `<div class="management-metrics"><article class="management-metric"><strong>${progress.approved}</strong><p>Approved points / ${progress.required} required</p></article><article class="management-metric"><strong>${progress.completed} / ${progress.required}</strong><p>Completed one-on-ones</p></article><article class="management-metric"><strong>${progress.pending}</strong><p>Points awaiting review</p></article></div>`;
        html += `<div class="member-preview-grid"><section class="dashboard-card"><h3>Announcements</h3>${announcements.length?announcements.map(a=>`<article class="preview-content-item"><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p><small>${date(a.publish_at)}</small>${flyerLink(a)}</article>`).join(''):'<p>No current announcements.</p>'}</section><section class="dashboard-card"><h3>Upcoming events</h3>${upcoming.length?upcoming.map(e=>`<article class="preview-content-item"><strong>${esc(e.title)}</strong><p>${esc(e.all_day?`${e.all_day_start} – ${e.all_day_end}`:date(e.start_time))}${e.location?` · ${esc(e.location)}`:''}</p></article>`).join(''):'<p>No upcoming events.</p>'}</section><section class="dashboard-card"><h3>Points activity</h3>${points.length?points.map(p=>`<article class="preview-content-item"><strong>${esc(p.activity_name)}</strong><p>${esc(label(p.status))} · ${p.points_awarded??p.points_requested} points</p></article>`).join(''):'<p>No point submissions yet.</p>'}</section><section class="dashboard-card"><h3>One-on-ones</h3>${oneOnOnes.length?oneOnOnes.map(o=>`<article class="preview-content-item"><strong>${date(o.scheduled_date)}</strong><p>${esc(label(o.status))}</p></article>`).join(''):'<p>No scheduled one-on-ones.</p>'}</section><section class="dashboard-card"><h3>Resources</h3>${resources.length?resources.map(r=>`<article class="preview-content-item"><strong>${esc(r.title)}</strong><p>${esc(r.category||r.description||'Resource')}</p></article>`).join(''):'<p>No current resources.</p>'}</section></div>`;
      } else html += '<div class="empty-state">No Trailblazer profiles are available to preview.</div>';
    } else if (tab === 'overview') {
      const active = members.filter(m => m.program_status === 'active'); const p = active.map(stats);
      const metrics = [['Active Trailblazers',active.length],['Points requirement',`${p.filter(x=>x.pointsMet).length} / ${active.length}`],['Meeting requirement',`${p.filter(x=>x.meetingsMet).length} / ${active.length}`],['Pending points',byMember(data.point_submissions).filter(p=>awaitingPointReview(p.status)).length],['Resumes awaiting review',byMember(data.resume_submissions).filter(r=>r.status!=='reviewed').length],['Upcoming one-on-ones',byMember(data.one_on_ones).filter(r=>['scheduled','pending'].includes(r.status)&&new Date(r.scheduled_date)>new Date()).length]];
      html += `<div class="management-metrics">${metrics.map(([title,value])=>`<article class="management-metric"><strong>${value}</strong><p>${title}</p>${title==='Pending points'?`<div class="overview-actions">${button('Review pending points','pending-points')}</div>`:''}${title==='Resumes awaiting review'?`<div class="overview-actions">${allowed('resumes')?button('Review resumes','quick-resumes'):''}${allowed('points')?button('Review points','quick-points'):''}</div>`:''}</article>`).join('')}</div><p>Only approved points count toward requirements. Open Members for individual progress and history.</p>`;
      html += table(['Member','Approved points','Meetings','Active strikes'],active.filter(m=>{const s=stats(m);return !s.pointsMet||!s.meetingsMet||s.strikes;}).map(m=>{const s=stats(m);return [esc(name(m)),s.approved,`${s.completed} / ${s.required}`,s.strikes];}));
    } else if (tab === 'members') {
      if (mode === 'admin') html += `<div class="management-toolbar">${button('Add Trailblazer','add-member')}</div>`;
      html += table(['Member','Email','Status','Points / pending','Meetings','Strikes','Actions'],members.map(m=>{ const s=stats(m);return [esc(name(m)),esc(m.uf_email||''),badge(m.program_status),`${s.approved} / ${s.pending}`,`${s.completed} / ${s.required}`,s.strikes,button('Open','member-detail',m.id)+(mode==='admin'?button('Edit','edit-member',m.id)+(m.auth_user_id?badge('Connected'):button('Invite / connect','invite-member',m.id)):'')]; }));
    } else if (tab === 'meetings') {
      if(allowed('meetings'))html+=`<div class="management-toolbar">${button('Add a completed one-on-one','record-meeting')}${mode==='admin'?button('Award one-on-one point','award-meeting-point'):''}</div><p>${mode==='admin'?'Record past meetings, correct completion, or award the one-on-one checklist point directly. Manual points can be edited or removed in Points.':'Past meetings need director approval. Mark a meeting completed to update the Trailblazer’s checklist.'}</p>`;
      if (mode === 'admin') {
        const meetings=byMember(data.one_on_ones);const personIds=members.filter(m=>m.program_status==='active'||meetings.some(o=>o.member_id===m.id)).map(m=>m.id).sort((a,b)=>name(member(a)).localeCompare(name(member(b))));
        html += '<p>One row per Trailblazer. Open a member to review their meeting schedule and history.</p>';
        html += table(['Member','Scheduled','Completed','Next meeting','Actions'],personIds.filter(id=>matches(name(member(id)))).map(id=>{const rows=meetings.filter(o=>o.member_id===id);const upcoming=rows.filter(o=>o.status==='scheduled'&&new Date(o.scheduled_date)>new Date()).sort((a,b)=>a.scheduled_date.localeCompare(b.scheduled_date))[0];return [memberCell(id),rows.filter(o=>o.status==='scheduled').length,rows.filter(o=>o.status==='completed').length,date(upcoming?.scheduled_date),button('View meetings','view-one-on-ones',id)];}));
      } else {
        const directorMeetings = byMember(data.one_on_ones).filter(o => mode === 'admin' || o.director_id === currentDirector?.id);
        const directorMeetingIds = new Set(directorMeetings.map(o => o.id));
        html += table(['Trailblazer','Director','Date','Method / location','Status','Actions'],directorMeetings.filter(o=>matches(name(member(o.member_id)),o.status)).sort((a,b)=>(a.status==='completion_pending'?-1:0)-(b.status==='completion_pending'?-1:0)||(b.scheduled_date||'').localeCompare(a.scheduled_date||'')).map(o=>[memberCell(o.member_id),esc(name(data.directors.find(d=>d.id===o.director_id))),date(o.scheduled_date),`${esc(label(o.meeting_method))}<br>${esc(o.location_method||'')}`,badge(o.status),meetingActions(o)]));
        const history = byMember(data.one_on_one_history).filter(o => mode === 'admin' || o.director_id === currentDirector?.id || directorMeetingIds.has(o.one_on_one_id));
        html+='<h3>Change history</h3>'+table(['Trailblazer','Previous date','Previous status','Changed'],history.sort((a,b)=>b.changed_at.localeCompare(a.changed_at)).map(o=>[memberCell(o.member_id),date(o.scheduled_date),badge(o.previous_status),date(o.changed_at)]));
      }
    } else if (tab === 'events') {
      if(allowed('events'))html+=`<div class="management-toolbar">${button('Create event','add-event')}</div>`;
      html+= '<p>Timed events display in your device time zone. All-day events preserve their calendar dates.</p>';
      html+=table(['Title','Audience','When','Category','Status','Actions'],data.meetings.filter(r=>(!cohort||!r.cohort_id||r.cohort_id===cohort)&&matches(r.title)).map(r=>[esc(r.title),esc(data.cohorts.find(c=>c.id===r.cohort_id)?.name||'All cohorts'),r.all_day?`${esc(r.all_day_start)} – ${esc(r.all_day_end)} · All day`:date(r.start_time),esc(label(r.event_category)),badge(r.active?'active':'canceled'),allowed('events')&&(mode==='admin'||r.cohort_id===cohort)?button('Edit / cancel','edit-event',r.id):'']));
    } else if (tab === 'strikes') {
      if (allowed('strikes')) html += `<div class="management-toolbar">${button('Add strike','add-strike')}</div>`;
      html += table(['Member','Reason','Issued','Issued by','Status','Resolution','Actions'],byMember(data.strikes).filter(s=>matches(name(member(s.member_id)),s.reason,s.status)).map(s=>[memberCell(s.member_id),esc(s.reason),date(s.issued_at),esc(name(data.directors.find(d=>d.id===s.issued_by))),badge(s.status),esc(s.resolution_note||''),allowed('strikes')&&s.status==='active'?button('Resolve / remove','remove-strike',s.id):'']));
    } else if (tab === 'resumes') {
      html += table(['Submitted by','File','Submitted','Status','Feedback','Actions'],byMember(data.resume_submissions).filter(r=>matches(name(member(r.member_id)),r.status)).sort((a,b)=>b.submitted_at.localeCompare(a.submitted_at)).map(r=>[memberCell(r.member_id),esc(r.file_name),date(r.submitted_at),badge(r.status),esc(r.feedback||''),button('Open file','resume-file',r.id)+(allowed('resumes')&&r.status!=='reviewed'?button('Review','review-resume',r.id):'')]));
    } else if (tab === 'excuses') {
      html += '<p>Excuse records and supporting proof are limited to administrators and authorized cohort directors.</p>';
      const excuses=byMember(data.excuse_submissions||[]).filter(r=>matches(name(member(r.member_id)),r.absence_type,r.reason)).sort((a,b)=>b.submitted_at.localeCompare(a.submitted_at));
      html += table(['Trailblazer','Request','Date / time missed','Reason','Submitted','Director notified','Proof'],excuses.map(r=>[memberCell(r.member_id),esc(label(r.absence_type)),date(r.missed_at),esc(r.reason),date(r.submitted_at),r.notified_director_id?esc(name(data.directors.find(d=>d.id===r.notified_director_id))):'—',button('Open form','excuse-detail',r.id)]));
    } else if (tab === 'announcements' && mode === 'director') {
      const now = Date.now();
      const announcements = data.announcements
        .filter(r => r.active && (!r.cohort_id || r.cohort_id === cohort) && ['members','directors'].includes(r.audience || 'members') && (!r.publish_at || new Date(r.publish_at).getTime() <= now) && (!r.expires_at || new Date(r.expires_at).getTime() > now) && matches(r.title,r.body))
        .sort((a,b)=>(b.pinned===true)-(a.pinned===true)||(b.publish_at||'').localeCompare(a.publish_at||''));
      if (allowed('content')) html += `<div class="management-toolbar">${button('Create announcement','add-content')}</div>`;
      html += announcements.length
        ? `<div class="director-announcement-list">${announcements.map(r=>`<article class="announcement-card director-announcement-card"><button type="button" class="director-announcement-open" data-action="view-announcement" data-id="${esc(r.id)}"><span class="director-announcement-heading"><strong>${esc(r.title)}</strong>${r.pinned?'<span class="management-badge">Pinned</span>':''}</span><span class="director-announcement-body">${esc(r.body||'')}</span><span class="director-announcement-meta">${esc(r.audience==='directors'?'Directors only':'All Trailblazers')} · ${date(r.publish_at)}</span></button>${flyerLink(r)}</article>`).join('')}</div>`
        : '<div class="empty-state">No current announcements for this cohort.</div>';
    } else if (tab === 'announcements' || tab === 'resources') {
      if (allowed('content')) html += `<div class="management-toolbar">${button(`Add ${tab==='announcements'?'announcement':'resource'}`,'add-content')}</div>`;
      html += table(['Title','Audience','Status','Actions'],data[tab].filter(r=>(!cohort||!r.cohort_id||r.cohort_id===cohort)&&matches(r.title,r.category)).map(r=>[esc(r.title),esc(r.cohort_id?data.cohorts.find(c=>c.id===r.cohort_id)?.name||'Cohort':'All cohorts')+(r.audience==='directors'?' · Directors only':''),badge(r.active?'active':'archived'),allowed('content')&&(mode==='admin'||r.cohort_id===cohort)?button('Edit / archive','edit-content',r.id):'']));
    } else if (tab === 'cohorts') {
      html += `<div class="management-toolbar">${button('Create cohort','add-cohort')}</div>`;
      html += table(['Name','Class','Status','Point requirement','Actions'],data.cohorts.map(c=>[button(c.name,'view-cohort',c.id),c.class_number,badge(c.status),c.point_requirement,button('Manage / archive','edit-cohort',c.id)+button('Set up Drive folders','sync-cohort',c.id)]));
    } else if (tab === 'directors') {
      html += `<div class="management-toolbar">${button('Add director','add-director')}${button(showClosedDirectors?'Hide closed accounts':'Show closed accounts','toggle-closed-directors')}</div>`;
      html += table(['Name','Email','Role','Status','Actions'],data.directors.filter(d=>(d.active||showClosedDirectors)&&matches(name(d),d.email,d.title)).map(d=>[esc(name(d)),esc(d.email),esc(d.role||d.title||''),badge(d.active?'active':'closed'),button('Edit','edit-director',d.id)+(d.active?button('Close account','close-director',d.id)+button(d.auth_user_id?'Account linked':'Invite / connect','invite-director',d.id):'')]));
    } else if (tab === 'assignments') {
      html += `<div class="management-toolbar">${button('Assign director','add-assignment')}</div>`;
      html += table(['Director','Cohort','Title','Capabilities','Dates','Status','Actions'],scoped(data.director_assignments).map(a=>[esc(name(data.directors.find(d=>d.id===a.director_id))),esc(data.cohorts.find(c=>c.id===a.cohort_id)?.name||''),esc(a.title),esc(a.capabilities.join(', ')),`${date(a.start_date)} – ${date(a.end_date)}`,badge(a.active?'active':'ended'),button('Edit / end','edit-assignment',a.id)]));
    } else if (tab === 'import') {
      html += '<p>Excel (.xlsx) first sheet or CSV columns: <code>first_name,last_name,uf_email,cohort,member_id,preferred_name</code>. The first four are required. Optional columns: nsbe_id, major, minor, college, graduation_year, organizations, career_interests, birthday_month, birthday_day, dietary_preference, food_allergies, dietary_restrictions, personal_email, phone. Cohort accepts its name or class number. Up to 500 rows; validation and import are all-or-nothing.</p><label class="management-field">Roster CSV<input type="file" id="rosterCSV" accept=".csv,.xlsx,text/csv"></label><div id="rosterPreview"></div>';
    } else if (tab === 'admins') {
      html += `<p>Each administrator needs their own verified account. The last active administrator cannot be removed.</p><div class="management-toolbar">${button('Grant or revoke access','manage-admin')}</div>`;
      html += table(['Account ID','Status','Granted'],data.portal_admins.map(a=>[esc(a.user_id),badge(a.active?'active':'inactive'),date(a.created_at)]));
    } else if (tab === 'settings') {
      html += notificationSettings();
      if (mode === 'admin') {
        html += `<h3>Portal configuration</h3><p>The default point requirement applies to new cohorts. Existing cohort requirements are controlled under Cohorts.</p><div class="management-toolbar">${button('Configure portal','configure')}${button('Add setting','add-setting')}</div>`;
        html += table(['Key','Value','Description','Actions'],data.portal_settings.map(s=>[esc(s.setting_key),esc(JSON.stringify(s.setting_value)),esc(s.description||''),button('Edit','edit-setting',s.id)]));
      }
    } else if (tab === 'audit') {
      html += '<p>The latest 200 changes, including the actor and before/after records. Historical data is retained.</p><div id="auditRows">Loading history…</div>';
      loadAudit();
    }
    if(tab==='points') html=renderPoints(matches);
    if(tab==='pending-points') html=renderPendingPoints(matches);
    const extension=PortalAssignments.render(context(),PortalInventory.render(context(),html));
    $('managementContent').innerHTML = sectionNav + extension;
    PortalInventory.afterRender(context());
    if(tab==='meetings')PortalMeetings.mount($('managementContent'),refresh,mode==='admin');
  }
  function pointSnapshot(p) {return Object.fromEntries(['activity_name','activity_date','category','points_awarded','status','director_note','reviewed_at','removed_at'].map(k=>[k,p[k]??null]));}
  function renderPendingPoints(matches) {
    const people=new Map(data.members.filter(m=>m.program_status==='active').map(m=>[m.id,m]));
    const pending=data.point_submissions.filter(p=>people.has(p.member_id)&&!p.removed_at&&['pending','needs_review'].includes(p.status)).filter(p=>matches(name(people.get(p.member_id)),p.activity_name,p.category,p.status)).sort((a,b)=>a.submitted_at.localeCompare(b.submitted_at));
    return `<h2>Pending points</h2><p>All current submissions awaiting review across ${mode==='admin'?'all cohorts':'your assigned cohorts'}. Includes pending and needs-review submissions. Search to find a Trailblazer or activity.</p><div class="management-toolbar">${button('Points overview','points-overview')}<strong>${pending.length} submission${pending.length===1?'':'s'} awaiting review</strong></div>`+table(['Trailblazer','Class','Activity','Requested points','Submitted','Status','Actions'],pending.map(p=>{
      const person=people.get(p.member_id),canReview=mode==='admin'||access.assignments.some(a=>a.cohort_id===person.cohort_id&&a.capabilities.includes('points'));
      return [esc(name(person)),esc(data.cohorts.find(c=>c.id===person.cohort_id)?.name||'—'),esc(p.activity_name),p.points_requested,date(p.submitted_at),badge(p.status,true),button('Details / evidence','point-detail',p.id)+(canReview?button('Review','review-points',p.id):'')+button('Full ledger','points-member',p.member_id)];
    }));
  }
  function renderPoints(matches) {
    const people=(mode==='admin'?data.members:scoped(data.members)).filter(m=>!selectedPointsCohort||m.cohort_id===selectedPointsCohort).sort((a,b)=>name(a).localeCompare(name(b)));
    const classes=mode==='admin'?data.cohorts:data.cohorts.filter(c=>!cohort||c.id===cohort);
    const choices=people.filter(m=>matches(name(m),m.uf_email));
    const totals=m=>{const rows=data.point_submissions.filter(p=>p.member_id===m.id),s=activityStats(m);return {rows,total:s.requiredComplete+s.electiveComplete,pending:rows.filter(p=>awaitingPointReview(p.status)&&!p.removed_at),requirement:10,summary:s};};
    let html='<h2>Points checklist</h2><p>All 4 required activities plus any 6 different electives. Three GBMs earn 1 point; director one-on-ones earn 1 point together.</p><div class="management-toolbar">'+button('All Trailblazers','points-overview')+button('Review pending submissions','pending-points')+(allowed('points')?button('Check off an activity','assign-points'):'')+'</div>';
    html+=`<div class="management-toolbar points-filters"><label>Class <select id="pointsCohortSelect">${mode==='admin'?'<option value="">All classes</option>':''}${classes.map(c=>`<option value="${esc(c.id)}" ${(selectedPointsCohort||cohort)===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label></div>`;
    if(pointsView==='overview'||!people.some(m=>m.id===selectedPointsMember)) {
      html+=table(['Trailblazer','Class','Required activities','Electives','Missing requirements','Pending reviews','Progress','Actions'],choices.map(m=>{const t=totals(m),s=t.summary;return [esc(name(m)),esc(data.cohorts.find(c=>c.id===m.cohort_id)?.name||'—'),`${s.requiredComplete} / 4`,`${Math.min(s.electiveComplete,6)} / 6`,s.activities.filter(r=>r.is_required&&!r.complete).map(r=>`${esc(r.name)} (${r.count}/${r.required_count})`).join('<br>')||'None',t.pending.length,badge(s.pointsMet?'complete':'in_progress'),button('Open checklist / history','points-member',m.id)];}));
    } else {
      const person=member(selectedPointsMember),t=totals(person);
      html+=`<h3>${esc(name(person))}</h3><div class="management-metrics"><article class="management-metric"><strong>${t.total}</strong><p>Approved points</p></article><article class="management-metric"><strong>${t.requirement}</strong><p>Required points</p></article><article class="management-metric"><strong>${Math.max(0,t.requirement-t.total)}</strong><p>Points remaining</p></article><article class="management-metric"><strong>${t.pending.length}</strong><p>Pending reviews</p></article></div><p>Full history, including pending, rejected, and removed entries. Only approved awards count toward the total.</p>`;
      const editable=person.program_status==='active'&&(mode==='admin'||access.assignments.some(a=>a.cohort_id===person.cohort_id&&a.capabilities.includes('points')));
      html+=PortalCompletion.checklist(person,data.point_rules,data.point_submissions,data.one_on_ones,data.director_assignments.filter(a=>data.directors.some(d=>d.id===a.director_id&&d.active)),editable,mode==='admin');
      html+=table(['Activity','Date','Requested / assigned','Awarded','Status','Source','Note','Actions'],t.rows.filter(p=>matches(p.activity_name,p.category,p.status,p.director_note,name(person))).sort((a,b)=>b.submitted_at.localeCompare(a.submitted_at)).map(p=>[
        esc(p.activity_name)+(p.occurrence_count>1?`<br>${p.occurrence_count} events`:''),date(p.activity_date),p.points_requested,p.points_awarded??'—',badge(p.removed_at?'removed':p.status,true),esc(p.director_assigned?'Director assigned':'Member submitted'),esc(p.director_note||''),button('Details','point-detail',p.id)+(editable?(awaitingPointReview(p.status)?button('Review','review-points',p.id):'')+button(p.removed_at?'Edit / restore':'Edit points','edit-point-award',p.id)+(p.status==='approved'&&!p.removed_at?button('Remove points','remove-point-award',p.id):''):'')
      ]));
    }
    html+=`<details class="dashboard-card"><summary>Points rules and administration</summary><div class="management-toolbar">${button('Open points rules','points-document')}${mode==='admin'?button('Upload rules PDF','upload-points-document')+button('Reset all active points','reset-all-points')+button('Reset one member’s points','reset-member-points'):''}</div>${mode==='admin'?button('Add activity','add-rule')+table(['Activity','Default points','Actions'],data.point_rules.filter(r=>!cohort||!r.cohort_id||r.cohort_id===cohort).map(r=>[esc(r.name),r.default_points,button('Edit','edit-rule',r.id)])):''}</details>`;
    return html;
  }
  async function loadAudit() {
    try {
      data.audit = await checked(supabaseClient.from('activity_log').select('*').order('created_at',{ascending:false}).limit(200));
      if ($('auditRows')) { $('auditRows').innerHTML = table(['When','Actor account','Action','Record','Details'],data.audit.map(a=>[date(a.created_at),esc(a.actor_user_id||'System'),esc(a.action),esc(a.entity_type),button('Inspect','audit-detail',a.id)])); $('auditRows').querySelector('.management-table-wrap')?.classList.add('audit-table-wrap'); }
    } catch(e) { if ($('auditRows')) $('auditRows').textContent=e.message; }
  }
  function field(key,title,type='text',extra={}) { return {key,title,type,...extra}; }
  function showDialog(title, fields, initial, save, intro='') {
    returnFocus = document.activeElement;
    $('managementDialogTitle').textContent = title;
    $('managementDialogIntro').textContent = intro;
    $('managementDialogFields').innerHTML = fields.map(f=>{
      const value = initial[f.key] ?? f.default ?? '';
      const attr = `name="${f.key}" id="mf-${f.key}" ${f.required?'required':''} ${f.readonly?'disabled':''}`;
      let control;
      if (f.type==='select') control=`<select ${attr}>${f.options.map(([v,t])=>`<option value="${esc(String(v))}" ${String(value)===String(v)?'selected':''}>${esc(t)}</option>`).join('')}</select>`;
      else if (f.type==='textarea'||f.type==='json') control=`<textarea ${attr} rows="4">${esc(f.type==='json'?JSON.stringify(value,null,2):String(value))}</textarea>`;
      else if (f.type==='checkbox') control=`<input ${attr} type="checkbox" ${value?'checked':''}>`;
      else if (f.type==='file') control=`<input ${attr} type="file" accept="${esc(f.accept||'')}" ${f.required?'required':''}>${f.currentURL?`<small>Current file: <a href="${esc(f.currentURL)}" target="_blank" rel="noopener noreferrer">${esc(f.currentName||'Open attachment')}</a></small>`:''}<small>${esc(f.hint||'PDF, JPG, PNG, or WebP · up to 50 MB')}</small>`;
      else control=`<input ${attr} type="${f.type}" value="${esc(f.type==='datetime-local'&&value?formatDateTimeLocalValue(value):String(value))}" ${f.min!==undefined?`min="${f.min}"`:''} ${f.max!==undefined?`max="${f.max}"`:''}>`;
      return `<label class="management-field" for="mf-${f.key}">${esc(f.title)}${control}</label>`;
    }).join('');
    $('managementDialogMessage').textContent='';
    $('managementDialogSave').hidden=!save;
    dialogSave=save?async form=>{
      const result={};
      fields.forEach(f=>{const el=form.elements[f.key]; result[f.key]=f.type==='file'?(el.files?.[0]||null):f.type==='checkbox'?el.checked:f.type==='json'?JSON.parse(el.value):f.type==='number'?(el.value?Number(el.value):null):f.type==='datetime-local'?(el.value?new Date(el.value).toISOString():null):el.value.trim()||null;});
      await save(result);
    }:null;
    $('managementDialog').showModal();
  }
  function details(title, html) { showDialog(title,[],{},null); $('managementDialogFields').innerHTML=html; }
  const boolField=(key,title,value=true)=>field(key,title,'checkbox',{default:value});
  const cohortField=(readonly=false)=>field('cohort_id','Cohort','select',{required:!['announcements','resources','events'].includes(tab),readonly,options:[...(mode==='admin'&&['announcements','resources','events'].includes(tab)?[['','All cohorts']]:[]),...options(data.cohorts)]});
  async function saveAndRefresh(kind,id,values) { await mutate(kind,id,values); await refresh(); }
  async function reportMeeting(staff=false,selectedMember='') {
    if(staff){
      if(!data.members||$('managementShell').hidden)await show('director','meetings');
      const people=scoped(data.members).filter(m=>m.program_status==='active'&&(mode==='admin'||access.assignments.some(a=>a.cohort_id===m.cohort_id&&a.capabilities.includes('meetings'))));
      const directors=data.directors.filter(d=>mode==='admin'||d.active&&d.id===currentDirector?.id);
      if(!people.length||!directors.length)throw new Error('No active Trailblazers or directors are available for manual entry. Check cohort assignments and meeting permissions.');
      showDialog('Add a completed one-on-one',[field('member_id','Trailblazer','select',{required:true,options:options(people)}),field('director_id','Director who met with the Trailblazer','select',{required:true,options:options(directors)}),field('completed_at','When the meeting took place','datetime-local',{required:true}),field('location','In-person location'),field('note','Note (optional)','textarea')],{member_id:selectedMember,completed_at:new Date().toISOString()},async payload=>{await checked(supabaseClient.rpc('portal_one_on_one_completion',{operation:'record',payload}));await refresh();notify('Completed one-on-one saved.');},'Record an in-person meeting that already happened. It counts immediately.');
      const updateDirectors=()=>{
        const person=people.find(m=>m.id===$('mf-member_id').value),today=PortalCompletion.today();
        const choices=directors.filter(d=>mode==='admin'||data.director_assignments.some(a=>a.director_id===d.id&&a.cohort_id===person?.cohort_id&&a.active&&a.capabilities.includes('meetings')&&(!a.start_date||a.start_date<=today)&&(!a.end_date||a.end_date>=today)));
        $('mf-director_id').innerHTML=choices.length?choices.map(d=>`<option value="${esc(d.id)}">${esc(name(d))}</option>`).join(''):'<option value="">No assigned director with meeting permission</option>';
      };
      $('mf-member_id').onchange=updateDirectors;updateDirectors();
    }else{
      const records=currentOneOnOnes.filter(o=>(o.status!=='completed'||o.completed_date?.slice(0,10)<PortalCompletion.termStart())&&o.director?.active);
      if(!records.length){alert('No incomplete director requirements are available. To correct a meeting already marked complete, ask your director or an administrator to use Edit meeting details.');return;}
      showDialog('Add a completed one-on-one',[field('record_id','Director you met with','select',{required:true,options:records.map(o=>[o.id,name(o.director)])}),field('completed_at','When the meeting took place','datetime-local',{required:true}),field('location','In-person location'),field('note','Note for your director','textarea')],{completed_at:new Date().toISOString()},async v=>{await checked(supabaseClient.rpc('portal_one_on_one_completion',{operation:'request',record_id:v.record_id,payload:v}));await refreshMemberData();},'Your director will review and approve this meeting before it counts toward completion.');
    }
  }
  async function saveAnnouncementWithFlyer(id, values, initial) {
    const file=values.flyer_file||null, removeFlyer=values.remove_flyer===true;
    delete values.flyer_file; delete values.remove_flyer;
    let uploadedPath=null, savedId=id||null, attachmentSaved=false;
    const oldPath=initial?.attachment_path||null;
    try {
      if(file){
        if(file.size>flyerMaxSize)throw new Error('Flyers must be 50 MB or smaller.');
        if(!flyerTypes.has(file.type))throw new Error('Use a PDF, JPG, PNG, or WebP flyer.');
        const safeName=file.name.replace(/[^A-Za-z0-9._-]+/g,'_').slice(-120)||'flyer';
        const folder=values.cohort_id||'global';
        uploadedPath=`${folder}/announcement-flyers/${crypto.randomUUID()}-${safeName}`;
        await checked(supabaseClient.storage.from('trailblazers-resources').upload(uploadedPath,file,{contentType:file.type,upsert:false}));
      }
      const result=await mutate('announcement',id,values);
      savedId=id||result;
      if(!savedId)throw new Error('The announcement was saved, but its flyer could not be linked. Refresh and edit the announcement to attach it.');
      if(file||removeFlyer){await checked(supabaseClient.rpc('portal_set_announcement_attachment',{p_announcement_id:savedId,p_path:uploadedPath,p_name:file?.name||null,p_content_type:file?.type||null,p_size:file?.size||null}));attachmentSaved=true;}
      await refresh();
      if(oldPath&&(removeFlyer||uploadedPath)&&oldPath!==uploadedPath){
        const {error}=await supabaseClient.storage.from('trailblazers-resources').remove([oldPath]);
        if(error)console.warn('Could not remove the replaced announcement flyer:',error.message);
      }
    } catch(error) {
      if(uploadedPath&&!attachmentSaved)await supabaseClient.storage.from('trailblazers-resources').remove([uploadedPath]);
      throw error;
    }
  }
  async function fileURL(path) { const result=await checked(supabaseClient.storage.from('trailblazers-private').createSignedUrl(path,900)); return result.signedUrl; }
  async function openFile(path) {
    const url=await fileURL(path);
    details('Private file',`<p>This download link expires in one minute.</p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open or download file</a>`);
  }
  async function pointsDocument() {
    const path=await checked(supabaseClient.rpc('portal_points_document',{operation:'read'}));
    if(!path){details('Points rules','<p>The administrator has not uploaded the points rules PDF yet.</p>');return;}
    const result=await checked(supabaseClient.storage.from('portal-documents').createSignedUrl(path,300));
    details('Points rules',`<a class="primary-button" href="${esc(result.signedUrl)}" target="_blank" rel="noopener noreferrer">Open rules PDF</a>`);
  }
  async function saveResourceWithFile(id,values) {
    const file=values.resource_file;
    const payload={...values};delete payload.resource_file;
    if(!file&&!payload.external_url)throw new Error('Add a link or choose a file to upload.');
    let uploadedPath=null, saved=false;
    try {
      if(file){
        if(file.size>50*1024*1024)throw new Error('Files must be 50 MB or smaller.');
        if(!file.size)throw new Error('Choose a file that is not empty.');
        const safeName=file.name.replace(/[^A-Za-z0-9._-]+/g,'_').slice(-120)||'resource';
        uploadedPath=`${payload.cohort_id||'global'}/resources/${crypto.randomUUID()}-${safeName}`;
        await checked(supabaseClient.storage.from('trailblazers-resources').upload(uploadedPath,file,{contentType:file.type||'application/octet-stream',upsert:false}));
        payload.external_url=publicFlyerUrl(uploadedPath);payload.resource_type='external_link';
      }
      await checked(supabaseClient.rpc('portal_save_resource',{record_id:id||null,payload}));saved=true;
      await refresh();notify(file?'Resource file published.':'Resource saved.');
    }catch(error){
      if(uploadedPath&&!saved){try{await checked(supabaseClient.storage.from('trailblazers-resources').remove([uploadedPath]));}catch(cleanupError){console.warn('Could not remove unpublished resource file:',cleanupError.message);}}
      throw error;
    }
  }
  function context(){return {data,mode,tab,cohort,access,scoped,byMember,stats,name,date,table,button,field,boolField,cohortField,showDialog,details,checked,refresh,render,allowed,notify,mutate,saveAndRefresh,saveResourceWithFile,navigate:target=>{tab=target;render();}};}
  async function action(action,id) {
    if(action==='accept-meeting'||action==='decline-meeting'){
      await checked(supabaseClient.rpc('portal_respond_legacy_meeting',{record_id:id,decision:action==='accept-meeting'?'accept':'decline'}));await refresh();notify('Invitation updated.');return;
    }
    if(action==='edit-past-meeting'){
      const o=data.one_on_ones.find(o=>o.id===id);if(!o||!canMeet(o))throw new Error('Meeting access required');
      showDialog('Edit meeting details',[field('scheduled_date','Meeting date and time','datetime-local',{required:true}),...(o.status==='completed'?[field('completed_date','Completion date and time','datetime-local',{required:true})]:[]),field('location_method','In-person location'),field('admin_note','Meeting note','textarea')],{...o,completed_date:o.completed_date||o.scheduled_date},async payload=>{await checked(supabaseClient.rpc('portal_edit_past_meeting',{record_id:id,payload}));await refresh();notify('Meeting details updated. Previous values are saved in change history.');},'Correct an existing meeting, including older completed meetings. Its status stays the same. Previous values remain in change history.');return;
    }
    if(action==='record-meeting'){return reportMeeting(true,id);}
    if(action==='reopen-meeting'){
      if(mode!=='admin'||!access.is_admin)throw new Error('Administrator access required');
      showDialog('Undo one-on-one completion',[field('note','Reason for correction','textarea',{required:true})],{},async payload=>{await checked(supabaseClient.rpc('portal_one_on_one_completion',{operation:'reopen',record_id:id,payload}));await refresh();notify('Completion removed. The meeting and its history are preserved.');},'This meeting will need rescheduling and will stop counting toward completion. A separately awarded manual point can be removed in Points.');return;
    }
    if(action==='complete-meeting'||action==='approve-meeting'||action==='reject-meeting'){
      const o=data.one_on_ones.find(o=>o.id===id);if(!o||!canMeet(o))throw new Error('Meeting access required');
      const reject=action==='reject-meeting';
      showDialog(reject?'Request completion correction':'Approve completed one-on-one',reject?[field('note','Reason / correction needed','textarea',{required:true})]:[field('completed_at','When the meeting took place','datetime-local',{required:true}),field('note','Note (optional)','textarea')],{completed_at:o.scheduled_date&&new Date(o.scheduled_date)<=new Date()?o.scheduled_date:new Date().toISOString()},async v=>{
        await checked(supabaseClient.rpc('portal_one_on_one_completion',{operation:reject?'reject':'record',record_id:id,payload:v}));await refresh();notify(reject?'Correction requested.':'One-on-one approved and checklist updated.');
      },'Completion counts after approval by the meeting’s director or an administrator.');return;
    }
    if(action==='pending-points'){tab='pending-points';$('managementSearch').value='';render();return;}
    if(action==='points-overview'){tab='points';pointsView='overview';selectedPointsMember='';render();return;}
    if(action==='points-member'){tab='points';selectedPointsMember=id;cohort=member(id)?.cohort_id||cohort;selectedPointsCohort='';pointsView='member';$('managementCohort').value=cohort;$('managementSearch').value='';render();return;}
    if(action==='edit-point-award'||action==='remove-point-award'){
      const p=data.point_submissions.find(p=>p.id===id);if(!p)throw new Error('Point entry not found. Refresh and try again.');
      const removing=action==='remove-point-award';
      const fields=removing?[field('reason','Reason for removal','textarea',{required:true})]:[
        field('point_rule_id','Checklist activity','select',{options:[['','Unclassified / historical award'],...data.point_rules.filter(r=>r.active&&(mode==='admin'||r.completion_source!=='director_meetings')&&(!r.cohort_id||r.cohort_id===member(p.member_id)?.cohort_id)).map(r=>[r.id,r.name])]}),field('occurrence_count','Events verified','number',{required:true,min:1,max:100}),field('activity_name','Activity','text',{required:true}),field('activity_date','Activity date','date',{required:true}),field('category','Category'),
        field('status','Status','select',{options:[['approved','Approved'],['pending','Pending'],['needs_review','Needs review'],['denied','Rejected']]}),
        field('points_awarded','Awarded points','number',{required:true,min:0,max:1000}),field('director_note','Note to Trailblazer','textarea')
      ];
      showDialog(removing?'Remove points':p.removed_at?'Edit / restore points':'Edit points',fields,removing?{}:{...p,status:p.removed_at?'approved':p.status,points_awarded:p.points_awarded??p.points_requested,director_note:p.removed_at?'':p.director_note},async values=>{
        await checked(supabaseClient.rpc('portal_edit_points',{record_id:id,payload:{...values,operation:removing?'remove':'edit',expected:pointSnapshot(p)}}));
        await refresh();notify(removing?'Points removed. The record and audit history are retained.':'Points updated. The Trailblazer’s total has been recalculated.');
      },removing?`Remove ${p.points_awarded||0} points for ${name(member(p.member_id))} from “${p.activity_name}”. This keeps the history and can be restored.`:'Change the activity, status, or awarded amount. Awards may exceed the original request. Only approved awards count. Saving restores a removed entry.');return;
    }
    if(action==='assign-points'||action==='check-activity'||action==='award-meeting-point') {
      const people=data.members.filter(m=>m.program_status==='active'&&(mode==='admin'||access.assignments.some(a=>a.cohort_id===m.cohort_id&&a.capabilities.includes('points')))).sort((a,b)=>name(a).localeCompare(name(b)));
      if(!people.length)throw new Error('No active Trailblazers are available for point assignment.');
      const request_id=crypto.randomUUID();
      const [chosenMember,chosenRule]=action==='check-activity'?id.split(':'):[];
      const rules=data.point_rules.filter(r=>r.active&&(mode==='admin'||r.completion_source!=='director_meetings')&&(action!=='award-meeting-point'||r.completion_source==='director_meetings'));
      showDialog('Check off an activity',[
        field('member_id','Trailblazer','select',{required:true,options:people.map(m=>[m.id,`${name(m)} · ${data.cohorts.find(c=>c.id===m.cohort_id)?.name||'No cohort'}`])}),
        field('point_rule_id','Activity from points rules','select',{required:true,options:rules.map(r=>[r.id,r.name])}),
        field('activity_date','Activity date','date',{required:true}),
        field('occurrence_count','Events / director meetings verified','number',{required:true,min:1,max:100}),
        field('director_note','Note to Trailblazer (optional)','textarea')
      ],{member_id:chosenMember|| (people.some(m=>m.id===selectedPointsMember)?selectedPointsMember:people[0].id),point_rule_id:chosenRule||'',activity_date:PortalCompletion.today(),occurrence_count:rules.find(r=>r.id===chosenRule)?.required_count||1},async values=>{
        await checked(supabaseClient.rpc('portal_record_activity',{payload:{...values,request_id}}));
        tab='points';selectedPointsCohort='';selectedPointsMember=values.member_id;pointsView='member';
        await refresh();notify('Activity points added. No proof is required.');
      },'The selected activity is approved immediately. Each activity earns one point total per semester. Enter how many GBMs, events, or director meetings you verified. Admins can award the director one-on-one point directly; this does not create individual meeting records.');
      const updateActivities=()=>{
        const selected=$('mf-point_rule_id').value,person=member($('mf-member_id').value);
        const choices=rules.filter(r=>!r.cohort_id||r.cohort_id===person?.cohort_id);
        $('mf-point_rule_id').innerHTML=choices.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
        if(choices.some(r=>r.id===selected))$('mf-point_rule_id').value=selected;
        updateCount();
      };
      const updateCount=()=>{const r=rules.find(r=>r.id===$('mf-point_rule_id').value);$('mf-occurrence_count').max=r?.required_count||1;$('mf-occurrence_count').value=r?.required_count||1;};
      $('mf-member_id').onchange=updateActivities;$('mf-point_rule_id').onchange=updateCount;updateActivities();
      return;
    }
    if(action==='member-preview'){tab='member-preview';render();return;}
    if(action==='refresh-preview'){await refresh();tab='member-preview';render();notify('Preview refreshed.');return;}
    if(action==='view-cohort'){cohort=id;tab='members';if($('managementCohort'))$('managementCohort').value=id;render();return;}
    if(action==='view-one-on-ones'){
      const rows=byMember(data.one_on_ones).filter(o=>o.member_id===id).sort((a,b)=>(b.scheduled_date||'').localeCompare(a.scheduled_date||''));
      details(`${name(member(id))} · One-on-ones`,(mode==='admin'?button('Add a completed one-on-one','record-meeting',id)+button('Open points','points-member',id):'')+table(['Director','Date','Method / location','Status','Actions'],rows.map(o=>[esc(name(data.directors.find(d=>d.id===o.director_id))),date(o.scheduled_date),`${esc(label(o.meeting_method))}<br>${esc(o.location_method||'')}`,badge(o.status),meetingActions(o)]))+'<h3>Change history</h3>'+table(['Previous date','Previous status','Changed'],data.one_on_one_history.filter(o=>o.member_id===id).sort((a,b)=>b.changed_at.localeCompare(a.changed_at)).map(o=>[date(o.scheduled_date),badge(o.previous_status),date(o.changed_at)])));return;
    }
    if(action==='view-announcement'){
      const announcement=data.announcements.find(item=>item.id===id);
      if(!announcement)throw new Error('This announcement is no longer available. Refresh the list and try again.');
      details(announcement.title,`<p class="director-announcement-detail-meta">${esc(announcement.audience==='directors'?'Directors only':'All Trailblazers')} · Published ${date(announcement.publish_at)}</p><div class="director-announcement-detail-body">${esc(announcement.body||'')}</div>${flyerLink(announcement)}${announcement.expires_at?`<p>Available through ${date(announcement.expires_at)}.</p>`:''}`);
      if(mode==='director'&&allowed('content')&&announcement.cohort_id===cohort){
        const remove=document.createElement('button');remove.type='button';remove.className='secondary-button director-announcement-delete';remove.textContent='Delete announcement';
        $('managementDialogFields').append(remove);
        remove.onclick=async()=>{
          if(!confirm('Delete this announcement for the cohort?'))return;
          remove.disabled=true;
          try{
            await mutate('announcement',id,{cohort_id:announcement.cohort_id,title:announcement.title,body:announcement.body,publish_at:announcement.publish_at,expires_at:announcement.expires_at,audience:announcement.audience,pinned:announcement.pinned,active:false});
            $('managementDialog').close();await refresh();notify('Announcement deleted.');
          }catch(error){$('managementDialogMessage').textContent=error.message;remove.disabled=false;}
        };
      }
      return;
    }
    if(action==='excuse-detail'){
      const r=(data.excuse_submissions||[]).find(item=>item.id===id);
      if(!r)throw new Error('This excuse form is no longer available. Refresh the list and try again.');
      const url=r.proof_path?await fileURL(r.proof_path):null;
      const isPDF=String(r.proof_path||'').toLowerCase().endsWith('.pdf');
      details(`${name(member(r.member_id))} · Excuse form`,
        `<p><strong>${esc(label(r.absence_type))}</strong> · ${date(r.missed_at)}</p><p><strong>Reason</strong></p><div class="director-announcement-detail-body">${esc(r.reason||'')}</div><p>Submitted ${date(r.submitted_at)}${r.notified_director_id?` · Director notified: ${esc(name(data.directors.find(d=>d.id===r.notified_director_id)))}`:''}</p>${url?`${isPDF?`<iframe class="evidence-pdf-preview" title="Excuse form proof" src="${esc(url)}"></iframe>`:''}<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open supporting proof</a></p>`:'<p>No proof file is available.</p>'}`);
      return;
    }
    if(action==='toggle-closed-directors'){showClosedDirectors=!showClosedDirectors;render();return;}
    if(action==='points-document') { await pointsDocument(); return; }
    if(action==='upload-points-document') {
      showDialog('Upload points rules',[],{},null);
      $('managementDialogFields').innerHTML='<label>Rules PDF (up to 50 MB)<input id="rulesPDF" type="file" accept="application/pdf,.pdf"></label><p id="rulesStatus" role="status"></p>';
      $('rulesPDF').onchange=async e=>{const file=e.target.files[0];if(!file)return;e.target.disabled=true;try{
        if(file.type!=='application/pdf'||file.size>50*1024*1024)throw new Error('Choose a PDF up to 50 MB.');
        const path=`points/${crypto.randomUUID()}.pdf`;
        await checked(supabaseClient.storage.from('portal-documents').upload(path,file,{contentType:'application/pdf'}));
        try { await checked(supabaseClient.rpc('portal_points_document',{operation:'save',path})); }
        catch(error){await supabaseClient.storage.from('portal-documents').remove([path]);throw error;}
        $('rulesStatus').textContent='Saved. Members and directors can now open this document.';
      }catch(error){$('rulesStatus').textContent=error.message;}finally{e.target.disabled=false;}};
      return;
    }
    if (action === 'close-director') {
      const director=data.directors.find(d=>d.id===id); if(!director) throw new Error('Director not found.');
      if(!confirm(`Close ${name(director)}'s director account? Their records will be preserved.`)) return;
      await checked(supabaseClient.rpc('portal_close_director',{director_id:id}));
      await refresh(); notify('Director account closed. Records were preserved.'); return;
    }
    if (action === 'quick-points') { tab='points'; render(); return; }
    if (action === 'quick-resumes') { tab='resumes'; render(); return; }
    if (action === 'reset-all-points' || action === 'reset-member-points') {
      if (!access.is_admin || mode !== 'admin') throw new Error('Administrator access required');
      const one = action === 'reset-member-points';
      showDialog(one ? 'Reset one Trailblazer’s points' : 'Reset all active Trailblazers’ points', [
        ...(one ? [field('member_id','Trailblazer','select',{required:true,options:[['','Choose a member'],...options(data.members.filter(m=>m.program_status==='active'))]})] : []),
        field('confirmation','Type RESET to confirm','text',{required:true})
      ], {}, async v => {
        if(v.confirmation !== 'RESET') throw new Error('Type RESET to confirm.');
        const count = await checked(supabaseClient.rpc('portal_reset_points',{target_member:one?v.member_id:null,confirmation:v.confirmation}));
        await refresh(); notify(`Points reset. ${count} awarded submissions updated.`);
      }, 'Clears awarded points to zero. Submissions, evidence and audit history are retained; pending reviews are unchanged. All active includes every cohort, regardless of the current filter.');
      return;
    }
    if(await PortalAssignments.action(action,id,context()))return;
    if(await PortalInventory.action(action,id,context()))return;
    let r;
    if (action==='member-detail') {
      r=member(id);const s=stats(r);
      details(name(r),`<p>${esc(r.uf_email||'')} · ${esc(r.phone||'')}</p><p>${s.approved} approved points · ${s.pending} pending · ${s.strikes} active strikes</p><p>Points requirement: ${s.pointsMet?'Complete':'Incomplete'}. Meetings: ${s.completed}/${s.required}${!s.required?' (no current director assignments)':''}.</p><h3>One-on-one history</h3>`+table(['Director','Date','Status'],data.one_on_ones.filter(o=>o.member_id===id).map(o=>[esc(name(data.directors.find(d=>d.id===o.director_id))),date(o.scheduled_date),badge(o.status)]))+`<h3>Strike history</h3>`+table(['Date','Reason','Status'],data.strikes.filter(o=>o.member_id===id).map(o=>[date(o.issued_at),esc(o.reason),badge(o.status)])));
    } else if (action==='point-detail') {
      r=data.point_submissions.find(p=>p.id===id);
      const url=r.evidence_path?await fileURL(r.evidence_path):safeURL(r.evidence_drive_url);
      const pdfPath=String(r.evidence_path||'');
      const pdfURL=url?new URL(url,location.href).pathname.toLowerCase().endsWith('.pdf'):false;
      const isPDF=/\.pdf(?:$|[?#])/i.test(pdfPath)||pdfURL;
      details(r.activity_name,`<p>${esc(r.description||'')}</p><p>${esc(r.director_note||'No review note.')}</p><p>${r.points_awarded??0} points awarded</p><p>${r.director_assigned?'Assigned':'Reviewed'} by ${esc(r.reviewer_name||name(data.directors.find(d=>d.id===r.reviewed_by)))} · ${date(r.reviewed_at)}</p>${url?`${isPDF?`<iframe class="evidence-pdf-preview" title="Point submission PDF evidence" src="${esc(url)}"></iframe>`:''}<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open evidence in a new tab</a></p>`:r.director_assigned?'<p>Director assigned — no proof required.</p>':'<p>No evidence attached.</p>'}`);
    } else if (action==='review-points') {
      r=data.point_submissions.find(p=>p.id===id);
      const person=member(r.member_id),rules=data.point_rules.filter(x=>x.active&&(!x.cohort_id||x.cohort_id===person.cohort_id)&&x.completion_source!=='director_meetings');
      showDialog(`Review: ${r.activity_name}`,[field('status','Decision','select',{options:[['approved','Approve'],['denied','Reject'],['needs_review','Needs review']]}),field('point_rule_id','Activity being completed','select',{options:[['','Select activity'],...rules.map(x=>[x.id,x.name])]}),field('occurrence_count','Number of events verified','number',{required:true,min:1,max:3}),field('director_note','Review note','textarea')],{status:'approved',point_rule_id:r.point_rule_id||rules.find(x=>x.name===r.activity_name)?.id||'',occurrence_count:r.occurrence_count||1},async v=>{await checked(supabaseClient.rpc('portal_review_activity',{record_id:id,payload:v}));await refresh();});
    } else if (action==='edit-meeting') {
      r=data.one_on_ones.find(o=>o.id===id);
      if(r.status==='completion_pending')return action('reject-meeting',id);
      showDialog('Manage one-on-one',[field('status','Status','select',{options:[['scheduled','Schedule / reschedule'],['completed','Completed'],['canceled','Canceled'],['reschedule_needed','Reschedule needed']]}),field('scheduled_date','Date and time','datetime-local'),field('location_method','In-person location'),field('admin_note','Meeting note','textarea')],r,v=>saveAndRefresh('one_on_one',id,v),'Times use your device time zone. Closed meetings remain in history.');
    } else if (action==='add-event'||action==='edit-event') {
      r=id?data.meetings.find(e=>e.id===id):{cohort_id:cohort,active:true};
      showDialog('Calendar event',[cohortField(!!id),field('title','Title','text',{required:true}),field('event_category','Category','select',{options:[['tb_event','Trailblazers'],['nsbe_event','NSBE']]}),boolField('all_day','All-day event',false),field('all_day_start','All-day start date','date'),field('all_day_end','All-day last date (inclusive)','date'),field('start_time','Timed event starts','datetime-local'),field('end_time','Timed event ends','datetime-local'),field('location','Location'),boolField('location_tbd','Location TBD',false),field('meeting_type','Meeting type'),field('dress_code','Dress code'),field('what_to_bring','What to bring'),field('description','Description','textarea'),boolField('active','Active (uncheck to cancel)'),boolField('notify_members','Notify members about this event')],r,async v=>{if(!v.all_day&&!v.start_time)throw new Error('Enter the start date and time.');await checked(supabaseClient.rpc('portal_save_event',{record_id:id||null,payload:v}));await refresh();},'For an all-day event, enter calendar dates. Otherwise enter start and end times in your device time zone. Uncheck Notify members to save without an announcement notification or email. Scheduled reminders follow the portal’s reminder settings.');
    } else if (action==='add-strike') {
      showDialog('Add strike',[field('member_id','Member','select',{required:true,options:options(scoped(data.members).filter(m=>m.program_status==='active'))}),field('reason','Reason','textarea',{required:true}),field('issued_at','Date and time','datetime-local',{required:true}),field('staff_note','Additional note','textarea')],{issued_at:new Date().toISOString()},v=>saveAndRefresh('strike',null,v));
    } else if (action==='remove-strike') {
      showDialog('Remove or correct strike',[field('status','Resolution','select',{options:[['resolved','Resolved'],['removed','Removed / correction']]}),field('resolution_note','Resolution note','textarea',{required:true})],{},v=>saveAndRefresh('strike',id,v),'The original record will remain in history. For a correction, remove this strike and add the corrected record.');
    } else if (action==='resume-file') await openFile(data.resume_submissions.find(r=>r.id===id).file_path);
    else if (action==='review-resume') {
      r=data.resume_submissions.find(r=>r.id===id);
      if (!r || r.status === 'reviewed') {
        await refresh();
        notify(r ? 'This resume has already been reviewed. The list has been refreshed.' : 'This resume submission is no longer available. The list has been refreshed.', true);
        return;
      }
      showDialog('Resume review',[field('status','Status','select',{options:[['under_review','Under review'],['reviewed','Reviewed']]}),field('feedback','Feedback','textarea')],{...r,status:'under_review'},v=>saveAndRefresh('resume_review',id,v));
    } else if (action==='add-content'||action==='edit-content') {
      const announcement=tab==='announcements'; r=id?data[tab].find(r=>r.id===id):{cohort_id:cohort,active:true,publish_at:new Date().toISOString()};
      const fields=[cohortField(!!id),field('title','Title','text',{required:true})];
      if (announcement) {
        fields.push(field('body','Message','textarea',{required:true}),field('publish_at','Publish at','datetime-local',{required:true}),field('expires_at','Expires at','datetime-local'),field('audience','Audience','select',{options:[['members','Members'],['directors','Directors only']]}),boolField('pinned','Pin announcement',false));
        fields.push(field('flyer_file','Attach a flyer','file',{accept:'application/pdf,image/jpeg,image/png,image/webp',currentURL:r.attachment_path?publicFlyerUrl(r.attachment_path):'',currentName:r.attachment_name||'Current flyer'}));
        if(r.attachment_path)fields.push(boolField('remove_flyer','Remove current flyer',false));
      }
      else fields.push(field('category','Category'),field('description','Description','textarea'),field('external_url','Resource or Drive link','url',{required:true}),boolField('featured','Featured',false),field('display_order','Display order','number',{default:0,required:true}));
      fields.push(boolField('active','Published (uncheck to archive)'));
      showDialog(`${id?'Edit':'Create'} ${announcement?'announcement':'resource'}`,fields,r,v=>announcement?saveAnnouncementWithFlyer(id,v,r):saveAndRefresh('resource',id,v));
    } else if (action==='add-cohort'||action==='edit-cohort') {
      r=id?data.cohorts.find(c=>c.id===id):{};
      const fields=[field('name','Cohort name','text',{required:true}),field('point_requirement','Required points','number',{required:true,min:1,default:10})];
      if(!id) fields.push(field('class_number','Class number','number',{required:true,min:1}),field('start_date','Start date','date'),field('end_date','End date','date'));
      else fields.push(field('status','Status','select',{options:[['active','Active'],['archived','Archived']]}));
      showDialog('Manage cohort',fields,{...r,point_requirement:r.point_requirement??data.portal_settings?.find(s=>s.setting_key==='point_requirement')?.setting_value?.value??10},v=>saveAndRefresh('cohort',id,v),'Archiving preserves all records, archives active members, and ends director assignments. Reactivating a cohort does not automatically reactivate its members or assignments.');
    } else if (action==='add-member'||action==='edit-member') {
      r=id?member(id):{cohort_id:cohort};
      const fields=[field('first_name','First name','text',{required:true}),field('last_name','Last name','text',{required:true}),field('preferred_name','Preferred name'),field('uf_email','UF / account email','email',{required:true}),cohortField(!!id)];
      if(id)fields.push(field('program_status','Status','select',{options:['active','inactive','archived'].map(v=>[v,label(v)])}));
      showDialog('Trailblazer roster',fields,r,v=>saveAndRefresh('member',id,v),'Create the roster record first, then use Invite / connect. Changing the contact email does not change an existing account login.');
    } else if (action==='add-director'||action==='edit-director') {
      r=id?data.directors.find(d=>d.id===id):{};
      showDialog('Director identity',[field('first_name','First name','text',{required:true}),field('last_name','Last name','text',{required:true}),field('email','Account email','email',{required:true}),field('title','Title'),field('role','Role'),boolField('active','Active')],r,v=>saveAndRefresh('director',id,v));
    } else if (action==='add-assignment'||action==='edit-assignment') {
      r=id?data.director_assignments.find(a=>a.id===id):{cohort_id:cohort,capabilities:capabilities.filter(c=>c!=='care')};
      const fields=[field('director_id','Director','select',{readonly:!!id,required:true,options:options(data.directors.filter(d=>d.active))}),cohortField(!!id),field('title','Assignment title','text',{required:true}),field('start_date','Starts','date'),field('end_date','Ends','date'),boolField('active','Active'),...capabilities.map(c=>boolField(`cap_${c}`,`May manage ${c}`,r.capabilities.includes(c)))];
      showDialog('Director assignment',fields,r,async v=>{v.capabilities=capabilities.filter(c=>v[`cap_${c}`]);await saveAndRefresh('assignment',id,v);},'One assignment per director per cohort. End a previous assignment and create a new one for the next cohort.');
    } else if (action==='manage-admin') {
      showDialog('Administrator access',[field('email','Verified account email','email',{required:true}),boolField('active','Grant access (uncheck to revoke)')],{},v=>saveAndRefresh('admin',null,v));
    } else if (action==='add-setting'||action==='edit-setting') {
      r=id?data.portal_settings.find(s=>s.id===id):{setting_value:{}};
      showDialog('Portal setting',[field('setting_key','Key','text',{required:true,readonly:!!id}),field('setting_value','Value (JSON)','json',{required:true}),field('description','Description')],r,v=>saveAndRefresh('settings',id,v),'Cohort point requirements are configured under Cohorts. Other settings only affect features that explicitly read their key.');
    } else if (action==='audit-detail') {
      r=data.audit.find(a=>a.id===id);details('Change history',`<pre>${esc(JSON.stringify(r.details,null,2))}</pre>`);
    } else if (action==='invite-member'||action==='invite-director') {
      const kind=action==='invite-member'?'member':'director';r=kind==='member'?member(id):data.directors.find(d=>d.id===id);
      if(r.auth_user_id) { details('Account connected','<p>This identity is already linked. The user can use Forgot password on the sign-in page.</p>');return; }
      showDialog('Invite or connect account',[],{},async()=>{const result=await checked(supabaseClient.functions.invoke('invite-portal-user',{body:{kind,id,redirect_to:location.origin+location.pathname}}));await refresh();notify(result.existing_account?`A secure sign-in link was sent to ${r.uf_email||r.email}.`:`A setup invitation was sent to ${r.uf_email||r.email}. Check the inbox and spam folder.`);},`Send a secure setup or sign-in link to ${r.uf_email||r.email}. They choose their own password.`);
    }
  }
  function watchAdmin() {
    if (!supabaseClient.channel || adminChannel) return;
    adminRealtimeStatus='CONNECTING';
    adminChannel=supabaseClient.channel('admin-member-portal-preview');
    for (const table of ['members','point_submissions','one_on_ones','strikes','meetings','announcements','resources','resume_submissions','excuse_submissions']) {
      adminChannel.on('postgres_changes',{event:'*',schema:'public',table},()=>{
        clearTimeout(adminRefreshTimer);
        adminRefreshTimer=setTimeout(()=>{if(['admin','director'].includes(mode)&&!$('managementShell').hidden)refresh();},500);
      });
    }
    adminChannel.subscribe(status=>{
      adminRealtimeStatus=status;
      if(mode==='admin'&&tab==='member-preview'&&!$('managementShell').hidden)render();
    });
  }
  async function show(which='director',initialTab='overview') {
    ++portalNavigationVersion;
    mode=which;tab=initialTab;cohort='';selectedPointsCohort='';selectedPointsMember='';pointsView='overview';$('managementSearch').value='';
    loginPage.style.display='none';dashboard.style.display='none';directorDashboard.style.display='none';
    $('managementShell').hidden=false;$('managementTitle').textContent=mode==='admin'?'Admin Portal':'Director Management';
    $('managementMemberView').hidden=false; $('managementMemberView').textContent=which==='admin'?'Preview member portal':'Member portal'; $('managementAdminView').hidden=which==='admin'||!access.is_admin;
    $('managementDirectorView').hidden=which==='director'||!access.assignments.length;
    await refresh();
    if ((which==='admin' && access.is_admin) || (which==='director' && access.assignments.length)) watchAdmin();
  }
  async function manageMeeting(id) {
    await show('director','meetings');
    if (!data.one_on_ones.some(o => o.id === id && o.director_id === currentDirector?.id)) throw new Error('This one-on-one is not assigned to your account.');
    return action('edit-meeting',id);
  }
  function hide(){ ++generation;$('managementShell').hidden=true;clearTimeout(adminRefreshTimer);if(adminChannel){supabaseClient.removeChannel(adminChannel);adminChannel=null;}adminRealtimeStatus='CLOSED'; }
  async function upload(file, kind, payload={}) {
    if(!file)throw new Error('Choose a file.');
    if(file.size>10*1024*1024)throw new Error('Maximum file size is 10 MB.');
    const types=kind==='resume'?['application/pdf']:['image/jpeg','image/png','image/webp'];
    if(!types.includes(file.type))throw new Error(kind==='resume'?'Use a PDF resume.':'Use a JPG, PNG, or WebP picture.');
    const user=await checked(supabaseClient.auth.getUser());
    const ext={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
    const path=`${user.user.id}/${crypto.randomUUID()}.${ext}`;
    await checked(supabaseClient.storage.from('trailblazers-private').upload(path,file,{contentType:file.type,upsert:false}));
    try { return await checked(supabaseClient.rpc('portal_submit_file',{kind,path,filename:file.name,payload})); }
    catch(e){ await supabaseClient.storage.from('trailblazers-private').remove([path]);throw e; }
  }
  async function submitPoints(event) {
    event.preventDefault();const form=event.currentTarget;const b=form.querySelector('button[type=submit]');if(b.disabled)return;b.disabled=true;
    try{
      if(!$('activityRule').value)throw new Error('Select an activity from the points rules.');
      const submissionId=await upload($('pointEvidence').files[0],'points',{activity_name:$('activityName').value.trim(),activity_date:$('activityDate').value,description:$('activityDescription').value,points_requested:1,category:$('pointCategory').value,point_rule_id:$('activityRule').value,occurrence_count:Number($('activityCount').value),request_id:submissionKey});
      submissionKey=crypto.randomUUID();form.reset();await refreshMemberData();
      const card=$('pointFormCard');if(card){card.style.display='none';card.classList.remove('form-open');}
      $('pointUploadMessage').textContent='';
    }catch(e){$('pointUploadMessage').textContent=e.message;}finally{b.disabled=false;}
  }
  function updateExcuseNotice() {
    const at=$('excuseMissedAt')?.value||'';
    const required=PortalUtils.requiresDirectorNotice(at);
    const wrapper=$('excuseDirectorNotice'),select=$('excuseNotifiedDirector');
    wrapper.hidden=!required;select.required=required;
    if(!required)select.value='';
  }
  async function loadExcuseOptions() {
    if(!currentMember||currentMember.program_status!=='active')throw new Error('Only active Trailblazers can submit an excuse form.');
    const rows=await checked(supabaseClient.rpc('portal_excuse_director_options'));
    excuseDirectorLabels=new Map(rows.map(d=>[d.director_id,d.display_name]));
    $('excuseNotifiedDirector').innerHTML='<option value="">Select the director you notified</option>'+rows.map(d=>`<option value="${esc(d.director_id)}">${esc(d.display_name)}</option>`).join('');
  }
  async function refreshExcuseHistory() {
    if(!currentMember)return;
    const rows=await checked(supabaseClient.from('excuse_submissions').select('id,absence_type,missed_at,reason,submitted_at,notified_director_id').eq('member_id',currentMember.id).order('submitted_at',{ascending:false}));
    $('memberExcuseHistory').innerHTML=rows.length?table(['Request','Date / time missed','Submitted','Director notified'],rows.map(r=>[esc(label(r.absence_type)),date(r.missed_at),date(r.submitted_at),r.notified_director_id?esc(excuseDirectorLabels.get(r.notified_director_id)||'Director notified'):'—'])):'<p>You have not submitted an excuse form yet.</p>';
  }
  async function loadExcuseForm() {
    const input=$('excuseMissedAt');
    if(input){const offset=new Date().getTimezoneOffset();input.min=new Date(Date.now()-offset*60000).toISOString().slice(0,16);}
    updateExcuseNotice();
    try{await loadExcuseOptions();await refreshExcuseHistory();}
    catch(error){$('excuseFormMessage').textContent=error.message;}
  }
  async function submitExcuse(event) {
    event.preventDefault();const form=event.currentTarget,b=form.querySelector('button[type=submit]');if(b.disabled)return;b.disabled=true;
    const status=$('excuseFormMessage');status.classList.remove('is-error');status.textContent='';
    let path=null;
    try{
      const file=$('excuseProof').files[0],type=$('excuseType').value,missedValue=$('excuseMissedAt').value,reason=$('excuseReason').value.trim();
      if(!file)throw new Error('Upload proof of your reason.');
      if(file.size>10*1024*1024)throw new Error('Proof must be 10 MB or smaller.');
      const ext={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
      if(!ext)throw new Error('Use a PDF, JPG, PNG, or WebP proof file.');
      const missedAt=new Date(missedValue);
      if(!missedValue||Number.isNaN(missedAt.getTime()))throw new Error('Enter the date and time you will be missing.');
      if(missedAt.getTime()<=Date.now())throw new Error('Choose a future date and time.');
      const requiresDirector=PortalUtils.requiresDirectorNotice(missedAt);
      const directorId=$('excuseNotifiedDirector').value||null;
      if(requiresDirector&&!directorId)throw new Error('Select the director you notified because this is less than 24 hours in advance.');
      const user=await checked(supabaseClient.auth.getUser());
      if(!user.user)throw new Error('Sign in again before submitting this form.');
      path=`${user.user.id}/excuses/${crypto.randomUUID()}.${ext}`;
      await checked(supabaseClient.storage.from('trailblazers-private').upload(path,file,{contentType:file.type,upsert:false}));
      await checked(supabaseClient.rpc('portal_submit_excuse',{p_absence_type:type,p_missed_at:missedAt.toISOString(),p_reason:reason,p_proof_path:path,p_notified_director_id:directorId}));
      path=null;
      form.reset();updateExcuseNotice();
      status.textContent='Excuse form submitted. Your response and proof are saved securely.';
      try{await refreshExcuseHistory();}catch(error){status.textContent+=` Your form was saved, but the history could not refresh: ${error.message}`;}
    }catch(error){
      if(path)await supabaseClient.storage.from('trailblazers-private').remove([path]);
      status.textContent=error.message;status.classList.add('is-error');
    }finally{b.disabled=false;}
  }
  async function refreshResume() {
    if(!currentMember)return;
    await PortalInventory.refreshMember();
    try{
      const rows=await checked(supabaseClient.from('resume_submissions').select('*').eq('member_id',currentMember.id).order('submitted_at',{ascending:false}));
      const submitter=`${currentMember.preferred_name||currentMember.first_name||'You'} ${currentMember.last_name||''}`.trim();
      $('memberResumeHistory').innerHTML=rows.length?table(['Submitted by','Submitted','File','Status','Feedback'],rows.map(r=>[esc(submitter),date(r.submitted_at),esc(r.file_name),badge(r.status),esc(r.feedback||'Feedback will appear here.')])):'<p>Awaiting submission. Upload a PDF to request a review.</p>';
    }catch(e){$('memberResumeHistory').textContent=e.message;}
  }
  function init(){
    const shell=document.createElement('section');shell.id='managementShell';shell.className='management-shell';shell.hidden=true;
    shell.innerHTML=`<header class="management-header"><div><p class="eyebrow">TRAILBLAZERS · OPERATIONS</p><h1 id="managementTitle">Management</h1></div><div class="management-actions"><button type="button" class="secondary-button" id="managementMemberView">Preview member portal</button><button type="button" class="secondary-button" id="managementDirectorView">Director dashboard</button><button type="button" class="secondary-button" id="managementAdminView" hidden>Admin portal</button><button type="button" class="secondary-button" id="managementLogout">Sign out</button></div></header><div class="management-toolbar"><label>Cohort <select id="managementCohort"></select></label><input id="managementSearch" type="search" aria-label="Search records" placeholder="Search records…"><button type="button" class="secondary-button" id="managementRefresh">Refresh</button></div><p id="managementMessage" class="management-message" role="status" aria-live="polite"></p><div class="management-layout"><nav id="managementNav" class="management-nav" aria-label="Management"></nav><main id="managementContent" class="management-content"></main></div>`;
    document.body.append(shell);
    updateManagementNav=window.PortalNav?.attach($('managementNav'),'management-nav-rail')||updateManagementNav;
    const dialog=document.createElement('dialog');dialog.id='managementDialog';dialog.className='management-dialog';dialog.setAttribute('aria-labelledby','managementDialogTitle');
    dialog.innerHTML='<h2 id="managementDialogTitle"></h2><p id="managementDialogIntro"></p><form id="managementDialogForm"><div id="managementDialogFields" class="stacked-form"></div><p id="managementDialogMessage" class="management-message error" role="alert"></p><div class="management-actions"><button type="submit" id="managementDialogSave" class="primary-button">Save</button><button type="button" id="managementDialogClose" class="secondary-button">Close</button></div></form>';
    document.body.append(dialog);
    $('managementDialogClose').onclick=()=>dialog.close();dialog.addEventListener('close',()=>returnFocus?.focus());
    $('managementDialogForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const b=$('managementDialogSave');if(b.disabled)return;b.disabled=true;try{await dialogSave?.(form);dialog.close();}catch(err){$('managementDialogMessage').textContent=err.message;}finally{b.disabled=false;}};
    $('managementNav').onclick=e=>{
      const b=e.target.closest('[data-tab],[data-section]');if(!b)return;
      const section=adminSections.find(([id])=>id===b.dataset.section);
      const available=section?.[2].filter(id=>mode==='admin'||!['cohorts','directors','assignments','import','director-import','member-preview','admins','templates','audit'].includes(id));
      tab=section?(adminSectionTabs[`${mode}:${section[0]}`]||available[0]):b.dataset.tab;
      $('managementSearch').value='';render();
    };
    $('managementCohort').onchange=e=>{cohort=e.target.value;selectedPointsCohort='';selectedPointsMember='';pointsView='overview';render();};$('managementSearch').oninput=render;$('managementRefresh').onclick=refresh;
    $('managementContent').onclick=async e=>{
      const destination=e.target.closest('[data-tab]');
      if(destination){tab=destination.dataset.tab;$('managementSearch').value='';render();return;}
      const b=e.target.closest('[data-action]');if(!b)return;b.disabled=true;try{await action(b.dataset.action,b.dataset.id);}catch(err){notify(err.message,true);}finally{b.disabled=false;}
    };
    $('managementDialogFields').onclick=async e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action,id=b.dataset.id;$('managementDialog').close();try{await action(a,id);}catch(err){notify(err.message,true);}};
    $('managementMemberView').onclick=async()=>{if(mode==='admin'){tab='member-preview';render();}else if(currentMember){await refreshMemberData();hide();showMemberPortal();}else {hide();await showSharedMemberPortal();}};$('managementDirectorView').onclick=()=>showDirectorPortal();$('managementAdminView').onclick=()=>show('admin');
    $('managementLogout').onclick=logoutPortal;
    $('managementContent').addEventListener('change',e=>{
      if (e.target.form?.id==='staffNotificationForm' && e.target.name==='email_enabled') $('staffNotificationCategories').disabled=!e.target.checked;
    });
    $('managementContent').addEventListener('submit',async e=>{
      if (e.target.id!=='staffNotificationForm') return;
      e.preventDefault();
      const form=e.target, save=form.querySelector('button[type="submit"]'), message=$('staffNotificationMessage');
      if (save.disabled || !preferencesUserId) return;
      const payload={user_id:preferencesUserId};
      for (const key of ['email_enabled',...notificationOptions.map(([key])=>key)]) payload[key]=form.elements.namedItem(key).checked;
      save.disabled=true;message.textContent='Saving…';message.classList.remove('error');
      try {
        const saved=await checked(supabaseClient.from('staff_notification_preferences').upsert(payload,{onConflict:'user_id'}).select('*').single());
        if (!saved) throw new Error('Settings were not saved. Refresh and try again.');
        if (preferencesUserId===saved.user_id) notificationPreferences=saved;
        message.textContent='Notification settings saved.';
      } catch (err) {message.textContent=err.message;message.classList.add('error');}
      finally {save.disabled=false;}
    });
    $('managementContent').addEventListener('change',async e=>{if(e.target.id==='memberPreviewSelect'){previewMemberId=e.target.value;render();return;}if(e.target.id!=='rosterCSV')return;try{
      const file=e.target.files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error('Import must be under 5 MB.');
      const rows=PortalUtils.validateRoster(PortalUtils.parseCSV(await PortalSpreadsheet.read(file)),data.cohorts,data.members);
      $('rosterPreview').innerHTML=`<p>${rows.length} valid members ready to import. Existing records will not be overwritten.</p>`+table(['Name','Email'],rows.map(r=>[esc(name(r)),esc(r.uf_email)]))+'<button type="button" id="commitRoster" class="primary-button">Import validated roster</button>';
      $('commitRoster').onclick=async()=>{const b=$('commitRoster');b.disabled=true;try{await mutate('import',null,{rows});await refresh();notify(`Imported ${rows.length} members. Use Members → Invite / connect to set up their accounts.`);}catch(err){notify(err.message,true);b.disabled=false;}};
    }catch(err){$('rosterPreview').textContent=err.message;}});
    $('managementContent').addEventListener('change',e=>{if(e.target.id==='pointsCohortSelect'){selectedPointsCohort=e.target.value;selectedPointsMember='';pointsView='overview';render();}else if(e.target.id==='pointsMemberSelect'){selectedPointsMember=e.target.value;pointsView='member';render();}});
    $('managementContent').addEventListener('click',e=>{const b=e.target.closest('[data-sort-column]');if(!b)return;const table=b.closest('table'),body=table?.tBodies[0];if(!body)return;const index=Number(b.dataset.sortColumn),ascending=b.dataset.direction!=='asc';b.dataset.direction=ascending?'asc':'desc';b.setAttribute('aria-sort',ascending?'ascending':'descending');[...table.querySelectorAll('.table-sort')].filter(x=>x!==b).forEach(x=>{delete x.dataset.direction;x.removeAttribute('aria-sort');});const rows=[...body.rows].sort((a,z)=>a.cells[index].textContent.trim().localeCompare(z.cells[index].textContent.trim(),undefined,{sensitivity:'base',numeric:true})*(ascending?1:-1));rows.forEach(row=>body.append(row));});
    for(const root of [dashboard,directorDashboard]){
      const nav=root?.querySelector('nav')||root?.querySelector('aside');if(!nav)continue;
      const entries=root===directorDashboard?[['director','Announcements','announcements'],['director','Review points','points'],['director','Resume reviews','resumes'],['director','Settings','settings'],['admin','Admin Portal','overview']]:[['admin','Admin Portal','overview']];
      for(const [kind,title,target] of entries){const b=document.createElement('button');b.type='button';b.className='nav-link';b.textContent=title;b.dataset.openManagement=kind;b.hidden=true;b.onclick=()=>show(kind,target);nav.append(b);}
    }
    const resume=document.createElement('section');resume.className='dashboard-card management-resume';resume.innerHTML='<h2>Resume review</h2><p>Upload a PDF up to 10 MB. Only you and authorized reviewers can access it.</p><form id="memberResumeForm"><label>Resume PDF<input id="memberResumeFile" type="file" accept="application/pdf,.pdf" required></label><button type="submit" class="primary-button">Submit for review</button></form><p id="memberResumeMessage" role="status"></p><div id="memberResumeHistory"></div>';
    $('resourcesPage').append(resume);
    $('memberResumeForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const b=form.querySelector('button');b.disabled=true;try{await upload($('memberResumeFile').files[0],'resume');form.reset();$('memberResumeMessage').textContent='Resume submitted.';await refreshResume();}catch(err){$('memberResumeMessage').textContent=err.message;}finally{b.disabled=false;}};
    $('excuseMissedAt').addEventListener('input',updateExcuseNotice);$('excuseMissedAt').addEventListener('change',updateExcuseNotice);
    $('excuseSubmissionForm').addEventListener('submit',submitExcuse);
    const category=document.createElement('label');category.innerHTML='Category<select id="pointCategory" required><option value="Professional">Professional</option><option value="Academic">Academic</option><option value="Service">Service</option><option value="Social">Social</option><option value="Other">Other</option></select>';
    $('pointSubmissionForm').prepend(category);const msg=document.createElement('p');msg.id='pointUploadMessage';msg.setAttribute('role','status');$('pointSubmissionForm').append(msg);
    $('pointEvidence').accept='.jpg,.jpeg,.png,.webp';
    const ruleButton=document.createElement('button');ruleButton.type='button';ruleButton.className='secondary-button';ruleButton.textContent='Points rules';
    ruleButton.onclick=()=>pointsDocument().catch(error=>details('Points rules',`<p>${esc(error.message)}</p>`));
    $('openPointForm').after(ruleButton);
    const deadline=document.createElement('p');deadline.id='programDeadline';$('pointsPage').querySelector('.page-header').after(deadline);
    initRecovery();
    supabaseClient.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'){
      hide();$('managementDialog').close();$('managementContent').replaceChildren();data={};access={is_admin:false,assignments:[]};
      clearTimeout(refreshTimer);if(memberChannel)supabaseClient.removeChannel(memberChannel);memberChannel=null;channelMemberId=null;
      currentMember=null;currentDirector=null;currentDirectorAssignment=null;
      dashboard.style.display='none';directorDashboard.style.display='none';loginPage.style.display='grid';
    }});
  }
  function initRecovery(){
    const b=document.createElement('button');b.type='button';b.className='secondary-button';b.textContent='Forgot password?';loginForm.append(b);
    b.onclick=async()=>{const email=$('email').value.trim();if(!email){alert('Enter your account email first.');return;}b.disabled=true;try{const result=await checked(supabaseClient.functions.invoke('portal-password-recovery',{body:{email,redirect_to:location.origin+location.pathname}}));alert(result?.message||'If an account matches that email, recovery instructions will be sent.');}catch(e){alert(e.message);}finally{b.disabled=false;}};
    supabaseClient.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')setTimeout(()=>{if(!$('managementDialog').open)passwordDialog();},0);});
    const inviteParams=new URLSearchParams(location.search), inviteToken=inviteParams.get('portal_invite_token')||inviteParams.get('portal_recovery_token'), inviteType=inviteParams.get('portal_invite_type')||(inviteParams.has('portal_recovery_token')?'recovery':null);
    if(inviteToken&&['invite','magiclink','recovery'].includes(inviteType))setTimeout(()=>confirmInvitation(inviteToken,inviteType),250);
    const params=new URLSearchParams(location.hash.replace(/^#/,''));
    if(['invite','recovery'].includes(params.get('type')))setTimeout(()=>passwordDialog(),300);
    if(params.get('error_description'))alert(params.get('error_description'));
  }
  function confirmInvitation(tokenHash,type){
    const title=type==='recovery'?'Reset your password':type==='invite'?'Finish account setup':'Connect your account';
    showDialog(title,[],{},null,'For your security, confirm below to finish verifying this one-time email link.');
    $('managementDialogFields').innerHTML='<p>The email link is ready. Continue to verify your email and '+(type==='recovery'?'set a new password.':'choose a portal password.')+'</p><button type="button" class="primary-button" id="confirmInviteLink">Continue securely</button><p id="inviteLinkMessage" class="management-message" role="status" aria-live="polite"></p>';
    $('confirmInviteLink').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;$('inviteLinkMessage').textContent='Verifying…';
      try{
        const result=await supabaseClient.auth.verifyOtp({token_hash:tokenHash,type});
        if(result.error)throw result.error;
        const clean=new URL(location.href);clean.searchParams.delete('portal_invite_token');clean.searchParams.delete('portal_invite_type');clean.searchParams.delete('portal_recovery_token');history.replaceState(null,'',clean.pathname+clean.search+clean.hash);
        $('managementDialog').close();
        setTimeout(()=>passwordDialog(),100);
      }catch(error){$('inviteLinkMessage').textContent='This link could not be verified. It may have expired or already been used. Ask an administrator to send a fresh link.';button.disabled=false;}
    };
  }
  function passwordDialog(){showDialog('Set your password',[field('password','New password','password',{required:true}),field('confirm','Confirm password','password',{required:true})],{},async v=>{if(v.password.length<12)throw new Error('Use at least 12 characters.');if(v.password!==v.confirm)throw new Error('Passwords do not match.');await checked(supabaseClient.auth.updateUser({password:v.password}));await restoreSession();},'Choose a password only you know.');}
  function watchMember() {
    if (!supabaseClient.channel || !currentMember || channelMemberId === currentMember.id) return;
    if(memberChannel)supabaseClient.removeChannel(memberChannel);
    channelMemberId=currentMember.id;
    memberChannel=supabaseClient.channel(`member-updates-${channelMemberId}`);
    for(const table of ['point_submissions','one_on_ones','strikes','resume_submissions','member_notifications','excuse_submissions']){
      memberChannel.on('postgres_changes',{event:'*',schema:'public',table,filter:`member_id=eq.${channelMemberId}`},()=>{
        clearTimeout(refreshTimer);refreshTimer=setTimeout(async()=>{if(!currentMember)return;await refreshMemberData();await refreshResume();},250);
      });
    }
    for(const table of ['announcements','resources'])memberChannel.on('postgres_changes',{event:'*',schema:'public',table},()=>{
      clearTimeout(refreshTimer);refreshTimer=setTimeout(async()=>{if(currentMember)await refreshMemberData();},250);
    });
    memberChannel.subscribe();
  }
  init();
  PortalInventory.init(context());
  PortalAssignments.init(context());
  return {loadAccess,show,hide,submitPoints,refreshResume,loadExcuseForm,passwordDialog,watchMember,manageMeeting,reportMeeting};
})();
restoreSession().catch(error=>{console.error('Portal startup failed:',error);alert(error.message);});
