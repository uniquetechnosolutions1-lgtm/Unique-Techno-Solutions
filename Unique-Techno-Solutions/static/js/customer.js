let services=[],offers=[],customer=null,currentService=null,bookingCode=null,timer=null,historyRows=[],notifications=[],reviewRating=0,pendingOfferId=null;
const api=async(u,o={})=>{const r=await fetch(u,{credentials:'same-origin',headers:{"Content-Type":"application/json",...(o.headers||{})},...o});const text=await r.text();let d={};try{d=text?JSON.parse(text):{}}catch(e){d={error:text||r.statusText||'Request failed'}}if(!r.ok)throw Error(d.error||"Request failed");return d};
const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const show=(id,navKey)=>{
  document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('on',x.id===id));
  const key=navKey || ({details:'servicesPage',booking:'servicesPage'}[id] || id);
  if(id==='history'){
    const e=document.getElementById('historyEyebrow'),t=document.getElementById('historyHeroTitle'),p=document.getElementById('historyHeroText');
    if(e)e.textContent='MY BOOKINGS';
    if(t)t.textContent='My Bookings';
    if(p)p.textContent='Track active requests, completed services, payments and invoices in one place.';
    const visual=document.querySelector('#history .booking-visual'); if(visual) visual.classList.remove('archive-mode');
  }
  if(id==='profile'){
    const reviews=key==='reviews';
    const e=document.getElementById('profileHeroEyebrow'),t=document.getElementById('profileHeroTitle'),p=document.getElementById('profileHeroText');
    if(e)e.textContent=reviews?'SERVICE EXPERIENCE':'MY ACCOUNT';
    if(t)t.textContent=reviews?'Reviews & Ratings':'Profile';
    if(p)p.textContent=reviews?'Your feedback helps us keep every engineer visit better, faster and more professional.':'Manage your contact details and service address.';
    const visual=document.querySelector('#profile .review-visual'); if(visual) visual.classList.toggle('profile-mode',!reviews);
  }
  document.querySelectorAll('#appSidebar [data-page]').forEach(b=>b.classList.toggle('active', b.dataset.nav===key));
  document.querySelectorAll('.navlinks button').forEach((b,i)=>{
    const keys=['home','servicesPage','bookings','track','payments','notifications','profile','help'];
    b.classList.toggle('current', keys[i]===key);
  });
  window.scrollTo({top:0,behavior:'smooth'});if(id!=='home'&&typeof closeAccountMenu==='function')closeAccountMenu();
};
let authMode='login';
function switchAuth(mode){
  authMode=mode;
  document.getElementById('loginTab')?.classList.toggle('active',mode==='login');
  document.getElementById('signupTab')?.classList.toggle('active',mode==='signup');
  document.getElementById('loginForm').style.display=mode==='login'?'block':'none';
  document.getElementById('signupForm').style.display=mode==='signup'?'block':'none';
  document.getElementById('otpStep').classList.remove('on');
  document.getElementById('signupProfileStep').style.display='none';
  document.getElementById('authTitle').innerHTML=mode==='login'?"Welcome back.<br><span>Let's get started.</span>":'Create your account.<br><span>Service starts here.</span>';
  document.getElementById('authSubtitle').textContent=mode==='login'?'Login with your registered mobile number to browse services, book a professional engineer and track your service live.':'Create your account using your mobile number, OTP, name, email and service address.';
}
function validPhone(id){const v=(document.getElementById(id)?.value||'').replace(/\D/g,'');return v.length===10}
function sendLoginOtp(){
  if(!validPhone('loginPhone'))return alert('Enter a valid 10-digit mobile number.');
  document.getElementById('loginForm').style.display='none';
  document.getElementById('signupProfileStep').style.display='none';
  document.getElementById('otpMessage').textContent='Enter the 6-digit OTP for your registered mobile number.';
  document.getElementById('otpStep').classList.add('on');
  document.getElementById('otp').value='';
  document.getElementById('otp').focus();
}
async function sendSignupOtp(){
  if(!validPhone('signupPhone'))return alert('Enter a valid 10-digit mobile number.');
  try{
    const phone=document.getElementById('signupPhone').value;
    const d=await api('/api/customer/check-phone',{method:'POST',body:JSON.stringify({phone})});
    if(d.exists){
      alert('This mobile number is already registered. Please Login instead.');
      switchAuth('login');
      const loginPhone=document.getElementById('loginPhone');
      if(loginPhone) loginPhone.value=phone;
      return;
    }
  }catch(e){return alert(e.message||'Unable to check mobile number. Please try again.');}
  document.getElementById('signupForm').style.display='none';
  document.getElementById('signupProfileStep').style.display='none';
  document.getElementById('otpMessage').textContent='Enter the 6-digit OTP sent to your mobile to continue creating your account.';
  document.getElementById('otpStep').classList.add('on');
  document.getElementById('otp').value='';
  document.getElementById('otp').focus();
}
function backToAuthForm(){
  document.getElementById('otpStep').classList.remove('on');
  document.getElementById('signupProfileStep').style.display='none';
  document.getElementById(authMode==='login'?'loginForm':'signupForm').style.display='block';
}
function backToSignupOtp(){
  document.getElementById('signupProfileStep').style.display='none';
  document.getElementById('otpStep').classList.add('on');
}
async function verifyAuthOtp(){
  const otp=document.getElementById('otp').value.trim();
  if(otp!=='123456')return alert('Prototype OTP is 123456.');
  if(authMode==='signup'){
    document.getElementById('otpStep').classList.remove('on');
    document.getElementById('signupProfileStep').style.display='block';
    document.getElementById('signupName').focus();
    return;
  }
  try{
    const payload={phone:document.getElementById('loginPhone').value,otp};
    const d=await api('/api/customer/login',{method:'POST',body:JSON.stringify(payload)});
    customer=d.customer;
    document.body.classList.add('customer-auth');
    await Promise.all([loadServices(),loadOffers(),loadHistory(),loadProfile(),loadNotifications()]);
    renderFloatingNotifications();
    renderDashboard();window.history.replaceState({},'', '/customer/');show('home');updateAccountControl();
  }catch(e){alert(e.message)}
}
async function completeSignup(){
  const name=document.getElementById('signupName').value.trim();
  const email=document.getElementById('signupEmail').value.trim();
  const address=document.getElementById('signupAddress').value.trim();
  if(name.length<2)return alert('Please enter your full name.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return alert('Please enter a valid email address.');
  if(address.length<8)return alert('Please enter your complete service address.');
  try{
    const d=await api('/api/customer/signup',{method:'POST',body:JSON.stringify({phone:document.getElementById('signupPhone').value,otp:document.getElementById('otp').value.trim(),name,email,address})});
    customer=d.customer;
    document.body.classList.add('customer-auth');
    await Promise.all([loadServices(),loadOffers(),loadHistory(),loadProfile(),loadNotifications()]);
    renderFloatingNotifications();
    renderDashboard();window.history.replaceState({},'', '/customer/');show('home');updateAccountControl();toast('Account created successfully. Welcome to Unique Techno Solutions.');
  }catch(e){alert(e.message)}
}
// Backward-compatible aliases for any older UI handlers.
function sendOtp(){sendLoginOtp()}
async function verify(){await verifyAuthOtp()}
async function loadServices(){services=await api('/api/services');renderServices()}
async function loadOffers(){try{offers=await api('/api/offers?_='+Date.now())}catch(e){offers=[]}}
function renderServices(list=services){document.getElementById('services').innerHTML=list.map(s=>`<button class="service" onclick="currentService=services.find(x=>Number(x.id)===Number(${Number(s.id)}));openDetails(${Number(s.id)})"><div class="ico">${s.icon}</div><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><span class="price">From ₹${Number(s.price).toLocaleString('en-IN')}</span></button>`).join('')||'<div class="panel">No services available.</div>'}
let activeServiceCategory='all';
function serviceCategory(s){const t=(s.name+' '+s.description).toLowerCase();if(/cctv|camera|surveillance|security/.test(t))return 'cctv';if(/network|wi-?fi|lan|fiber|switch|router|cabling/.test(t))return 'network';if(/laptop|desktop|pc|workstation|computer/.test(t))return 'it';if(/server|firewall|infrastructure|storage|nvr|dvr/.test(t))return 'infra';if(/automation|plc|bms/.test(t))return 'automation';return 'other'}
function filterServices(q){q=(q??document.getElementById('serviceSearch')?.value??'').toLowerCase();renderServices(services.filter(s=>(s.name+' '+s.description).toLowerCase().includes(q)&&(activeServiceCategory==='all'||serviceCategory(s)===activeServiceCategory)))}
function setServiceCategory(cat,btn){activeServiceCategory=cat;document.querySelectorAll('.service-filter').forEach(x=>x.classList.remove('active'));if(btn)btn.classList.add('active');filterServices(document.getElementById('serviceSearch')?.value||'')}
function openDetails(id){currentService=services.find(s=>s.id===id);if(!currentService)return;document.getElementById('dIcon').textContent=currentService.icon;document.getElementById('dName').textContent=currentService.name;document.getElementById('dDesc').textContent=currentService.description;document.getElementById('dPrice').textContent='Starting from ₹'+Number(currentService.price).toLocaleString('en-IN');show('details')}
function openBooking(){if(!customer?.id)return alert('Please login first.');if(!currentService?.id)return alert('Please select a service first.');const offer=pendingOfferId?offers.find(o=>Number(o.id)===Number(pendingOfferId)):null;document.getElementById('sName').textContent=offer?offer.title:currentService.name;document.getElementById('sPrice').textContent=offer?'₹'+Number(offer.fixed_price||0).toLocaleString('en-IN'):'₹'+currentService.price;document.getElementById('sTotal').textContent=offer?'₹'+Number(offer.fixed_price||0).toLocaleString('en-IN'):'₹'+currentService.price;document.getElementById('date').min=new Date().toISOString().slice(0,10);document.getElementById('address').value=customer?.address||'';show('booking');initBookingPicker();const rb=document.getElementById('bookingResult');if(rb)rb.style.display='none';renderBookingRecords()}

function setBookingStep(n){
  const steps=document.querySelectorAll('#bookingSteps .booking-step');
  steps.forEach((el,i)=>{el.classList.toggle('active',i===n-1);el.classList.toggle('done',i<n-1);});
}
function goBookingStep(n){
  if(!document.getElementById('booking')) return;
  const targets={1:'#datePicks',2:'#address',3:'.booking-confirm-btn'};
  const target=document.querySelector(targets[n]);
  if(n===2 && !document.getElementById('date').value){
    setBookingStep(1); document.getElementById('datePicks')?.scrollIntoView({behavior:'smooth',block:'center'}); toast('Please choose a service date first.'); return;
  }
  if(n===3){
    const date=document.getElementById('date').value, address=document.getElementById('address').value.trim();
    if(!date){setBookingStep(1);document.getElementById('datePicks')?.scrollIntoView({behavior:'smooth',block:'center'});toast('Please choose a service date first.');return;}
    if(!address){setBookingStep(2);document.getElementById('address')?.scrollIntoView({behavior:'smooth',block:'center'});toast('Please enter the service address.');return;}
  }
  setBookingStep(n); target?.scrollIntoView({behavior:'smooth',block:'center'});
}
function openCalendarPicker(){
  const date=document.getElementById('date');
  if(!date)return;
  try{ if(typeof date.showPicker==='function') date.showPicker(); else { date.style.opacity='1';date.style.pointerEvents='auto';date.focus();date.click();setTimeout(()=>{date.style.opacity='0';date.style.pointerEvents='none'},500); } }catch(e){date.focus();date.click();}
}
function syncCalendarDate(){
  const date=document.getElementById('date'), dateWrap=document.getElementById('datePicks'); if(!date||!dateWrap||!date.value)return;
  const chosen=date.value;
  let matched=false;
  dateWrap.querySelectorAll('.date-choice').forEach(b=>{
    if(b.dataset.date===chosen){b.classList.add('selected');matched=true}else b.classList.remove('selected');
  });
  let custom=dateWrap.querySelector('.custom-date-choice');
  if(!matched){
    if(!custom){custom=document.createElement('button');custom.type='button';custom.className='date-choice custom-date-choice';dateWrap.appendChild(custom);}
    const d=new Date(chosen+'T00:00:00');
    custom.dataset.date=chosen;
    custom.innerHTML=`<small>Selected date</small><b>${d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}</b>`;
    custom.classList.add('selected');
  }else if(custom){custom.remove();}
  setBookingStep(1);
}
function initBookingPicker(){
  const date=document.getElementById('date'), time=document.getElementById('time'); if(!date||!time)return;
  const today=new Date(); today.setHours(0,0,0,0); date.min=today.toISOString().slice(0,10);
  if(!date.value) date.value=date.min;
  const dateWrap=document.getElementById('datePicks');
  const timeWrap=document.getElementById('timePicks');
  const fmt=(d)=>d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
  const day=(d)=>d.toLocaleDateString('en-IN',{weekday:'short'});
  dateWrap.innerHTML='';
  for(let i=0;i<3;i++){const d=new Date(today);d.setDate(today.getDate()+i);const iso=d.toISOString().slice(0,10);const b=document.createElement('button');b.type='button';b.dataset.date=iso;b.className='date-choice'+(date.value===iso?' selected':'');b.innerHTML=`<small>${i===0?'Today':i===1?'Tomorrow':day(d)}</small><b>${fmt(d)}</b>`;b.onclick=()=>{date.value=iso;syncCalendarDate()};dateWrap.appendChild(b)}
  timeWrap.innerHTML=''; Array.from(time.options).forEach((o,i)=>{const b=document.createElement('button');b.type='button';b.className='time-choice'+(i===0?' selected':'');b.textContent=o.value;b.onclick=()=>{time.value=o.value;document.querySelectorAll('.time-choice').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');setBookingStep(2)};timeWrap.appendChild(b)});
  date.addEventListener('change',syncCalendarDate);
  syncCalendarDate();
}

async function confirmBooking(){const date=document.getElementById('date').value,address=document.getElementById('address').value.trim();if(!customer?.id)return alert('Please login first.');if(!currentService?.id)return alert('Please select a service first.');if(!date||!address)return alert('Enter date and address.');const btn=document.querySelector('#booking button[onclick="confirmBooking()"]');if(btn)btn.disabled=true;try{const d=await api('/api/bookings',{method:'POST',body:JSON.stringify({customer_id:customer.id,service_id:currentService.id,offer_id:pendingOfferId||null,date,time:document.getElementById('time').value,address,problem:document.getElementById('problem').value,phone:customer.phone})});bookingCode=d.booking_code;pendingOfferId=null;await Promise.all([loadHistory(),loadNotifications()]);showBookingResult(d.booking_code);renderBookingRecords();toast('Booking confirmed • '+bookingCode)}catch(e){alert(e.message)}finally{if(btn)btn.disabled=false}}
function showBookingResult(code){const b=(historyRows||[]).find(x=>x.booking_code===code);const box=document.getElementById('bookingResult');if(!box)return;const service=b?.service||currentService?.name||'—';const dt=b?(b.date+' • '+b.time):(document.getElementById('date').value+' • '+document.getElementById('time').value);const amount='₹'+Number(b?.amount||currentService?.price||0).toLocaleString('en-IN');const status=b?.status||'Pending';box.style.display='block';document.getElementById('resultBookingId').textContent=code||'—';document.getElementById('resultBookingService').textContent=service;document.getElementById('resultBookingDate').textContent=dt;document.getElementById('resultBookingAmount').textContent=amount;document.getElementById('resultBookingAddress').textContent=b?.address||document.getElementById('address').value||'—';document.getElementById('resultBookingStatus').textContent=status.toUpperCase();document.getElementById('resultBookingStatus').className='status-pill '+(status==='Pending'?'warn':'good');showBookingSuccessModal(code,service,dt,amount,status)}
function showBookingSuccessModal(code,service,dt,amount,status){const m=document.getElementById('bookingSuccessModal');if(!m)return;document.getElementById('successBookingId').textContent=code||'—';document.getElementById('successBookingService').textContent=service||'—';document.getElementById('successBookingDate').textContent=dt||'—';document.getElementById('successBookingAmount').textContent=amount||'—';const st=document.getElementById('successBookingStatus');st.textContent=(status||'Pending').toUpperCase();st.className='status-pill '+((status||'Pending')==='Pending'?'warn':'good');m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.classList.add('booking-modal-open');setTimeout(()=>document.querySelector('.booking-success-close')?.focus(),50)}
function closeBookingSuccess(){const m=document.getElementById('bookingSuccessModal');if(!m)return;m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.classList.remove('booking-modal-open')}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeBookingSuccess()});
function renderBookingRecords(){const box=document.getElementById('bookingRecordsList');if(!box)return;const rows=[...(historyRows||[])].sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0));if(!rows.length){box.innerHTML='<div class="booking-record-empty">No bookings yet. Select a service above to create your first booking.</div>';return}box.innerHTML=rows.map(b=>{const cls=['Closed','Completed'].includes(b.status)?'good':b.status==='Cancelled'?'bad':'warn';return `<div class="booking-record"><div class="booking-record-main"><span class="eyebrow">${esc(b.booking_code)}</span><h3>${esc(b.service)}</h3><p>${esc(b.date)} • ${esc(b.time)} • ${esc(b.address||'Address not set')}</p></div><div class="booking-record-side"><b>₹${Number(b.amount||0).toLocaleString('en-IN')}</b><span class="status-pill ${cls}">${esc(b.status)}</span></div></div>`}).join('')}
function drawTimeline(st){const steps=['Booked','Confirmed','Engineer Assigned','Engineer On The Way','Service Started','Completed'];const idx={Pending:0,Confirmed:1,Assigned:2,'On the Way':3,Arrived:3,'Service Started':4,Completed:5,Closed:5,Cancelled:-1}[st]??0;document.getElementById('timeline').innerHTML=steps.map((x,i)=>`<div class="mile ${i<=idx?'done':''}"><div class="dot">${i<=idx?'✓':i+1}</div>${x}</div>`).join('')}
function drawEngineer(b){if(!b.engineer){document.getElementById('eng').innerHTML='<div class="engineer-card"><div class="engineer-main"><div class="tag">ENGINEER</div><h3>Finding an engineer…</h3><p>We will update this automatically.</p></div></div>';return}const ini=b.engineer.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();document.getElementById('eng').innerHTML=`<div class="engineer-card"><div class="avatar">${ini}</div><div class="engineer-main"><div class="tag">ENGINEER ASSIGNED</div><h3>${esc(b.engineer)}</h3><p>★ ${Number(b.engineer_rating||0).toFixed(1)} • ${esc(b.engineer_area||'Area not set')}</p><p>Status: <b>${esc(b.engineer_status||'Assigned')}</b></p><p>${esc(b.engineer_skills||'')}</p></div>${b.engineer_phone?`<a class="call" href="tel:${b.engineer_phone}">Call</a>`:''}</div>`}
async function refreshTracking(){if(!bookingCode)return;try{const b=await api('/api/bookings/'+encodeURIComponent(bookingCode));document.getElementById('tTitle').textContent=b.service+' • Current status';document.getElementById('bookingConfirmation').style.display='none';document.getElementById('tMsg').textContent={Pending:'✓ Booking confirmed. Finding an engineer...',Assigned:'✓ Engineer assigned successfully.','On the Way':'✓ Your engineer is on the way.',Arrived:'✓ Engineer has arrived at the location.','Service Started':'✓ Service has started.',Completed:'✓ Admin marked service completed. Please confirm.',Closed:'✓ Service closed.',Cancelled:'Booking cancelled.'}[b.status]||'Booking update';document.getElementById('tDate').textContent=b.date+' • '+b.time;document.getElementById('tAddress').textContent=b.address;drawTimeline(b.status);drawEngineer(b);document.getElementById('etaBox').style.display=b.status==='On the Way'?'block':'none';if(b.status==='On the Way'){const e=b.eta_until?new Date(b.eta_until):new Date(Date.now()+7200000);document.getElementById('etaText').textContent='Engineer arrival expected within 2 hours • '+e.toLocaleString()}document.getElementById('confirmBox').style.display=b.status==='Completed'?'block':'none';document.getElementById('paymentBox').style.display=['Completed','Closed'].includes(b.status)?'block':'none';document.getElementById('payStatus').textContent=b.payment_status||'Unpaid';document.getElementById('payButton').style.display=(b.payment_status==='Paid'||!['Completed','Closed'].includes(b.status))?'none':'inline-block';document.getElementById('reviewBox').style.display=b.status==='Closed'?'block':'none';if(['Closed','Cancelled'].includes(b.status)){clearInterval(timer);timer=null}}catch(e){}}
async function customerConfirm(){try{await api('/api/bookings/'+encodeURIComponent(bookingCode)+'/confirm',{method:'POST',body:JSON.stringify({customer_id:customer.id})});await refreshTracking();await Promise.all([loadHistory(),loadNotifications()]);toast('Service closed successfully.')}catch(e){alert(e.message)}}
async function payNow(){try{await api('/api/bookings/'+encodeURIComponent(bookingCode)+'/pay',{method:'POST',body:JSON.stringify({customer_id:customer.id})});await refreshTracking();await loadHistory();toast('Payment recorded successfully.')}catch(e){alert(e.message)}}
function setReview(n){reviewRating=n;document.querySelectorAll('.review-stars button').forEach((b,i)=>b.classList.toggle('sel',i<n))}
async function submitReview(){if(reviewRating<1)return alert('Select a rating.');try{await api('/api/bookings/'+encodeURIComponent(bookingCode)+'/review',{method:'POST',body:JSON.stringify({customer_id:customer.id,rating:reviewRating,review:document.getElementById('reviewText').value.trim()})});await loadHistory();toast('Thanks for your review.')}catch(e){alert(e.message)}}
async function loadHistory(){if(!customer?.id)return;try{historyRows=await api('/api/customer/'+customer.id+'/bookings');renderHistory();renderBookingRecords()}catch(e){document.getElementById('historyList').innerHTML='<div class="notification-empty">Could not load your booking history.</div>'}}
let bookingFilter='all';
function setBookingFilter(filter,el){bookingFilter=filter;document.querySelectorAll('.booking-filter').forEach(x=>x.classList.remove('active'));el?.classList.add('active');renderHistory();}
function bookingKind(b){return b.offer_id?'OFFER':'REGULAR'}
function bookingFilterMatch(b){
  if(bookingFilter==='all') return true;
  if(bookingFilter==='cancelled') return b.status==='Cancelled';
  if(bookingFilter==='completed') return ['Closed','Completed'].includes(b.status);
  if(bookingFilter==='active') return !['Pending','Completed','Closed','Cancelled'].includes(b.status);
  if(bookingFilter==='upcoming') return b.status==='Pending';
  return true;
}
function updateBookingCounts(){
  const rows=historyRows||[], counts={all:rows.length,upcoming:rows.filter(b=>b.status==='Pending').length,active:rows.filter(b=>!['Pending','Completed','Closed','Cancelled'].includes(b.status)).length,completed:rows.filter(b=>['Closed','Completed'].includes(b.status)).length,cancelled:rows.filter(b=>b.status==='Cancelled').length};
  Object.entries(counts).forEach(([k,v])=>{const el=document.getElementById('count'+k.charAt(0).toUpperCase()+k.slice(1));if(el)el.textContent=v});
}
function historyCard(b){
  const cls=['Closed','Completed'].includes(b.status)?'good':b.status==='Cancelled'?'bad':'warn';
  const kind=bookingKind(b), isOffer=kind==='OFFER';
  const engineer=b.engineer||'Not assigned';
  const payment=b.payment_status||'Unpaid';
  const action='View Details';
  const cancelButton=b.status==='Pending'&&!b.engineer_id?`<button class="btn cancel-booking-btn" onclick="cancelBooking('${encodeURIComponent(b.booking_code)}')">Cancel Booking</button>`:'';
  const approvalPending=b.status==='Completed';
  const approvalBox=approvalPending?`<div class="booking-approval-box">
      <div class="booking-approval-icon">✓</div>
      <div class="booking-approval-copy">
        <strong>Your service is done</strong>
        <span>We've completed your service. Please review and approve it to close this booking.</span>
      </div>
      <button class="booking-approval-btn" onclick="confirmBookingFromHistory('${encodeURIComponent(b.booking_code)}',this)">Approve &amp; Close</button>
    </div>`:'';
  const paymentPending=b.status==='Closed' && (b.payment_status||'Unpaid')!=='Paid';
  const paymentBox=paymentPending?`<div class="booking-payment-box">
      <div class="booking-payment-icon">₹</div>
      <div class="booking-payment-copy">
        <strong>Service completed successfully</strong>
        <span>Your booking is closed. Payment is now ready.</span>
      </div>
      <button class="booking-payment-btn" onclick="openPaymentGateway('${encodeURIComponent(b.booking_code)}')">Pay Now</button>
    </div>`:'';
  return `<div class="panel history-card booking-card-${kind.toLowerCase()}" data-status="${esc(b.status)}">
    <div class="history-top">
      <div class="booking-card-title">
        <div class="booking-code-row"><span class="eyebrow">${esc(b.booking_code)}</span><span class="booking-type ${isOffer?'offer-type':'regular-type'}">${kind}</span></div>
        <h3>${esc(b.service)}</h3>
        <div class="booking-date">${esc(b.date)} <span>•</span> ${esc(b.time)}</div>
      </div>
      <span class="status-pill ${cls}">${esc(b.status)}</span>
    </div>
    <div class="history-grid">
      <div><small>Amount</small><b>₹${Number(b.amount||0).toLocaleString('en-IN')}</b>${isOffer?'<em>Offer price</em>':''}</div>
      <div><small>Engineer</small><b>${esc(engineer)}</b></div>
      <div><small>Payment</small><b>${esc(payment)}</b></div>
      <div><small>Address</small><b>${esc(b.address||'—')}</b></div>
    </div>
    ${isOffer?`<div class="booking-offer-note">✦ Offer booking${b.offer_title?` • ${esc(b.offer_title)}`:''}</div>`:''}
    ${approvalBox}
    ${paymentBox}
    ${b.payment_status==='Paid'?`<div class="booking-payment-details">
      <div><small>Payment Status</small><b>✓ Paid</b></div>
      <div><small>Payment UTR</small><b>${esc(b.payment_utr||b.payment_id||'—')}</b></div>
      <div><small>Payment Ref</small><b>${esc(b.payment_id||'—')}</b></div>
      <div><small>Paid At</small><b>${esc(b.paid_at||'—')}</b></div>
    </div>`:''}
    ${b.review_rating?`<div class="booking-rating">Your rating: ${'★'.repeat(b.review_rating)}${'☆'.repeat(5-b.review_rating)}</div>`:''}
    <div class="booking-card-actions"><button class="btn dark" onclick="openBookingDetails('${encodeURIComponent(b.booking_code)}')">${action}</button>${cancelButton}${b.status==='Closed'?'<span class="booking-complete-note">✓ Service completed</span>':''}</div>
  </div>`;
}

