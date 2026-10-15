'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('preview');
const themeStyle = $('active-theme');
const SVG_W = 1600, SVG_H = 900;
const portraitAssets = { sun:'assets/sun-iconic.png', death:'assets/death-iconic.png', door:'assets/door-iconic.png', adversary:'assets/adversary-iconic.png', 'yellow-king':'assets/yellow-king-iconic.png' };
const glyphCache = new Map();
const glyphTintCache = new Map();
let pathways = [];
let currentPath = null;
let data = null;
let themeCss = '';
let imageObject = null;
let database = null;
let saveTimer = null;
let lastNoticeTimer = null;
let modified = false;

const defaultData = (p) => ({
  pathway: p.id, title: p.name.toUpperCase(),
  kicker: 'PATHWAY PREVIEW',
  tags: p.id === 'sun' ? ['LIGHT', 'PURIFICATION', 'ORDER'] : p.id==='death' ? ['SPIRITS', 'NECROMANCY', 'DEATH MAGIC'] : [p.focus.split('/')[0].trim().toUpperCase(), 'PATHWAY', 'PRACTICE'],
  summary: 'Enter a brief, player-facing overview of this pathway. Avoid revealing later sequences, concealed authorities, or story secrets.',
  quote: 'Add a short pathway quotation.',
  roleTags: ['PRACTITIONER', 'PATHWAY', 'PREVIEW'],
  abilities: [1, 2, 3, 4].map((n) => ({ title: `ABILITY ${['ONE','TWO','THREE','FOUR'][n-1]}`, description: 'Describe a non-spoiler ability or characteristic here.' })),
  infoMode: 'ratings',
  ratings: [{label:'Power',value:p.id==='death'?4:null},{label:'Flexibility',value:p.id==='death'?2:null},{label:'Complexity',value:p.id==='death'?2:null}],
  image: portraitAssets[p.id] || '',
  scale: 1, panX: 0, panY: 0,
});


function normalizeProfile(value, p) {
  const base=defaultData(p);
  const result={...base,...(value||{}),pathway:p.id};
  result.ratings=base.ratings.map((rating,i)=>{
    const r=Array.isArray(value?.ratings)?value.ratings[i]:null;
    const numeric=(r?.value===null||r?.value===''||r?.value===undefined)?null:Number(r.value);
    return {label:String(r?.label ?? rating.label),value:Number.isFinite(numeric)?Math.max(0,Math.min(5,Math.round(numeric))):null};
  });
  const oldProse=typeof value?.summary==='string' && value.summary.trim() && !value.summary.startsWith('Enter a brief, player-facing overview');
  result.infoMode=value?.infoMode==='description' || (!value?.infoMode && oldProse)?'description':'ratings';
  // Existing profiles and local edits take precedence over bundled artwork.
  if(!result.image && portraitAssets[p.id]) result.image=portraitAssets[p.id];
  return result;
}
async function loadPathwayGlyph(id) {
  if(glyphCache.has(id)) return glyphCache.get(id);
  const pending=new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>resolve(null);
    img.src=`assets/pathway-icons/${id}.png`;
  });
  glyphCache.set(id,pending);
  const loaded=await pending;
  if(loaded) {glyphCache.set(id,loaded);glyphTintCache.clear();if(currentPath?.id===id)paint();}
  else glyphCache.delete(id);
  return loaded;
}
function tintedGlyph(id,color){
  const source=glyphCache.get(id);
  if(!source || !(source instanceof HTMLImageElement))return null;
  const key=`${id}/${color}`;
  if(glyphTintCache.has(key))return glyphTintCache.get(key);
  const c=document.createElement('canvas');c.width=144;c.height=144;
  const cx=c.getContext('2d');cx.drawImage(source,0,0,144,144);
  cx.globalCompositeOperation='source-in';cx.fillStyle=color;cx.fillRect(0,0,144,144);
  glyphTintCache.set(key,c);return c;
}

