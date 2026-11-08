const {test}=require('node:test');
const assert=require('node:assert/strict');
test('preferences cover workflow and reminder types and reject closed accounts',async()=>{
 const {emailAllowed}=await import('../supabase/functions/send-notification-email/preferences.mjs');
 const m={program_status:'active'};
 assert.equal(emailAllowed(null,{},'system'),false);
 assert.equal(emailAllowed({program_status:'inactive'},{},'system'),false);
 for(const type of ['announcement','resource','one_on_one','event','accountability','system']) assert.equal(emailAllowed(m,{email_enabled:false},type),false);
 assert.equal(emailAllowed(m,{announcement_email_enabled:false},'announcement'),false);
 assert.equal(emailAllowed(m,{resource_email_enabled:false},'resource'),false);
 assert.equal(emailAllowed(m,{meeting_email_enabled:false},'system','oneOnOnes'),false);
 assert.equal(emailAllowed(m,{meeting_email_enabled:false},'system','calendar'),false);
 assert.equal(emailAllowed(m,{meeting_email_enabled:false},'system','points'),true);
 assert.equal(emailAllowed(m,null,'accountability'),true);
});
test('staff preferences map each workflow and preserve default delivery',async()=>{
 const {staffNotificationCategory,staffEmailAllowed}=await import('../supabase/functions/send-notification-email/preferences.mjs');
 const workflows=[['point-submission:1','points'],['one-on-one-request:1','meetings'],['one-on-one-canceled:1','meetings'],['resume-review:1','resumes'],['excuse-submission:1','excuses'],['birthday:1','birthdays'],['new-portal-notice:1','portal']];
 for(const [dedupe_key,category] of workflows){
  const notification={dedupe_key};
  assert.equal(staffNotificationCategory(notification),category);
  assert.equal(staffEmailAllowed(null,notification),true);
  assert.equal(staffEmailAllowed({email_enabled:false},notification),false);
  assert.equal(staffEmailAllowed({[`${category}_email_enabled`]:false},notification),false);
  const other=category==='points'?'portal':'points';
  assert.equal(staffEmailAllowed({[`${other}_email_enabled`]:false},notification),true);
 }
 assert.equal(staffNotificationCategory({notification_type:'event'}),'meetings');
 assert.equal(staffNotificationCategory({notification_type:'announcement'}),'portal');
 assert.equal(staffEmailAllowed({portal_email_enabled:false},{}),false);
});
