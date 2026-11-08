const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseCSV,validateRoster,progress,occursOnDate,calendarBirthdays,upcomingCalendarBirthdays,requiresDirectorNotice}=require('../portal-utils.js');
test('CSV supports BOM, quoted commas, escaped quotes, CRLF, and embedded newlines',()=>{
 const rows=parseCSV('\uFEFFfirst_name,last_name,uf_email,cohort\r\n"Maya, M.","O""Neil",m@example.com,"Class\n5"\r\n');
 assert.equal(rows[0].first_name,'Maya, M.');assert.equal(rows[0].last_name,'O"Neil');assert.equal(rows[0].cohort,'Class\n5');
});
test('CSV rejects malformed data before import',()=>{
 for(const text of ['first_name,last_name,uf_email,cohort\na,b,c','first_name,last_name,uf_email,cohort\n"unterminated','first_name,last_name,uf_email,cohort\n"a"x,b,c,d'])assert.throws(()=>parseCSV(text));
});
const cohorts=[{id:'cohort-5',name:'Class 5',class_number:5,status:'active'}];
const row={first_name:'Maya',last_name:'Smith',uf_email:'MAYA@example.com',cohort:'5',member_id:'TB5'};
test('Roster resolves cohort and normalizes email',()=>assert.deepEqual(validateRoster([row],cohorts,[])[0],{first_name:'Maya',last_name:'Smith',preferred_name:null,uf_email:'maya@example.com',member_id:'TB5',cohort_id:'cohort-5'}));
test('Roster rejects duplicate batch/existing emails, IDs, and archived cohorts',()=>{
 assert.throws(()=>validateRoster([row,row],cohorts,[]),/duplicate email/);
 assert.throws(()=>validateRoster([row],cohorts,[{uf_email:'maya@example.com'}]),/duplicate email/);
 assert.throws(()=>validateRoster([row],cohorts,[{member_id:'TB5'}]),/duplicate member ID/);
 assert.throws(()=>validateRoster([row],[{...cohorts[0],status:'archived'}],[]),/active cohort/);
});
test('Extended roster fields survive import and impossible birthdays are rejected',()=>{
 const extended=validateRoster([{...row,major:'Engineering',graduation_year:'2030',birthday_month:'2',birthday_day:'29',food_allergies:'Test'}],cohorts,[])[0];
 assert.equal(extended.major,'Engineering');assert.equal(extended.graduation_year,2030);assert.equal(extended.food_allergies,'Test');
 assert.throws(()=>validateRoster([{...row,birthday_month:'2',birthday_day:'30'}],cohorts,[]),/birthday/);
 assert.throws(()=>validateRoster([{...row,birthday_month:'2'}],cohorts,[]),/together/);
 assert.throws(()=>validateRoster([{...row,graduation_year:'twenty'}],cohorts,[]),/whole number/);
});
test('Director CSV can use email headings and expired assignments do not count',()=>{
 assert.equal(parseCSV('first_name,last_name,email,cohort\nA,B,a@example.invalid,5',['first_name','last_name','email','cohort'])[0].email,'a@example.invalid');
 const p=progress({id:'m',cohort_id:'c'},[],[],[],[{cohort_id:'c',director_id:'old',active:true,end_date:'2000-01-01'},{cohort_id:'c',director_id:'future',active:true,start_date:'2999-01-01'}]);
 assert.equal(p.required,0);assert.equal(p.meetingsMet,false);
});
test('Only awarded approved points and completed required meetings count',()=>{
 const result=progress({id:'m',cohort_id:'c'},[{member_id:'m',status:'approved',points_awarded:5,points_requested:10},{member_id:'m',status:'pending',points_requested:20},{member_id:'m',status:'submitted',points_requested:7},{member_id:'m',status:'denied',points_awarded:100}],
 [{member_id:'m',director_id:'d',status:'completed'},{member_id:'m',director_id:'d2',status:'canceled'}], [{member_id:'m',status:'removed'}], [{cohort_id:'c',director_id:'d',active:true},{cohort_id:'c',director_id:'d2',active:true}],30);
 assert.deepEqual(result,{approved:5,pending:27,strikes:0,completed:1,required:2,pointsMet:false,meetingsMet:false});
});
test('Multi-day and all-day events appear on the correct dates',()=>{
 assert.equal(occursOnDate('2026-09-22T15:00:00','2026-09-24T00:00:00',new Date(2026,8,23)),true);
 assert.equal(occursOnDate('2026-09-22T15:00:00','2026-09-24T00:00:00',new Date(2026,8,24)),false);
 assert.equal(occursOnDate('2026-09-22T00:00:00Z',null,new Date(2026,8,22),'2026-09-22','2026-09-23'),true);
 assert.equal(occursOnDate('2026-09-22T00:00:00Z',null,new Date(2026,8,21),'2026-09-22','2026-09-23'),false);
});
test('Birthdays repeat yearly without exposing birth year and handle leap day',()=>{
 const events=calendarBirthdays([{member_id:'m1',display_name:'Maya Smith',birthday_month:2,birthday_day:29}],2027,2);
 assert.deepEqual(events.map(event=>[event.title,event.all_day_start,event.is_birthday]),[
  ["Maya Smith's birthday",'2027-02-28',true],
  ["Maya Smith's birthday",'2028-02-29',true]
 ]);
});
test('Upcoming birthday agenda shows only the next occurrence for each person',()=>{
 const events=upcomingCalendarBirthdays([
  {member_id:'passed',display_name:'Ari',birthday_month:3,birthday_day:2},
  {member_id:'future',display_name:'Bea',birthday_month:10,birthday_day:4},
  {member_id:'leap',display_name:'Cam',birthday_month:2,birthday_day:29}
 ],new Date(2026,8,27));
 assert.deepEqual(events.map(event=>[event.member_id,event.all_day_start]),[
  ['future','2026-10-04'],['leap','2027-02-28'],['passed','2027-03-02']
 ]);
 assert.equal(new Set(events.map(event=>event.member_id)).size,events.length);
});
test('Excuse form requires a notified director only inside the 24-hour window',()=>{
 const now=new Date('2026-09-28T12:00:00Z');
 assert.equal(requiresDirectorNotice('2026-09-29T11:59:00Z',now),true);
 assert.equal(requiresDirectorNotice('2026-09-29T12:00:00Z',now),false);
 assert.equal(requiresDirectorNotice('2026-09-28T11:59:00Z',now),true);
 assert.equal(requiresDirectorNotice('not-a-date',now),false);
});