async function openDB() {
  if (!window.indexedDB) return null;
  return new Promise((resolve) => {
    let request;
    try { request = indexedDB.open('pathway-showcase-v1', 1); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles');
      if (!db.objectStoreNames.contains('themes')) db.createObjectStore('themes');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}
function dbGet(store, key) {
  if (!database) return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = database.transaction(store, 'readonly').objectStore(store).get(key);
    t.onsuccess = () => resolve(t.result ?? null);
    t.onerror = () => resolve(null);
  });
}
function dbPut(store, key, val) {
  if (!database) return Promise.resolve(false);
  return new Promise((resolve) => {
    const t = database.transaction(store, 'readwrite');
    t.objectStore(store).put(val, key);
    t.oncomplete = () => resolve(true);
    t.onerror = () => resolve(false);
    t.onabort = () => resolve(false);
  });
}

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  clearTimeout(lastNoticeTimer);
  lastNoticeTimer = setTimeout(() => $('notice').textContent = '', 7000);
}
function slugFilename(s) { return (s || 'pathway').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function dbDelete(store, key) {
  if (!database) return Promise.resolve(false);
  return new Promise((resolve) => {
    const t=database.transaction(store,'readwrite'); t.objectStore(store).delete(key);
    t.oncomplete=()=>resolve(true);t.onerror=()=>resolve(false);
  });
}
async function loadImage(src) {
  if (!src) { imageObject = null; paint(); return; }
  const expected = src;
  const img = new Image();
  try {
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src; });
    if (data?.image === expected) imageObject = img;
  } catch (e) {
    imageObject = null; notice('Artwork could not be loaded. Upload a local file.', true);
  }
  paint();
}
function getVar(name, fallback) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; }
function getTheme() {
  return {
    accent:getVar('--accent','#d9a24f'), text:getVar('--text','#fff0d7'), body:getVar('--body-text','#ccc8bf'),
    bg:getVar('--background','#101114'), panel:getVar('--panel','#15171c'), border:getVar('--panel-border','#564026'),
    display:getVar('--font-display','Georgia').replace(/['"]/g,''), bodyFont:getVar('--font-body','Georgia').replace(/['"]/g,''),
    pattern:getVar('--pattern','rings'), opacity:Math.min(1, Math.max(0,Number(getVar('--ornament-opacity','0.68')) || 0)),
    overlay:Math.min(1, Math.max(0,Number(getVar('--portrait-overlay','0.12')) || 0))
  };
}
function hexRgb(h) {
  let hex = h.trim().replace('#','');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex=hex.split('').map(c=>c+c).join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return [217,162,79];
  return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));
}
function rgba(hex,opacity) { const [r,g,b]=hexRgb(hex); return `rgba(${r},${g},${b},${opacity})`; }
function roundRect(ctx,x,y,w,h,r,fill,stroke,lineWidth=1) {
  ctx.beginPath(); ctx.roundRect(x,y,w,h,r);
  if(fill){ctx.fillStyle=fill;ctx.fill();}
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();}
}
function font(ctx,size,family,weight='normal') {ctx.font=`${weight} ${size}px "${family}", Georgia, serif`;}
function fitFont(ctx,text,maxWidth,size,family,weight='normal',minimum=18) {
  let result=size; do{font(ctx,result,family,weight);if(ctx.measureText(text).width<=maxWidth)break;result-=1;}while(result>minimum);
  return result;
}
function wrapLines(ctx,text,width,maxLines=10){
  const words=String(text||'').replace(/\r/g,'').split(/(\s+)/);
  let lines=[''];
  for(const token of words){
    if(token.includes('\n')){
      const pieces=token.split('\n');
      for(let i=0;i<pieces.length;i++){ if(i>0)lines.push(''); if(pieces[i])append(pieces[i]); }
    }else append(token);
  }
  function append(token){
    if(!token)return;
    const last=lines.length-1;
    const trial=lines[last]+token;
    if(ctx.measureText(trial).width<=width || lines[last].trim().length===0){lines[last]=trial;return;}
    lines.push(token.trimStart());
  }
  lines=lines.map(s=>s.trim()).filter(Boolean);
  if(lines.length>maxLines){lines=lines.slice(0,maxLines);let last=lines.at(-1);while(last.length&&ctx.measureText(last+'…').width>width)last=last.slice(0,-1);lines[lines.length-1]=last.trimEnd()+'…';}
  return lines;
}
function drawLine(ctx,points,color,thick=1){ctx.beginPath();ctx.moveTo(...points[0]);points.slice(1).forEach(p=>ctx.lineTo(...p));ctx.strokeStyle=color;ctx.lineWidth=thick;ctx.stroke();}
function drawBackground(ctx,t) {
  ctx.fillStyle=t.bg; ctx.fillRect(0,0,SVG_W,SVG_H);
  const gradient=ctx.createRadialGradient(1330,280,60,1330,480,930);gradient.addColorStop(0,rgba(t.accent,.16));gradient.addColorStop(.48,rgba(t.accent,.035));gradient.addColorStop(1,'rgba(0,0,0,.38)');ctx.fillStyle=gradient;ctx.fillRect(0,0,SVG_W,SVG_H);
  ctx.save();ctx.globalAlpha=t.opacity;const line=rgba(t.accent,.35), stronger=rgba(t.accent,.6);
  if(t.pattern==='rings'||t.pattern==='rays'||t.pattern==='waves'){
    for(let r of [180,255,335,435,565,730]){ctx.beginPath();ctx.arc(1237,351,r,0,Math.PI*2);ctx.strokeStyle=line;ctx.lineWidth=r===255?2:1;ctx.stroke();}
    for(let i=0;i<34;i++){const a=(i/34)*Math.PI*2;drawLine(ctx,[[1237+Math.cos(a)*160,351+Math.sin(a)*160],[1237+Math.cos(a)*760,351+Math.sin(a)*760]],i%5?line:stronger,i%5?1:2);}
    if(t.pattern==='waves'){for(let j=0;j<10;j++){ctx.beginPath();for(let x=720;x<1660;x+=7){let y=100+j*90+Math.sin(x*.008+j*.7)*33; x===720?ctx.moveTo(x,y):ctx.lineTo(x,y)}ctx.strokeStyle=line;ctx.lineWidth=1;ctx.stroke();}}
  } else if(t.pattern==='grid'||t.pattern==='lattice') {
    for(let x=0;x<1700;x+=78){drawLine(ctx,[[x,0],[x,900]],line)}
    for(let y=0;y<1000;y+=78){drawLine(ctx,[[0,y],[1600,y]],line)}
    if(t.pattern==='lattice')for(let x=-900;x<1700;x+=175){drawLine(ctx,[[x,0],[x+900,900]],line)}
  }else{
    for(let i=0;i<48;i++){
      let x=745+(i*239)%990, y=(i*139)%920, rad=35+(i*19)%110;
      drawLine(ctx,[[x-rad,y+rad],[x+rad*.3,y-rad],[x+rad*1.4,y+rad*.2]],i%3?line:stronger,i%3?1:2);
    }
  }
  for(let i=0;i<9;i++){let x=850+i*101,y=35+(i*97)%760;ctx.fillStyle=rgba(t.accent,.09+(i%3)*.04);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+165,y-50);ctx.lineTo(x+52,y+190);ctx.closePath();ctx.fill();}
  ctx.restore();
  drawLine(ctx,[[28,28],[1572,28]],rgba(t.accent,.38)); drawLine(ctx,[[28,872],[1572,872]],rgba(t.accent,.38));
  drawLine(ctx,[[28,28],[28,872]],rgba(t.accent,.19));drawLine(ctx,[[1572,28],[1572,872]],rgba(t.accent,.19));
}
function drawPortrait(ctx,t){
  if(!imageObject)return;
  ctx.save();ctx.beginPath();ctx.rect(690,0,910,900);ctx.clip();
  const zoom=Math.max(.5,Math.min(2.5,Number(data.scale)||1));
  const img=imageObject;const ratio=Math.max(910/img.naturalWidth,900/img.naturalHeight)*zoom;
  const dw=img.naturalWidth*ratio, dh=img.naturalHeight*ratio;
  const x=690+(910-dw)/2+(Number(data.panX)||0); const y=(900-dh)/2+(Number(data.panY)||0);
  ctx.drawImage(img,x,y,dw,dh);
  ctx.fillStyle=rgba(t.bg,t.overlay);ctx.fillRect(690,0,910,900);
  ctx.restore();
  const fade=ctx.createLinearGradient(610,0,1095,0);
  fade.addColorStop(0,rgba(t.bg,1));fade.addColorStop(.25,rgba(t.bg,.94));fade.addColorStop(.6,rgba(t.bg,.48));fade.addColorStop(1,rgba(t.bg,0));
  ctx.fillStyle=fade;ctx.fillRect(610,0,500,900);
  const fadeBottom=ctx.createLinearGradient(0,690,0,900);fadeBottom.addColorStop(0,'rgba(0,0,0,0)');fadeBottom.addColorStop(1,rgba(t.bg,.48));ctx.fillStyle=fadeBottom;ctx.fillRect(690,690,910,210);
}
function drawOrnaments(ctx,t){
  ctx.save();ctx.strokeStyle=rgba(t.accent,.48);ctx.lineWidth=1;
  for(let radius of [170,210,272]){ctx.beginPath();ctx.arc(1240,330,radius,-2.4,1.2);ctx.stroke();}
  ctx.translate(1454,118);ctx.rotate(Math.PI/4);roundRect(ctx,-6,-6,12,12,0,t.accent,rgba(t.text,.8));ctx.restore();
}
function drawText(ctx,text,x,y,size,color,family='Georgia',weight='normal',align='left'){
  ctx.fillStyle=color; font(ctx,size,family,weight);ctx.textBaseline='alphabetic';ctx.textAlign=align;ctx.fillText(String(text),x,y);ctx.textAlign='left';
}
function drawLabelChip(ctx,text,x,y,w,t){
  roundRect(ctx,x,y,w,31,1,'rgba(4,5,8,.81)',rgba(t.accent,.76));
  drawText(ctx,text,x+w/2,y+20,14,t.text,t.bodyFont,'bold','center');
}
function drawTopPanel(ctx,t){
  roundRect(ctx,65,51,697,389,3,'rgba(5,6,8,.72)',rgba(t.accent,.4),1);
  drawText(ctx,(data.kicker||'PATHWAY PREVIEW').toUpperCase(),91,88,15,t.accent,t.bodyFont,'bold');
  const title=(data.title||currentPath?.name||'PATHWAY').toUpperCase();
  const size=fitFont(ctx,title,655,66,t.display,'bold',30);
  drawText(ctx,title,89,166,size,t.text,t.display,'bold');
  drawLine(ctx,[[91,184],[704,184]],rgba(t.accent,.69),2);
  ctx.save();ctx.translate(398,184);ctx.rotate(Math.PI/4);roundRect(ctx,-6,-6,12,12,0,t.accent);ctx.restore();
  const tags=(data.tags||[]).slice(0,3);
  let tx=90;
  tags.forEach((tag)=>{const text=String(tag).toUpperCase().slice(0,28);font(ctx,13,t.bodyFont,'bold');const width=Math.min(193,Math.max(90,ctx.measureText(text).width+26));if(tx+width<730){drawLabelChip(ctx,text,tx,206,width,t);tx+=width+12;}});
  if(data.infoMode==='description') {
    font(ctx,21,t.bodyFont);
    const lines=wrapLines(ctx,data.summary||'',622,6);
    lines.forEach((line,i)=>drawText(ctx,line,93,287+i*27,21,t.body,t.bodyFont));
  } else drawRatings(ctx,t);
}
function drawRatings(ctx,t) {
  drawText(ctx,'WHAT A NEW PRACTITIONER SHOULD KNOW',94,270,14,t.accent,t.bodyFont,'bold');
  const rows=Array.isArray(data.ratings)?data.ratings:[];
  for(let i=0;i<3;i++){
    const item=rows[i]||{};const label=String(item.label||'ATTRIBUTE').toUpperCase();
    const baseline=317+i*46;
    const size=fitFont(ctx,label,230,19,t.bodyFont,'bold',12);
    drawText(ctx,label,94,baseline,size,t.text,t.bodyFont,'bold');
    const num=(item.value===null||item.value===''||item.value===undefined)?null:Math.max(0,Math.min(5,Math.round(Number(item.value))));
    const segmentX=369,segmentW=42,segmentGap=7;
    for(let n=0;n<5;n++){
      const x=segmentX+n*(segmentW+segmentGap), y=baseline-19;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+segmentW-5,y);ctx.lineTo(x+segmentW,y+22);ctx.lineTo(x+5,y+22);ctx.closePath();
      ctx.fillStyle=num!==null&&n<num?rgba(t.accent,.94):rgba(t.accent,.08);
      ctx.fill();ctx.strokeStyle=rgba(t.accent,num!==null&&n<num?.96:.43);ctx.lineWidth=1.2;ctx.stroke();
    }
    drawText(ctx,num===null?'—/5':`${num}/5`,701,baseline,20,t.accent,t.display,'bold','right');
  }
}
function drawGlyph(ctx,x,y,kind,t){
  ctx.save();ctx.translate(x,y);ctx.strokeStyle=t.text;ctx.fillStyle=t.text;ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';
  if(kind==='sun'||kind==='star'){let n=kind==='sun'?12:8;ctx.beginPath();ctx.arc(0,0,kind==='sun'?13:7,0,7);ctx.stroke();for(let i=0;i<n;i++){let a=i*2*Math.PI/n;drawLine(ctx,[[Math.cos(a)*20,Math.sin(a)*20],[Math.cos(a)*31,Math.sin(a)*31]],t.text,2.8)}}
  else if(kind==='shield'){ctx.beginPath();ctx.moveTo(0,-32);ctx.lineTo(24,-21);ctx.lineTo(22,6);ctx.quadraticCurveTo(15,22,0,32);ctx.quadraticCurveTo(-19,20,-22,6);ctx.lineTo(-24,-21);ctx.closePath();ctx.stroke();}
  else if(kind==='eye'){ctx.beginPath();ctx.moveTo(-32,0);ctx.quadraticCurveTo(0,-30,32,0);ctx.quadraticCurveTo(0,30,-32,0);ctx.stroke();ctx.beginPath();ctx.arc(0,0,9,0,7);ctx.fill();}
  else if(kind==='flame'){ctx.beginPath();ctx.moveTo(0,-33);ctx.bezierCurveTo(-7,-4,-30,-1,-15,22);ctx.quadraticCurveTo(0,39,17,19);ctx.bezierCurveTo(25,7,9,-10,0,-33);ctx.stroke();}
  else if(kind==='moon'){ctx.beginPath();ctx.arc(-2,-2,25,.4,Math.PI*1.75);ctx.arc(15,-13,24,Math.PI*1.5,.35,true);ctx.stroke();}
  else if(kind==='orbit'){for(let i=0;i<3;i++){ctx.save();ctx.rotate(i*Math.PI/3);ctx.beginPath();ctx.ellipse(0,0,33,12,0,0,7);ctx.stroke();ctx.restore()}ctx.beginPath();ctx.arc(0,0,5,0,7);ctx.fill();}
  else if(kind==='shard'){ctx.beginPath();ctx.moveTo(4,-37);ctx.lineTo(24,-5);ctx.lineTo(2,34);ctx.lineTo(-19,5);ctx.closePath();ctx.stroke();drawLine(ctx,[[-3,-22],[9,9],[-5,27]],t.text,2);}
  else if(kind==='diamond'){ctx.beginPath();ctx.moveTo(0,-33);ctx.lineTo(28,0);ctx.lineTo(0,33);ctx.lineTo(-28,0);ctx.closePath();ctx.stroke();drawLine(ctx,[[-28,0],[28,0]],t.text);}
  else if(kind==='cross'){roundRect(ctx,-6,-29,12,58,1,t.text);roundRect(ctx,-29,-6,58,12,1,t.text);}
  else if(kind==='crown'){ctx.beginPath();ctx.moveTo(-30,-20);ctx.lineTo(-17,18);ctx.lineTo(18,18);ctx.lineTo(30,-20);ctx.lineTo(10,-4);ctx.lineTo(0,-28);ctx.lineTo(-10,-4);ctx.closePath();ctx.stroke();}
  else{for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-31,-14+i*15);ctx.bezierCurveTo(-12,-32+i*15,5,9+i*15,31,-14+i*15);ctx.stroke();}}
  ctx.restore();
}
function drawAbility(ctx,t,ab,i){
  const y=469+i*101, right=i%2===1;
  const x=right?125:67,w=697,h=89;
  const gr=ctx.createLinearGradient(x,y,x+w,y);gr.addColorStop(0,'rgba(7,8,11,.94)');gr.addColorStop(1,'rgba(14,15,18,.77)');
  roundRect(ctx,x,y,w,h,2,gr,rgba(t.accent,.47));
  const circleX=right?x+w-18:x+27, circleY=y+44;
  ctx.beginPath();ctx.arc(circleX,circleY,49,0,Math.PI*2);ctx.fillStyle=rgba(t.bg,.99);ctx.fill();ctx.strokeStyle=t.accent;ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.arc(circleX,circleY,41,0,7);ctx.strokeStyle=rgba(t.accent,.5);ctx.lineWidth=1;ctx.stroke();
  const emblem=tintedGlyph(currentPath?.id||'sun',t.text);
  if(emblem){ctx.drawImage(emblem,circleX-36,circleY-36,72,72)}else drawGlyph(ctx,circleX,circleY,'sun',t);
  const bodyX=right?x+22:x+108, contentW=right?570:550;
  const title=(ab?.title||`ABILITY ${i+1}`).toUpperCase();const n=String(i+1).padStart(2,'0');
  drawText(ctx,n,bodyX,y+31,20,t.accent,t.bodyFont);
  font(ctx,23,t.display,'bold');fitFont(ctx,title,contentW-68,23,t.display,'bold',15);
  drawText(ctx,title,bodyX+41,y+31,Math.min(23,fitFont(ctx,title,contentW-68,23,t.display,'bold',15)),t.text,t.display,'bold');
  font(ctx,17,t.bodyFont);
  wrapLines(ctx,ab?.description||'',contentW-12,2).forEach((l,j)=>drawText(ctx,l,bodyX,y+55+j*19,17,t.body,t.bodyFont));
}
function drawPortraitFooter(ctx,t){
  const x=904;
  const chips=(data.roleTags||[]).slice(0,3).filter(Boolean);
  let cx=x;
  chips.forEach((label)=>{font(ctx,15,t.bodyFont,'bold');const w=Math.min(210,Math.max(110,ctx.measureText(label.toUpperCase()).width+22));roundRect(ctx,cx,756,w,35,1,rgba(t.accent,.91),rgba(t.text,.33));drawText(ctx,label.toUpperCase(),cx+w/2,779,14,t.bg,t.bodyFont,'bold','center');cx+=w+9;});
  const quote=String(data.quote||'').replace(/\s+/g,' ').trim();
  font(ctx,19,t.display);const lines=wrapLines(ctx,quote,602,2);
  const height=lines.length*25+23;
  roundRect(ctx,892,806,654,Math.max(56,height),2,'rgba(4,5,8,.72)',rgba(t.accent,.46));
  lines.forEach((l,i)=>drawText(ctx,l,908,835+i*24,19,t.text,t.display));
}
function drawScene(target,exportScale=1){
  if(!data)return;
  const ctx=target.getContext('2d',{alpha:false});
  ctx.save();ctx.setTransform(exportScale,0,0,exportScale,0,0);
  const t=getTheme();
  drawBackground(ctx,t);drawPortrait(ctx,t);drawOrnaments(ctx,t);drawTopPanel(ctx,t);
  (data.abilities||[]).slice(0,4).forEach((ab,i)=>drawAbility(ctx,t,ab,i));
  drawPortraitFooter(ctx,t);
  ctx.restore();
}
function paint(){if(data)drawScene(canvas,1);}