function openBookingDetails(code){
  const booking=historyRows.find(x=>x.booking_code===decodeURIComponent(code));
  if(!booking)return alert('Booking details not found.');
  const modal=document.getElementById('bookingDetailsModal'); if(!modal)return;
  const status=booking.status||'Pending', cls=['Closed','Completed'].includes(status)?'good':status==='Cancelled'?'bad':'warn';
  const isOffer=!!booking.offer_id;
  const set=(id,val)=>{const e=document.getElementById(id);if(e)e.textContent=val??'—'};
  set('bdService',booking.service||'—'); set('bdId',booking.booking_code||'—'); set('bdDate',(booking.date||'—')+' • '+(booking.time||'—'));
  set('bdPayment',booking.payment_status||'Unpaid'); set('bdAddress',booking.address||'—'); set('bdEngineer',booking.engineer||'Not assigned');
  set('bdEngineerPhone',booking.engineer_phone||'—'); set('bdAmount','₹'+Number(booking.amount||0).toLocaleString('en-IN')); set('bdCurrentStatus',status);
  const st=document.getElementById('bdStatus'); if(st){st.textContent=status.toUpperCase();st.className='status-pill '+cls;}
  const kind=document.getElementById('bdKind'); if(kind){kind.textContent=isOffer?'OFFER':'REGULAR';kind.className='booking-type '+(isOffer?'offer-type':'regular-type');}
  const reasonBox=document.getElementById('bdCancellationReason'); if(reasonBox){reasonBox.style.display=status==='Cancelled'?'block':'none';set('bdReason',booking.cancellation_reason||'Reason not provided');}
  const track=document.getElementById('bdTrackBtn'); if(track){track.style.display=status==='Cancelled'?'none':'inline-block';track.onclick=()=>{closeBookingDetails();openUpcomingBooking(encodeURIComponent(booking.booking_code));};}
  const invoice=document.getElementById('bdInvoiceBtn'); if(invoice){invoice.style.display=['Completed','Closed'].includes(status)?'inline-flex':'none'; invoice.disabled=false;}
  window._utDetailsInvoiceCode=booking.booking_code;
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); document.body.classList.add('booking-modal-open');
}
function closeBookingDetails(){const m=document.getElementById('bookingDetailsModal');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.classList.remove('booking-modal-open');}}
async function downloadInvoice(code,btn){
  const decoded=decodeURIComponent(code||window._utDetailsInvoiceCode||'');
  if(!decoded)return;
  if(btn){btn.disabled=true;btn.textContent='Preparing Invoice...';}
  try{
    const res=await fetch('/api/bookings/'+encodeURIComponent(decoded)+'/invoice',{credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/pdf'}});
    const blob=await res.blob();
    if(!res.ok){
      let msg='Could not download invoice.';
      try{const text=await blob.text(); const j=JSON.parse(text); if(j?.error)msg=j.error;}catch(_){}
      throw new Error(msg);
    }
    if(!blob || blob.size===0)throw new Error('Invoice PDF is empty. Please try again.');
    const type=(res.headers.get('content-type')||'').toLowerCase();
    if(type.includes('json')){
      let msg='Could not download invoice.';
      try{const text=await blob.text(); const j=JSON.parse(text); if(j?.error)msg=j.error;}catch(_){}
      throw new Error(msg);
    }
    const url=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));
    const a=document.createElement('a');
    a.href=url;
    a.download='Unique-Techno-Invoice-'+decoded+'.pdf';
    a.style.display='none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    setTimeout(()=>toast('Invoice downloaded successfully.'),250);
  }catch(e){alert(e?.message||'Could not download invoice.');}
  finally{if(btn){btn.disabled=false;btn.textContent='⬇ Download Invoice';}}
}

