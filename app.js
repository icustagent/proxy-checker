var V=[],U=[],F=[],busy=false,totalCount=0,sid=null,resultsIndex=0;
var API_BASE=window.location.hostname.endsWith('vercel.app')?'':(window.location.hostname==='strongshuai.github.io'?'https://proxy-checker-nu.vercel.app':window.location.origin);
var isRemote=window.location.hostname.endsWith('vercel.app')||window.location.hostname==='strongshuai.github.io';
var proxyInput=document.getElementById("proxyInput");
var checkBtn=document.getElementById("checkBtn");
var stopBtn=document.getElementById("stopBtn");
var prog=document.getElementById("progress");
var progBar=document.getElementById("progressBar");
var validList=document.getElementById("validList");
var failList=document.getElementById("failList");
var vCount=document.getElementById("vCount");
var fCount=document.getElementById("fCount");
var sTotal=document.getElementById("sTotal");
var sValid=document.getElementById("sValid");
var sUnstable=document.getElementById("sUnstable");
var sInvalid=document.getElementById("sInvalid");
var sRate=document.getElementById("sRate");
var sCfBypass=document.getElementById("sCfBypass");
var sRegReady=document.getElementById("sRegReady");
var statusText=document.getElementById("statusText");
var proxyCountBadge=document.getElementById("proxyCountBadge");
var TARGET_PROFILE_KEY='proxy_checker_target_profile';
var ACTIVE_SESSION_KEY='proxy_checker_active_session';
var AUTH_TOKEN_KEY='proxy_checker_auth_token';
var authRequired=false;
var authenticated=false;
var targetProfiles=[
  {id:'generic',name:'常规代理检测',has_api:false,has_signup:false},
  {id:'openai',name:'OpenAI 检测',has_api:true,has_signup:true},
  {id:'grok',name:'Grok 检测',has_api:true,has_signup:false},
  {id:'gemini',name:'Gemini 检测',has_api:true,has_signup:false},
  {id:'claude',name:'Claude 检测',has_api:true,has_signup:false}
];
var currentTargetProfile=localStorage.getItem(TARGET_PROFILE_KEY)||'generic';

// ============================================================
// [1] Real-time proxy count in textarea
// ============================================================
function updateProxyCount(){
  var lines=parseLines(proxyInput.value);
  var n=lines.length;
  proxyCountBadge.textContent=n+' 个代理';
}
proxyInput.addEventListener('input',updateProxyCount);
updateProxyCount();

// Textarea drag-to-resize
(function(){
  var handle=proxyInput.parentElement;
  var startY,startH;
  handle.addEventListener('mousedown',function(e){
    // Only trigger on the bottom 8px of the handle area
    var rect=handle.getBoundingClientRect();
    if(e.clientY<rect.bottom-8)return;
    e.preventDefault();
    startY=e.clientY;
    startH=proxyInput.offsetHeight;
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
    document.body.style.cursor='ns-resize';
    document.body.style.userSelect='none';
  });
  function onMove(ev){
    var h=startH+(ev.clientY-startY);
    if(h<80)h=80;if(h>600)h=600;
    proxyInput.style.height=h+'px';
  }
  function onUp(){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onUp);
    document.body.style.cursor='';
    document.body.style.userSelect='';
  }
})();

function copyText(text){
  var ta=document.createElement("textarea");
  ta.value=text;
  ta.style.cssText="position:fixed;left:-9999px;top:-9999px";
  document.body.appendChild(ta);
  ta.select();
  try{document.execCommand("copy");toast("已复制")}catch(e){toast("复制失败")}
  document.body.removeChild(ta);
}
function toast(m){var t=document.getElementById("toast");t.textContent=m;t.classList.add("show");setTimeout(function(){t.classList.remove("show")},2500)}
function esc(s){var d=document.createElement("div");d.textContent=s;return d.innerHTML}
function parseLines(t){return t.split("\n").map(function(l){return l.trim()}).filter(function(l){return l.length>0 && !l.startsWith("#")})}
function dedup(){
  var lines=parseLines(proxyInput.value);
  var seen={};var unique=[];
  lines.forEach(function(l){var k=l.toLowerCase();if(!seen[k]){seen[k]=true;unique.push(l)}});
  proxyInput.value=unique.join("\n");
  updateProxyCount();
  toast("去重: "+lines.length+" -> "+unique.length+" 个");
}
function post(url,data,cb){
  var fullUrl=API_BASE+url;
  var xhr=new XMLHttpRequest();xhr.open("POST",fullUrl,true);
  xhr.setRequestHeader("Content-Type","application/json");
  var authToken=localStorage.getItem(AUTH_TOKEN_KEY);
  if(authToken)xhr.setRequestHeader("Authorization","Bearer "+authToken);
  xhr.onload=function(){
    var res=null;
    try{res=JSON.parse(xhr.responseText||"{}")}catch(e){cb("解析失败");return}
    if(xhr.status===401){
      if(url!=='/api/auth/login')localStorage.removeItem(AUTH_TOKEN_KEY);
      authenticated=false;
      if(url!=='/api/auth/login'&&(!API_BASE||API_BASE===window.location.origin)){
        location.replace('/login.html');
        return;
      }
      showAuthOverlay();
      cb(res.error||"请先输入登录密码",res);
      return;
    }
    cb(null,res);
  };
  xhr.onerror=function(){cb("网络错误")};
  xhr.send(JSON.stringify(data));
}

function showAuthOverlay(){
  var overlay=document.getElementById('authOverlay');
  if(!overlay)return;
  overlay.classList.add('show');
  overlay.style.display='flex';
  setTimeout(function(){
    var input=document.getElementById('authPassword');
    if(input)input.focus();
  },50);
}

function hideAuthOverlay(){
  var overlay=document.getElementById('authOverlay');
  if(!overlay)return;
  overlay.classList.remove('show');
  overlay.style.display='none';
}

function requireAuthenticatedUI(){
  if(authRequired&&!authenticated){
    showAuthOverlay();
    toast('请输入登录密码');
    return false;
  }
  return true;
}

function checkAuthStatus(){
  post('/api/auth/status',{},function(err,res){
    if(err||!res){
      authRequired=true;
      authenticated=false;
      showAuthOverlay();
      return;
    }
    authRequired=!!res.auth_required;
    authenticated=!!res.authenticated||!authRequired;
    if(authRequired&&!authenticated)showAuthOverlay();
    else hideAuthOverlay();
  });
}

function loginWithPassword(){
  var input=document.getElementById('authPassword');
  var msg=document.getElementById('authMessage');
  var btn=document.getElementById('authLoginBtn');
  var password=input?input.value:'';
  if(!password){
    if(msg)msg.textContent='请输入密码';
    return;
  }
  if(btn){btn.disabled=true;btn.textContent='登录中...'}
  post('/api/auth/login',{password:password},function(err,res){
    if(btn){btn.disabled=false;btn.textContent='登录'}
    if(err||!res||!res.ok){
      if(msg)msg.textContent=err||'登录失败';
      return;
    }
    if(res.token)localStorage.setItem(AUTH_TOKEN_KEY,res.token);
    authenticated=true;
    authRequired=!!res.auth_required;
    if(input)input.value='';
    if(msg)msg.textContent='';
    hideAuthOverlay();
    toast('已登录');
    checkCapabilities();
  });
}

function logoutAuth(){
  post('/api/auth/logout',{},function(){});
  localStorage.removeItem(AUTH_TOKEN_KEY);
  authenticated=false;
  showAuthOverlay();
  toast('已退出');
}

