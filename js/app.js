/* Тропа · Калининградская область — карта, трек, точки интереса, офлайн PWA */
'use strict';

// ---------- Categories ----------
const CATS = {
  start:     { label:'Начало/финиш', icon:'🚩', color:'#2e7d32' },
  history:   { label:'История',      icon:'🏚', color:'#795548' },
  viewpoint: { label:'Смотровая',     icon:'🔭', color:'#1565c0' },
  nature:    { label:'Природа',       icon:'🌳', color:'#2e7d32' },
  water:     { label:'Вода/родник',   icon:'💧', color:'#0277bd' },
  rest:      { label:'Привал/стоянка',icon:'🪵', color:'#6d4c41' },
  warning:   { label:'Осторожно',     icon:'⚠️', color:'#e65100' },
  junction:  { label:'Развилка',      icon:'🔀', color:'#5d4037' },
  photo:     { label:'Фототочка',     icon:'📷', color:'#7b1fa2' },
  info:      { label:'Информация',    icon:'ℹ️', color:'#455a64' },
  other:     { label:'Другое',        icon:'📍', color:'#f4511e' },
};
const catOf = c => CATS[c] || CATS.other;

// ---------- Small helpers ----------
const $ = s => document.querySelector(s);
const el = (tag, cls) => { const e=document.createElement(tag); if(cls) e.className=cls; return e; };
function toast(msg, ms=2400){ const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,ms); }
function fmtKm(m){ return (m/1000).toFixed(2)+' км'; }
function download(name, text, mime='application/octet-stream'){
  const blob = new Blob([text], {type:mime});
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
function haversine(a, b){ // [lat,lon]
  const R=6371000, toR=x=>x*Math.PI/180;
  const dLat=toR(b[0]-a[0]), dLon=toR(b[1]-a[1]);
  const s=Math.sin(dLat/2)**2 + Math.cos(toR(a[0]))*Math.cos(toR(b[0]))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
const uid = () => 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);

function bearing(a, b){ // [lat,lon] -> degrees clockwise from north
  const toR=x=>x*Math.PI/180;
  const φ1=toR(a[0]), φ2=toR(b[0]), Δλ=toR(b[1]-a[1]);
  const y=Math.sin(Δλ)*Math.cos(φ2);
  const x=Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y,x)*180/Math.PI + 360) % 360;
}
// Nearest point on the reference track to ll=[lat,lon]; returns {d:meters, i:segIdx, t, along, ll}
function nearestOnTrack(ll){
  if (trackLatLngs.length < 2) return null;
  const mLat = 111320, mLon = 111320*Math.cos(ll[0]*Math.PI/180);
  const xy = p => [ (p[1]-ll[1])*mLon, (p[0]-ll[0])*mLat ];
  let best=null;
  for (let i=0;i<trackLatLngs.length-1;i++){
    const A=xy(trackLatLngs[i]), B=xy(trackLatLngs[i+1]);
    const abx=B[0]-A[0], aby=B[1]-A[1];
    const ab2=abx*abx+aby*aby || 1e-9;
    let t=(-A[0]*abx + -A[1]*aby)/ab2; t=Math.max(0,Math.min(1,t));
    const cx=A[0]+t*abx, cy=A[1]+t*aby;
    const d=Math.hypot(cx,cy);
    if (!best || d<best.d){
      const along=trackCum[i] + t*((trackCum[i+1]||trackCum[i]) - trackCum[i]);
      best={ d, i, t, along, ll:[ ll[0]+cy/mLat, ll[1]+cx/mLon ] };
    }
  }
  return best;
}
// Point on the track at cumulative distance `m` (clamped to track length)
function pointAtAlong(m){
  if (!trackLatLngs.length) return null;
  const total = trackCum[trackCum.length-1] || 0;
  if (m<=0) return trackLatLngs[0];
  if (m>=total) return trackLatLngs[trackLatLngs.length-1];
  let i=0; while (i<trackCum.length-1 && trackCum[i+1]<m) i++;
  const seg=(trackCum[i+1]-trackCum[i])||1, t=(m-trackCum[i])/seg;
  return [ trackLatLngs[i][0]+t*(trackLatLngs[i+1][0]-trackLatLngs[i][0]),
           trackLatLngs[i][1]+t*(trackLatLngs[i+1][1]-trackLatLngs[i][1]) ];
}

// ---------- Map ----------
const KO_CENTER = [54.71, 21.0]; // Калининградская область
const map = L.map('map', { zoomControl:true, attributionControl:true }).setView(KO_CENTER, 9);
L.control.scale({ imperial:false }).addTo(map);

const baseLayers = {
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, attribution: 'Карта: © OpenTopoMap (CC-BY-SA) · данные © OpenStreetMap'
  }),
};
// ---------- Saved preferences (which base layer + which overlays are shown) ----------
const PREFS_KEY = 'tropa.prefs.v1';
function loadPrefs(){
  try { return Object.assign({ base:'osm', points:true, track:true }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); }
  catch { return { base:'osm', points:true, track:true }; }
}
function savePrefs(){ try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} }
const prefs = loadPrefs();

let currentBase = baseLayers[prefs.base] ? prefs.base : 'osm';
baseLayers[currentBase].addTo(map);
{ // sync the menu controls with the saved choice
  const r = document.querySelector(`input[name=base][value="${currentBase}"]`); if (r) r.checked = true;
  const cp = $('#chkPoints'); if (cp) cp.checked = !!prefs.points;
  const ct = $('#chkTrack');  if (ct) ct.checked = !!prefs.track;
}

