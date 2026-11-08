const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const PortalUtils=require('../portal-utils.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
test('home banner chooses the earliest event across categories, including all-day events without timestamps',()=>{
 const ctx={Date,PortalUtils,setText:(key,value)=>ctx[key]=value,getEventCategoryLabel:v=>v,formatFullDateTime:v=>String(v)};
 vm.createContext(ctx);
 const begin=source.indexOf('function buildCalendarItems('),end=source.indexOf('// 25.',begin);
 vm.runInContext(source.slice(begin,source.lastIndexOf('// ==========================================================',end)),ctx);
 const future=new Date();future.setDate(future.getDate()+2);
 const day=`${future.getFullYear()}-${String(future.getMonth()+1).padStart(2,'0')}-${String(future.getDate()).padStart(2,'0')}`;
 const items=ctx.buildCalendarItems([{id:'all-day',title:'All-day gathering',all_day:true,all_day_start:day,all_day_end:day,event_category:'tb_event'},{id:'later',title:'Later event',start_time:new Date(future.getTime()+86400000).toISOString(),event_category:'nsbe_event'}],[]);
 assert.equal(items.length,2);assert.equal(items[0].title,'All-day gathering');
 ctx.displayNextEvent(items.reverse());
 assert.equal(ctx.nextEventTitle,'All-day gathering');
});