// Check capabilities on load
function checkCapabilities(){
  post("/api/capabilities",{},function(err,res){
    if(err) return;
    authRequired=!!res.auth_required;
    authenticated=!!res.authenticated||!authRequired;
    if(authRequired&&!authenticated)showAuthOverlay();
    if(res && Array.isArray(res.target_profiles) && res.target_profiles.length){
      targetProfiles=res.target_profiles;
      renderTargetProfileMenu();
      updateTargetProfileUI();
    }
    var badge=document.getElementById("capBadge");
    if(res && res.deep_check){
      badge.className="cap-badge cap-ok";
      badge.innerHTML="&#9989; Deep Check可用";
      badge.title="Deep Check 已可用：会用真实浏览器再测一次，速度慢一点，但更接近真实访问目标服务的结果。";
    }else{
      badge.className="cap-badge cap-no";
      badge.innerHTML="&#9888; Deep Check不可用";
      badge.title="Deep Check 是用真实浏览器复测代理的慢速检查；当前服务器没装这套组件，所以这里只能做普通检测。";
    }
    badge.style.display="inline-flex";
  });
}

function getTargetProfileInfo(id){
  for(var i=0;i<targetProfiles.length;i++){
    if(targetProfiles[i].id===id)return targetProfiles[i];
  }
  return targetProfiles[0];
}

function renderTargetProfileMenu(){
  var menu=document.getElementById('targetProfileMenu');
  if(!menu)return;
  var html='';
  targetProfiles.forEach(function(profile){
    var active=profile.id===currentTargetProfile?' <span style="color:#22c55e;margin-left:auto">✓</span>':'';
    html+='<div class="fetch-menu-item" onclick="setTargetProfile(\''+esc(profile.id)+'\')">&#127919; '+esc(profile.name)+active+'</div>';
  });
  menu.innerHTML=html;
}

function updateTargetProfileUI(){
  var profile=getTargetProfileInfo(currentTargetProfile);
  var btn=document.getElementById('targetProfileBtn');
  if(btn)btn.innerHTML='&#127919; '+esc(profile.name)+' &#9660;';
  var serviceBtn=document.getElementById('filterServiceBtn');
  var apiBtn=document.getElementById('filterApiBtn');
  if(serviceBtn)serviceBtn.textContent=currentTargetProfile==='openai'?'CF绕过':'服务可达';
  if(apiBtn)apiBtn.textContent=currentTargetProfile==='openai'?'可注册':(profile.has_api?'API可达':'出口IP');
  updateStatLabels();
}

function setTargetProfile(id){
  currentTargetProfile=getTargetProfileInfo(id).id;
  localStorage.setItem(TARGET_PROFILE_KEY,currentTargetProfile);
  document.getElementById('targetProfileDropdown').classList.remove('open');
  renderTargetProfileMenu();
  updateTargetProfileUI();
}

function toggleTargetProfileMenu(){
  document.getElementById('targetProfileDropdown').classList.toggle('open');
}

document.addEventListener('click',function(e){
  var dd=document.getElementById('targetProfileDropdown');
  if(dd&&!e.target.closest('#targetProfileDropdown'))dd.classList.remove('open');
});

// GitHub Pages: show backend config panel
if(isRemote && !window.location.hostname.endsWith('vercel.app')){
  document.getElementById("backendConfig").style.display="block";
  var saved=localStorage.getItem("proxy_checker_backend");
  if(saved){
    API_BASE=saved.replace(/\/$/,"");
    document.getElementById("backendUrl").value=API_BASE;
    checkCapabilities();
    checkAuthStatus();
  }
}

function connectBackend(){
  var url=document.getElementById("backendUrl").value.trim().replace(/\/$/,"");
  if(!url){toast("请输入后端地址");return}
  API_BASE=url;
  localStorage.setItem("proxy_checker_backend",url);
  document.getElementById("connStatus").textContent="连接中...";
  document.getElementById("connStatus").style.color="#eab308";
  post("/api/capabilities",{},function(err,res){
    if(err){
      document.getElementById("connStatus").textContent="连接失败";
      document.getElementById("connStatus").style.color="#ef4444";
      toast("无法连接到后端: "+err);
      return;
    }
    document.getElementById("connStatus").textContent="已连接 ✓";
    document.getElementById("connStatus").style.color="#22c55e";
    toast("后端连接成功");
    checkCapabilities();
    checkAuthStatus();
  });
}

checkCapabilities();
checkAuthStatus();

var roundsSelect=document.getElementById("roundsSelect");
var concurrentInput=document.getElementById("concurrentInput");
var sRounds=document.getElementById("sRounds");
var CONCURRENT_KEY='proxy_checker_max_concurrent';

function normalizeConcurrent(value){
  var n=parseInt(value);
  if(!n||n<1)n=30;
  if(n>200)n=200;
  return n;
}

function getConcurrentValue(){
  var n=normalizeConcurrent(concurrentInput?concurrentInput.value:30);
  if(concurrentInput)concurrentInput.value=String(n);
  localStorage.setItem(CONCURRENT_KEY,String(n));
  return n;
}

if(concurrentInput){
  concurrentInput.value=String(normalizeConcurrent(localStorage.getItem(CONCURRENT_KEY)||concurrentInput.value));
  concurrentInput.addEventListener('change',getConcurrentValue);
  concurrentInput.addEventListener('blur',getConcurrentValue);
}

function updateStatLabels(){
  if(!roundsSelect)return;
  var r=parseInt(roundsSelect.value)||2;
  sRounds.textContent=r+"轮";
  document.querySelector('#sValid').closest('.stat').querySelector('.stat-label').textContent='稳定('+r+'/'+r+')';
  document.querySelector('#sUnstable').closest('.stat').querySelector('.stat-label').textContent='不稳定('+(r-1>0?r-1:1)+'/'+r+')';
  var profile=getTargetProfileInfo(currentTargetProfile);
  document.querySelector('#sCfBypass').closest('.stat').querySelector('.stat-label').textContent=currentTargetProfile==='openai'?'CF绕过':'服务可达';
  document.querySelector('#sRegReady').closest('.stat').querySelector('.stat-label').textContent=currentTargetProfile==='openai'?'可注册':(profile.has_api?'API可达':'出口IP');
}
roundsSelect.addEventListener('change',updateStatLabels);
updateStatLabels();
renderTargetProfileMenu();
updateTargetProfileUI();

function startCheck(options){
  options=options||{};
  if(!requireAuthenticatedUI())return;
  if(busy) return;
  var lines=parseLines(proxyInput.value);
  if(!lines.length){toast("请输入至少一个代理");return}
  var rounds=parseInt(roundsSelect.value)||2;
  var maxConcurrent=getConcurrentValue();
  sRounds.textContent=rounds+"轮";
  updateStatLabels();

  // Filter based on detect mode
  var toCheck=lines;
  var skippedCount=0;
  if(!options.force&&detectMode==='skip'&&getCheckedCount()>0){
    toCheck=lines.filter(function(p){return !isChecked(p)});
    skippedCount=lines.length-toCheck.length;
  }
  if(toCheck.length===0){
    toast("所有代理均已检测过，请切换到'强制检测全部'模式或清空检测记录");
    return;
  }

  clearActiveSession();
  busy=true; V=[]; U=[]; F=[]; totalCount=toCheck.length; resultsIndex=0;
  saveResults();
  checkBtn.disabled=true;
  document.getElementById('stopBtn').style.display="inline-flex";
  prog.style.display="block";
  progBar.style.width="0%";
  validList.innerHTML=""; failList.innerHTML="";
  if(skippedCount>0){
    statusText.textContent="跳过 "+skippedCount+" 个已检测代理，正在提交 "+toCheck.length+" 个...";
  }else{
    statusText.textContent="正在提交...";
  }
  var targetProfile=options.targetProfile||currentTargetProfile;
  post("/api/start",{proxies:toCheck,rounds:rounds,target_profile:targetProfile,max_concurrent:maxConcurrent},function(err,res){
    if(err){toast(err);finishCheck(false);return}
    sid=res.session_id; totalCount=res.total;
    currentTargetProfile=res.target_profile||targetProfile;
    if(res.max_concurrent&&concurrentInput){
      concurrentInput.value=String(res.max_concurrent);
      localStorage.setItem(CONCURRENT_KEY,String(res.max_concurrent));
    }
    localStorage.setItem(TARGET_PROFILE_KEY,currentTargetProfile);
    saveActiveSession();
    statusText.textContent="正在检测 0/"+totalCount+"，并发 "+getConcurrentValue();
    poll();
  });
}