function downloadInvoiceFromDetails(){downloadInvoice(encodeURIComponent(window._utDetailsInvoiceCode||''),document.getElementById('bdInvoiceBtn'));}


let pendingCancelCode=null,pendingCancelReason='';
function cancelBooking(code){
  const booking=historyRows.find(x=>x.booking_code===decodeURIComponent(code));
  if(!booking||booking.status!=='Pending'||booking.engineer_id){ return alert('This booking can only be cancelled before an engineer is assigned.'); }
  pendingCancelCode=code; pendingCancelReason='';
  document.querySelectorAll('#cancelReasons button').forEach(x=>x.classList.remove('selected'));
  const other=document.getElementById('cancelOtherReason'); if(other){other.value='';other.style.display='none';}
  const m=document.getElementById('cancelReasonModal'); if(m){m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.classList.add('booking-modal-open');}
}
function closeCancelReason(){const m=document.getElementById('cancelReasonModal');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.classList.remove('booking-modal-open');}pendingCancelCode=null;pendingCancelReason='';}
document.addEventListener('click',e=>{const b=e.target.closest('#cancelReasons button');if(!b)return;document.querySelectorAll('#cancelReasons button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');pendingCancelReason=b.dataset.reason||'';const other=document.getElementById('cancelOtherReason');if(other){other.style.display=pendingCancelReason==='Other'?'block':'none';if(pendingCancelReason==='Other')setTimeout(()=>other.focus(),50);}});