// ---------- Admin mode ----------
// Зайдите по адресу ...?edit=КОД один раз — режим сохранится в этом браузере.
// ↓↓↓ ПОМЕНЯЙТЕ на свой секретный код:
const ADMIN_CODE = '1803';
(function(){
  const p = new URLSearchParams(location.search);
  if (p.has('edit')){
    if (p.get('edit') === ADMIN_CODE) localStorage.setItem('tropa.admin','1');
    else setTimeout(()=>toast('Неверный код администратора'), 700);
  }
})();
const isAdmin = localStorage.getItem('tropa.admin') === '1';
if (isAdmin) document.body.classList.add('admin');

// ---------- Remember last map view ----------
const VIEW_KEY = 'tropa.view.v1';
let restoredView = false;
try {
  const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
  if (v && isFinite(v.lat) && isFinite(v.lng)){ map.setView([v.lat, v.lng], v.z || 13); restoredView = true; }
} catch {}
let _saveViewT = null;
map.on('moveend', () => {
  clearTimeout(_saveViewT);
  _saveViewT = setTimeout(() => {
    const c = map.getCenter();
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ lat:+c.lat.toFixed(6), lng:+c.lng.toFixed(6), z: map.getZoom() })); } catch {}
  }, 600);
});
let userInteracted = false, didAutoCenter = false;
map.on('zoomstart', () => { userInteracted = true; });

// ---------- State ----------
const STORAGE_KEY = 'tropa.points.v1';
let trackLatLngs = [];          // [[lat,lon],...] for the loaded reference track
let trackEle = [];              // elevations aligned with trackLatLngs (may contain nulls)
let trackCum = [];              // cumulative distance (m) aligned
let trackLine = null;           // L.polyline
let userPoints = [];            // [{id,name,description,category,lat,lon,created}]
let seedPoints = [];            // from data/points.geojson (read-only originals)
const markerById = new Map();   // id -> L.marker
let editingId = null;           // id being edited, or null when adding new
let pendingLatLng = null;       // latlng for a new point
let addPreviewMarker = null;

// ---------- Reference track (GPX) ----------
function parseGpx(text){
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('Не удалось разобрать GPX');
  const pts = [...xml.querySelectorAll('trkpt, rtept')];
  const out = [];
  for (const p of pts){
    const lat = parseFloat(p.getAttribute('lat')), lon = parseFloat(p.getAttribute('lon'));
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const eleEl = p.querySelector('ele');
    const ele = eleEl ? parseFloat(eleEl.textContent) : null;
    out.push({ lat, lon, ele: isFinite(ele) ? ele : null });
  }
  let name = xml.querySelector('trk > name, metadata > name, rte > name');
  return { name: name ? name.textContent.trim() : null, points: out };
}

function setTrack(parsed, opts){
  trackLatLngs = parsed.points.map(p => [p.lat, p.lon]);
  trackEle = parsed.points.map(p => p.ele);
  trackCum = [0];
  for (let i=1;i<trackLatLngs.length;i++) trackCum[i] = trackCum[i-1] + haversine(trackLatLngs[i-1], trackLatLngs[i]);
  if (trackLine) trackLine.remove();
  trackLine = L.polyline(trackLatLngs, { color:'#29b6f6', weight:5, opacity:0.9 }).addTo(map);
  if ($('#chkTrack') && !$('#chkTrack').checked) trackLine.remove();
  if (parsed.name){ $('#trailName').textContent = parsed.name; document.title = parsed.name; }
  recomputePointAlong();
  updateStats();
  drawElevation();
  const navBtn = $('#btnNav'); if (navBtn) navBtn.hidden = trackLatLngs.length < 2;
  const wantFit = opts && 'fit' in opts ? opts.fit : !restoredView;
  if (trackLatLngs.length && wantFit) map.fitBounds(trackLine.getBounds().pad(0.15));
}
// Project every point onto the track so navigation can say "300 m ahead: ..."
function recomputePointAlong(){
  for (const p of [...seedPoints, ...userPoints]){
    const np = nearestOnTrack([p.lat, p.lon]);
    p._along = np ? np.along : null;
    p._off = np ? np.d : null;
  }
}

function updateStats(){
  const len = trackCum.length ? trackCum[trackCum.length-1] : 0;
  let ascent = 0, last = null;
  for (const e of trackEle){ if (e==null) continue; if (last!=null && e>last) ascent += e-last; last = e; }
  const n = userPoints.length + seedPoints.length;
  $('#trailStats').textContent = `${fmtKm(len)} · набор ${Math.round(ascent)} м · точек: ${n}`;
}