function saveActiveSession(){
  if(!sid||!busy)return;
  localStorage.setItem(ACTIVE_SESSION_KEY,JSON.stringify({
    session_id:sid,
    target_profile:currentTargetProfile,
    rounds:parseInt(roundsSelect.value)||2,
    max_concurrent:getConcurrentValue(),
    total:totalCount,
    input:proxyInput.value,
    results_index:resultsIndex,
    created:Date.now()
  }));
}

function clearActiveSession(){
  localStorage.removeItem(ACTIVE_SESSION_KEY);
}

function expireActiveSession(message){
  clearActiveSession();
  busy=false;sid=null;
  checkBtn.disabled=false;
  document.getElementById('stopBtn').style.display="none";
  prog.style.display="none";
  statusText.textContent=message;
  toast(message);
  updateSkipBadge();
}

function poll(){
  if(!busy||!sid) return;
  post("/api/status",{session_id:sid, since:resultsIndex},function(err,res){
    if(err){setTimeout(poll,1000);return}
    if(res.error){
      expireActiveSession("检测任务已过期，可重新开始");
      return;
    }
    if(res.new&&res.new.length>0){
      res.new.forEach(function(r){
        if(r.valid){V.push(r);appendItem(validList,r,"valid")}
        else if(r.unstable){U.push(r);appendItem(validList,r,"unstable")}
        else{F.push(r);appendItem(failList,r,"invalid")}
      });
      resultsIndex+=res.new.length;
      var pct=Math.round(res.total_done/totalCount*100);
      progBar.style.width=pct+"%";
      statusText.textContent="已检测 "+res.total_done+"/"+totalCount+" ("+pct+"%)";
      updateStats();
      saveResults();
      saveActiveSession();
    }
    if(res.finished){
      // Mark all detected proxies as checked
      var allDetected=V.concat(U).concat(F);
      markCheckedBatch(allDetected.map(function(r){return r.original||r.proxy}));
      saveCheckedLocal();
      syncCheckedToServer();
      clearActiveSession();
      finishCheck(false);
      toast("检测完成: "+V.length+" 稳定, "+U.length+" 不稳定, "+F.length+" 失效");
      statusText.textContent="检测完成";
    }else{setTimeout(poll,500)}
  });
}
function stopCheck(){
  if(!sid)return;
  post("/api/stop",{session_id:sid},function(){});
  clearActiveSession();
  finishCheck(true); toast("已停止");
}
function finishCheck(stopped){
  busy=false;sid=null;
  checkBtn.disabled=false;
  document.getElementById('stopBtn').style.display="none";
  prog.style.display="none";
  statusText.textContent=stopped?"已停止":"检测完成";
  saveResults();
  updateSkipBadge();
}

function appendItem(list,r,type){
  if(list.querySelector(".empty"))list.innerHTML="";
  list.insertAdjacentHTML("beforeend",itemHTML(r,type));
}

function getResultByProxy(proxy){
  var all=V.concat(U);
  for(var i=0;i<all.length;i++){
    if(all[i].proxy===proxy)return all[i];
  }
  return null;
}

function getResultCountry(r){
  var country=r.country;
  if(!country&&r.checks_detail&&r.checks_detail.ip_info)country=r.checks_detail.ip_info.country;
  return country?String(country).toUpperCase():'';
}

function getResultErrorText(r){
  if(r.error)return r.error;
  if(!r.valid&&r.status_code&&r.status_code!==200)return 'HTTP '+r.status_code;
  return '';
}