function showCancellationSuccess(bookingId, reason){
  const m=document.getElementById('cancellationSuccessModal');
  if(!m)return;
  const id=document.getElementById('cancelSuccessBookingId'), r=document.getElementById('cancelSuccessReason');
  if(id)id.textContent=bookingId||'—';
  if(r)r.textContent=reason||'Reason not provided';
  m.classList.add('open'); m.setAttribute('aria-hidden','false'); document.body.classList.add('booking-modal-open');
}
function closeCancellationSuccess(){
  const m=document.getElementById('cancellationSuccessModal');
  if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.classList.remove('booking-modal-open');}
}

async function submitCancelReason(){
  if(!pendingCancelCode)return;
  let reason=pendingCancelReason; const other=document.getElementById('cancelOtherReason');
  if(reason==='Other') reason=(other?.value||'').trim();
  if(!reason)return alert('Please select a reason or enter your reason in the text box.');
  const btn=document.getElementById('submitCancelReason'); if(btn)btn.disabled=true;
  try{await api('/api/bookings/'+pendingCancelCode+'/cancel',{method:'POST',body:JSON.stringify({customer_id:customer.id,reason})});const cancelledBookingId=historyRows.find(x=>x.booking_code===decodeURIComponent(pendingCancelCode))?.booking_code||decodeURIComponent(pendingCancelCode); closeCancelReason(); await Promise.all([loadHistory(),loadNotifications()]); showCancellationSuccess(cancelledBookingId,reason);}
  catch(e){alert(e.message)} finally{if(btn)btn.disabled=false;}
}
function updateBookingHero(){
  const v=document.getElementById('bookingHeroVisual'); if(!v)return;
  const code=document.getElementById('bookingHeroCode'),service=document.getElementById('bookingHeroService'),schedule=document.getElementById('bookingHeroSchedule'),status=document.getElementById('bookingHeroStatus'),eng=document.getElementById('bookingHeroEngineer'),updated=document.getElementById('bookingHeroUpdated'),timeline=document.getElementById('bookingHeroTimeline');
  const active=(historyRows||[]).filter(b=>!['Completed','Closed','Cancelled'].includes(b.status));
  if(!active.length){
    v.classList.add('booking-empty'); code.textContent='UTS'; service.textContent='No active service'; schedule.textContent='Your next booking will appear here'; status.textContent='READY'; eng.innerHTML='<span>Service status</span><b>Ready for your next request</b>'; updated.textContent='Updated automatically';
    timeline.querySelectorAll('.timeline-step').forEach((x,i)=>x.classList.toggle('done',i===0)); return;
  }
  const b=active[0]; v.classList.remove('booking-empty'); code.textContent=b.booking_code||'UTS'; service.textContent=b.service||'Service request'; schedule.textContent=`${b.date||''} • ${b.time||''}`;
  status.textContent=b.status||'ACTIVE';
  const engineer=b.engineer||'Not assigned'; const engineerStatus=b.engineer_status|| (b.engineer?'Assigned':'Waiting for assignment');
  eng.innerHTML=`<span>${b.offer_id?'Offer booking':'Regular booking'}</span><b>${esc(engineer)}${engineer!=='Not assigned'?' • '+esc(engineerStatus):''}</b>`;
  updated.textContent='Live update • just now';
  const order=['Pending','Assigned','On the Way','Arrived','Service Started','Completed','Closed']; const idx=Math.max(0,order.indexOf(b.status));
  timeline.querySelectorAll('.timeline-step').forEach((x,i)=>x.classList.toggle('done', i<=Math.min(idx,3)));
  if(b.status==='Cancelled'){status.textContent='CANCELLED';v.classList.add('booking-cancelled');timeline.querySelectorAll('.timeline-step').forEach(x=>x.classList.remove('done'));}
}
function renderHistory(){
  updateBookingHero(); updateBookingCounts();
  const box=document.getElementById('historyList'); if(!box)return;
  if(!historyRows.length){box.innerHTML='<div class="booking-empty-state"><div>▣</div><h3>No bookings yet</h3><p>Your confirmed services will appear here with their Booking ID, schedule and status.</p><button class="btn dark" onclick="show(\'servicesPage\');renderServices()">Browse Services →</button></div>';return}
  const filtered=historyRows.filter(bookingFilterMatch);
  if(!filtered.length){box.innerHTML='<div class="booking-empty-state"><div>✓</div><h3>No bookings in this section</h3><p>Try another filter to see your bookings.</p></div>';return}
  const active=filtered.filter(b=>!['Closed','Cancelled'].includes(b.status));
  const past=filtered.filter(b=>['Closed','Cancelled'].includes(b.status));
  box.innerHTML=(active.length?'<div class="eyebrow booking-section-label">CURRENT BOOKINGS</div>'+active.map(historyCard).join(''):'')+(past.length?'<div class="eyebrow booking-section-label">BOOKING HISTORY</div>'+past.map(historyCard).join(''):'');
}
async function confirmBookingFromHistory(code,btn){
  const decoded=decodeURIComponent(code);
  if(!customer?.id)return alert('Please login again.');
  if(!confirm('Confirm that your service has been completed successfully?'))return;
  if(btn){btn.disabled=true;btn.textContent='Confirming…';}
  try{
    const b=await api('/api/bookings/'+encodeURIComponent(decoded)+'/confirm',{
      method:'POST',body:JSON.stringify({customer_id:customer.id})
    });
    bookingCode=decoded;
    // Show the same Service Done popup used by Track Service.
    if(typeof showServiceDonePopup==='function'){
      showServiceDonePopup(b||{booking_code:decoded,status:'Closed',payment_status:'Unpaid'});
    }
    await Promise.all([loadHistory(),loadNotifications()]);
  }catch(e){
    console.error('My Bookings approval failed:',e);
    alert(e?.message||'Could not approve this service. Please try again.');
    if(btn){btn.disabled=false;btn.textContent='Approve & Close';}
  }
}
async function payBookingFromHistory(code,btn){
  const decoded=decodeURIComponent(code);
  if(!customer?.id)return alert('Please login again.');
  const utrEl=document.querySelector('[data-done-utr]');
  const utr=(utrEl?.value||'').trim();
  if(utr.length<4){
    const b=historyRows.find(x=>x.booking_code===decoded)||{booking_code:decoded,status:'Closed',payment_status:'Unpaid'};
    if(typeof showServiceDonePopup==='function')showServiceDonePopup(b,false);
    setTimeout(()=>document.querySelector('[data-done-utr]')?.focus(),100);
    return;
  }
  if(btn){btn.disabled=true;btn.textContent='Processing…';}
  try{
    const b=await api('/api/bookings/'+encodeURIComponent(decoded)+'/pay',{
      method:'POST',body:JSON.stringify({customer_id:customer.id,utr})
    });
    bookingCode=decoded;
    if(typeof showServiceDonePopup==='function'){
      showServiceDonePopup(b||{booking_code:decoded,status:'Closed',payment_status:'Paid',payment_utr:utr},true);
    }
    await Promise.all([loadHistory(),loadNotifications()]);
  }catch(e){
    console.error('My Bookings payment failed:',e);
    alert(e?.message||'Could not process payment. Please try again.');
    if(btn){btn.disabled=false;btn.textContent='Pay Now';}
  }
}