// ---------- Elevation profile ----------
const elevSvg = $('#elev'), elevTip = $('#elevTip');
let elevGeom = null; // {minX,maxX,minE,maxE,W,H,toX(d),toY(e)}
function drawElevation(){
  const wrap = $('#elevWrap');
  const haveEle = trackEle.some(e => e != null);
  if (!trackLatLngs.length || !haveEle){ wrap.hidden = true; return; }
  wrap.hidden = false;
  const W = 1000, H = 140, padB = 14, padT = 10;
  const totalD = trackCum[trackCum.length-1] || 1;
  const eles = trackEle.map((e,i)=> e==null ? null : e);
  let minE = Infinity, maxE = -Infinity;
  for (const e of eles){ if (e==null) continue; if (e<minE) minE=e; if (e>maxE) maxE=e; }
  if (!isFinite(minE)){ minE=0; maxE=1; }
  if (maxE - minE < 1) maxE = minE + 1;
  const toX = d => (d/totalD)*W;
  const toY = e => H - padB - ((e-minE)/(maxE-minE))*(H-padB-padT);
  elevGeom = { totalD, minE, maxE, W, H, toX, toY };

  let dPath = '', area = '';
  let started = false;
  for (let i=0;i<eles.length;i++){
    if (eles[i]==null) continue;
    const x = toX(trackCum[i]).toFixed(1), y = toY(eles[i]).toFixed(1);
    if (!started){ dPath += `M${x} ${y}`; area += `M${x} ${H-padB} L${x} ${y}`; started = true; }
    else { dPath += ` L${x} ${y}`; area += ` L${x} ${y}`; }
  }
  area += ` L${W} ${H-padB} Z`;
  const gridY = [];
  const step = niceStep(maxE-minE);
  for (let e = Math.ceil(minE/step)*step; e < maxE; e += step){
    gridY.push(`<line x1="0" y1="${toY(e).toFixed(1)}" x2="${W}" y2="${toY(e).toFixed(1)}" class="g"/><text x="4" y="${(toY(e)-3).toFixed(1)}" class="gt">${Math.round(e)} м</text>`);
  }
  elevSvg.innerHTML = `
    <style>
      #elev .g{stroke:#d7dbd5;stroke-width:1}
      #elev .gt{fill:#9aa19a;font-size:11px}
      #elev .area{fill:rgba(198,40,40,.14)}
      #elev .ln{fill:none;stroke:#c62828;stroke-width:2}
      #elev .cursor{stroke:#1b5e20;stroke-width:1.5}
      #elev .dot{fill:#1b5e20}
    </style>
    ${gridY.join('')}
    <path class="area" d="${area}"/>
    <path class="ln" d="${dPath}"/>
    <line class="cursor" id="elevCursor" x1="0" y1="${padT}" x2="0" y2="${H-padB}" style="display:none"/>
    <circle class="dot" id="elevDot" r="4" style="display:none"/>
  `;
}
function niceStep(range){
  const raw = range/4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw||1)));
  const n = raw/pow;
  return (n<1.5?1:n<3?2:n<7?5:10)*pow;
}

let elevHoverMarker = null;
function onElevMove(ev){
  if (!elevGeom || !trackLatLngs.length) return;
  const rect = elevSvg.getBoundingClientRect();
  const cx = ('touches' in ev ? ev.touches[0].clientX : ev.clientX) - rect.left;
  const frac = Math.max(0, Math.min(1, cx/rect.width));
  const targetD = frac * elevGeom.totalD;
  // binary-ish search nearest cum
  let i = 0; while (i < trackCum.length-1 && trackCum[i+1] < targetD) i++;
  const e = trackEle[i];
  const X = elevGeom.toX(trackCum[i]);
  const cursor = $('#elevCursor'), dot = $('#elevDot');
  if (cursor){ cursor.style.display=''; cursor.setAttribute('x1', X); cursor.setAttribute('x2', X); }
  if (dot && e!=null){ dot.style.display=''; dot.setAttribute('cx', X); dot.setAttribute('cy', elevGeom.toY(e)); }
  elevTip.hidden = false;
  elevTip.style.left = (cx) + 'px';
  elevTip.style.top = '14px';
  elevTip.textContent = `${(trackCum[i]/1000).toFixed(2)} км${e!=null?` · ${Math.round(e)} м`:''}`;
  const ll = trackLatLngs[i];
  if (!elevHoverMarker) elevHoverMarker = L.circleMarker(ll, { radius:7, color:'#1b5e20', weight:3, fillColor:'#fff', fillOpacity:1 }).addTo(map);
  else elevHoverMarker.setLatLng(ll);
}
function onElevLeave(){
  elevTip.hidden = true;
  const c=$('#elevCursor'), d=$('#elevDot'); if(c)c.style.display='none'; if(d)d.style.display='none';
  if (elevHoverMarker){ elevHoverMarker.remove(); elevHoverMarker = null; }
}
elevSvg.addEventListener('mousemove', onElevMove);
elevSvg.addEventListener('mouseleave', onElevLeave);
elevSvg.addEventListener('touchstart', onElevMove, {passive:true});
elevSvg.addEventListener('touchmove', onElevMove, {passive:true});
elevSvg.addEventListener('touchend', onElevLeave);
$('#elevToggle').addEventListener('click', ()=> $('#elevWrap').classList.toggle('collapsed'));

// ---------- Points: storage ----------
function loadUserPoints(){
  try { userPoints = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { userPoints = []; }
  if (!Array.isArray(userPoints)) userPoints = [];
}
function saveUserPoints(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(userPoints)); }
  catch(e){ toast('Не удалось сохранить в этом браузере'); }
}