function itemHTML(r,type){
  var lat=r.latency?r.latency+"ms":"-";
  var spd=r.latency?(r.latency<1000?"speed-fast":r.latency<3000?"speed-mid":"speed-slow"):"";
  var err=getResultErrorText(r);
  var errTag=err?'<span style="color:#555">'+esc(err)+'</span>':'';
  var profileId=r.target_profile||currentTargetProfile;
  var isOpenAI=profileId==='openai';
  var targetTag=r.target_name?'<span class="tag" style="background:rgba(255,255,255,.06);color:#aaa">'+esc(r.target_name)+'</span>':'';
  var serviceTag='';
  if(r.service_reachable===true) serviceTag='<span class="tag tag-ok">服务可达</span>';
  else if(r.service_reachable===false) serviceTag='<span class="tag tag-fail">服务不可达</span>';

  // Grade badge
  var gradeColors={'A':'#22c55e','B':'#10b981','C':'#eab308','D':'#f97316','F':'#ef4444'};
  var gradeLabels={'A':'最优','B':'良好','C':'可用','D':'仅首页','F':'失效'};
  var g=r.grade||'F';
  var gradeTag='<span class="tag" style="background:rgba(0,0,0,.3);color:'+(gradeColors[g]||'#888')+';font-weight:700">等级'+g+'</span>';

  // IP tag
  var ipTag=r.ip?'<span class="tag tag-ip" title="目标网站看到的出口 IP">IP: '+esc(r.ip)+'</span>':'';
  var country=getResultCountry(r);
  var countryTag=country?'<span class="tag tag-country" title="出口 IP 所在国家或地区">国家: '+esc(country)+'</span>':'';
  // IP type tag
  var ipTypeTag='';
  if(r.ip_type==='datacenter') ipTypeTag='<span class="tag tag-dc">机房</span>';
  else if(r.ip_type==='residential') ipTypeTag='<span class="tag tag-res">住宅</span>';
  else if(r.ip) ipTypeTag='<span class="tag" style="background:rgba(255,255,255,.06);color:#666">类型未知</span>';

  // CF bypass tag
  var cfTag='';
  if(isOpenAI){
    if(r.cf_bypass) cfTag='<span class="tag tag-cf">&#9989; CF绕过</span>';
    else if(r.cf_challenge) cfTag='<span class="tag tag-cf-fail">&#10060; CF拦截('+esc(r.cf_challenge_type||'?')+')</span>';
    else cfTag='<span class="tag" style="background:rgba(255,255,255,.06);color:#666">CF未通过</span>';
  }

  // API tag
  var apiTag='';
  if(r.api_reachable===true) apiTag='<span class="tag tag-ok">API可达</span>';
  else if(r.api_reachable===false) apiTag='<span class="tag tag-fail">API不可达</span>';
  else if(isOpenAI) apiTag='<span class="tag" style="background:rgba(255,255,255,.06);color:#666">API未检测</span>';

  // Registration tag
  var regTag='';
  if(isOpenAI){
    if(r.registration_ready) regTag='<span class="tag tag-reg">&#9989; 可注册</span>';
    else if(r.registration_detail) regTag='<span class="tag tag-reg-fail">&#10060; 注册受限</span>';
    else regTag='<span class="tag" style="background:rgba(255,255,255,.06);color:#666">注册未检测</span>';
  }

  // Check count tag
  var chkTag='';
  if(r.checks_total!==undefined){
    var pct=(r.checks_passed||0)+"/"+r.checks_total;
    chkTag=r.valid?'<span class="tag tag-ok">'+pct+'</span>':
           r.unstable?'<span class="tag tag-unstable">'+pct+'</span>':
           '<span class="tag tag-fail">'+pct+'</span>';
  }

  // Badge
  var badge=r.valid?'<span class="tag tag-ok">'+gradeLabels[g]+'</span>':
            r.unstable?'<span class="tag tag-unstable">不稳定</span>':
            '<span class="tag tag-fail">'+gradeLabels[g]+'</span>';
  var repoBtn=type==='invalid'?'':'<button class="copy-btn" onclick="event.stopPropagation();addSingleResultToRepo(this)" data-p="'+esc(r.proxy)+'">添加到仓库</button>';

  // Detail panel (expandable)
  var detailId='detail_'+Math.random().toString(36).substr(2,8);
  var detailHTML='';
  if(r.checks_detail && Object.keys(r.checks_detail).length>0){
    var d=r.checks_detail;
    var rows='';
    if(d.service) rows+='<div class="detail-row"><span class="detail-key">服务:</span><span>'+(d.service.status||'-')+' '+(d.service.reachable?'<span style="color:#22c55e">可达</span>':'<span style="color:#ef4444">不可达</span>')+(d.service.cf_detected?' <span style="color:#ef4444">CF:'+esc(d.service.cf_type||'detected')+'</span>':'')+'</span></div>';
    else if(d.chat) rows+='<div class="detail-row"><span class="detail-key">首页:</span><span>'+(d.chat.status||'-')+(d.chat.cf_detected?' <span style="color:#ef4444">CF:'+esc(d.chat.cf_type||'detected')+'</span>':'')+'</span></div>';
    if(d.signup) rows+='<div class="detail-row"><span class="detail-key">注册页:</span><span>'+(d.signup.status||'-')+' '+(d.signup.accessible?'<span style="color:#22c55e">可访问</span>':'<span style="color:#ef4444">'+esc(d.signup.detail||'不可达')+'</span>')+'</span></div>';
    if(d.api) rows+='<div class="detail-row"><span class="detail-key">API:</span><span>'+(d.api.status||'-')+'</span></div>';
    if(d.ip_info) rows+='<div class="detail-row"><span class="detail-key">IP信息:</span><span>'+esc(d.ip_info.org||'')+' ('+esc(d.ip_info.country||'')+')</span></div>';
    if(r.cf_indicators && r.cf_indicators.length>0) rows+='<div class="detail-row"><span class="detail-key">CF特征:</span><span style="color:#ef4444">'+esc(r.cf_indicators.join(', '))+'</span></div>';
    detailHTML='<div class="detail-panel" id="'+detailId+'">'+rows+'</div>';
  }

  return '<div class="proxy-item '+type+'" data-lat="'+(r.latency||99999)+'" data-err="'+(err?"y":"n")+'" data-stable="'+(r.valid?"y":r.unstable?"u":"n")+'" data-service="'+(r.service_reachable?"y":"n")+'" data-api="'+(r.api_reachable===true?"y":"n")+'" data-ip="'+(r.ip?"y":"n")+'" data-cf="'+(r.cf_bypass?"y":"n")+'" data-reg="'+(r.registration_ready?"y":"n")+'" data-cf-challenge="'+(r.cf_challenge_type||"")+'" data-grade="'+g+'" data-ip-type="'+(r.ip_type||"")+'" data-country="'+(country?"y":"n")+'" onclick="toggleDetail(\''+detailId+'\')">'+
    '<div style="flex:1;min-width:0">'+
    '<div class="proxy-addr">'+esc(r.proxy)+'</div>'+
    '<div class="proxy-meta">'+targetTag+gradeTag+chkTag+serviceTag+cfTag+regTag+ipTag+countryTag+ipTypeTag+apiTag+errTag+'</div>'+
    detailHTML+
    '</div>'+
    '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
    (r.latency?'<span class="tag tag-lat"><span class="speed-dot '+spd+'"></span>'+lat+'</span>':'')+
    badge+
    repoBtn+
    '<button class="copy-btn" onclick="event.stopPropagation();clip(this)" data-p="'+esc(r.proxy)+'">复制</button>'+
    '</div></div>';
}

function toggleDetail(id){
  var el=document.getElementById(id);
  if(el) el.classList.toggle("show");
}

function updateStats(){
  var total=V.length+U.length+F.length;
  sTotal.textContent=total;
  sValid.textContent=V.length;
  sUnstable.textContent=U.length;
  sInvalid.textContent=F.length;
  sRate.textContent=total>0?Math.round(V.length/total*100)+"%":"0%";
  vCount.textContent=V.length+U.length;
  fCount.textContent=F.length;

  // Count CF bypass and registration ready
  var allR=V.concat(U).concat(F);
  var profile=getTargetProfileInfo(currentTargetProfile);
  if(currentTargetProfile==='openai'){
    sCfBypass.textContent=allR.filter(function(r){return r.cf_bypass}).length;
    sRegReady.textContent=allR.filter(function(r){return r.registration_ready}).length;
  }else{
    sCfBypass.textContent=allR.filter(function(r){return r.service_reachable}).length;
    sRegReady.textContent=profile.has_api?
      allR.filter(function(r){return r.api_reachable===true}).length:
      allR.filter(function(r){return r.ip}).length;
  }
}
function clip(el){copyText(el.dataset.p)}
function copyValidProxies(){
  var all=V.concat(U);
  copyText(all.map(function(r){return r.proxy}).join("\n"));
  toast("已复制 "+all.length+" 个可用代理");
}
function copyFailedProxies(){copyText(F.map(function(r){return r.proxy}).join("\n"));toast("已复制 "+F.length+" 个失效代理")}
function clearValid(){
  V=[];U=[];validList.innerHTML='<div class="empty">等待检测...</div>';
  updateStats();saveResults();toast('已清空有效代理');
}
function clearFailed(){
  F=[];failList.innerHTML='<div class="empty">等待检测...</div>';
  updateStats();saveResults();toast('已清空失效代理');
}
function clearAll(){
  if(busy)stopCheck();
  proxyInput.value="";V=[];U=[];F=[];totalCount=0;sid=null;
  try{localStorage.removeItem(RESULTS_KEY)}catch(e){}
  validList.innerHTML='<div class="empty">等待检测...</div>';
  failList.innerHTML='<div class="empty">等待检测...</div>';
  vCount.textContent="0";fCount.textContent="0";
  sTotal.textContent="0";sValid.textContent="0";sUnstable.textContent="0";sInvalid.textContent="0";
  sCfBypass.textContent="0";sRegReady.textContent="0";
  sRate.textContent="0%";statusText.textContent="";
  updateProxyCount();
}

// [3] Export as TXT — one proxy per line
function exportResults(){
  var all=V.concat(U).concat(F);
  if(!all.length){toast("没有可导出的结果");return}
  var lines=all.map(function(r){return r.proxy}).join("\n");
  var b=new Blob([lines],{type:'text/plain'});
  var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='proxy-results-'+Date.now()+'.txt';a.click();
  toast('已导出 '+all.length+' 个代理');
}

function loadDemo(){
  proxyInput.value="# 示例(支持自动识别协议)\n127.0.0.1:7890\n192.168.1.1:1080\n# 也支持带前缀\nhttp://user:pass@proxy.example.com:8080\nhttps://proxy.example.com:8443\nsocks4://your-proxy:1080\nsocks5://your-proxy:1080\nsocks5h://your-proxy:1080";
  updateProxyCount();
  toast('已加载示例');
}