async function openPastBooking(code){show('history','bookings');await loadHistory();toast('Booking ID '+decodeURIComponent(code)+' is available in My Bookings. Track Service shows only your current active service.')} 
function openUpcomingBooking(code){bookingCode=decodeURIComponent(code);show('track');refreshTracking();}
async function loadProfile(){if(!customer?.id)return;try{customer=await api('/api/customer/'+customer.id+'/profile');renderProfile()}catch(e){renderProfile()}}
function renderProfile(){const n=(customer.name||'C').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();document.getElementById('profileAvatar').textContent=n;document.getElementById('profileWelcome').textContent='Welcome, '+(customer.name||'Customer');document.getElementById('pName').value=customer.name||'';document.getElementById('pPhone').value=customer.phone||'';document.getElementById('pEmail').value=customer.email||'';document.getElementById('pArea').value=customer.area||'';document.getElementById('pAddress').value=customer.address||'';updateAccountControl()}
let profileChangeMode='';
let profileChangeResendTimer=null;
let profileChangeResendSeconds=0;
function startProfileChangeResendCountdown(){
  clearInterval(profileChangeResendTimer);
  const btn=document.getElementById('profileChangeSendBtn');
  profileChangeResendSeconds=60;
  if(btn){btn.disabled=true;btn.textContent='Re-send OTP in 60s';}
  profileChangeResendTimer=setInterval(()=>{
    profileChangeResendSeconds--;
    const b=document.getElementById('profileChangeSendBtn');
    if(profileChangeResendSeconds>0){
      if(b){b.disabled=true;b.textContent='Re-send OTP in '+profileChangeResendSeconds+'s';}
    }else{
      clearInterval(profileChangeResendTimer); profileChangeResendTimer=null;
      if(b){b.disabled=false;b.textContent='Re-send OTP →';}
    }
  },1000);
}
function resetProfileChangeResend(){
  clearInterval(profileChangeResendTimer); profileChangeResendTimer=null;
  profileChangeResendSeconds=0;
  const b=document.getElementById('profileChangeSendBtn');
  if(b){b.disabled=false;b.textContent='Send OTP to Mobile →';}
}

function openProfileChange(mode){
  profileChangeMode=mode;
  const title=document.getElementById('profileChangeTitle');
  const label=document.getElementById('profileChangeValueLabel');
  const input=document.getElementById('profileChangeValue');
  const otpBox=document.getElementById('profileChangeOtpBox');
  const sendBtn=document.getElementById('profileChangeSendBtn');
  if(!title||!label||!input)return;
  title.textContent=mode==='email'?'Change Email':'Change Mobile Number';
  label.textContent=mode==='email'?'New Email':'New Mobile Number';
  input.type=mode==='email'?'email':'tel';
  input.maxLength=mode==='email'?120:10;
  input.inputMode=mode==='email'?'email':'numeric';
  input.placeholder=mode==='email'?'you@example.com':'10-digit mobile number';
  input.value=mode==='email'?(customer?.email||''):(customer?.phone||'');
  otpBox.style.display='none';
  sendBtn.disabled=false;
  sendBtn.textContent='Send OTP to Mobile →';
  clearInterval(profileChangeResendTimer); profileChangeResendTimer=null; profileChangeResendSeconds=0;
  document.getElementById('profileChangeOtp').value='';
  const m=document.getElementById('profileChangeModal'); m.style.display='flex'; m.setAttribute('aria-hidden','false');
  setTimeout(()=>input.focus(),80);
}

function closeProfileChange(){
  clearInterval(profileChangeResendTimer); profileChangeResendTimer=null; profileChangeResendSeconds=0;
  const m=document.getElementById('profileChangeModal'); if(m){m.style.display='none';m.setAttribute('aria-hidden','true');}
}

