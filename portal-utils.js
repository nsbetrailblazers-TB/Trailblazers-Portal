(function (root) {
  'use strict';
  function parseCSV(text, required = ['first_name', 'last_name', 'uf_email', 'cohort']) {
    const rows = []; let row = [], cell = '', quoted = false, closed = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') { quoted = false; closed = true; }
        else cell += c;
      } else if (c === '"' && !cell && !closed) quoted = true;
      else if (c === ',' || c === '\n' || c === '\r') {
        row.push(cell.trim()); cell = ''; closed = false;
        if (c !== ',') {
          if (row.some(Boolean)) rows.push(row);
          row = [];
          if (c === '\r' && text[i + 1] === '\n') i++;
        }
      } else {
        if (closed && c.trim()) throw new Error('Unexpected text after a quoted CSV field.');
        cell += c;
      }
    }
    if (quoted) throw new Error('The CSV contains an unclosed quote.');
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    if (!rows.length) throw new Error('The CSV is empty.');
    const headers = rows.shift().map(h => h.toLowerCase().replace(/\s+/g, '_'));
    if (new Set(headers).size !== headers.length) throw new Error('Duplicate column headings.');
    for (const name of required) {
      if (!headers.includes(name)) throw new Error(`Missing column: ${name}`);
    }
    return rows.map((cells, i) => {
      if (cells.length !== headers.length) throw new Error(`Row ${i + 2}: wrong number of columns.`);
      return Object.fromEntries(headers.map((h, j) => [h, cells[j]]));
    });
  }
  function validateRoster(rows, cohorts, members) {
    if (!rows.length || rows.length > 500) throw new Error('Import between 1 and 500 members at a time.');
    const emails = new Set(members.map(m => (m.uf_email || '').trim().toLowerCase()));
    const ids = new Set(members.map(m => m.member_id).filter(Boolean));
    return rows.map((row, index) => {
      const fail = message => { throw new Error(`Row ${index + 2}: ${message}`); };
      const email = (row.uf_email || '').trim().toLowerCase();
      if (!row.first_name?.trim() || !row.last_name?.trim()) fail('first and last name are required.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('invalid email.');
      if (emails.has(email)) fail(`duplicate email: ${email}`);
      if (row.member_id && ids.has(row.member_id)) fail(`duplicate member ID: ${row.member_id}`);
      const matches = cohorts.filter(c => c.status === 'active' && [c.id, c.name, String(c.class_number)].some(v => v?.toLowerCase() === row.cohort?.toLowerCase()));
      if (matches.length !== 1) fail('cohort must match one active cohort name, number, or ID.');
      emails.add(email); if (row.member_id) ids.add(row.member_id);
      const extra = {};
      for (const key of ['nsbe_id','personal_email','phone','preferred_contact_method','major','minor','college','academic_interests','career_interests','research_interests','organizations','leadership_roles','hobbies','skills','linkedin_url','dietary_preference','food_allergies','dietary_restrictions']) if(key in row) extra[key] = row[key] || null;
      for (const key of ['graduation_year','birthday_month','birthday_day']) {
        if (row[key] && !/^\d+$/.test(row[key])) fail(`${key} must be a whole number.`);
        if(key in row) extra[key] = row[key] ? Number(row[key]) : null;
      }
      if (Boolean(extra.birthday_month) !== Boolean(extra.birthday_day)) fail('birthday month and day must be provided together.');
      if (extra.birthday_month) {
        const d = new Date(2000, extra.birthday_month - 1, extra.birthday_day);
        if (extra.birthday_month < 1 || extra.birthday_month > 12 || d.getMonth() !== extra.birthday_month - 1 || d.getDate() !== extra.birthday_day) fail('invalid birthday.');
      }
      return { ...extra, first_name: row.first_name.trim(), last_name: row.last_name.trim(), preferred_name: row.preferred_name || null,
        uf_email: email, member_id: row.member_id || null, cohort_id: matches[0].id };
    });
  }
  function progress(member, points, meetings, strikes, assignments, requirement = 30, rules) {
    const own = points.filter(p => p.member_id === member.id);
    const approved = own.filter(p => p.status === 'approved').reduce((s, p) => s + (Number(p.points_awarded) || 0), 0);
    const today = new Date().toLocaleDateString('en-CA');
    const required = assignments.filter(a => a.cohort_id === member.cohort_id && a.active && (!a.start_date || a.start_date <= today) && (!a.end_date || a.end_date >= today));
    const termStart=today.slice(0,4)+(Number(today.slice(5,7))<=6?'-01-01':'-07-01');
    const completed = new Set(meetings.filter(m => m.member_id === member.id && m.status === 'completed' && (!rules||m.completed_date?.slice(0,10)>=termStart)).map(m => m.director_id));
    const activity=rules?activityProgress(member,rules,points,meetings,assignments):null;
    return { approved:activity?activity.requiredComplete+activity.electiveComplete:approved, pending: own.filter(p => !['approved', 'denied', 'rejected'].includes(String(p.status || '').toLowerCase())).reduce((s, p) => s + Number(p.points_requested), 0),
      strikes: strikes.filter(s => s.member_id === member.id && s.status === 'active').length,
      completed: required.filter(a => completed.has(a.director_id)).length, required: required.length,
      pointsMet: rules ? activityProgress(member,rules,points,meetings,assignments).pointsMet : approved >= requirement, meetingsMet: required.length > 0 && required.every(a => completed.has(a.director_id)) };
  }
  function activityProgress(member, rules, submissions, meetings = [], assignments = [], referenceDate = new Date()) {
    const day=referenceDate.toLocaleDateString('en-CA',{timeZone:'America/New_York'});
    const start=day.slice(0,4)+(Number(day.slice(5,7))<=6?'-01-01':'-07-01');
    const end=day.slice(0,4)+(Number(day.slice(5,7))<=6?'-06-30':'-12-31');
    const inTerm=value=>!!value&&String(value).slice(0,10)>=start&&String(value).slice(0,10)<=end;
    const own=submissions.filter(p=>(!p.member_id||p.member_id===member.id)&&inTerm(p.activity_date));
    const available=rules.filter(r=>r.active&&(!r.cohort_id||r.cohort_id===member.cohort_id));
    const directorIds=new Set(meetings.filter(o=>(!o.member_id||o.member_id===member.id)&&o.status==='completed'&&inTerm(o.completed_date)).map(o=>o.director_id||o.director?.id));
    const assigned=[...new Set(assignments.filter(a=>a.cohort_id===member.cohort_id&&a.active&&(!a.start_date||a.start_date<=day)&&(!a.end_date||a.end_date>=day)).map(a=>a.director_id))];
    const activities=available.map(r=>{
      const matched=own.filter(p=>p.point_rule_id===r.id||(!p.point_rule_id&&p.activity_name?.trim().toLowerCase()===r.name.trim().toLowerCase()));
      const needed=r.completion_source==='director_meetings'?Math.min(5,Math.max(4,assigned.length||meetings.filter(o=>o.director?.active!==false).length)):Number(r.required_count||1);
      const verified=matched.filter(p=>p.status==='approved'&&!p.removed_at&&Number(p.points_awarded)>0).reduce((sum,p)=>sum+Number(p.occurrence_count??r.required_count??1),0);
      const count=r.completion_source==='director_meetings'?Math.max(directorIds.size,verified>=Number(r.required_count||1)?needed:verified):verified;
      return {...r,is_required:r.is_required??r.category==='Required',required_count:needed,count:Math.min(count,needed),complete:count>=needed,pending:matched.some(p=>['pending','needs_review'].includes(p.status)&&!p.removed_at)};
    });
    const requiredComplete=activities.filter(r=>r.is_required&&r.complete).length;
    const electiveComplete=activities.filter(r=>!r.is_required&&r.complete).length;
    const configured=activities.filter(r=>r.is_required).length===4;
    const unmapped=own.filter(p=>p.status==='approved'&&!p.removed_at&&!activities.some(r=>p.point_rule_id===r.id||(!p.point_rule_id&&p.activity_name?.trim().toLowerCase()===r.name.trim().toLowerCase()))).length;
    return {activities,requiredComplete,electiveComplete,configured,unmapped,pointsMet:configured&&requiredComplete===4&&electiveComplete>=6};
  }
  function occursOnDate(start, end, day, allDayStart, allDayEnd) {
    const key = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    if (allDayStart) return key >= allDayStart && key <= (allDayEnd || allDayStart);
    const next = new Date(day.getFullYear(),day.getMonth(),day.getDate()+1);
    const a = new Date(start), b = end ? new Date(end) : a;
    return a < next && (b > day || (!end && a >= day));
  }
  function calendarBirthdays(members, startYear = new Date().getFullYear(), yearCount = 3) {
    const items = [];
    for (const member of members || []) {
      const month = Number(member.birthday_month), birthdayDay = Number(member.birthday_day);
      if (!member.member_id && !member.id || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(birthdayDay) || birthdayDay < 1 || birthdayDay > 31) continue;
      const id = member.member_id || member.id;
      const name = member.display_name || `${member.preferred_name || member.first_name || 'Trailblazer'} ${member.last_name || ''}`.trim();
      for (let year = startYear; year < startYear + yearCount; year++) {
        const day = Math.min(birthdayDay, new Date(year, month, 0).getDate());
        const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        items.push({id:`birthday-${id}-${year}`,member_id:id,title:`${name}'s birthday`,event_category:'tb_event',all_day:true,all_day_start:date,all_day_end:date,start_time:null,end_time:null,is_birthday:true});
      }
    }
    return items;
  }
  function upcomingCalendarBirthdays(members, referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const today = `${year}-${String(referenceDate.getMonth() + 1).padStart(2, '0')}-${String(referenceDate.getDate()).padStart(2, '0')}`;
    const seen = new Set();
    return calendarBirthdays(members, year, 2)
      .filter(event => event.all_day_start >= today)
      .sort((a, b) => a.all_day_start.localeCompare(b.all_day_start))
      .filter(event => {
        if (seen.has(event.member_id)) return false;
        seen.add(event.member_id);
        return true;
      });
  }
  function requiresDirectorNotice(missedAt, referenceDate = new Date()) {
    const missing = new Date(missedAt).getTime();
    const now = new Date(referenceDate).getTime();
    return Number.isFinite(missing) && Number.isFinite(now) && missing - now < 24 * 60 * 60 * 1000;
  }
  const api = { parseCSV, validateRoster, progress, activityProgress, occursOnDate, calendarBirthdays, upcomingCalendarBirthdays, requiresDirectorNotice };
  if (typeof module !== 'undefined') module.exports = api; else root.PortalUtils = api;
})(typeof window === 'undefined' ? {} : window);
