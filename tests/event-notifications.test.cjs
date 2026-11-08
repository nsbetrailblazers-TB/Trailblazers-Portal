const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

for(const notify of [true,false])test(`director event save sends notification choice ${notify}`,async()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const start=source.indexOf('if (directorEventForm) {',source.indexOf('// 43A.'));
 const end=source.indexOf('// 44. ONE-ON-ONE',start);
 let submit;const calls=[];
 const elements={};
 for(const [id,value] of Object.entries({Title:'Event',Category:'trailblazers',MeetingType:'meeting',Start:'2026-10-20T15:00',End:'2026-10-20T16:00',Location:'Room',DressCode:'',Bring:'',Description:''}))elements[`directorEvent${id}`]={value};
 for(const [id,checked] of Object.entries({AllDay:false,LocationTBD:false,NotifyMembers:notify}))elements[`directorEvent${id}`]={checked};
 elements.directorSaveEventButton={disabled:false};
 const context={document:{getElementById:id=>elements[id]},directorEventForm:{addEventListener:(_,fn)=>submit=fn,reset(){}},currentDirectorCohort:{id:'cohort'},editingDirectorEventId:null,
  supabaseClient:{rpc:async(fn,args)=>{calls.push({fn,args});return{data:'event',error:null};}},console:{log(){}},setText(){},loadDirectorCalendarEvents:async()=>[],displayDirectorCalendarEvents(){},renderDirectorMonthlyCalendar(){},loadDirectorUpcomingEventsCount:async()=>1,closeDirectorEventForm(){}};
 vm.runInNewContext(source.slice(start,end),context);
 await submit({preventDefault(){}});
 assert.equal(calls.length,1);assert.equal(calls[0].fn,'portal_save_event');
 assert.equal(calls[0].args.payload.notify_members,notify);
 assert.equal(elements.directorSaveEventButton.disabled,false);
});

test('management event dialog defaults to notifying and passes unchecked choice to the RPC',async()=>{
 const source=fs.readFileSync(require.resolve('../management.js'),'utf8');
 const start=source.indexOf("} else if (action==='add-event'||action==='edit-event') {")+7;
 const end=source.indexOf("} else if (action==='add-strike')",start);
 let fields,save;const calls=[];
 const context={action:'add-event',id:null,cohort:'cohort',data:{meetings:[]},cohortField:()=>({key:'cohort_id'}),field:(key,title,type,extra)=>({key,title,type,...extra}),boolField:(key,title,value=true)=>({key,title,type:'checkbox',default:value}),showDialog:(_,f,r,s)=>{fields=f;save=s;},checked:async result=>result.data,refresh:async()=>{},supabaseClient:{rpc:async(fn,args)=>{calls.push({fn,args});return{data:'event'};}}};
 vm.runInNewContext(source.slice(start,end)+'}',context);
 assert.equal(fields.find(f=>f.key==='notify_members').default,true);
 await save({start_time:'2026-10-20T15:00:00Z',notify_members:false});
 assert.equal(calls[0].fn,'portal_save_event');assert.equal(calls[0].args.payload.notify_members,false);
});