// Tab switching
function switchTab(tab){
  document.querySelectorAll('.result-tab').forEach(function(t){t.classList.remove('active')});
  document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('active')});
  if(tab==='valid'){
    document.getElementById('tabBtnValid').classList.add('active');
    document.getElementById('tabValid').classList.add('active');
  }else if(tab==='invalid'){
    document.getElementById('tabBtnInvalid').classList.add('active');
    document.getElementById('tabInvalid').classList.add('active');
  }else if(tab==='repo'){
    document.getElementById('tabBtnRepo').classList.add('active');
    document.getElementById('tabRepo').classList.add('active');
    renderRepo();
  }
}

// Filter buttons
document.querySelectorAll('.fbtn').forEach(function(btn){
  btn.addEventListener('click',function(){
    var bar=btn.closest('.filter-bar');
    bar.querySelectorAll('.fbtn').forEach(function(b){b.classList.remove('active')});
    btn.classList.add('active');
    var f=btn.dataset.f;
    if(bar.id==='repoFilters'){
      filterRepoList(f);
      return;
    }
    var listId=bar.id==='vFilters'?'validList':'failList';
    document.querySelectorAll('#'+listId+' .proxy-item').forEach(function(item){
      var lat=parseInt(item.dataset.lat);
      var err=item.dataset.err;
      var stb=item.dataset.stable;
      var cf=item.dataset.cf;
      var reg=item.dataset.reg;
      var service=item.dataset.service;
      var api=item.dataset.api;
      var ip=item.dataset.ip;
      var cfChal=item.dataset.cfChallenge;
      var show=true;
      if(listId==='validList'){
        if(f==='stable')show=stb==='y';
        else if(f==='unstable')show=stb==='u';
        else if(f==='cf_bypass')show=currentTargetProfile==='openai'?cf==='y':service==='y';
        else if(f==='reg_ready')show=currentTargetProfile==='openai'?reg==='y':(getTargetProfileInfo(currentTargetProfile).has_api?api==='y':ip==='y');
        else if(f==='fast')show=lat<1000;
        else if(f==='mid')show=lat>=1000&&lat<3000;
        else if(f==='slow')show=lat>=3000;
        else show=stb==='y'||stb==='u';
      }else{
        if(f==='timeout')show=err==='y'&&item.textContent.indexOf('\u8d85\u65f6')>-1;
        else if(f==='cf_block')show=cfChal.length>0&&cf!=='y';
        else if(f==='conn')show=err==='y'&&item.textContent.indexOf('\u8d85\u65f6')===-1&&cfChal.length===0;
        else if(f==='other')show=err==='n'&&cfChal.length===0;
        else show=true;
      }
      item.style.display=show?'flex':'none';
    });
  });
});
document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();if(busy)stopCheck();else startCheck()}});

function filterRepoList(f){
  document.querySelectorAll('#repoList .proxy-item').forEach(function(item){
    var show=true;
    if(f==='grade_a')show=item.dataset.grade==='A';
    else if(f==='grade_b')show=item.dataset.grade==='B';
    else if(f==='grade_c')show=item.dataset.grade==='C';
    else if(f==='grade_d')show=item.dataset.grade==='D';
    else if(f==='service')show=item.dataset.service==='y';
    else if(f==='api')show=item.dataset.api==='y';
    else if(f==='cf')show=item.dataset.cf==='y';
    else if(f==='reg')show=item.dataset.reg==='y';
    else if(f==='dc')show=item.dataset.ipType==='datacenter';
    else if(f==='res')show=item.dataset.ipType==='residential';
    else if(f==='country')show=item.dataset.country==='y';
    item.style.display=show?'flex':'none';
  });
}

function applyRepoFilter(){
  var active=document.querySelector('#repoFilters .fbtn.active');
  filterRepoList(active?active.dataset.f:'all');
}

// ============================================================
// [4] Grade dropdown — add proxies to repo by grade
// ============================================================
function toggleGradeMenu(){
  var dd=document.getElementById('gradeDropdown');
  dd.classList.toggle('open');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.grade-dropdown'))document.getElementById('gradeDropdown').classList.remove('open');
});

function addToRepoByGrade(grade){
  document.getElementById('gradeDropdown').classList.remove('open');
  var all=V.concat(U);
  var filtered;
  if(grade==='ALL'){
    filtered=all;
  }else{
    filtered=all.filter(function(r){return (r.grade||'F')===grade});
  }
  if(!filtered.length){toast('没有等级 '+grade+' 的代理');return}
  var changed=addRepoItems(filtered.map(resultToRepoItem));
  if(changed.added>0||changed.updated>0){
    toast('已同步仓库: 新增 '+changed.added+' 个，更新 '+changed.updated+' 个');
  }else{
    toast('仓库中已存在这些代理');
  }
}

// ============================================================
// [5] 我的仓库 — localStorage persistence
// ============================================================
var REPO_KEY='proxy_checker_repo';
var USER_TOKEN_KEY='proxy_checker_token';
var REPO_SYNCED_KEY='proxy_checker_synced';
var repoCache=null;
var userTokenCache=null;

function compactRepoItem(p){
  var item={proxy:String(p.proxy||'')};
  if(!item.proxy)return null;
  item.grade=p.grade||'?';
  if(p.latency!==undefined&&p.latency!==null)item.latency=p.latency;
  if(p.ip)item.ip=p.ip;
  if(p.country)item.country=String(p.country).toUpperCase();
  if(p.ip_type)item.ip_type=p.ip_type;
  if(p.service_reachable===true)item.service_reachable=true;
  if(p.api_reachable===true)item.api_reachable=true;
  if(p.cf_bypass)item.cf_bypass=true;
  if(p.registration_ready)item.registration_ready=true;
  if(p.target_profile)item.target_profile=p.target_profile;
  if(p.target_name)item.target_name=p.target_name;
  item.added=p.added||Date.now();
  item.updated=p.updated||item.added;
  return item;
}

function compactRepo(repo){
  var out=[];
  var seen={};
  (repo||[]).forEach(function(p){
    var item=compactRepoItem(p||{});
    if(!item||seen[item.proxy])return;
    seen[item.proxy]=true;
    out.push(item);
  });
  return out;
}

function getUserToken(){
  if(userTokenCache)return userTokenCache;
  var t='';
  try{t=localStorage.getItem(USER_TOKEN_KEY)||''}catch(e){}
  if(!t){
    t='user_'+Math.random().toString(36).substr(2,12);
    try{localStorage.setItem(USER_TOKEN_KEY,t)}catch(e){}
  }
  userTokenCache=t;
  return t;
}

function syncRepoToServer(repoOverride){
  if(!requireAuthenticatedUI())return;
  var repo=compactRepo(repoOverride||loadRepo());
  var token=getUserToken();
  post('/api/repo/save',{repo:repo,token:token},function(err,res){
    if(!err&&res.ok){
      try{localStorage.setItem(REPO_SYNCED_KEY,JSON.stringify({count:res.count,time:Date.now()}))}catch(e){}
    }
  });
}

