const $ = id => document.getElementById(id);
let currentDraft = null;
let currentProducts = [];

function setStatus(msg){ $('status').textContent = msg; }
function esc(s=''){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }

async function loadConfig(){
  const c = await window.autoSocial.getConfig();
  $('rootFolder').value = c.rootFolder || '';
  $('aiProvider').value = c.aiProvider;
  $('deepseekApiKey').value = c.deepseekApiKey || '';
  $('deepseekModel').value = c.deepseekModel || 'deepseek-chat';
  $('ollamaUrl').value = c.ollamaUrl || 'http://127.0.0.1:11434';
  $('ollamaModel').value = c.ollamaModel || '';
  $('stylePrompt').value = c.stylePrompt || '';
  $('postingTimes').value = (c.postingTimes || []).join(', ');
  $('repeatDays').value = c.daysBeforeRepeatProduct ?? 7;
  $('imagesPerPost').value = c.imagesPerPost ?? 4;
  $('autoPostEnabled').checked = !!c.autoPostEnabled;
  providerUI();
}

function providerUI(){
  const isDeep = $('aiProvider').value === 'deepseek';
  $('deepseekFields').classList.toggle('hidden', !isDeep);
  $('ollamaFields').classList.toggle('hidden', isDeep);
}

async function saveConfig(){
  const postingTimes = $('postingTimes').value.split(',').map(x=>x.trim()).filter(Boolean);
  await window.autoSocial.saveConfig({
    aiProvider: $('aiProvider').value,
    deepseekApiKey: $('deepseekApiKey').value.trim(),
    deepseekModel: $('deepseekModel').value.trim(),
    ollamaUrl: $('ollamaUrl').value.trim(),
    ollamaModel: $('ollamaModel').value.trim(),
    stylePrompt: $('stylePrompt').value.trim(),
    postingTimes,
    autoPostEnabled: $('autoPostEnabled').checked,
    daysBeforeRepeatProduct: Number($('repeatDays').value || 7),
    imagesPerPost: Number($('imagesPerPost').value || 4)
  });
  setStatus('✅ Đã lưu cài đặt');
}

async function scan(){
  setStatus('Đang quét kho ảnh...');
  currentProducts = await window.autoSocial.scan();
  $('products').innerHTML = currentProducts.length ? currentProducts.map(p=>`
    <div class="product">
      <b>${esc(p.name)}</b>
      <small>${p.images.length} ảnh · ${p.unusedImages.length} ảnh chưa dùng</small>
    </div>`).join('') : '<p>Chưa tìm thấy thư mục mặt hàng có ảnh.</p>';
  setStatus(`✅ Tìm thấy ${currentProducts.length} mặt hàng`);
}

async function history(){
  const rows = await window.autoSocial.recentPosts();
  $('history').innerHTML = rows.length ? rows.map(r=>`
    <div class="history-row">
      <span>${esc((r.posted_at || r.created_at || '').replace('T',' ').slice(0,16))}</span>
      <span><b>${esc(r.product_name)}</b>${r.error_message ? `<br><small>${esc(r.error_message)}</small>`:''}</span>
      <b class="${r.status==='posted'?'ok':'fail'}">${r.status==='posted'?'Đã đăng':'Lỗi'}</b>
    </div>`).join('') : '<p>Chưa có lịch sử.</p>';
}

$('chooseFolder').onclick = async()=>{
  const c = await window.autoSocial.chooseFolder();
  if(c){ $('rootFolder').value = c.rootFolder; await scan(); }
};
$('scanBtn').onclick = scan;
$('loginBtn').onclick = async()=>{
  setStatus('Chrome đang mở. Hãy đăng nhập Facebook rồi đóng cửa sổ Chrome khi xong.');
  try { await window.autoSocial.openLogin(); } catch(e){ setStatus('❌ '+e.message); }
};
$('aiProvider').onchange = providerUI;
$('saveBtn').onclick = saveConfig;
$('generateBtn').onclick = async()=>{
  try{
    await saveConfig();
    setStatus('✨ AI đang tạo bài...');
    currentDraft = await window.autoSocial.generateDraft();
    $('draftName').textContent = currentDraft.productName;
    $('draftCaption').value = currentDraft.caption;
    $('draftImages').innerHTML = currentDraft.images.map(x=>`<div>🖼 ${esc(x)}</div>`).join('');
    $('draftBox').classList.remove('hidden');
    setStatus('✅ Đã tạo bài. Kiểm tra trước khi đăng.');
  }catch(e){ setStatus('❌ '+e.message); alert(e.message); }
};
$('postNowBtn').onclick = async()=>{
  if(!currentDraft) return;
  currentDraft.caption = $('draftCaption').value;
  if(!confirm(`Đăng ngay bài "${currentDraft.productName}" lên Facebook cá nhân?`)) return;
  try{
    setStatus('🚀 Đang đăng Facebook...');
    await window.autoSocial.postDraft(currentDraft);
    $('draftBox').classList.add('hidden');
    currentDraft = null;
    await Promise.all([scan(),history()]);
  }catch(e){ alert(e.message); }
};
window.autoSocial.onStatus(setStatus);

(async()=>{ await loadConfig(); await scan(); await history(); })();