function geojsonToPoints(gj, markSeed){
  const feats = (gj && gj.features) || [];
  const out = [];
  for (const f of feats){
    if (!f.geometry || f.geometry.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties || {};
    out.push({
      id: p.id || uid(),
      name: p.name || p.title || 'Без названия',
      description: p.description || p.desc || p.note || '',
      category: CATS[p.category] ? p.category : 'other',
      lat, lon,
      created: p.created || null,
      _seed: !!markSeed,
    });
  }
  return out;
}
function pointsToGeojson(points, name){
  return {
    type:'FeatureCollection',
    name: name || 'Точки тропы',
    generated: new Date().toISOString().slice(0,10),
    features: points.map(p => ({
      type:'Feature',
      properties:{ id:p.id, name:p.name, description:p.description, category:p.category, created:p.created || new Date().toISOString().slice(0,10) },
      geometry:{ type:'Point', coordinates:[ +p.lon.toFixed(6), +p.lat.toFixed(6) ] }
    }))
  };
}

// ---------- Points: rendering ----------
function poiDivIcon(cat){
  const c = catOf(cat);
  return L.divIcon({
    className:'', html:`<div class="poi-pin" style="background:${c.color}"><span>${c.icon}</span></div>`,
    iconSize:[28,28], iconAnchor:[14,28], popupAnchor:[0,-26]
  });
}
function allPoints(){ return [...seedPoints, ...userPoints]; }

function renderMarkers(){
  for (const m of markerById.values()) m.remove();
  markerById.clear();
  recomputePointAlong();
  if ($('#chkPoints') && !$('#chkPoints').checked){ renderPoiList(); updateStats(); return; }
  for (const p of allPoints()){
    const m = L.marker([p.lat, p.lon], { icon: poiDivIcon(p.category) }).addTo(map);
    m.bindPopup(() => popupHtml(p));
    m.on('popupopen', e => bindPopupActions(e.popup, p));
    markerById.set(p.id, m);
  }
  renderPoiList();
  updateStats();
}
function popupHtml(p){
  const c = catOf(p.category);
  const div = el('div');
  div.innerHTML = `<div class="pcat">${c.icon} ${c.label}</div>
    <h4>${escapeHtml(p.name)}</h4>
    ${p.description ? `<div>${escapeHtml(p.description).replace(/\n/g,'<br>')}</div>` : ''}
    <div class="pcat" style="margin-top:6px">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${p.created?` · ${p.created}`:''}</div>
    ${isAdmin ? `<div class="pact">
      <button class="edit">✎ Изменить</button>
      <button class="del">🗑 Удалить</button>
    </div>` : ''}`;
  return div;
}
function bindPopupActions(popup, p){
  if (!isAdmin) return;
  const node = popup.getElement();
  if (!node) return;
  const ed = node.querySelector('.edit'), del = node.querySelector('.del');
  if (ed) ed.onclick = () => { map.closePopup(); openPoiDialog(p); };
  if (del) del.onclick = () => {
    if (!confirm(`Удалить точку «${p.name}»?`)) return;
    map.closePopup();
    deletePoint(p.id);
  };
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function renderPoiList(){
  const box = $('#poiList'); box.innerHTML = '';
  const pts = allPoints();
  if (!pts.length){ const e=el('div','poi-empty'); e.textContent = isAdmin ? 'Точек пока нет — нажмите ＋ на карте.' : 'Точек пока нет.'; box.appendChild(e); return; }
  for (const p of pts){
    const c = catOf(p.category);
    const item = el('div','poi-item');
    item.innerHTML = `<span class="ic">${c.icon}</span><span class="nm">${escapeHtml(p.name)}<div class="cat">${c.label}${p._seed?' · из файла':''}</div></span>`;
    item.onclick = () => {
      closePanel();
      map.setView([p.lat,p.lon], Math.max(map.getZoom(), 15));
      const m = markerById.get(p.id); if (m) m.openPopup();
    };
    box.appendChild(item);
  }
}

// ---------- Add / edit point ----------
function fillCatSelect(){
  const sel = $('#poiCat'); sel.innerHTML='';
  for (const [k,v] of Object.entries(CATS)){
    const o = el('option'); o.value=k; o.textContent=`${v.icon} ${v.label}`; sel.appendChild(o);
  }
}
function startAddPoint(){
  if (!isAdmin){ toast('Добавлять точки может только администратор'); return; }
  toast('Коснитесь карты, где поставить точку');
  map.getContainer().style.cursor = 'crosshair';
  $('#btnAdd').classList.add('active');
  map.once('click', e => {
    map.getContainer().style.cursor='';
    $('#btnAdd').classList.remove('active');
    pendingLatLng = e.latlng;
    editingId = null;
    if (addPreviewMarker) addPreviewMarker.remove();
    addPreviewMarker = L.marker(e.latlng, { icon: poiDivIcon('other'), opacity:0.7 }).addTo(map);
    openPoiDialog(null, e.latlng);
  });
}
function openPoiDialog(point, latlng){
  editingId = point ? point.id : null;
  pendingLatLng = latlng || (point ? L.latLng(point.lat, point.lon) : null);
  $('#poiDlgTitle').textContent = point ? 'Изменить точку' : 'Новая точка';
  $('#poiName').value = point ? point.name : '';
  $('#poiDesc').value = point ? point.description : '';
  $('#poiCat').value = point ? point.category : 'other';
  $('#poiCoord').textContent = pendingLatLng ? `Координаты: ${pendingLatLng.lat.toFixed(6)}, ${pendingLatLng.lng.toFixed(6)}` : '';
  $('#poiDelete').hidden = !point;
  $('#poiBackdrop').hidden = false;
  $('#poiDialog').hidden = false;
  setTimeout(()=>$('#poiName').focus(), 50);
}
function closePoiDialog(){
  $('#poiBackdrop').hidden = true;
  $('#poiDialog').hidden = true;
  if (addPreviewMarker){ addPreviewMarker.remove(); addPreviewMarker = null; }
  pendingLatLng = null; editingId = null;
}
function savePoiDialog(){
  const name = $('#poiName').value.trim() || 'Без названия';
  const description = $('#poiDesc').value.trim();
  const category = $('#poiCat').value;
  if (!pendingLatLng){ closePoiDialog(); return; }
  if (editingId){
    const p = userPoints.find(x=>x.id===editingId) || seedPoints.find(x=>x.id===editingId);
    if (p){
      p.name=name; p.description=description; p.category=category;
      p.lat=pendingLatLng.lat; p.lon=pendingLatLng.lng;
      if (p._seed) toast('Изменено. Точки из файла сохраняются только при экспорте — нажмите «Сохранить точки».');
    }
  } else {
    userPoints.push({ id: uid(), name, description, category, lat:pendingLatLng.lat, lon:pendingLatLng.lng, created:new Date().toISOString().slice(0,10) });
  }
  saveUserPoints();
  closePoiDialog();
  renderMarkers();
  if (!editingId) toast('Точка сохранена');
}
function deletePoint(id){
  const i = userPoints.findIndex(x=>x.id===id);
  if (i>=0){ userPoints.splice(i,1); saveUserPoints(); renderMarkers(); toast('Точка удалена'); return; }
  // seed point: remove from in-memory list (note: comes back on reload unless file edited)
  const j = seedPoints.findIndex(x=>x.id===id);
  if (j>=0){ seedPoints.splice(j,1); renderMarkers(); toast('Точка из файла скрыта (до перезагрузки). Чтобы убрать насовсем — отредактируйте data/points.geojson'); }
}

$('#poiSave').onclick = savePoiDialog;
$('#poiCancel').onclick = closePoiDialog;
$('#poiBackdrop').onclick = closePoiDialog;
$('#poiDelete').onclick = () => { if (editingId && confirm('Удалить эту точку?')){ const id=editingId; closePoiDialog(); deletePoint(id);} };
$('#btnAdd').onclick = startAddPoint;

// ---------- Geolocation ----------
let meMarker = null, meCircle = null, geoWatchId = null, follow = false;
let lastLL = null, gpsHeading = null, compassHeading = null;

function meIconHtml(){
  const hd = headingNow();
  const wedge = (navOn && hd != null) ? `<div class="me-head" style="transform:rotate(${hd}deg)"></div>` : '';
  return `<div class="me-wrap">${wedge}<div class="me-dot"></div></div>`;
}
function refreshMeIcon(){
  if (!meMarker) return;
  meMarker.setIcon(L.divIcon({ className:'', html:meIconHtml(), iconSize:[34,34], iconAnchor:[17,17] }));
}
function ensureGeoWatch(){
  if (geoWatchId != null || !navigator.geolocation) return;
  geoWatchId = navigator.geolocation.watchPosition(onGeo, onGeoErr, { enableHighAccuracy:true, maximumAge:2000, timeout:20000 });
}
function onGeo(pos){
  const { latitude:lat, longitude:lon, accuracy:acc } = pos.coords;
  const ll = [lat, lon]; lastLL = ll;
  if (pos.coords.heading != null && isFinite(pos.coords.heading) && pos.coords.speed != null && pos.coords.speed > 0.7) gpsHeading = pos.coords.heading;
  if (!meMarker){
    meMarker = L.marker(ll, { icon: L.divIcon({className:'', html:meIconHtml(), iconSize:[34,34], iconAnchor:[17,17]}), zIndexOffset:1000 }).addTo(map);
    meCircle = L.circle(ll, { radius:acc||20, color:'#1976d2', weight:1, fillColor:'#1976d2', fillOpacity:.12 }).addTo(map);
  } else {
    meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(acc||20); refreshMeIcon();
  }
  if (follow) map.setView(ll, Math.max(map.getZoom(), navOn ? 17 : 16), { animate:true });
  else if (!didAutoCenter && !userInteracted){ didAutoCenter = true; map.setView(ll, Math.max(map.getZoom(), 15)); }
  if (recording) recordPush(lat, lon, pos.coords.altitude, pos.timestamp);
  if (navOn) updateNav(ll);
}
function onGeoErr(err){
  if (err.code === 1){
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const msg = isIOS
      ? 'Геолокация запрещена. Откройте Настройки → Safari → Геопозиция и разрешите для этого сайта.'
      : 'Геолокация запрещена. Нажмите на замок 🔒 слева от адреса сайта и разрешите «Местоположение».';
    toast(msg, 5000);
  } else {
    toast('Не удалось определить местоположение. Проверьте, что GPS включён на устройстве.', 4000);
  }
  follow = false; $('#btnLocate').classList.remove('active');
  if (navOn) navStop();
}
$('#btnLocate').onclick = () => {
  if (!navigator.geolocation){ toast('Геолокация недоступна'); return; }
  ensureGeoWatch();
  follow = !follow;
  $('#btnLocate').classList.toggle('active', follow);
  if (follow && meMarker) map.setView(meMarker.getLatLng(), Math.max(map.getZoom(), 16));
  if (follow && !meMarker) toast('Определяю местоположение…');
};
map.on('dragstart', () => { userInteracted = true; if (follow){ follow=false; $('#btnLocate').classList.remove('active'); } });
$('#btnFit').onclick = () => {
  userInteracted = true;
  if (trackLine) map.fitBounds(trackLine.getBounds().pad(0.15));
  else if (allPoints().length) map.fitBounds(L.latLngBounds(allPoints().map(p=>[p.lat,p.lon])).pad(0.2));
  else map.setView(KO_CENTER, 9);
};

// ---------- Trail navigation ----------
let navOn = false, navWasOff = false, navLastVibe = 0, navTargetBearing = null, _orientT = 0;
let navResumeWanted = false;          // set on boot if navigation was on when the app was closed
const NAV_ON_KEY = 'tropa.nav.on';
const OFF_TRAIL_M = 35;
function headingNow(){ return (compassHeading != null && isFinite(compassHeading)) ? compassHeading : (gpsHeading != null ? gpsHeading : null); }
function onOrient(e){
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading)) h = e.webkitCompassHeading;          // iOS
  else if (e.absolute && typeof e.alpha === 'number' && isFinite(e.alpha)) h = (360 - e.alpha) % 360;                      // Android (absolute)
  if (h == null) return;
  compassHeading = h;
  const now = Date.now();
  if (now - _orientT < 120) return; _orientT = now;                       // throttle visual updates
  if (navOn){ if (navTargetBearing != null) $('#navArrow').style.transform = `rotate(${((navTargetBearing - h)+360)%360}deg)`; refreshMeIcon(); }
}
async function enableCompass(){
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'){
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return;
    }
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
  } catch {}
}
async function navStart(){
  if (trackLatLngs.length < 2){ toast('Сначала загрузите трек тропы'); return; }
  if (!navigator.geolocation){ toast('Геолокация недоступна'); return; }
  navOn = true; navWasOff = false;
  try { localStorage.setItem(NAV_ON_KEY, '1'); } catch {}
  $('#navBar').hidden = false; $('#navBar').classList.remove('off');
  $('#navMain').textContent = 'Веду по тропе…'; $('#navSub').textContent = 'Определяю положение…';
  $('#btnNav').classList.add('active');
  ensureGeoWatch(); follow = true; $('#btnLocate').classList.add('active');
  await enableCompass();
  closePanel();
  if (lastLL) updateNav(lastLL);
}
function navStop(){
  navOn = false; follow = false;
  try { localStorage.removeItem(NAV_ON_KEY); } catch {}
  $('#navBar').hidden = true; $('#btnNav').classList.remove('active'); $('#btnLocate').classList.remove('active');
  navTargetBearing = null; refreshMeIcon();
}
function vibe(pattern){ try { navigator.vibrate && navigator.vibrate(pattern); } catch {} }
function updateNav(ll){
  if (!navOn || trackLatLngs.length < 2) return;
  const np = nearestOnTrack(ll); if (!np) return;
  const total = trackCum[trackCum.length-1] || 0;
  const along = np.along, remaining = Math.max(0, total - along), off = np.d;
  const offTrail = off > OFF_TRAIL_M;
  // off the trail → arrow points back to it; on it → arrow points down the track ahead of you
  const target = offTrail ? np.ll : pointAtAlong(Math.min(total, along + 45));
  navTargetBearing = target ? bearing(ll, target) : null;
  const hd = headingNow();
  const arr = $('#navArrow');
  if (navTargetBearing != null){ arr.style.transform = `rotate(${((navTargetBearing - (hd||0))+360)%360}deg)`; arr.style.opacity = '1'; }
  else arr.style.opacity = '.25';

  const nb = $('#navBar');
  nb.classList.toggle('off', offTrail);
  if (offTrail){
    $('#navMain').textContent = `⚠️ Вы в ${Math.round(off)} м от тропы`;
    $('#navSub').textContent = hd != null ? 'Стрелка укажет, куда вернуться' : 'Пройдите пару шагов — стрелка станет точнее';
    const now = Date.now();
    if (!navWasOff || now - navLastVibe > 15000){ vibe([180,90,180]); navLastVibe = now; }
  } else if (remaining < 25){
    $('#navMain').textContent = '🏁 Финиш рядом'; $('#navSub').textContent = `Пройдено ${fmtKm(along)}`;
  } else {
    $('#navMain').textContent = `Осталось ${fmtKm(remaining)}`;
    let up = null;
    for (const p of allPoints()){
      if (p._along == null || (p._off != null && p._off > 200)) continue;
      if (p._along <= along + 5) continue;
      if (!up || p._along < up._along) up = p;
    }
    if (up){ const c = catOf(up.category); $('#navSub').textContent = `${c.icon} ${up.name} · через ${fmtKm(up._along - along)}`; }
    else $('#navSub').textContent = `Пройдено ${fmtKm(along)}${hd == null ? ' · стрелка точнее в движении' : ''}`;
  }
  navWasOff = offTrail;
}
const navBtnEl = $('#btnNav');
if (navBtnEl) navBtnEl.onclick = () => navOn ? navStop() : navStart();
const navStartBtn = $('#btnNavStart');
if (navStartBtn) navStartBtn.onclick = () => navOn ? navStop() : navStart();
const navCloseEl = $('#navClose');
if (navCloseEl) navCloseEl.onclick = navStop;