function loadRepoFromServer(callback){
  var token=getUserToken();
  function tryLoadJson(t,cb){
    var xhr=new XMLHttpRequest();
    xhr.open('GET',API_BASE+'/api/repo/'+t+'.json',true);
    xhr.onload=function(){
      if(xhr.status===200){
        try{
          var data=JSON.parse(xhr.responseText);
          if(Array.isArray(data)&&data.length>0){cb(data.length,data);return}
        }catch(e){}
        // Fallback to txt
        tryLoadTxt(t,cb);
      }else{tryLoadTxt(t,cb)}
    };
    xhr.onerror=function(){tryLoadTxt(t,cb)};
    xhr.send();
  }
  function tryLoadTxt(t,cb){
    var xhr=new XMLHttpRequest();
    xhr.open('GET',API_BASE+'/api/repo/'+t+'.txt',true);
    xhr.onload=function(){
      if(xhr.status===200){
        var text=xhr.responseText.trim();
        if(!text){cb(0);return}
        var lines=text.split('\n').filter(function(l){return l.trim()});
        var repo=lines.map(function(p){return {proxy:p,grade:'?',latency:null,ip:null,country:null,ip_type:null,service_reachable:null,api_reachable:null,cf_bypass:false,registration_ready:false,target_profile:'generic',target_name:'常规代理检测',added:Date.now()}});
        cb(repo.length,repo);
      }else{cb(0)}
    };
    xhr.onerror=function(){cb(0)};
    xhr.send();
  }
  tryLoadJson(token,function(count,repo){
    if(count>0){
      saveRepo(repo);
      renderRepo();
      if(callback)callback(count);
    }else{
      tryLoadJson('default',function(count2,repo2){
        if(count2>0){
          saveRepo(repo2);
          syncRepoToServer();
          renderRepo();
          if(callback)callback(count2);
        }else{
          if(callback)callback(0);
        }
      });
    }
  });
}
var RESULTS_KEY='proxy_checker_results';
var CHECKED_KEY='proxy_checker_checked';
var detectMode=localStorage.getItem('proxy_checker_detect_mode')||'skip'; // 'skip' or 'force'
var checkedProxies=new Set();
var checkedSyncTimer=null;

function loadCheckedLocal(){
  try{
    var arr=JSON.parse(localStorage.getItem(CHECKED_KEY))||[];
    checkedProxies=new Set(arr);
  }catch(e){checkedProxies=new Set()}
}
function saveCheckedLocal(){
  try{localStorage.setItem(CHECKED_KEY,JSON.stringify([...checkedProxies]))}catch(e){}
}
function syncCheckedToServer(){
  clearTimeout(checkedSyncTimer);
  checkedSyncTimer=setTimeout(function(){
    var token=getUserToken();
    var arr=[...checkedProxies];
    // Limit to 50000 to avoid huge payloads
    if(arr.length>50000) arr=arr.slice(-50000);
    post('/api/checked/save',{proxies:arr,token:token},function(){});
  },1500);
}
function loadCheckedFromServer(callback){
  var token=getUserToken();
  var xhr=new XMLHttpRequest();
  xhr.open('GET',API_BASE+'/api/checked/'+token+'.txt',true);
  xhr.onload=function(){
    if(xhr.status===200){
      var lines=xhr.responseText.split('\n').filter(function(l){return l.trim()});
      lines.forEach(function(l){checkedProxies.add(l.trim())});
      saveCheckedLocal();
      if(callback)callback(lines.length);
    }else{if(callback)callback(0)}
  };
  xhr.onerror=function(){if(callback)callback(0)};
  xhr.send();
}
function markChecked(proxy){checkedProxies.add(proxy)}
function markCheckedBatch(proxies){proxies.forEach(function(p){checkedProxies.add(p)})}
function isChecked(proxy){return checkedProxies.has(proxy)}
function getCheckedCount(){return checkedProxies.size}

function setDetectMode(mode){
  detectMode=mode;
  localStorage.setItem('proxy_checker_detect_mode',mode);
  document.getElementById('detectDropdown').classList.remove('open');
  var label=document.getElementById('detectBtnLabel');
  if(mode==='skip'){label.textContent='跳过已检测'}
  else{label.textContent='强制检测全部'}
  updateSkipBadge();
}
function toggleDetectMenu(){
  document.getElementById('detectDropdown').classList.toggle('open');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.detect-dropdown'))document.getElementById('detectDropdown').classList.remove('open');
});
function updateSkipBadge(){
  var badge=document.getElementById('skipBadge');
  var count=getCheckedCount();
  if(detectMode==='skip'&&count>0){
    badge.style.display='inline';
    badge.textContent=count+'个已检测';
  }else{
    badge.style.display='none';
  }
}
function clearCheckedHistory(){
  if(!getCheckedCount()){toast('检测记录为空');return}
  if(!confirm('确定清空检测记录？清空后所有代理将被重新检测。'))return;
  checkedProxies.clear();
  saveCheckedLocal();
  syncCheckedToServer();
  updateSkipBadge();
  toast('检测记录已清空');
}

// Initialize detect mode UI
(function(){
  var label=document.getElementById('detectBtnLabel');
  if(detectMode==='force'){label.textContent='强制检测全部'}
  else{label.textContent='跳过已检测'}
})();

function saveResults(){
  try{localStorage.setItem(RESULTS_KEY,JSON.stringify({valid:V,unstable:U,invalid:F}))}catch(e){}
}
function loadSavedResults(){
  try{var d=JSON.parse(localStorage.getItem(RESULTS_KEY));if(d){V=d.valid||[];U=d.unstable||[];F=d.invalid||[];return true}}catch(e){}
  return false;
}

function restoreActiveSession(){
  var raw=localStorage.getItem(ACTIVE_SESSION_KEY);
  if(!raw)return false;
  var active;
  try{active=JSON.parse(raw)}catch(e){clearActiveSession();return false}
  if(!active||!active.session_id){clearActiveSession();return false}
  sid=active.session_id;
  currentTargetProfile=active.target_profile||currentTargetProfile;
  localStorage.setItem(TARGET_PROFILE_KEY,currentTargetProfile);
  if(active.input&&parseLines(proxyInput.value).length===0){
    proxyInput.value=active.input;
    updateProxyCount();
  }
  if(active.rounds)roundsSelect.value=String(active.rounds);
  if(active.max_concurrent&&concurrentInput){
    concurrentInput.value=String(normalizeConcurrent(active.max_concurrent));
    localStorage.setItem(CONCURRENT_KEY,concurrentInput.value);
  }
  updateTargetProfileUI();
  busy=true;
  totalCount=active.total||V.length+U.length+F.length;
  resultsIndex=V.length+U.length+F.length;
  checkBtn.disabled=true;
  document.getElementById('stopBtn').style.display="inline-flex";
  prog.style.display="block";
  var pct=totalCount>0?Math.round(resultsIndex/totalCount*100):0;
  progBar.style.width=pct+"%";
  statusText.textContent="已恢复检测进度 "+resultsIndex+"/"+totalCount;
  poll();
  return true;
}

function loadRepo(){
  if(repoCache)return repoCache;
  try{
    repoCache=compactRepo(JSON.parse(localStorage.getItem(REPO_KEY))||[]);
    return repoCache;
  }catch(e){
    repoCache=[];
    return repoCache;
  }
}
function saveRepo(repo,options){
  options=options||{};
  repoCache=compactRepo(repo);
  var json=JSON.stringify(repoCache);
  var localSaved=false;
  try{
    localStorage.setItem(REPO_KEY,json);
    localSaved=true;
  }catch(e){
    try{
      localStorage.removeItem(RESULTS_KEY);
      localStorage.setItem(REPO_KEY,json);
      localSaved=true;
    }catch(e2){
      try{localStorage.removeItem(REPO_KEY)}catch(e3){}
      if(!saveRepo._quotaWarned){
        toast('仓库太大，本地缓存已跳过，仍会同步到云端');
        saveRepo._quotaWarned=true;
      }
    }
  }
  if(options.sync!==false){
    clearTimeout(saveRepo._timer);
    saveRepo._timer=setTimeout(function(){syncRepoToServer(repoCache)},1000);
  }
  return localSaved;
}

