(() => {
  const CFG = window.APP_CONFIG;
  const TABLES = Array.from({ length: CFG.TABLE_END - CFG.TABLE_START + 1 }, (_, i) => `C${CFG.TABLE_START + i}`);
  const isConfigured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('YOUR_') && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes('YOUR_');
  const DEMO = CFG.DEMO_MODE || !isConfigured;
  const sb = (!DEMO && window.supabase) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

  const state = { bookings: [], profile: { role: DEMO ? 'admin' : 'staff' }, user: null, scanner: null, importRows: [] };

  const $ = (id) => document.getElementById(id);
  const el = {
    setupBanner: $('setupBanner'), loginView: $('loginView'), appShell: $('appShell'), loginForm: $('loginForm'), loginEmail: $('loginEmail'), loginPassword: $('loginPassword'), loginStatus: $('loginStatus'),
    pageTitle: $('pageTitle'), userEmail: $('userEmail'), userRole: $('userRole'), logoutBtn: $('logoutBtn'), statPaidTables: $('statPaidTables'), statAvailableTables: $('statAvailableTables'), statCheckedIn: $('statCheckedIn'), availableQuick: $('availableQuick'), lastSync: $('lastSync'),
    bookingSearch: $('bookingSearch'), bookingFilter: $('bookingFilter'), bookingRows: $('bookingRows'), tableGrid: $('tableGrid'), startScanner: $('startScanner'), stopScanner: $('stopScanner'), scannerStatus: $('scannerStatus'), manualLookupText: $('manualLookupText'), manualLookupBtn: $('manualLookupBtn'), scanResult: $('scanResult'),
    csvFile: $('csvFile'), downloadTemplate: $('downloadTemplate'), importPreview: $('importPreview'), confirmImport: $('confirmImport'), importStatus: $('importStatus'), historyRows: $('historyRows'), bookingDialog: $('bookingDialog'), dialogClose: $('dialogClose'), dialogContent: $('dialogContent')
  };

  const demoData = [
    { id:'d1', booking_ref:'BK001', name:'สมชาย ใจดี', phone:'0812345678', table_number:'C18', seats:8, college_qr_value:'COLLEGE-QR-BK001', checked_in_at:null },
    { id:'d2', booking_ref:'BK002', name:'วิชัย ช่างดี', phone:'0891112233', table_number:'C24', seats:8, college_qr_value:'COLLEGE-QR-BK002', checked_in_at:new Date().toISOString() },
    { id:'d3', booking_ref:'BK003', name:'ประเสริฐ ทองดี', phone:'0863332211', table_number:'C31', seats:8, college_qr_value:'COLLEGE-QR-BK003', checked_in_at:null }
  ];

  function setNotice(node, text, type='') { node.textContent = text || ''; node.className = `notice ${type}`.trim(); }
  function normalizePhone(v=''){ return String(v).replace(/\D/g,''); }
  function loginIdentifierToEmail(v=''){
    const raw = String(v).trim();
    if (raw.includes('@')) return raw.toLowerCase();
    const phone = normalizePhone(raw);
    if (/^0\d{9}$/.test(phone)) return `${phone}@staff.local`;
    return '';
  }
  function displayUserIdentifier(email=''){
    const m = String(email).match(/^(0\d{9})@staff\.local$/i);
    return m ? m[1] : (email || 'เจ้าหน้าที่');
  }
  function validTable(t=''){ return /^C(?:1[1-9]|[2-5]\d|60)$/i.test(String(t).trim()); }
  function statusOfBooking(b){ return b.checked_in_at ? 'checked' : 'paid'; }
  function tableBooking(t){ return state.bookings.find(b => b.table_number === t); }
  function tableStatus(t){ const b = tableBooking(t); return !b ? 'available' : statusOfBooking(b); }
  function statusLabel(s){ return s === 'checked' ? 'เช็กอินแล้ว' : s === 'paid' ? 'ชำระแล้ว' : 'ว่าง'; }
  function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c])); }
  function fmtTime(v){ if(!v) return '-'; return new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)); }

  async function init(){
    if (DEMO) {
      el.setupBanner.classList.remove('hidden');
      el.setupBanner.textContent = 'โหมดทดสอบในเครื่อง — หน้าตาและฟังก์ชันพร้อมแล้ว แต่ยังไม่ซิงก์หลายเครื่อง จนกว่าจะเชื่อม Supabase ตาม README';
      state.user = { email:'demo@local' };
      state.bookings = JSON.parse(localStorage.getItem('checkin_demo_bookings') || 'null') || demoData;
      showApp();
      renderAll();
      return;
    }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    state.user = session.user;
    await loadProfile();
    showApp();
    await loadData();
    subscribeRealtime();
  }

  function showLogin(){ el.loginView.classList.remove('hidden'); el.appShell.classList.add('hidden'); }
  function showApp(){
    el.loginView.classList.add('hidden'); el.appShell.classList.remove('hidden');
    el.userEmail.textContent = displayUserIdentifier(state.user?.email);
    el.userRole.textContent = state.profile.role === 'admin' ? 'ผู้ดูแลระบบ' : 'เจ้าหน้าที่';
    document.querySelectorAll('.admin-only').forEach(n => n.classList.toggle('hidden', state.profile.role !== 'admin'));
  }

  async function loadProfile(){
    const { data, error } = await sb.from('profiles').select('role').eq('id', state.user.id).single();
    if (error) throw error;
    state.profile = data || { role:'staff' };
  }

  async function loadData(){
    const { data, error } = await sb.from('bookings').select('*').order('table_number');
    if(error){ alert('โหลดข้อมูลไม่สำเร็จ: '+error.message); return; }
    state.bookings = data || [];
    renderAll();
  }

  function subscribeRealtime(){
    sb.channel('bookings-live').on('postgres_changes',{event:'*',schema:'public',table:'bookings'}, async()=>{ await loadData(); }).subscribe();
  }

  function renderAll(){ renderDashboard(); renderBookings(); renderTables(); renderHistory(); el.lastSync.textContent = `อัปเดตล่าสุด ${new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}`; }

  function renderDashboard(){
    const paid = state.bookings.filter(b=>!b.checked_in_at).length;
    const checked = state.bookings.filter(b=>!!b.checked_in_at).length;
    const available = TABLES.filter(t=>!tableBooking(t));
    el.statPaidTables.textContent = paid;
    el.statCheckedIn.textContent = checked;
    el.statAvailableTables.textContent = available.length;
    el.availableQuick.innerHTML = available.slice(0,25).map(t=>`<span class="chip">${t}</span>`).join('') + (available.length>25 ? `<span class="chip">+${available.length-25}</span>` : '');
  }

  function renderBookings(){
    const q = el.bookingSearch.value.trim().toLowerCase();
    const filter = el.bookingFilter.value;
    const rows = state.bookings.filter(b=>{
      const hay = `${b.booking_ref||''} ${b.name||''} ${b.phone||''} ${b.table_number||''}`.toLowerCase();
      const s = statusOfBooking(b);
      return (!q || hay.includes(q)) && (filter==='all' || filter===s);
    });
    el.bookingRows.innerHTML = rows.length ? rows.map(b=>`<tr>
      <td>${escapeHtml(b.booking_ref||'-')}</td><td><strong>${escapeHtml(b.name)}</strong></td><td>${escapeHtml(b.phone||'-')}</td><td><strong>${escapeHtml(b.table_number)}</strong></td><td>${b.seats||8}</td>
      <td><span class="badge ${statusOfBooking(b)}">${statusLabel(statusOfBooking(b))}</span></td>
      <td><button class="btn ghost" data-open="${b.id}">ดู</button></td></tr>`).join('') : `<tr><td colspan="7" class="muted">ไม่พบข้อมูล</td></tr>`;
    el.bookingRows.querySelectorAll('[data-open]').forEach(btn=>btn.addEventListener('click',()=>openBooking(btn.dataset.open)));
  }

  function renderTables(){
    el.tableGrid.innerHTML = TABLES.map(t=>{
      const b = tableBooking(t), s = tableStatus(t);
      return `<article class="table-card ${s}" data-table="${t}"><div class="inner"><h3>${t}</h3><p><strong>${statusLabel(s)}</strong></p>${b?`<p>${escapeHtml(b.name)}</p><p>${b.seats||8} ที่นั่ง</p>`:'<p>ยังไม่มีรายการชำระแล้ว</p>'}</div></article>`;
    }).join('');
    el.tableGrid.querySelectorAll('[data-table]').forEach(card=>card.addEventListener('click',()=>{ const b=tableBooking(card.dataset.table); if(b) openBooking(b.id); }));
  }

  async function openBooking(id){
    const b = state.bookings.find(x=>String(x.id)===String(id)); if(!b) return;
    el.dialogContent.innerHTML = `<h2>โต๊ะ ${escapeHtml(b.table_number)}</h2>
      <div class="result-grid"><div class="result-item"><span>ผู้จอง</span><strong>${escapeHtml(b.name)}</strong></div><div class="result-item"><span>โทรศัพท์</span><strong>${escapeHtml(b.phone||'-')}</strong></div><div class="result-item"><span>รหัสจอง</span><strong>${escapeHtml(b.booking_ref||'-')}</strong></div><div class="result-item"><span>สถานะ</span><strong>${statusLabel(statusOfBooking(b))}</strong></div></div>
      ${b.checked_in_at ? `<p class="notice success">เช็กอินแล้ว ${fmtTime(b.checked_in_at)}</p>` : `<button id="dialogCheckin" class="btn primary full">เช็กอินผู้จองนี้</button>`}`;
    el.bookingDialog.showModal();
    const c=$('dialogCheckin'); if(c) c.addEventListener('click', async()=>{ await checkIn(b,'manual'); el.bookingDialog.close(); });
  }

  async function checkIn(b, method){
    if(!validTable(b.table_number)) return alert('รายการนี้ไม่ใช่โต๊ะ C11–C60 ของแผนก');
    if(b.checked_in_at) return alert('รายการนี้เช็กอินแล้ว');
    const now = new Date().toISOString();
    if(DEMO){ b.checked_in_at=now; b.checked_in_by=state.user.email; b.checkin_method=method; localStorage.setItem('checkin_demo_bookings',JSON.stringify(state.bookings)); renderAll(); showScanResult(b,true); return; }
    const { error } = await sb.rpc('check_in_booking',{p_booking_id:b.id,p_method:method});
    if(error){ alert('เช็กอินไม่สำเร็จ: '+error.message); return; }
    await loadData(); const updated=state.bookings.find(x=>x.id===b.id); showScanResult(updated,true);
  }

  function extractQrCandidates(raw){
    const vals = [raw];
    try { const u = new URL(raw); ['booking_id','booking','ticket_id','ticket','id','ref','code','token'].forEach(k=>{ const v=u.searchParams.get(k); if(v) vals.push(v); }); vals.push(u.pathname.split('/').filter(Boolean).pop()); } catch(e){}
    return [...new Set(vals.filter(Boolean).map(v=>String(v).trim()))];
  }

  function matchQr(raw){
    const candidates = extractQrCandidates(raw);
    return state.bookings.find(b=>candidates.some(v => v===String(b.college_qr_value||'') || v===String(b.booking_ref||'')));
  }

  async function handleQr(raw){
    const b = matchQr(raw);
    if(!b){ setNotice(el.scannerStatus,'ไม่พบ QR นี้ในรายชื่อของแผนก หรืออาจเป็นโต๊ะนอก C11–C60','error'); el.scanResult.innerHTML='<strong>ไม่พบข้อมูลในระบบแผนก</strong><p class="muted">ตรวจสอบว่ารายการจากวิทยาลัยถูกนำเข้าแล้ว</p>'; el.scanResult.classList.remove('empty'); return; }
    if(!validTable(b.table_number)){ setNotice(el.scannerStatus,'QR นี้ไม่ใช่โต๊ะของแผนกก่อสร้าง–สถาปัตย์','error'); return; }
    showScanResult(b,false);
  }

  function showScanResult(b, justChecked=false){
    el.scanResult.classList.remove('empty');
    el.scanResult.innerHTML = `<div class="result-name">${escapeHtml(b.name)}</div><div class="result-grid"><div class="result-item"><span>โต๊ะ</span><strong>${escapeHtml(b.table_number)}</strong></div><div class="result-item"><span>โทรศัพท์</span><strong>${escapeHtml(b.phone||'-')}</strong></div><div class="result-item"><span>รหัสจอง</span><strong>${escapeHtml(b.booking_ref||'-')}</strong></div><div class="result-item"><span>สถานะ</span><strong>${statusLabel(statusOfBooking(b))}</strong></div></div>${b.checked_in_at?`<p class="notice success">${justChecked?'เช็กอินสำเร็จ':'รายการนี้เช็กอินแล้ว'} — ${fmtTime(b.checked_in_at)}</p>`:`<button id="resultCheckin" class="btn primary full">ยืนยันเช็กอิน</button>`}`;
    const btn=$('resultCheckin'); if(btn) btn.addEventListener('click',()=>checkIn(b,'qr'));
  }

  async function startScanner(){
    if(state.scanner) return;
    setNotice(el.scannerStatus,'กำลังเปิดกล้อง...');
    try{
      const scanner = new Html5Qrcode('qrReader'); state.scanner=scanner;
      await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:240,height:240}}, async text=>{ await handleQr(text); await stopScanner(); }, ()=>{});
      setNotice(el.scannerStatus,'พร้อมสแกน QR ของวิทยาลัย','success');
    }catch(e){ state.scanner=null; setNotice(el.scannerStatus,'เปิดกล้องไม่ได้: '+e.message,'error'); }
  }
  async function stopScanner(){ if(!state.scanner) return; try{ await state.scanner.stop(); await state.scanner.clear(); }catch(e){} state.scanner=null; }

  function manualLookup(){
    const q=el.manualLookupText.value.trim().toLowerCase(); if(!q) return;
    const phone=normalizePhone(q);
    const matches=state.bookings.filter(b=>`${b.name||''} ${b.booking_ref||''} ${b.table_number||''}`.toLowerCase().includes(q) || (phone && normalizePhone(b.phone).includes(phone)));
    if(matches.length===1) return showScanResult(matches[0],false);
    if(matches.length===0){ el.scanResult.innerHTML='<strong>ไม่พบข้อมูล</strong>'; el.scanResult.classList.remove('empty'); return; }
    el.scanResult.innerHTML=`<strong>พบ ${matches.length} รายการ</strong>`+matches.map(b=>`<button class="btn ghost full choose-match" data-id="${b.id}" style="margin-top:8px">${escapeHtml(b.name)} — ${b.table_number}</button>`).join(''); el.scanResult.classList.remove('empty');
    el.scanResult.querySelectorAll('.choose-match').forEach(x=>x.addEventListener('click',()=>showScanResult(state.bookings.find(b=>String(b.id)===x.dataset.id),false)));
  }

  function parseCsv(file){
    Papa.parse(file,{header:true,skipEmptyLines:true,complete:r=>{
      const mapped=r.data.map((x,i)=>({
        booking_ref:String(x.booking_ref||x.bookingId||'').trim(), name:String(x.name||'').trim(), phone:String(x.phone||'').trim(), table_number:String(x.table_number||x.table||'').trim().toUpperCase(), seats:Number(x.seats||8), college_qr_value:String(x.college_qr_value||x.qr||'').trim(), row:i+2
      }));
      const invalid=mapped.filter(x=>!x.name||!validTable(x.table_number));
      state.importRows=mapped.filter(x=>x.name&&validTable(x.table_number));
      el.importPreview.innerHTML=`<div class="notice ${invalid.length?'error':'success'}">พร้อมนำเข้า ${state.importRows.length} รายการ${invalid.length?` / ข้าม ${invalid.length} แถวที่ข้อมูลไม่ครบหรือโต๊ะนอก C11–C60`:''}</div>`;
      el.confirmImport.classList.toggle('hidden',!state.importRows.length);
    },error:e=>setNotice(el.importStatus,'อ่านไฟล์ไม่ได้: '+e.message,'error')});
  }

  async function confirmImport(){
    if(state.profile.role!=='admin') return;
    const dupTables = state.importRows.map(x=>x.table_number).filter((x,i,a)=>a.indexOf(x)!==i);
    if(dupTables.length) return setNotice(el.importStatus,'ไฟล์มีเลขโต๊ะซ้ำ: '+[...new Set(dupTables)].join(', '),'error');
    if(DEMO){
      state.bookings = state.importRows.map((x,i)=>({id:`imp${Date.now()}${i}`,...x,checked_in_at:null})); localStorage.setItem('checkin_demo_bookings',JSON.stringify(state.bookings)); renderAll(); setNotice(el.importStatus,'นำเข้าข้อมูลทดสอบเรียบร้อย','success'); return;
    }
    const payload=state.importRows.map(({row,...x})=>x);
    const { error } = await sb.rpc('replace_paid_bookings',{p_rows:payload});
    if(error) return setNotice(el.importStatus,'นำเข้าไม่สำเร็จ: '+error.message,'error');
    setNotice(el.importStatus,'นำเข้าสำเร็จ ข้อมูลทุกเครื่องกำลังอัปเดต','success'); await loadData();
  }

  async function renderHistory(){
    if(state.profile.role!=='admin'){ el.historyRows.innerHTML=''; return; }
    if(DEMO){
      const rows=state.bookings.filter(b=>b.checked_in_at).sort((a,b)=>new Date(b.checked_in_at)-new Date(a.checked_in_at));
      el.historyRows.innerHTML=rows.map(b=>`<tr><td>${fmtTime(b.checked_in_at)}</td><td>${escapeHtml(b.name)}</td><td>${b.table_number}</td><td>${b.checkin_method||'demo'}</td><td>${escapeHtml(b.checked_in_by||'demo@local')}</td></tr>`).join('')||'<tr><td colspan="5">ยังไม่มีประวัติ</td></tr>'; return;
    }
    const { data } = await sb.from('checkin_logs').select('*, bookings(name,table_number)').order('created_at',{ascending:false}).limit(200);
    el.historyRows.innerHTML=(data||[]).map(r=>`<tr><td>${fmtTime(r.created_at)}</td><td>${escapeHtml(r.bookings?.name||'-')}</td><td>${escapeHtml(r.bookings?.table_number||'-')}</td><td>${escapeHtml(r.method||'-')}</td><td>${escapeHtml(r.staff_email||'-')}</td></tr>`).join('')||'<tr><td colspan="5">ยังไม่มีประวัติ</td></tr>';
  }

  function downloadTemplate(){
    const csv='booking_ref,name,phone,table_number,seats,college_qr_value\nBK001,สมชาย ใจดี,0812345678,C18,8,COLLEGE-QR-BK001\n';
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:'text/csv;charset=utf-8'})); a.download='college-paid-bookings-template.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  function navigate(view){
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===view));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    const btn=document.querySelector(`.nav-btn[data-view="${view}"]`); el.pageTitle.textContent=btn?.textContent||'ระบบเช็คอินของแผนก';
    if(view==='history') renderHistory();
  }

  document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.view)));
  document.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.jump)));
  el.bookingSearch.addEventListener('input',renderBookings); el.bookingFilter.addEventListener('change',renderBookings);
  el.startScanner.addEventListener('click',startScanner); el.stopScanner.addEventListener('click',stopScanner); el.manualLookupBtn.addEventListener('click',manualLookup); el.manualLookupText.addEventListener('keydown',e=>{if(e.key==='Enter') manualLookup()});
  el.csvFile.addEventListener('change',e=>{const f=e.target.files[0]; if(f) parseCsv(f)}); el.confirmImport.addEventListener('click',confirmImport); el.downloadTemplate.addEventListener('click',downloadTemplate);
  el.dialogClose.addEventListener('click',()=>el.bookingDialog.close());

  el.loginForm.addEventListener('submit',async e=>{
    e.preventDefault();
    setNotice(el.loginStatus,'กำลังเข้าสู่ระบบ...');
    const email = loginIdentifierToEmail(el.loginEmail.value);
    if(!email) return setNotice(el.loginStatus,'กรุณากรอกเบอร์โทร 10 หลัก หรืออีเมลให้ถูกต้อง','error');
    const {data,error}=await sb.auth.signInWithPassword({email,password:el.loginPassword.value});
    if(error)return setNotice(el.loginStatus,'เบอร์โทร/อีเมล หรือรหัสผ่านไม่ถูกต้อง','error');
    state.user=data.user;
    await loadProfile();
    showApp();
    await loadData();
    subscribeRealtime();
  });
  el.logoutBtn.addEventListener('click',async()=>{ if(DEMO){location.reload(); return;} await sb.auth.signOut(); location.reload(); });

  init().catch(e=>{ console.error(e); alert('เกิดข้อผิดพลาด: '+e.message); });
})();