// ---------- Record a track by GPS ----------
let recording = false, recPts = [], recLine = null, recDist = 0;
function recordStart(){
  if (!navigator.geolocation){ toast('Геолокация недоступна'); return; }
  recording = true; recPts = []; recDist = 0;
  if (recLine) recLine.remove();
  recLine = L.polyline([], { color:'#f4511e', weight:5, dashArray:'1,8', lineCap:'round' }).addTo(map);
  ensureGeoWatch();
  follow = true; $('#btnLocate').classList.add('active');
  $('#recBadge').hidden = false; $('#recInfo').textContent = '0.00 км';
  const b=$('#btnRecStart'); b.textContent='● Идёт запись… (стоп)'; b.classList.add('recording');
  toast('Запись трека началась. Не закрывайте вкладку.');
  closePanel();
}
function recordPush(lat, lon, alt, ts){
  const last = recPts[recPts.length-1];
  if (last){
    const d = haversine([last.lat,last.lon],[lat,lon]);
    if (d < 3) return;        // ignore GPS jitter
    recDist += d;
  }
  recPts.push({ lat, lon, ele: (alt!=null && isFinite(alt)) ? alt : null, t: new Date(ts||Date.now()).toISOString() });
  recLine.addLatLng([lat, lon]);
  $('#recInfo').textContent = fmtKm(recDist) + ` · ${recPts.length} точ.`;
}
function recordStop(){
  recording = false;
  $('#recBadge').hidden = true;
  const b=$('#btnRecStart'); b.textContent='● Записать трек по GPS'; b.classList.remove('recording');
  if (recPts.length < 2){ toast('Трек слишком короткий — не сохранён'); if(recLine){recLine.remove();recLine=null;} return; }
  const name = prompt('Название трека:', $('#trailName').textContent || 'Моя тропа') || 'Моя тропа';
  download(slugify(name)+'.gpx', recordToGpx(name, recPts), 'application/gpx+xml');
  if (confirm('Сделать этот трек текущим на карте?')){
    setTrack({ name, points: recPts }, { fit:true });
  }
  if (recLine){ recLine.remove(); recLine=null; }
  toast('Трек сохранён в файл GPX');
}
function recordToGpx(name, pts){
  const esc = s => String(s).replace(/[<>&]/g,m=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]));
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Тропа КО" xmlns="http://www.topografix.com/GPX/1/1">\n`;
  s += `  <metadata><name>${esc(name)}</name><time>${new Date().toISOString()}</time></metadata>\n`;
  s += `  <trk><name>${esc(name)}</name><trkseg>\n`;
  for (const p of pts){
    s += `    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">`;
    if (p.ele!=null) s += `<ele>${p.ele.toFixed(1)}</ele>`;
    if (p.t) s += `<time>${p.t}</time>`;
    s += `</trkpt>\n`;
  }
  s += `  </trkseg></trk>\n</gpx>\n`;
  return s;
}
function slugify(s){ return (s||'track').toLowerCase().replace(/[^\wа-яё]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'track'; }
$('#btnRecStart').onclick = () => recording ? recordStop() : recordStart();
$('#btnRecStop').onclick = recordStop;

// ---------- Import / export ----------
$('#btnExportGeo').onclick = () => {
  const all = allPoints();
  if (!all.length){ toast('Нет точек для экспорта'); return; }
  download('points.geojson', JSON.stringify(pointsToGeojson(all, $('#trailName').textContent), null, 2), 'application/geo+json');
  toast('Файл points.geojson скачан');
};
$('#btnImportGeo').onclick = () => $('#fileGeo').click();
$('#fileGeo').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const gj = JSON.parse(r.result);
      const pts = geojsonToPoints(gj, false);
      if (!pts.length){ toast('В файле нет точек'); return; }
      if (confirm(`Заменить текущие добавленные точки на ${pts.length} из файла?`)){
        userPoints = pts; saveUserPoints();
      } else {
        userPoints = userPoints.concat(pts); saveUserPoints();
      }
      renderMarkers(); toast('Точки загружены');
    } catch { toast('Не похоже на GeoJSON'); }
  };
  r.readAsText(f); e.target.value='';
};
$('#btnImportGpx').onclick = () => $('#fileGpx').click();
$('#fileGpx').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { setTrack(parseGpx(r.result), { fit:true }); toast('Трек загружен'); } catch(err){ toast('Не удалось прочитать GPX'); } };
  r.readAsText(f); e.target.value='';
};