async function sendProfileChangeOtp(){
  try{
    if(profileChangeResendSeconds>0)return;
    if(!customer?.id)throw Error('Please login again.');
    const value=document.getElementById('profileChangeValue').value.trim();
    if(profileChangeMode==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw Error('Enter a valid email address.');
    if(profileChangeMode==='mobile' && !/^\d{10}$/.test(value.replace(/\D/g,''))) throw Error('Enter a valid 10-digit mobile number.');
    const d=await api('/api/customer/'+customer.id+'/profile-change-otp',{method:'POST',body:JSON.stringify({type:profileChangeMode,value})});
    document.getElementById('profileChangeOtpBox').style.display='block';
    document.getElementById('profileChangeInfo').textContent='OTP has been sent to your registered mobile number '+(customer.phone||'')+'.';
    startProfileChangeResendCountdown();
    toast(d.message||'OTP sent to your mobile number.');
    setTimeout(()=>document.getElementById('profileChangeOtp')?.focus(),80);
  }catch(e){alert(e.message)}
}

async function verifyProfileChangeOtp(){
  try{
    const value=document.getElementById('profileChangeValue').value.trim();
    const otp=document.getElementById('profileChangeOtp').value.trim();
    if(!/^\d{6}$/.test(otp))throw Error('Enter the 6-digit OTP.');
    const d=await api('/api/customer/'+customer.id+'/profile-change-otp',{method:'PUT',body:JSON.stringify({type:profileChangeMode,value,otp})});
    customer=d.customer||d;
    renderProfile();
    closeProfileChange();
    toast(profileChangeMode==='email'?'Email updated successfully.':'Mobile number updated successfully.');
  }catch(e){alert(e.message)}
}

async function saveProfile(){try{customer=await api('/api/customer/'+customer.id+'/profile',{method:'PUT',body:JSON.stringify({name:document.getElementById('pName').value,email:document.getElementById('pEmail').value,area:document.getElementById('pArea').value,address:document.getElementById('pAddress').value})});renderProfile();toast('Profile updated.')}catch(e){alert(e.message)}}
async function loadNotifications(){if(!customer?.id)return;try{notifications=await api('/api/customer/'+customer.id+'/notifications');renderNotifications();document.getElementById('notifCount').textContent=notifications.filter(n=>!n.is_read).length||''}catch(e){document.getElementById('notificationList').innerHTML='<div class="notification-empty">No notifications.</div>'}}
function renderNotifications(){const box=document.getElementById('notificationList');if(!notifications.length){box.innerHTML='<div class="notification-empty">No notifications.</div>';return}box.innerHTML=notifications.map(n=>`<div class="notification ${n.is_read?'':'unread'}"><b>${esc(n.title)}</b><span>${esc(n.message)}</span><span>${esc(n.created_at)}</span></div>`).join('')}
function toast(t){const e=document.getElementById('toast');e.textContent=t;e.style.display='block';setTimeout(()=>e.style.display='none',2200)}
async function initCustomerAuth(){try{const d=await api('/api/customer/session');if(d.customer){customer=d.customer;document.body.classList.add('customer-auth');await Promise.all([loadServices(),loadOffers(),loadHistory(),loadProfile(),loadNotifications()]);show('home');return}}catch(e){} document.body.classList.remove('customer-auth');show('login')}
initCustomerAuth();

async function openLatestActive(){
  if(!customer?.id){show('home');return}
  if(!historyRows.length) await loadHistory();
  const b=[...historyRows].filter(x=>!['Closed','Cancelled'].includes(x.status)).sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0))[0];
  if(!b){alert('No active service found.');show('history');return}
  bookingCode=b.booking_code; show('track'); await refreshTracking();
}
function renderPayments(){
  const box=document.getElementById('paymentList'); if(!box)return;
  const rows=historyRows||[];
  if(!rows.length){box.innerHTML='<div class="notification-empty">No payments or invoices yet.</div>';return}
  box.innerHTML=rows.map(b=>`<div class="panel history-card"><div class="history-top"><div><div class="eyebrow">${esc(b.booking_code)}</div><h3 style="margin:5px 0">${esc(b.service)}</h3><div style="font-size:9px;color:#737c86">${esc(b.date)} • ${esc(b.time)}</div></div><span class="status-pill ${b.payment_status==='Paid'?'good':'warn'}">${esc(b.payment_status||'Unpaid')}</span></div><div class="history-grid"><div><small>Amount</small><b>₹${Number(b.amount||0).toLocaleString('en-IN')}</b></div><div><small>Payment ID</small><b>${esc(b.payment_id||'—')}</b></div><div><small>Service Status</small><b>${esc(b.status)}</b></div><div><small>Engineer</small><b>${esc(b.engineer||'Not assigned')}</b></div></div><div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn dark" onclick="printInvoice('${encodeURIComponent(b.booking_code)}')">Print Invoice</button>${b.payment_status!=='Paid'&&['Completed','Closed'].includes(b.status)?`<button class="btn" onclick="bookingCode='${encodeURIComponent(b.booking_code)}';payNow()">Pay Now</button>`:''}</div></div>`).join('');
}
function printInvoice(code){
 const b=historyRows.find(x=>x.booking_code===decodeURIComponent(code)); if(!b)return;
 const w=window.open('','_blank','width=760,height=700'); if(!w)return alert('Please allow pop-ups to print the invoice.');
 w.document.write(`<html><head><title>Invoice ${esc(b.booking_code)}</title><style>body{font-family:Arial;padding:40px;color:#111}h1{margin-bottom:4px}.muted{color:#666;font-size:13px}.box{border:1px solid #ddd;padding:18px;border-radius:10px;margin-top:18px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:10px 0}.total{font-size:20px;font-weight:bold;margin-top:15px}</style><style>
/* Unique Techno — Booking Status Timeline */
.ut-booking-timeline{margin:20px 0;padding:18px;border:1px solid #e5e7eb;border-radius:14px;background:#fff}
.ut-booking-timeline-title{font-size:18px;font-weight:700;margin-bottom:16px}
.ut-timeline-track{display:flex;align-items:flex-start;gap:0;overflow-x:auto;padding:6px 2px 10px}
.ut-timeline-step{min-width:145px;position:relative;text-align:center;font-size:14px;color:#6b7280}
.ut-timeline-step:not(:last-child)::after{content:"";position:absolute;top:15px;left:calc(50% + 16px);right:calc(-50% + 16px);height:2px;background:#d1d5db}
.ut-timeline-dot{width:30px;height:30px;border-radius:50%;margin:0 auto 9px;display:flex;align-items:center;justify-content:center;background:#e5e7eb;color:#6b7280;font-weight:700;position:relative;z-index:1}
.ut-timeline-step.done{color:#111827;font-weight:600}
.ut-timeline-step.done .ut-timeline-dot{background:#16a34a;color:#fff}
.ut-timeline-step.current{color:#111827;font-weight:700}
.ut-timeline-step.current .ut-timeline-dot{background:#2563eb;color:#fff;box-shadow:0 0 0 5px rgba(37,99,235,.12)}
.ut-timeline-step.done:not(:last-child)::after{background:#16a34a}
@media(max-width:600px){.ut-timeline-step{min-width:125px;font-size:13px}}
</style></head><body><h1>Unique Techno Solutions</h1><div class="muted">Service Invoice / Receipt</div><div class="box"><div class="row"><b>Booking</b><span>${esc(b.booking_code)}</span></div><div class="row"><b>Customer</b><span>${esc(customer?.name||'')}</span></div><div class="row"><b>Phone</b><span>${esc(customer?.phone||'')}</span></div><div class="row"><b>Service</b><span>${esc(b.service)}</span></div><div class="row"><b>Date</b><span>${esc(b.date)} ${esc(b.time)}</span></div><div class="row"><b>Engineer</b><span>${esc(b.engineer||'—')}</span></div><div class="row"><b>Payment</b><span>${esc(b.payment_status||'Unpaid')} ${b.payment_id?'• '+esc(b.payment_id):''}</span></div><div class="total">Total: ₹${Number(b.amount||0).toLocaleString('en-IN')}</div></div><p class="muted">This is a prototype service invoice generated from your booking record.</p><script>window.print()<\/script><script>
function renderBookingStatusTimeline(container, status){
  if(!container) return;
  const steps=[
    ["Booked","booked"],
    ["Confirmed","confirmed"],
    ["Engineer Assigned","engineer_assigned"],
    ["Engineer On The Way","on_the_way"],
    ["Service Started","service_started"],
    ["Completed","completed"]
  ];
  const normalized=String(status||"").toLowerCase().replace(/[\s-]+/g,"_");
  const aliases={
    pending:"booked",requested:"booked",booking_requested:"booked",
    confirmed:"confirmed",accepted:"confirmed",
    assigned:"engineer_assigned",engineer_assigned:"engineer_assigned",
    on_the_way:"on_the_way",en_route:"on_the_way",engineer_on_the_way:"on_the_way",
    in_progress:"service_started",started:"service_started",service_started:"service_started",
    completed:"completed"
  };
  const current=aliases[normalized]||normalized;
  const idx=Math.max(0,steps.findIndex(s=>s[1]===current));
  container.innerHTML='<div class="ut-booking-timeline-title">Booking Status</div><div class="ut-timeline-track">'+
    steps.map((s,i)=>{
      const state=i<idx?'done':(i===idx?'current':'');
      return '<div class="ut-timeline-step '+state+'"><div class="ut-timeline-dot">'+(i<idx?'✓':(i+1))+'</div><div>'+s[0]+'</div></div>';
    }).join('')+'</div>';
}
</script></body></html>`); w.document.close();
}
async function loadSupport(){
 if(!customer?.id)return; const box=document.getElementById('supportList'); if(!box)return;
 try{const rows=await api('/api/customer/'+customer.id+'/support');box.innerHTML=rows.length?rows.map(t=>`<div class="notification"><b>#${t.id} • ${esc(t.subject)}</b><span>Status: ${esc(t.status)}${t.booking_code?' • '+esc(t.booking_code):''}</span><p style="font-size:10px;margin:8px 0">${esc(t.message)}</p></div>`).join(''):'<div class="notification-empty">No support requests yet.</div>'}catch(e){box.innerHTML='<div class="notification-empty">Could not load support requests.</div>'}
}
async function submitSupport(){
 const subject=document.getElementById('supportSubject').value.trim(), message=document.getElementById('supportMessage').value.trim(), code=document.getElementById('supportBooking').value.trim();
 if(!subject||!message)return alert('Enter subject and message.'); let booking_id=null;
 if(code){const b=historyRows.find(x=>x.booking_code===code); if(!b)return alert('Booking ID not found in your account.'); booking_id=b.id}
 try{await api('/api/customer/'+customer.id+'/support',{method:'POST',body:JSON.stringify({subject,message,booking_id})});document.getElementById('supportSubject').value='';document.getElementById('supportMessage').value='';document.getElementById('supportBooking').value='';await loadSupport();await loadNotifications();toast('Support request submitted.')}catch(e){alert(e.message)}
}

// Corporate portal navigation state is handled by show(id, navKey) above.
const _loadNotificationsOriginal = loadNotifications;
loadNotifications = async function(){
  await _loadNotificationsOriginal();
  renderFloatingNotifications();
};

function renderFloatingNotifications(){
  const box=document.getElementById('floatingNotificationList');
  const badge=document.getElementById('floatingNotifCount');
  if(!box||!badge)return;
  const unread=notifications.filter(n=>Number(n.is_read)!==1).length;
  badge.textContent=unread?String(unread):'';
  badge.classList.toggle('has-count',unread>0);
  if(!notifications.length){box.innerHTML='<div class="floating-notification-empty">No notifications yet.</div>';return;}
  box.innerHTML=notifications.slice(0,50).map(n=>{
    const id=Number(n.id);
    const open=Number(window.__openNotificationId)===id;
    const unreadClass=Number(n.is_read)!==1?' unread':'';
    return `<div class="floating-notification-item${unreadClass}${open?' expanded':''}" data-id="${id}">
      <div class="floating-notification-row" role="button" tabindex="0" onclick="toggleCustomerNotification(${id},event)" onkeydown="if(event.key==='Enter'||event.key===' ')toggleCustomerNotification(${id},event)">
        <span class="floating-notification-dot"></span>
        <span class="floating-notification-copy"><b>${esc(n.title)}</b><span>${esc(n.message)}</span><small>${esc(n.created_at||'')}</small></span>
        <span class="floating-notification-chevron">${open?'⌃':'⌄'}</span>
      </div>
      ${open?`<div class="floating-notification-details">
        <div class="floating-notification-full">${esc(n.message||'No additional details available.')}</div>
        <div class="floating-notification-meta"><span class="${Number(n.is_read)!==1?'status-unread':'status-read'}">${Number(n.is_read)!==1?'● Unread':'✓ Read'}</span><span>${esc(n.created_at||'')}</span></div>
        <div class="floating-notification-actions">
          ${Number(n.is_read)!==1?`<button type="button" class="floating-notification-markread" onclick="markCustomerNotificationRead(${id},event)">✓ Mark as read</button>`:'<span class="floating-notification-read-label">✓ Already read</span>'}
          ${n.booking_id?`<button type="button" class="floating-notification-view" onclick="viewCustomerNotificationBooking(${id},${JSON.stringify(String(n.booking_id))},event)">View Booking →</button>`:''}
        </div>
      </div>`:''}
    </div>`;
  }).join('');
}