function resultToRepoItem(r){
  return {
    proxy:r.proxy,
    grade:r.grade||'F',
    latency:r.latency,
    ip:r.ip,
    country:getResultCountry(r),
    ip_type:r.ip_type,
    service_reachable:r.service_reachable,
    api_reachable:r.api_reachable,
    cf_bypass:r.cf_bypass,
    registration_ready:r.registration_ready,
    target_profile:r.target_profile||currentTargetProfile,
    target_name:r.target_name||getTargetProfileInfo(currentTargetProfile).name,
    added:Date.now(),
    updated:Date.now()
  };
}

function addRepoItems(items){
  if(!items.length)return {added:0,updated:0};
  try{localStorage.removeItem('repo_manually_cleared')}catch(e){}
  var repo=loadRepo();
  var indexByProxy={};
  repo.forEach(function(p,i){indexByProxy[p.proxy]=i});
  var added=0;
  var updated=0;
  items.forEach(function(item){
    var idx=indexByProxy[item.proxy];
    if(idx===undefined){
      repo.push(item);
      indexByProxy[item.proxy]=repo.length-1;
      added++;
    }else{
      item.added=repo[idx].added||item.added;
      repo[idx]=Object.assign({},repo[idx],item);
      updated++;
    }
  });
  saveRepo(repo);
  renderRepo();
  return {added:added,updated:updated};
}

function addSingleResultToRepo(button){
  var proxy=button.dataset.p;
  var result=getResultByProxy(proxy);
  if(!result){toast('这个代理不在有效列表里');return}
  var changed=addRepoItems([resultToRepoItem(result)]);
  if(changed.added>0)toast('已添加到仓库，稍后自动同步云端');
  else toast('仓库已更新，稍后自动同步云端');
}

function renderRepo(){
  var repo=loadRepo();
  var list=document.getElementById('repoList');
  var cnt=document.getElementById('repoCount');
  cnt.textContent=repo.length;
  if(!repo.length){
    list.innerHTML='<div class="empty">仓库为空，检测完成后可将代理添加到仓库</div>';
    return;
  }
  var html='';
  var displayRepo=repo.map(function(p,i){return {item:p,index:i}}).sort(function(a,b){
    return (b.item.updated||b.item.added||0)-(a.item.updated||a.item.added||0);
  });
  displayRepo.forEach(function(entry){
    var p=entry.item;
    var i=entry.index;
    var gradeColors={'A':'#22c55e','B':'#10b981','C':'#eab308','D':'#f97316','F':'#ef4444'};
    var gradeLabels={'A':'最优','B':'良好','C':'可用','D':'仅首页','F':'失效'};
    var g=p.grade||'F';
    var lat=p.latency?p.latency+'ms':'-';
    var spd=p.latency?(p.latency<1000?"speed-fast":p.latency<3000?"speed-mid":"speed-slow"):"";
    var country=p.country?String(p.country).toUpperCase():'';
    html+='<div class="proxy-item valid" data-lat="'+(p.latency||99999)+'" data-grade="'+g+'" data-service="'+(p.service_reachable===true?"y":"n")+'" data-api="'+(p.api_reachable===true?"y":"n")+'" data-cf="'+(p.cf_bypass?"y":"n")+'" data-reg="'+(p.registration_ready?"y":"n")+'" data-ip-type="'+(p.ip_type||"")+'" data-country="'+(country?"y":"n")+'">'+
      '<div style="flex:1;min-width:0">'+
      '<div class="proxy-addr">'+esc(p.proxy)+'</div>'+
      '<div class="proxy-meta">'+
      (p.target_name?'<span class="tag" style="background:rgba(255,255,255,.06);color:#aaa">'+esc(p.target_name)+'</span>':'')+
      '<span class="tag" style="background:rgba(0,0,0,.3);color:'+(gradeColors[g]||'#888')+';font-weight:700">等级'+g+'</span>'+
      (p.service_reachable?'<span class="tag tag-ok">服务可达</span>':'')+
      (p.api_reachable===true?'<span class="tag tag-ok">API可达</span>':'')+
      (country?'<span class="tag tag-country">国家: '+esc(country)+'</span>':'')+
      (p.ip_type==='datacenter'?'<span class="tag tag-dc">机房</span>':p.ip_type==='residential'?'<span class="tag tag-res">住宅</span>':'')+
      (p.cf_bypass?'<span class="tag tag-cf">CF绕过</span>':'')+
      (p.registration_ready?'<span class="tag tag-reg">可注册</span>':'')+
      '</div></div>'+
      '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'+
      (p.latency?'<span class="tag tag-lat"><span class="speed-dot '+spd+'"></span>'+lat+'</span>':'')+
      '<span class="tag tag-ok">'+(gradeLabels[g]||'')+'</span>'+
      '<button class="copy-btn" style="opacity:0.6" onclick="event.stopPropagation();clip(this)" data-p="'+esc(p.proxy)+'">复制</button>'+
      '<button class="copy-btn" style="opacity:0.6;color:#ef4444" onclick="event.stopPropagation();removeFromRepo('+i+')">删除</button>'+
      '</div></div>';
  });
  list.innerHTML=html;
  list.style.maxHeight='420px';
  list.style.overflowY='auto';
  applyRepoFilter();
}

function removeFromRepo(idx){
  var repo=loadRepo();
  repo.splice(idx,1);
  saveRepo(repo);
  renderRepo();
  toast('已从仓库移除');
}

function exportRepo(){
  var repo=loadRepo();
  if(!repo.length){toast('仓库为空');return}
  var lines=repo.map(function(p){return p.proxy}).join("\n");
  var b=new Blob([lines],{type:'text/plain'});
  var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='proxy-repo-'+Date.now()+'.txt';a.click();
  toast('已导出 '+repo.length+' 个代理');
}

function copyRepo(){
  var repo=loadRepo();
  if(!repo.length){toast('仓库为空');return}
  copyText(repo.map(function(p){return p.proxy}).join("\n"));
  toast("已复制 "+repo.length+" 个代理");
}

function recheckRepo(){
  if(busy){toast('正在检测中，请先停止当前任务');return}
  var repo=loadRepo();
  if(!repo.length){toast('仓库为空');return}
  var proxies=repo.map(function(p){return p.proxy}).filter(function(p){return p&&p.trim()});
  if(!proxies.length){toast('仓库没有可检测的代理');return}
  proxyInput.value=proxies.join("\n");
  updateProxyCount();
  switchTab('valid');
  startCheck({force:true});
}

function restoreRepoFromCloud(){
  if(!requireAuthenticatedUI())return;
  var local=loadRepo();
  if(local.length>0 && !confirm('清空本地仓库并从云端恢复？'))return;
  try{localStorage.removeItem('repo_manually_cleared')}catch(e){}
  loadRepoFromServer(function(count){
    if(count>0) toast('已从云端恢复 '+count+' 个代理');
    else toast('云端没有仓库数据');
  });
}

function toggleRepoIO(){
  document.getElementById('repoIODropdown').classList.toggle('open');
}
function toggleRepoCloud(){
  document.getElementById('repoCloudDropdown').classList.toggle('open');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('#repoIODropdown'))document.getElementById('repoIODropdown').classList.remove('open');
  if(!e.target.closest('#repoCloudDropdown'))document.getElementById('repoCloudDropdown').classList.remove('open');
});
function saveRepoToCloud(){
  if(!requireAuthenticatedUI())return;
  document.getElementById('repoCloudDropdown').classList.remove('open');
  try{localStorage.removeItem('repo_manually_cleared')}catch(e){}
  var repo=loadRepo();
  if(!repo.length){toast('仓库为空，无需保存');return}
  var token=getUserToken();
  post('/api/repo/save',{repo:repo,token:token},function(err,res){
    if(err){toast('保存失败: '+err);return}
    if(res.ok){
      try{localStorage.setItem(REPO_SYNCED_KEY,JSON.stringify({count:res.count,time:Date.now()}))}catch(e){}
      toast('已保存 '+res.count+' 个代理到云端');
    }
  });
}