function markDirty(){
  modified=true;$('save-state').textContent='Unsaved changes';paint();
  clearTimeout(saveTimer);saveTimer=setTimeout(saveCurrent,650);
}
async function saveCurrent(){
  if(!currentPath || !data)return;
  const savedPath=currentPath.id, snapshot=structuredClone(data), css=themeCss;
  const [a,b]=await Promise.all([dbPut('profiles',savedPath,snapshot),dbPut('themes',savedPath,css)]);
  if(currentPath?.id===savedPath){modified=false;$('save-state').textContent=a&&b?'Saved in browser':'Export JSON to save';}
}
function collectChanges(){
  if(!data)return;
  data.title=$('display-name').value;
  data.kicker=$('kicker').value;
  data.tags=$('tags').value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,3);
  data.summary=$('summary').value;
  data.infoMode=$('info-mode').value;
  data.ratings=[...document.querySelectorAll('.rating-editor')].map(el=>({
    label:el.querySelector('[data-rating=label]').value,
    value:el.querySelector('[data-rating=value]').value===''?null:Math.max(0,Math.min(5,Math.round(Number(el.querySelector('[data-rating=value]').value))))
  }));
  data.quote=$('quote').value;
  data.roleTags=$('role-tags').value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,3);
  data.scale=Number($('image-scale').value);data.panX=Number($('image-x').value);data.panY=Number($('image-y').value);
  data.abilities=[...document.querySelectorAll('.ability-editor')].map((el)=>({title:el.querySelector('[data-ability="title"]').value,description:el.querySelector('[data-ability="description"]').value}));
  $('image-scale-value').textContent=`${data.scale.toFixed(2)}×`;
  $('image-x-value').textContent=`${data.panX}px`;
  $('image-y-value').textContent=`${data.panY}px`;
  $('preview-heading').textContent=(data.title||currentPath?.name||'PATHWAY').toUpperCase();
  markDirty();
}
function initAbilities(){
  const parent=$('abilities-editor');parent.replaceChildren();
  for(let i=0;i<4;i++){
    const ab=data.abilities?.[i]||{title:`ABILITY ${i+1}`,description:''};
    const el=document.createElement('div');el.className='ability-editor';
    const heading=document.createElement('h3');heading.textContent=`HIGHLIGHT ${String(i+1).padStart(2,'0')}`;
    const title=field('Name','input','title',ab.title);
    const desc=field('Description','textarea','description',ab.description);
    el.append(heading,title,desc);parent.append(el);
  }
}
function field(labelText,tag,key,value,options){
  const root=document.createElement('div');root.className='field';const lab=document.createElement('label');lab.textContent=labelText;
  const input=document.createElement(tag);input.dataset.ability=key;
  if(tag==='textarea')input.rows=2;
  if(tag==='select')options.forEach(o=>{const option=document.createElement('option');option.value=o;option.textContent=o;input.append(option);});
  input.value=value; input.addEventListener('input',collectChanges);root.append(lab,input);return root;
}
function renderRatingControls(){
  const parent=$('rating-editors');parent.replaceChildren();
  const ratings=Array.isArray(data.ratings)?data.ratings:[];
  for(let i=0;i<3;i++){
    const r=ratings[i]||{label:['Power','Flexibility','Complexity'][i],value:null};
    const row=document.createElement('div');row.className='rating-editor';
    const label=document.createElement('div');label.className='field';
    const labelText=document.createElement('label');labelText.textContent=`Attribute ${i+1}`;
    const labelInput=document.createElement('input');labelInput.type='text';labelInput.maxLength=28;labelInput.value=r.label;labelInput.dataset.rating='label';
    label.append(labelText,labelInput);
    const value=document.createElement('div');value.className='field';
    const valueLabel=document.createElement('label');valueLabel.textContent='Rating / 5';
    const number=document.createElement('input');number.type='number';number.min=0;number.max=5;number.step=1;number.placeholder='—';number.value=r.value===null?'':r.value;number.dataset.rating='value';
    value.append(valueLabel,number);row.append(label,value);parent.append(row);
    labelInput.addEventListener('input',collectChanges);number.addEventListener('input',collectChanges);
  }
  updateInfoMode();
}
function updateInfoMode(){
  const showRatings=$('info-mode').value==='ratings';
  $('rating-editors').hidden=!showRatings;
  $('summary-container').hidden=showRatings;
}
function fillControls(){
  $('display-name').value=data.title||'';$('kicker').value=data.kicker||'';$('tags').value=(data.tags||[]).join(', ');
  $('info-mode').value=data.infoMode||'ratings';
  renderRatingControls();
  $('summary').value=data.summary||'';$('quote').value=data.quote||'';$('role-tags').value=(data.roleTags||[]).join(', ');
  $('image-scale').value=data.scale??1;$('image-x').value=data.panX??0;$('image-y').value=data.panY??0;
  $('image-scale-value').textContent=`${Number(data.scale).toFixed(2)}×`;
  $('image-x-value').textContent=`${data.panX}px`; $('image-y-value').textContent=`${data.panY}px`;
  $('preview-heading').textContent=data.title;
  initAbilities();
}
async function bundledTheme(p){
  try{const r=await fetch(p.theme,{cache:'no-store'});if(!r.ok)throw new Error('Theme not found');return await r.text();}
  catch{return ':root { --accent: #d9a24f; --text: #fff0d7; --body-text: #c9c6c0; --background: #101114; --panel: #15171c; --panel-border: #564026; --font-display: Georgia; --font-body: Georgia; --pattern: rings; --ornament-opacity: .68; --portrait-overlay: .12; }';}
}
async function publishedProfile(id){
  try { const r=await fetch(`profiles/${id}.json`,{cache:'no-store'}); if(!r.ok)return null; const json=await r.json(); return json.format==='pathway-showcase'&&Array.isArray(json.profile?.abilities)?json.profile:null; }
  catch{return null;}
}
async function switchPath(id){
  clearTimeout(saveTimer);if(modified)await saveCurrent();
  const next=pathways.find(p=>p.id===id);if(!next)return;
  currentPath=next;
  const [storedData,storedCss,baseCss,published]=await Promise.all([dbGet('profiles',id),dbGet('themes',id),bundledTheme(next),publishedProfile(id)]);
  const loaded=storedData&&Array.isArray(storedData.abilities)?storedData:published||defaultData(next);
  data=normalizeProfile(loaded,next);
  themeCss=typeof storedCss==='string'?storedCss:baseCss;
  themeStyle.textContent=themeCss;$('theme-css').value=themeCss;
  $('pathway-select').value=id;fillControls();
  imageObject=null;paint();
  void loadPathwayGlyph(next.id);
  await loadImage(data.image);
  modified=false;$('save-state').textContent=storedData?'Loaded local changes':'Loaded';
}
async function imageUploaded(file){
  if(!file)return;
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)){notice('Please select a PNG, JPG, or WebP image.',true);return;}
  if(file.size>25*1024*1024){notice('Image too large (25 MB maximum).',true);return;}
  const reader=new FileReader();reader.onload=()=>{data.image=reader.result;loadImage(data.image);markDirty();};reader.onerror=()=>notice('Could not read image.',true);reader.readAsDataURL(file);
}
async function downloadPng(){
  if(!data)return;
  const scale=Number($('export-scale').value)||2;
  try{
    $('download-png').disabled=true;$('download-png').textContent='Rendering…';
    const out=document.createElement('canvas');out.width=SVG_W*scale;out.height=SVG_H*scale;drawScene(out,scale);
    const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('Browser did not create a PNG');
    downloadBlob(blob,`${slugFilename(data.title||currentPath.name)}-pathway.png`);
    notice(`Downloaded ${out.width} × ${out.height} PNG.`);
    out.width=0;out.height=0;
  }catch(e){notice('PNG export failed: '+e.message,true);}
  finally{$('download-png').disabled=false;$('download-png').innerHTML='Download PNG <span aria-hidden="true">↓</span>';}
}
async function exportJson(){
  if(!data)return;
  await saveCurrent();
  const profile=structuredClone(data);
  if (profile.image && !profile.image.startsWith('data:') && imageObject) {
    const imgCanvas=document.createElement('canvas');imgCanvas.width=imageObject.naturalWidth;imgCanvas.height=imageObject.naturalHeight;
    imgCanvas.getContext('2d').drawImage(imageObject,0,0);
    try { profile.image=imgCanvas.toDataURL('image/png'); } catch { /* Retain the relative path if pixel export is restricted. */ }
  }
  const payload={format:'pathway-showcase',version:1,pathway:currentPath.id,profile,themeCss};
  downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`${currentPath.id}.json`);
  notice(`Exported ${currentPath.id}.json. Upload it into profiles/ on GitHub to publish these texts and artwork.`);
}
async function importJson(file){
  if(!file)return;
  try{
    const blob=JSON.parse(await file.text());
    if(blob.format!=='pathway-showcase'||!blob.profile||!Array.isArray(blob.profile.abilities))throw new Error('Not a Pathway Showcase JSON file');
    const p=pathways.find(x=>x.id===blob.pathway);
    if(!p)throw new Error('This pathway is not in the current list.');
    await saveCurrent();await switchPath(p.id);
    data=normalizeProfile(blob.profile,p);
    if(typeof blob.themeCss==='string'){themeCss=blob.themeCss;themeStyle.textContent=themeCss;$('theme-css').value=themeCss;}
    fillControls();await loadImage(data.image);markDirty();await saveCurrent();notice('Imported '+p.name+' data and its CSS.');
  }catch(e){notice('Import failed: '+e.message,true);}
}
async function init(){
  try{
    const response=await fetch('pathways.json');if(!response.ok)throw new Error('Missing pathways.json');
    pathways=await response.json();
  }catch(e){notice('Unable to load site data. Use GitHub Pages or a local web server, not file://.',true);$('save-state').textContent='Load error';return;}
  database=await openDB();
  pathways.forEach(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.name+' Pathway';$('pathway-select').append(option);});
  $('pathway-select').addEventListener('change',e=>switchPath(e.target.value));
  for(const id of ['display-name','kicker','tags','summary','quote','role-tags','image-scale','image-x','image-y'])$(id).addEventListener('input',collectChanges);
  $('info-mode').addEventListener('change',()=>{updateInfoMode();collectChanges();});
  $('theme-css').addEventListener('input',e=>{themeCss=e.target.value;themeStyle.textContent=themeCss;markDirty();});
  $('image-upload').addEventListener('change',e=>{imageUploaded(e.target.files[0]);e.target.value='';});
  $('image-reset').addEventListener('click',()=>{$('image-scale').value=1;$('image-x').value=0;$('image-y').value=0;collectChanges();});
  $('image-remove').addEventListener('click',()=>{data.image='';imageObject=null;markDirty();});
  $('reload-published').addEventListener('click',async()=>{
    if(!currentPath || !confirm(`Discard local edits to ${currentPath.name} and reload the published version?`))return;
    clearTimeout(saveTimer);modified=false;
    await Promise.all([dbDelete('profiles',currentPath.id),dbDelete('themes',currentPath.id)]);
    await switchPath(currentPath.id);notice('Reloaded published or bundled default content.');
  });
  $('download-png').addEventListener('click',downloadPng);
  $('download-json').addEventListener('click',exportJson);
  $('import-json').addEventListener('click',()=>$('json-file').click());
  $('json-file').addEventListener('change',e=>{importJson(e.target.files[0]);e.target.value='';});
  $('download-theme').addEventListener('click',()=>downloadBlob(new Blob([themeCss],{type:'text/css'}),`${currentPath.id}.css`));
  $('reset-theme').addEventListener('click',async()=>{if(!confirm(`Restore the default ${currentPath.name} CSS?`))return;themeCss=await bundledTheme(currentPath);themeStyle.textContent=themeCss;$('theme-css').value=themeCss;markDirty();});
  await switchPath('sun');
}
init();