function toggleFloatingNotifications(event){
  event?.stopPropagation();
  if(!customer?.id)return;
  const p=document.getElementById('floatingNotificationPanel');
  if(!p)return;
  if(typeof closeAccountMenu==='function')closeAccountMenu();
  const open=p.classList.toggle('open');
  p.setAttribute('aria-hidden',open?'false':'true');
  if(open){window.__openNotificationId=null;loadNotifications();}
}
function closeFloatingNotifications(){
  const p=document.getElementById('floatingNotificationPanel');
  if(p){p.classList.remove('open');p.setAttribute('aria-hidden','true');}
  window.__openNotificationId=null;
}

async function markCustomerNotificationRead(id,event){
  event?.stopPropagation();
  if(!customer?.id)return false;
  try{
    const r=await api('/api/customer/'+customer.id+'/notifications/read',{method:'POST',body:JSON.stringify({id:Number(id)})});
    if(!r?.ok)throw Error('Read update failed');
    const n=notifications.find(x=>Number(x.id)===Number(id));
    if(n)n.is_read=1;
    renderFloatingNotifications();
    return true;
  }catch(e){
    alert('Could not mark notification as read. Please try again.');
    return false;
  }
}

async function markAllNotificationsRead(event){
  event?.stopPropagation();
  if(!customer?.id)return;
  try{
    const r=await api('/api/customer/'+customer.id+'/notifications/read',{method:'POST',body:JSON.stringify({all:true})});
    if(!r?.ok)throw Error('Read update failed');
    notifications.forEach(n=>n.is_read=1);
    window.__openNotificationId=null;
    renderFloatingNotifications();
    toast('All notifications marked as read.');
  }catch(e){alert('Could not mark all notifications as read. Please try again.');}
}

function toggleCustomerNotification(id,event){
  event?.stopPropagation();
  const nid=Number(id);
  window.__openNotificationId=Number(window.__openNotificationId)===nid?null:nid;
  renderFloatingNotifications();
}

async function viewCustomerNotificationBooking(id,bookingId,event){
  event?.stopPropagation();
  await markCustomerNotificationRead(id,event);
  closeFloatingNotifications();
  const row=historyRows.find(x=>String(x.id)===String(bookingId));
  if(row){bookingCode=row.booking_code;show('track');await refreshTracking();}
}

async function openCustomerNotification(id,bookingId){toggleCustomerNotification(id);}

(function initFloatingNotifications(){
  document.addEventListener('click',e=>{
    const root=document.getElementById('notificationFab');
    if(root&&!root.contains(e.target))closeFloatingNotifications();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFloatingNotifications()});
  setInterval(()=>{if(customer&&document.visibilityState==='visible')loadNotifications().catch(()=>{});},10000);
})();

async function logoutCustomer(){try{await api('/api/customer/logout',{method:'POST'});}catch(e){} customer=null;historyRows=[];notifications=[];document.body.classList.remove('customer-auth');document.getElementById('otpStep').classList.remove('on');document.getElementById('phoneStep').style.display='block';document.getElementById('otp').value='';show('login');window.history.replaceState({},'', '/customer/login');}