// ---------- Layers panel ----------
document.querySelectorAll('input[name=base]').forEach(r => r.onchange = () => {
  if (!r.checked) return;
  baseLayers[currentBase].remove();
  currentBase = r.value;
  baseLayers[currentBase].addTo(map).bringToBack();
  prefs.base = currentBase; savePrefs();
});
$('#chkPoints').onchange = () => { prefs.points = $('#chkPoints').checked; savePrefs(); renderMarkers(); };
$('#chkTrack').onchange = () => {
  prefs.track = $('#chkTrack').checked; savePrefs();
  if (!trackLine) return;
  if ($('#chkTrack').checked) trackLine.addTo(map); else trackLine.remove();
};

// ---------- Side panel ----------
function openPanel(){ $('#panel').hidden=false; $('#panelBackdrop').hidden=false; renderPoiList(); }
function closePanel(){ $('#panel').hidden=true; $('#panelBackdrop').hidden=true; }
$('#btnMenu').onclick = openPanel;
$('#panelClose').onclick = closePanel;
$('#panelBackdrop').onclick = closePanel;

// ---------- Offline tiles ----------
function lonToTileX(lon, z){ return Math.floor((lon+180)/360 * Math.pow(2,z)); }
function latToTileY(lat, z){ const r=lat*Math.PI/180; return Math.floor((1 - Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2 * Math.pow(2,z)); }
const SUBS = ['a','b','c'];
async function cacheVisibleArea(){
  const b = map.getBounds();
  const z0 = map.getZoom();
  const layer = currentBase==='topo' ? baseLayers.topo : baseLayers.osm;
  const maxZoom = layer.options.maxZoom || 18;
  const urls = [];
  for (let z = z0; z <= Math.min(z0+3, maxZoom); z++){
    const x1=lonToTileX(b.getWest(),z), x2=lonToTileX(b.getEast(),z);
    const y1=latToTileY(b.getNorth(),z), y2=latToTileY(b.getSouth(),z);
    for (let x=x1;x<=x2;x++) for (let y=y1;y<=y2;y++){
      const host = currentBase==='topo' ? `https://${SUBS[(x+y)%3]}.tile.opentopomap.org` : `https://${SUBS[(x+y)%3]}.tile.openstreetmap.org`;
      urls.push(`${host}/${z}/${x}/${y}.png`);
    }
  }
  if (urls.length > 1500){ toast(`Слишком большая область (${urls.length} тайлов). Приблизьте карту и повторите.`); return; }
  const prog = $('#cacheProgress');
  prog.textContent = `Скачиваю 0 / ${urls.length}…`;
  let done=0, ok=0;
  const queue = urls.slice();
  async function worker(){
    while (queue.length){
      const u = queue.pop();
      try { const res = await fetch(u, { mode:'cors', cache:'reload' }); if (res.ok) ok++; }
      catch{}
      done++;
      if (done%15===0 || done===urls.length) prog.textContent = `Скачиваю ${done} / ${urls.length}…`;
    }
  }
  await Promise.all([worker(),worker(),worker(),worker()]);
  prog.textContent = `Готово: ${ok} из ${urls.length} тайлов сохранено для офлайна.`;
  toast('Карта этой области скачана');
}
$('#btnCacheArea').onclick = () => cacheVisibleArea().catch(()=>toast('Не удалось скачать'));
$('#btnClearTiles').onclick = async () => {
  if (!('caches' in window)) return;
  await caches.delete('tropa-tiles-v1');
  $('#cacheProgress').textContent = 'Скачанные тайлы удалены.';
  toast('Кэш карты очищен');
};

// ---------- Online/offline indicator ----------
function updateNet(){ const s=$('#netStatus'); const off=!navigator.onLine; s.classList.toggle('off',off); s.title = off?'Сеть: офлайн — карта берётся из скачанного кэша':'Сеть: онлайн — карта подгружается из интернета'; }
$('#netStatus').onclick = () => toast(navigator.onLine ? 'Сеть: онлайн — карта подгружается из интернета' : 'Сеть: офлайн — карта берётся из скачанного кэша', 2600);
window.addEventListener('online', updateNet); window.addEventListener('offline', updateNet); updateNet();

// ---------- PWA install ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#btnInstall').hidden = false; });
$('#btnInstall').onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#btnInstall').hidden = true;
};
window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; toast('Установлено на устройство'); });

