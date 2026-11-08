/* Activity checklists use the same progress calculation for every portal role. */
window.PortalCompletion = (() => {
  const esc = escapeHTML;
  const today = () => new Date().toLocaleDateString('en-CA', {timeZone:'America/New_York'});
  const termStart = () => today().slice(0,4)+(Number(today().slice(5,7))<=6?'-01-01':'-07-01');
  function checklist(person, rules, submissions, meetings, assignments, controls = false, admin = false) {
    if(person.program_status==='archived')return '<section class="dashboard-card"><h3>Archived progress</h3><p>Completion is preserved in this Trailblazer’s archive snapshot. Historical awards and approvals remain in the ledger below.</p></section>';
    const s = PortalUtils.activityProgress(person, rules, submissions, meetings, assignments);
    const row = r => `<li class="activity-checklist-item"><div><strong>${esc(r.name)}</strong><p>${esc(r.description || '')}</p></div><div><span class="management-badge point-status-${r.complete?'approved':r.pending?'pending':'needs_review'}">${r.complete?'Complete':`${r.count} / ${r.required_count} approved`}</span>${r.pending?'<small>Awaiting approval</small>':''}${controls&&!r.complete&&(admin||r.completion_source!=='director_meetings')?`<button type="button" class="secondary-button" data-action="check-activity" data-id="${esc(person.id+':'+r.id)}">Check off activity</button>`:''}</div></li>`;
    return `<section class="dashboard-card activity-checklist"><h3>Semester activity checklist</h3><p>Complete all 4 required activities, then any 6 different electives. Each activity earns 1 point total. ${s.requiredComplete} / 4 required · ${Math.min(s.electiveComplete,6)} / 6 electives.</p>${!s.configured?'<p class="error">This class needs exactly four required activities configured.</p>':''}<h4>Required activities</h4><ul>${s.activities.filter(r=>r.is_required).map(row).join('')}</ul><details><summary>Choose any six electives · ${Math.min(s.electiveComplete,6)} / 6 complete</summary><ul>${s.activities.filter(r=>!r.is_required).map(row).join('')}</ul></details>${s.unmapped?`<p>${s.unmapped} approved submission(s) need an activity selected before they count toward this checklist.</p>`:''}</section>`;
  }
  async function member() {
    if(!currentMember)return;
    const person=currentMember;
    const result=await supabaseClient.from('point_rules').select('*').eq('active',true).order('name');
    if(result.error)throw result.error;
    if(currentMember?.id!==person.id)return;
    const rules=result.data||[];
    const summary=PortalUtils.activityProgress(person,rules,currentPointSubmissions,currentOneOnOnes,[]);
    if(person.program_status!=='archived'){
      document.querySelectorAll('.points-total').forEach(e=>e.textContent=`${summary.requiredComplete+Math.min(summary.electiveComplete,6)} / 10`);
      document.querySelectorAll('.points-remaining').forEach(e=>e.textContent=summary.pointsMet?'All required activities and six electives complete':`${summary.requiredComplete} / 4 required · ${Math.min(summary.electiveComplete,6)} / 6 electives`);
      document.querySelectorAll('.points-progress').forEach(e=>e.style.width=`${(summary.requiredComplete+Math.min(summary.electiveComplete,6))*10}%`);
    }
    let box=document.getElementById('memberActivityChecklist');
    if(!box){box=document.createElement('div');box.id='memberActivityChecklist';document.querySelector('#pointsPage .points-summary').after(box);}
    box.innerHTML=checklist(person,rules,currentPointSubmissions,currentOneOnOnes,[]);
    const select=document.getElementById('activityRule');
    if(select){
      const selected=select.value;select.required=true;
      select.innerHTML='<option value="">Select an activity from the points rules</option>'+summary.activities.filter(r=>r.completion_source!=='director_meetings').map(r=>`<option value="${esc(r.id)}">${esc(r.name)} (${r.is_required?'Required':'Elective'})</option>`).join('');select.value=selected;
      select.onchange=()=>{
        const r=rules.find(r=>r.id===select.value);if(!r)return;
        document.getElementById('activityName').value=r.name;document.getElementById('pointsRequested').value=1;
        const category=document.getElementById('pointCategory');if(category){if(![...category.options].some(x=>x.value===r.category))category.add(new Option(r.category,r.category));category.value=r.category;}
        const count=document.getElementById('activityCount');count.max=r.required_count||1;count.value=r.required_count||1;
        document.getElementById('activityCountHint').textContent=r.required_count>1?`Submit one event at a time or proof for all ${r.required_count}. The full activity earns one point.`:'This elective counts once per semester.';
      };
    }
    let report=document.getElementById('reportPastOneOnOne');
    if(!report){report=document.createElement('button');report.id='reportPastOneOnOne';report.type='button';report.className='secondary-button';report.textContent='Add a completed one-on-one';document.querySelector('#oneOnOnesPage .page-header').append(report);}
    report.hidden=person.program_status!=='active';report.onclick=()=>PortalManagement.reportMeeting();
  }
  return {checklist,member,today,termStart};
})();
