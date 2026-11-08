/* Small XLSX reader: first worksheet, values only, no macros or formulas. */
window.PortalSpreadsheet = (() => {
 const decoder=new TextDecoder();
 async function read(file){
  if(!/\.xlsx$/i.test(file.name))return file.text();
  if(file.size>5*1024*1024)throw new Error('Workbook must be under 5 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),v=new DataView(bytes.buffer),files=new Map();
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break;}
  if(end<0)throw new Error('Invalid XLSX archive.');
  let pos=v.getUint32(end+16,true);const count=v.getUint16(end+10,true);
  if(count>1000)throw new Error('Workbook has too many entries.');
  for(let i=0;i<count;i++){
   if(v.getUint32(pos,true)!==0x02014b50)throw new Error('Invalid workbook directory.');
   const method=v.getUint16(pos+10,true),size=v.getUint32(pos+20,true),length=v.getUint32(pos+24,true),nl=v.getUint16(pos+28,true),el=v.getUint16(pos+30,true),cl=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true);
   const name=decoder.decode(bytes.subarray(pos+46,pos+46+nl));files.set(name,{method,size,length,offset});pos+=46+nl+el+cl;
  }
  async function xml(name){
   const e=files.get(name);if(!e)throw new Error(`Workbook entry missing: ${name}`);
   if(e.length>8*1024*1024)throw new Error('Worksheet is too large. Import at most 500 rows.');
   if(v.getUint32(e.offset,true)!==0x04034b50)throw new Error('Invalid workbook entry.');
   const start=e.offset+30+v.getUint16(e.offset+26,true)+v.getUint16(e.offset+28,true);
   let body=bytes.subarray(start,start+e.size);
   if(e.method===8){
    const reader=new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks=[];let total=0;
    for(;;){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>8*1024*1024){await reader.cancel();throw new Error('Worksheet expands beyond the import limit.');}chunks.push(r.value);}
    body=new Uint8Array(total);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length;}
   }else if(e.method!==0)throw new Error('Unsupported workbook compression.');
   const text=decoder.decode(body);if(/<!DOCTYPE/i.test(text))throw new Error('Unsupported XML document type.');
   const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw new Error('Invalid worksheet XML.');return doc;
  }
  const wb=await xml('xl/workbook.xml'),sheet=wb.getElementsByTagName('sheet')[0];if(!sheet)throw new Error('No worksheets found.');
  const rel=await xml('xl/_rels/workbook.xml.rels');const rid=sheet.getAttribute('r:id');const target=[...rel.getElementsByTagName('Relationship')].find(r=>r.getAttribute('Id')===rid)?.getAttribute('Target');
  if(!target||target.includes('..')||target.includes(':'))throw new Error('Unsupported worksheet path.');
  const path=target.startsWith('/')?target.slice(1):'xl/'+target;
  const shared=files.has('xl/sharedStrings.xml')?[...(await xml('xl/sharedStrings.xml')).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
  const worksheet=await xml(path),rows=[];
  for(const node of worksheet.getElementsByTagName('row')){
   if(rows.length>500)throw new Error('Import at most 500 data rows.');
   const row=[];
   for(const cell of node.getElementsByTagName('c')){
    if(cell.getElementsByTagName('f').length)throw new Error('Convert formulas to values before importing.');
    const ref=cell.getAttribute('r')||'',letters=ref.match(/^[A-Z]+/)?.[0];if(!letters)throw new Error('Invalid cell reference.');
    let column=0;for(const ch of letters)column=column*26+ch.charCodeAt(0)-64;if(column>100)throw new Error('Use at most 100 columns.');
    const type=cell.getAttribute('t'),value=cell.getElementsByTagName('v')[0]?.textContent||'';
    row[column-1]=type==='s'?shared[Number(value)]||'':type==='inlineStr'?[...cell.getElementsByTagName('t')].map(t=>t.textContent).join(''):value;
   }
   if(row.some(Boolean))rows.push(row);
  }
  const width=rows[0]?.length||0;
  return rows.map(row=>Array.from({length:width},(_,i)=>'"'+String(row[i]||'').replaceAll('"','""')+'"').join(',')).join('\n');
 }
 return {read};
})();