function clearRepo(){
  if(!loadRepo().length){toast('仓库已经是空的');return}
  if(!confirm('确定清空本地仓库？\n注意：云端数据不会被删除，可随时通过「恢复云端数据」恢复。'))return;
  repoCache=[];
  try{localStorage.removeItem(REPO_KEY)}catch(e){}
  try{localStorage.setItem('repo_manually_cleared','1')}catch(e){}
  renderRepo();
  toast('本地仓库已清空（云端数据保留）');
}

function importRepoTxt(input){
  try{localStorage.removeItem('repo_manually_cleared')}catch(e){}
  var file=input.files[0];
  if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    var text=e.target.result;
    var lines=text.split("\n").map(function(l){return l.trim()}).filter(function(l){return l.length>0&&!l.startsWith("#")});
    if(!lines.length){toast("文件中没有有效的代理");return}
    var repo=loadRepo();
    var existingSet={};
    repo.forEach(function(p){existingSet[p.proxy]=true});
    var added=0;
    lines.forEach(function(proxy){
      if(!existingSet[proxy]){
        repo.push({proxy:proxy,grade:"?",latency:null,ip:null,country:null,ip_type:null,service_reachable:null,api_reachable:null,cf_bypass:false,registration_ready:false,target_profile:'generic',target_name:'常规代理检测',added:Date.now()});
        existingSet[proxy]=true;
        added++;
      }
    });
    saveRepo(repo);
    renderRepo();
    toast("已导入 "+added+" 个代理到仓库"+(added<lines.length?"（跳过 "+(lines.length-added)+" 个重复）":""));
  };
  reader.readAsText(file);
  input.value="";
}

// Initial render
renderRepo();
// Load checked proxies from server
loadCheckedLocal();
updateSkipBadge();
loadCheckedFromServer(function(count){
  if(count>0){updateSkipBadge();toast('从服务器恢复 '+count+' 条检测记录')}
});
// If repo is empty, try loading from server (skip if user manually cleared)
var repoClearedManually=localStorage.getItem('repo_manually_cleared');
if(!repoClearedManually && !loadRepo().length){
  loadRepoFromServer(function(count){
    if(count>0){toast('从服务器恢复 '+count+' 个仓库代理')}
  });
}
// Restore saved detection results
if(loadSavedResults()){
  var all=V.concat(U).concat(F);
  if(all.length>0){
    V.forEach(function(r){appendItem(validList,r,"valid")});
    U.forEach(function(r){appendItem(validList,r,"unstable")});
    F.forEach(function(r){appendItem(failList,r,"invalid")});
    updateStats();
    statusText.textContent="已恢复 "+all.length+" 条历史结果";
  }
}
restoreActiveSession();

// Get repo link — sync to server and show URL
function getRepoLink(button){
  if(!requireAuthenticatedUI())return;
  var repo=loadRepo();
  if(!repo.length){toast('仓库为空');return}
  var token=getUserToken();
  var btn=button||(typeof event!=='undefined'?event.target:null);
  if(btn){
    btn.innerHTML='&#128279; 同步中...';
    btn.disabled=true;
  }
  post('/api/repo/save',{repo:repo,token:token},function(err,res){
    if(btn){
      btn.innerHTML='&#128279; 获取仓库链接';
      btn.disabled=false;
    }
    if(err||res.error){toast('同步失败: '+(err||res.error));return}
    var url=API_BASE+'/api/repo/'+token+'.txt';
    copyText(url);
    toast('链接已复制 ('+res.count+'个代理)');
    var overlay=document.createElement('div');
    overlay.className='modal-overlay show';
    overlay.onclick=function(e){if(e.target===overlay)overlay.remove()};
    var html='<div class="modal-box" style="max-width:500px">';
    html+='<div class="modal-icon" style="background:linear-gradient(135deg,rgba(96,165,250,.15),rgba(96,165,250,.05));border-color:rgba(96,165,250,.2)">&#128279;</div>';
    html+='<h3>仓库链接</h3>';
    html+='<p style="margin-bottom:16px">在其他程序的代理框中粘贴此链接即可拉取：</p>';
    html+='<input id="repoLinkInput" readonly value="'+url+'" style="width:100%;padding:12px 14px;background:#0d0d1a;border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#e0e0e0;font-family:monospace;font-size:12px;margin-bottom:20px">';
    html+='<div style="display:flex;gap:10px;justify-content:center">';
    html+='<button class="btn btn-ghost" onclick="navigator.clipboard.writeText(document.getElementById(\'repoLinkInput\').value);toast(\'已复制\')">复制链接</button>';
    html+='<button class="btn btn-primary" onclick="this.closest(\'.modal-overlay\').remove()">关闭</button>';
    html+='</div></div>';
    overlay.innerHTML=html;
    document.body.appendChild(overlay);
    document.getElementById('repoLinkInput').select();
  });
}

// ============================================================
// Fetch free proxies from external sources
// ============================================================
var fetchSources=[];
var fetchMenu=document.getElementById('fetchMenu');
var fetchDropdown=document.getElementById('fetchDropdown');

function initFetchMenu(){
  post('/api/capabilities',{},function(err,res){
    if(err||!res)return;
    if(!res.fetch_proxies)return;
    fetchSources=res.proxy_sources||[];
    if(!fetchSources.length)return;
    var html='<div class="fetch-menu-item" onclick="doFetchProxies(\'all\')">&#9889; 一键拉取所有免费代理</div>';
    fetchSources.forEach(function(s){
      html+='<div class="fetch-menu-item" onclick="doFetchProxies(\''+esc(s.id)+'\')">'+esc(s.name)+'</div>';
    });
    fetchMenu.innerHTML=html;
    document.getElementById('fetchBtn').style.display='inline-flex';
  });
}
initFetchMenu();

function toggleFetchMenu(){
  fetchDropdown.classList.toggle('open');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.fetch-dropdown'))fetchDropdown.classList.remove('open');
});

function doFetchProxies(sourceId){
  if(!requireAuthenticatedUI())return;
  fetchDropdown.classList.remove('open');
  var btn=document.getElementById('fetchBtn');
  var origText=btn.innerHTML;
  btn.innerHTML='&#8987; 拉取中...';
  btn.disabled=true;
  statusText.textContent='正在从 '+(sourceId==='all'?'所有免费代理源':sourceId)+' 拉取代理...';
  post('/api/fetch-proxies',{source:sourceId,limit:50000},function(err,res){
    btn.innerHTML=origText;
    btn.disabled=false;
    if(err){
      toast('拉取失败: '+err);
      statusText.textContent='';
      return;
    }
    if(res.error){
      toast('拉取失败: '+res.error);
      statusText.textContent='';
      return;
    }
    var proxyLines=res.proxies.map(function(p){return p.proxy});
    var existing=proxyInput.value.trim();
    if(existing){
      proxyInput.value=existing+'\n'+proxyLines.join('\n');
    }else{
      proxyInput.value=proxyLines.join('\n');
    }
    updateProxyCount();
    toast('已从 '+res.source+' 拉取 '+res.count+' 个代理');
    statusText.textContent='已追加 '+res.count+' 个代理';
  });
}