// ---------- Service worker ----------
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(()=>{}));
}

// ---------- Admin: leave admin mode ----------
const adminLogoutBtn = $('#btnAdminLogout');
if (adminLogoutBtn) adminLogoutBtn.onclick = () => {
  if (!confirm('Выйти из режима администратора в этом браузере?')) return;
  localStorage.removeItem('tropa.admin');
  location.href = location.pathname;
};

// ---------- Onboarding ----------
(function onboarding(){
  const OB_KEY = 'tropa.onboarded';
  const card = $('#welcomeCard');
  const backdrop = $('#welcomeBackdrop');
  if (!card || !backdrop) return;

  const isInstalled = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  // If already onboarded, check if we should show install prompt
  if (localStorage.getItem(OB_KEY) === '1'){
    if (!isInstalled && deferredPrompt){
      // Show install step only
      $('#obStep1').classList.add('hidden');
      $('#obStep2').classList.add('hidden');
      $('#obStep3').classList.remove('hidden');
    } else {
      card.classList.add('hidden');
      backdrop.classList.add('hidden');
    }
    // Logo tap reopens welcome
    const logo = $('.logo-group');
    if (logo){ logo.style.cursor = 'pointer'; logo.onclick = () => { showStep(1); }; }
    setupSteps();
    return;
  }

  setupSteps();
  const logo = $('.logo-group');
  if (logo){ logo.style.cursor = 'pointer'; logo.onclick = () => { showStep(1); }; }

  function showStep(n){
    card.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    for (let i=1;i<=3;i++){
      const s = $('#obStep'+i);
      if (s) s.classList.toggle('hidden', i !== n);
    }
  }

  function closeAll(){
    card.classList.add('hidden');
    backdrop.classList.add('hidden');
    localStorage.setItem(OB_KEY, '1');
  }

  function setupSteps(){
    // Step 1 -> Step 2
    const next1 = $('#obNext1');
    if (next1) next1.onclick = () => {
      // Check if geo already granted
      if (navigator.permissions && navigator.permissions.query){
        navigator.permissions.query({name:'geolocation'}).then(st => {
          if (st.state === 'granted'){
            // Skip geo step, go to install
            if (!isInstalled) showStep(3);
            else closeAll();
          } else {
            showStep(2);
          }
        }).catch(() => showStep(2));
      } else {
        showStep(2);
      }
    };

    // Step 2: request geo
    const geoBtn = $('#obGeo');
    if (geoBtn) geoBtn.onclick = () => {
      navigator.geolocation.getCurrentPosition(
        () => {
          ensureGeoWatch();
          if (!isInstalled) showStep(3);
          else closeAll();
        },
        (err) => {
          if (err.code === 1){
            const d = $('#obGeoDenied');
            if (d) d.classList.remove('hidden');
          }
        },
        { timeout: 10000 }
      );
    };
    const skipGeo = $('#obSkipGeo');
    if (skipGeo) skipGeo.onclick = () => {
      if (!isInstalled) showStep(3);
      else closeAll();
    };

    // Step 3: install
    const installBtn = $('#obInstall');
    if (installBtn) installBtn.onclick = async () => {
      if (deferredPrompt){
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        closeAll();
      } else {
        // Show manual instructions
        const hint = $('#obInstallHint');
        if (hint){
          const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
          hint.innerHTML = isIOS
            ? 'Нажмите кнопку «Поделиться» (квадрат со стрелкой) внизу Safari, затем «На экран Домой».'
            : 'В меню браузера (три точки) выберите «Добавить на главный экран» или «Установить приложение».';
          hint.classList.remove('hidden');
        }
      }
    };
    const skipInstall = $('#obSkipInstall');
    if (skipInstall) skipInstall.onclick = () => closeAll();
  }
})();

