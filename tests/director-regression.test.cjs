const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('management loads assignment recipients using their composite key',async()=>{
 const source=fs.readFileSync(require.resolve('../management.js'),'utf8');
 const start=source.indexOf('  async function all('),end=source.indexOf('  function allowed(',start);
 const ordered=[];
 const ctx={checked:async result=>result.data,supabaseClient:{from:table=>({select:()=>({order(column){assert.ok(['assignment_id','member_id'].includes(column),`${table}.${column} does not exist`);ordered.push(column);return this;},range:()=>({data:[{assignment_id:'assignment',member_id:'member'}]})})})}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 const rows=await ctx.all('assignment_recipients');
 assert.equal(rows.length,1);assert.deepEqual(ordered,['assignment_id','member_id']);
});
test('navigation after a failed initial load reports an error without rendering missing records',()=>{
 const source=fs.readFileSync(require.resolve('../management.js'),'utf8');
 const start=source.indexOf('  function render()'),end=source.indexOf('  function pointSnapshot(',start);
 const messages=[];const ctx={data:{},notify:(message,error)=>messages.push({message,error})};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 assert.doesNotThrow(()=>ctx.render());assert.equal(messages.length,1);assert.equal(messages[0].error,true);assert.match(messages[0].message,/Refresh/);
});
test('portal utilities load before app.js calendar startup uses them',()=>{
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
 const utilities=html.indexOf('src="portal-utils.js"');
 const app=html.indexOf('src="app.js?');
 assert.ok(utilities>=0&&app>=0&&utilities<app,'portal-utils.js must load before app.js');
});
test('director refresh preserves member identity and loads the director cohort',async()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const start=source.indexOf('async function refreshDirectorData()');
 const end=source.indexOf('// 12B. DISPLAY DIRECTOR PROFILE',start);
 const ctx={currentMember:{id:'original-member'},loadCurrentDirector:async()=>({id:'director'}),loadCurrentDirectorAssignment:async()=>({id:'assignment',cohort_id:'cohort'}),loadCurrentCohort:async()=>({id:'cohort'}),loadDirectorActiveMembersCount:async()=>2,loadDirectorUpcomingOneOnOnesCount:async()=>0,loadDirectorPendingPointsCount:async()=>1,loadDirectorUpcomingEventsCount:async()=>0,loadDirectorUpcomingOneOnOnes:async()=>[],loadDirectorCalendarEvents:async()=>[],loadDirectorMembers:async()=>[]};
 for(const name of ['displayCurrentDirector','setText','displayDirectorUpcomingOneOnOnes','displayDirectorOneOnOnes','displayDirectorCalendarEvents','renderDirectorMonthlyCalendar','populateDirectorOneOnOneMemberSelect','displayDirectorMembers'])ctx[name]=()=>{};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 const result=await ctx.refreshDirectorData();
 assert.equal(result.cohort.id,'cohort');assert.equal(ctx.currentMember.id,'original-member');assert.equal(ctx.currentDirector.id,'director');
});