async function offerActivity(offerId,activity){try{await api('/api/offers/'+encodeURIComponent(offerId)+'/activity',{method:'POST',body:JSON.stringify({activity})})}catch(e){}}
function openOfferDetails(offerId,action='view'){const o=offers.find(x=>Number(x.id)===Number(offerId));if(!o)return;offerActivity(o.id,action==='explore'?'explore':'view');const svc=o.service_id?services.find(s=>Number(s.id)===Number(o.service_id)):null;document.getElementById('offerModalBadge').textContent=o.badge||'LIMITED OFFER';document.getElementById('offerModalIcon').textContent=o.icon||'✦';document.getElementById('offerModalTitle').textContent=o.title;document.getElementById('offerModalDesc').textContent=o.description;document.getElementById('offerModalDiscount').textContent=o.discount||'Special offer';document.getElementById('offerModalPrice').textContent='₹'+Number(o.fixed_price||0).toLocaleString('en-IN');document.getElementById('offerModalValid').textContent=o.valid_until?'Valid till '+o.valid_until:'While available';document.getElementById('offerModalService').textContent=svc?svc.name:(o.service_name||'Professional service');const btn=document.getElementById('offerModalBook');btn.style.display=svc?'inline-flex':'none';btn.textContent='Book This Offer →';btn.onclick=()=>{if(svc){pendingOfferId=o.id;currentService=svc;openBooking()}closeOfferDetails()};document.getElementById('offerDetailsModal').classList.add('open');document.body.classList.add('modal-open')}
function closeOfferDetails(){document.getElementById('offerDetailsModal')?.classList.remove('open');document.body.classList.remove('modal-open')}
function openOfferAction(offerId,action='explore'){openOfferDetails(offerId,action)}
function renderDashboard(){
  if(!customer)return;
  const active=historyRows.filter(b=>!['Completed','Closed','Cancelled'].includes(b.status));
  const completed=historyRows.filter(b=>['Completed','Closed'].includes(b.status));
  const ratings=historyRows.filter(b=>Number(b.review_rating)>0).map(b=>Number(b.review_rating));
  const avg=ratings.length?(ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(1):'—';
  const name=customer.name&&customer.name!=='Customer'?customer.name.split(/\s+/)[0]:'there';
  const g=document.getElementById('dashGreeting'); if(g)g.textContent=`Welcome back, ${name}.`;
  const sub=document.getElementById('dashSubtitle'); if(sub)sub.textContent=active.length?'Here is the latest update on your service.':'Professional technical support whenever you need it.';
  document.getElementById('statTotal').textContent=historyRows.length;
  document.getElementById('statCompleted').textContent=completed.length;
  document.getElementById('statActive').textContent=active.length;
  document.getElementById('statRating').textContent=avg+(avg!=='—'?' ★':'');

  const current=document.getElementById('currentServicePanel');
  if(active.length){
    const b=active[0];
    const ini=b.engineer?b.engineer.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase():'—';
    current.innerHTML=`<div class="panel-heading"><div><span class="eyebrow">CURRENT SERVICE</span><h3>Service in progress</h3></div><span class="current-status">${esc(b.status)}</span></div><div class="current-active"><div><div class="current-title">${esc(b.service)}</div><div class="current-meta"><b>${esc(b.booking_code)}</b> • ${esc(b.date)} • ${esc(b.time)}<br>${esc(b.address||'Service address not set')}</div>${b.engineer?`<div class="engineer-mini"><div class="mini-avatar">${ini}</div><div><b>${esc(b.engineer)}</b><span>Engineer • ${esc(b.engineer_status||'Assigned')}</span></div></div>`:''}<div class="current-actions"><button class="mini-btn primary" onclick="bookingCode='${esc(b.booking_code)}';show('track');refreshTracking()">View Service</button>${b.engineer_phone?`<a class="mini-btn" href="tel:${esc(b.engineer_phone)}">Call Engineer</a>`:''}</div></div><div class="dash-mini-art">${esc(b.service_icon||'🛠️')}</div></div>`;
  }else{
    current.innerHTML=`<div class="dash-empty"><div class="dash-empty-copy"><span class="eyebrow">NO ACTIVE SERVICE</span><h2>Nothing booked right now.</h2><p>You can browse our professional services, schedule a visit, or simply explore the portal. We will keep your service information here when you book.</p><button class="btn dark" onclick="show('servicesPage');renderServices()">Book a Service →</button></div><div class="dash-mini-art">⚙</div></div>`;
  }

  const upcoming=document.getElementById('upcomingPanel');
  const future=historyRows.filter(b=>!['Completed','Closed','Cancelled'].includes(b.status)).slice(1,2);
  if(future.length){const b=future[0];upcoming.innerHTML=`<div class="panel-heading"><div><span class="eyebrow">UPCOMING SERVICE</span><h3>Your next visit</h3></div><span class="upcoming-badge">${esc(b.status)}</span></div><div class="upcoming-grid"><div><div class="service-name">${esc(b.service)}</div><div class="service-meta">${esc(b.date)} • ${esc(b.time)}<br>${esc(b.engineer?'Engineer: '+b.engineer:'Engineer will be assigned soon')}<br>${esc(b.address||'')}</div></div><button type="button" class="date-box" onclick="openUpcomingBooking('${esc(b.booking_code)}')" aria-label="View details for ${esc(b.service)}"><b>→</b><span>View details</span></button></div>`}else{upcoming.innerHTML='';}

  const last=completed[0]; const lastPanel=document.getElementById('lastServicePanel');
  if(last){lastPanel.innerHTML=`<div class="panel-heading"><div><span class="eyebrow">LAST SERVICE</span><h3>Recently completed</h3></div><button class="text-link" onclick="bookingCode='${esc(last.booking_code)}';show('track');refreshTracking()">View Details →</button></div><div class="last-grid"><div><div class="service-name">${esc(last.service)}</div><div class="service-meta">${esc(last.date)} • ${esc(last.time)}<br>Engineer: ${esc(last.engineer||'—')}<br>Amount: ₹${Number(last.amount||0).toLocaleString('en-IN')}</div></div><div class="date-box"><b>${last.review_rating?'★ '+last.review_rating:'☆'}</b><span>${last.review_rating?'Your rating':'Rate service'}</span></div></div>`}else{lastPanel.innerHTML='';}

  const op=document.getElementById('offersPanel');
  if(op){
    if(offers.length){
      op.innerHTML=`<div class="offers-shell">
        <div class="offers-topline"><div><span class="eyebrow">LATEST OFFERS</span><h3>Exclusive offers for you.</h3><p>Smart savings on professional services from Unique Techno Solutions.</p></div><span class="offer-live"><i></i> LIVE OFFERS</span></div>
        <div class="offer-benefits">
          <div><span class="benefit-icon">✓</span><div><b>Trusted Service</b><small>Professional support</small></div></div>
          <div><span class="benefit-icon">◷</span><div><b>Limited Time</b><small>Grab before it ends</small></div></div>
          <div><span class="benefit-icon">✦</span><div><b>Expert Engineers</b><small>Skilled professionals</small></div></div>
          <div><span class="benefit-icon">⌁</span><div><b>Better Value</b><small>Service + savings</small></div></div>
        </div>
        <div class="offer-grid unique-offer-grid">${offers.slice(0,3).map((o,i)=>`<article class="offer-card unique-offer-card offer-tone-${i%3}">
          <div class="offer-card-top"><span class="offer-badge">${esc(o.badge||'LIMITED TIME')}</span><span class="offer-icon">${esc(o.icon||'✦')}</span></div>
          <h4>${esc(o.title)}</h4><p>${esc(o.description)}</p>
          <div class="offer-save">${esc(o.discount||'Special offer')}</div>
          <div class="offer-meta"><div><small>FIXED OFFER PRICE</small><b>₹${Number(o.fixed_price||0).toLocaleString('en-IN')}</b></div><div><small>VALID TILL</small><b>${esc(o.valid_until||'While available')}</b></div></div>
          <div class="offer-cta"><button onclick="${o.service_id?`pendingOfferId=${Number(o.id)};currentService=services.find(s=>Number(s.id)===Number(${Number(o.service_id)}));openBooking()`:`openOfferDetails(${Number(o.id)},'explore')` }">${o.service_id?'Book Now →':'Explore Offer →'}</button><button class="offer-details-link" onclick="openOfferDetails(${Number(o.id)},'view')">View details</button></div>
        </article>`).join('')}</div>
        <div class="offers-footer"><div><span class="gift-mark">✦</span><div><b>More offers coming your way!</b><small>Keep notifications enabled so you never miss a deal.</small></div></div><button onclick="show('notifications');loadNotifications()">Enable Alerts →</button></div>
      </div>`;
    } else { op.innerHTML='<div class="offers-empty"><div class="offers-empty-icon">✦</div><div><span class="eyebrow">EXCLUSIVE FOR YOU</span><h3>No active offers right now.</h3><p>We are preparing new service deals. Check back soon or explore our services below.</p></div><button class="btn dark" onclick="show(&quot;servicesPage&quot;);renderServices()">Explore Services →</button></div>'; }
  }

  const rec=document.getElementById('recommendationsPanel');
  const source=services.slice(0,3);
  rec.innerHTML=`<div class="panel-heading"><div><span class="eyebrow">EXPLORE</span><h3>Popular services</h3></div><button class="text-link" onclick="show('servicesPage');renderServices()">View all →</button></div><div class="rec-grid">${source.map(s=>`<div class="rec-card" onclick="openDetails(${s.id})"><div class="rec-icon">${esc(s.icon)}</div><b>${esc(s.name)}</b><span>From ₹${Number(s.price).toLocaleString('en-IN')}</span></div>`).join('')}</div>`;

  const dn=document.getElementById('dashNotifications'); const recent=notifications.slice(0,4);
  if(dn){
    dn.innerHTML=recent.length?`<div class="notification-list-mini">${recent.map(n=>`<div class="notif-mini ${n.is_read?'':'unread'}"><span class="notif-dot"></span><div><b>${esc(n.title)}</b><span>${esc(n.message)} • ${esc(n.created_at||'')}</span></div></div>`).join('')}</div>`:'<div class="notification-empty" style="padding:16px 0">You are all caught up.</div>';
  }
  const unreadCount=notifications.filter(n=>!n.is_read).length;
  const badge=document.getElementById('dashNotifBadge');
  const summary=document.getElementById('dashNotifSummary');
  if(badge){ badge.textContent=unreadCount?String(unreadCount):''; badge.classList.toggle('has-count',unreadCount>0); }
  if(summary){ summary.textContent=unreadCount?`${unreadCount} unread update${unreadCount===1?'':'s'}`:(notifications.length?`${notifications.length} recent update${notifications.length===1?'':'s'}`:'No new updates'); }

  const inv=document.getElementById('dashInvoice');
  const paid=historyRows.find(b=>b.payment_status==='Paid')||historyRows[0];
  inv.innerHTML=paid?`<div class="panel-heading"><div><span class="eyebrow">LATEST BILLING</span><h3>Latest invoice</h3></div><button class="text-link" onclick="show('payments');loadHistory();renderPayments()">View all →</button></div><div class="invoice-amount">₹${Number(paid.amount||0).toLocaleString('en-IN')}</div><div class="invoice-row"><span>Service</span><b>${esc(paid.service)}</b></div><div class="invoice-row"><span>Status</span><b>${esc(paid.payment_status||'Unpaid')}</b></div>`:`<div class="panel-heading"><div><span class="eyebrow">BILLING</span><h3>Payments & invoices</h3></div></div><p style="font-size:10px;color:#78879a;line-height:1.6">Your invoices and payment history will appear here after your first service.</p>`;
}

function toggleDashboardNotifications(){
  const panel=document.getElementById('dashboardNotificationPanel');
  const toggle=panel?.querySelector('.notification-toggle');
  if(!panel||!toggle)return;
  const expanded=!panel.classList.contains('collapsed');
  panel.classList.toggle('collapsed',expanded);
  toggle.setAttribute('aria-expanded',String(!expanded));
  const arrow=document.getElementById('dashNotifArrow');
  if(arrow)arrow.textContent=expanded?'⌄':'⌃';
}
const _oldLoadHistory=loadHistory; loadHistory=async function(){await _oldLoadHistory();renderDashboard()};
const _oldLoadNotifications=loadNotifications; loadNotifications=async function(){await _oldLoadNotifications();renderDashboard()};
const _oldLoadServices=loadServices; loadServices=async function(){await _oldLoadServices();renderDashboard()};
const _oldLoadOffers=loadOffers; loadOffers=async function(){await _oldLoadOffers();renderDashboard()};
// Keep customer offers synchronized with Admin deletions/updates across tabs.
(function initOfferSync(){
  let syncing=false;
  const syncOffers=async()=>{
    if(syncing || !customer)return;
    syncing=true;
    try{await loadOffers();}catch(e){}
    finally{syncing=false;}
  };
  try{
    const bc=new BroadcastChannel('uts-offers');
    bc.addEventListener('message',e=>{if(e.data?.type==='offers-changed')syncOffers();});
  }catch(e){}
  window.addEventListener('storage',e=>{if(e.key==='uts_offers_changed')syncOffers();});
  window.addEventListener('focus',syncOffers);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncOffers();});
  setInterval(()=>{if(document.visibilityState==='visible')syncOffers();},5000);
})();


document.addEventListener('input',e=>{if(e.target?.id==='address' && e.target.value.trim()) setBookingStep(3);});

function accountPhotoKey(){return customer?.id?'uniqueTechnoProfilePhoto_'+customer.id:''}
function getProfilePhoto(){try{const k=accountPhotoKey();return k?localStorage.getItem(k)||'':''}catch(e){return ''}}
function updateAccountControl(){
  const fab=document.getElementById('accountFab'); if(!fab)return;
  const name=customer?.name||'Customer'; const initials=name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase()||'C';
  const photo=getProfilePhoto();
  const a=document.getElementById('accountFabAvatar'), ma=document.getElementById('accountMenuAvatar');
  [a,ma].forEach((el)=>{if(!el)return;el.innerHTML=photo?`<img src="${photo}" alt="Profile">`:initials});
  const n=document.getElementById('accountMenuName'),p=document.getElementById('accountMenuPhone');
  if(n)n.textContent=name; if(p)p.textContent=customer?.phone||'My Account';
  const pa=document.getElementById('profileAvatar'); if(pa){pa.innerHTML=photo?`<img src="${photo}" alt="Profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:initials}
}
function toggleAccountMenu(){const m=document.getElementById('accountMenu');if(!m)return;if(typeof closeFloatingNotifications==='function')closeFloatingNotifications();m.classList.toggle('open');m.setAttribute('aria-hidden',m.classList.contains('open')?'false':'true');updateAccountControl()}
function closeAccountMenu(){const m=document.getElementById('accountMenu');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true')}}
function openAccountProfile(){closeAccountMenu();show('profile','profile');loadProfile();setTimeout(()=>document.getElementById('pName')?.focus(),120)}
function triggerProfilePhoto(){closeAccountMenu();document.getElementById('profilePhotoInput')?.click()}
function changeProfilePhoto(input){
  const file=input?.files?.[0]; if(!file)return;
  if(!file.type.startsWith('image/')){alert('Please choose an image file.');input.value='';return}
  if(file.size>3*1024*1024){alert('Profile photo should be within 3 MB.');input.value='';return}
  const reader=new FileReader(); reader.onload=()=>{try{localStorage.setItem(accountPhotoKey(),reader.result);updateAccountControl();toast('Profile photo updated.')}catch(e){alert('Could not save this photo. Please choose a smaller image.')}}; reader.readAsDataURL(file);
  input.value='';
}
document.addEventListener('click',e=>{const f=document.getElementById('accountFab');if(f&&!f.contains(e.target))closeAccountMenu()});
function bindAccountFab(){
  const b=document.getElementById('accountFabBtn');
  if(!b || b.dataset.bound==='1')return;
  b.dataset.bound='1';
  b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggleAccountMenu();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindAccountFab);else bindAccountFab();