// ---------- Boot ----------
fillCatSelect();
loadUserPoints();
const navBtnInit = $('#btnNav'); if (navBtnInit) navBtnInit.hidden = true;   // shown once a track is loaded
// If location was already allowed before — start tracking right away so the map opens "where you are now",
// and remember to resume trail navigation if it was on when the app was last closed.
if (localStorage.getItem(NAV_ON_KEY) === '1') navResumeWanted = true;
if (navigator.permissions && navigator.permissions.query){
  navigator.permissions.query({ name:'geolocation' }).then(st => {
    if (st.state === 'granted') ensureGeoWatch();
    else if (st.state === 'denied') navResumeWanted = false;
  }).catch(()=>{});
}

(async function init(){
  // load reference track
  try {
    const res = await fetch('data/track.gpx', { cache:'no-cache' });
    if (res.ok) setTrack(parseGpx(await res.text()), { fit: !restoredView });
  } catch { /* offline or missing — ignore */ }
  // load seed points
  try {
    const res = await fetch('data/points.geojson', { cache:'no-cache' });
    if (res.ok) seedPoints = geojsonToPoints(await res.json(), true);
  } catch {}
  renderMarkers();
  if (!trackLatLngs.length && !allPoints().length){
    toast('Нет данных. Запустите через локальный сервер (см. README) или загрузите GPX/GeoJSON через меню.');
  }
  // Resume trail navigation if it was running when the app was closed (only if GPS is already allowed).
  if (navResumeWanted && trackLatLngs.length >= 2 && !navOn){
    toast('🧭 Навигация по тропе возобновлена');
    navStart();
  }
})();

// keyboard escape
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#poiDialog').hidden) closePoiDialog();
  else if (!$('#panel').hidden) closePanel();
});
