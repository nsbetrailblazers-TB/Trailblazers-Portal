const {test}=require('node:test');
const assert=require('node:assert/strict');
const {activityProgress}=require('../portal-utils.js');
const m={id:'member',cohort_id:'class'},now=new Date('2026-10-11T16:00:00Z');
const rules=Array.from({length:12},(_,i)=>({id:'r'+i,name:'Activity '+i,cohort_id:'class',active:true,is_required:i<4,required_count:i===0?5:i===2?3:1,completion_source:i===0?'director_meetings':'submission'}));
const meetings=Array.from({length:5},(_,i)=>({member_id:m.id,director_id:'d'+i,status:'completed',completed_date:'2026-09-20T12:00:00Z'}));
const submissions=rules.slice(1,10).map(r=>({member_id:m.id,point_rule_id:r.id,activity_date:'2026-10-01',status:'approved',points_awarded:1,occurrence_count:r.required_count}));
const calc=(rows=submissions,ones=meetings,rs=rules)=>activityProgress(m,rs,rows,ones,[],now);
test('Four required activities and six distinct electives complete the requirement',()=>{const s=calc();assert.equal(s.requiredComplete,4);assert.equal(s.electiveComplete,6);assert.equal(s.pointsMet,true);});
test('Extra elective awards cannot replace a missing requirement',()=>{const s=calc(submissions.filter(p=>p.point_rule_id!=='r1').concat(submissions.filter(p=>p.point_rule_id==='r4').map(p=>({...p,points_awarded:100}))));assert.equal(s.pointsMet,false);assert.equal(s.electiveComplete,6);});
test('Three approved GBMs earn one required point; pending, rejected and removed records do not count',()=>{const base=submissions.filter(p=>p.point_rule_id!=='r2');const gbm=status=>({member_id:m.id,point_rule_id:'r2',activity_date:'2026-10-01',status,points_awarded:1,occurrence_count:1});assert.equal(calc([...base,gbm('approved'),gbm('approved'),gbm('pending'),gbm('denied'),{...gbm('approved'),removed_at:'2026-10-02'}]).requiredComplete,3);assert.equal(calc([...base,gbm('approved'),gbm('approved'),gbm('approved')]).requiredComplete,4);});
test('Director meetings count as one group; a request and duplicate director do not count',()=>{const s=calc(submissions,[...meetings.slice(0,3),meetings[0],{...meetings[3],status:'completion_pending'}]);assert.equal(s.requiredComplete,3);assert.equal(s.pointsMet,false);});
test('Old semester work, other members, other cohorts and unmapped activities do not satisfy the checklist',()=>{const rows=submissions.map(p=>({...p,activity_date:'2026-04-01'}));rows.push({...submissions[0],member_id:'other'},{...submissions[0],point_rule_id:null,activity_name:'Custom',points_awarded:100});const s=calc(rows,meetings.map(o=>({...o,completed_date:'2026-04-01'})),[...rules,{id:'foreign',name:'Foreign',active:true,cohort_id:'other',is_required:true}]);assert.equal(s.pointsMet,false);assert.equal(s.requiredComplete,0);assert.equal(s.unmapped,1);assert.equal(s.activities.length,12);});
test('A class with fewer than four required rules cannot be marked complete',()=>assert.equal(calc(submissions,meetings,rules.filter(r=>r.id!=='r1')).pointsMet,false));

test('Admin one-on-one credit completes the group once and removal restores automatic calculation',()=>{
 const award={member_id:m.id,point_rule_id:'r0',activity_date:'2026-10-01',status:'approved',points_awarded:1,occurrence_count:5,director_assigned:true};
 assert.equal(calc([...submissions,award],[]).requiredComplete,4);
 assert.equal(calc([...submissions,award],meetings).requiredComplete,4);
 for(const change of [{removed_at:'2026-10-02'},{status:'denied'},{points_awarded:0},{activity_date:'2026-04-01'},{member_id:'other'}])assert.equal(calc([...submissions,{...award,...change}],[]).requiredComplete,3);
});
