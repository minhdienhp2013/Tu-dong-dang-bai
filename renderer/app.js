const $ = id => document.getElementById(id);
let state = { categories: [], products: [], selectedCategoryId: null, editingProductId: null, editingCategoryId: null, editingContentId: null, contents: [], images: [] };

function esc(s=''){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function setStatus(msg){ $('status').textContent = msg; }
function fmtDate(v){ if(!v) return '—'; try{return new Date(v).toLocaleString('vi-VN');}catch{return v;} }
function statusLabel(s){ return ({draft:'Nháp',approved:'Đã duyệt',used:'Đã dùng',scheduled:'Đã lên lịch',posting:'Đang đăng',posted:'Đã đăng',failed:'Lỗi',cancelled:'Đã hủy'})[s] || s; }
function fileUrl(p){ return 'file:///' + encodeURI(String(p).replace(/\\/g,'/')); }

function activateTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  $('tab-'+name).classList.add('active');
  if(name==='content') loadContents();
  if(name==='schedule') loadSchedules();
  if(name==='history') loadHistory();
}
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>activateTab(btn.dataset.tab));

function buildCategoryOptions(includeAll=false, excludeId=null){
  const byParent=new Map();
  state.categories.forEach(c=>{const k=c.parent_id||0;if(!byParent.has(k))byParent.set(k,[]);byParent.get(k).push(c);});
  const out=[includeAll?'<option value="">Tất cả danh mục</option>':'<option value="">Không có danh mục</option>'];
  function walk(parent=0,depth=0){
    (byParent.get(parent)||[]).forEach(c=>{
      if(c.id===excludeId)return;
      out.push('<option value="'+c.id+'">'+esc('— '.repeat(depth)+c.name)+'</option>');
      walk(c.id,depth+1);
    });
  }
  walk();
  return out.join('');
}

async function loadCategories(){
  state.categories=await window.autoSocial.listCategories();
  renderCategoryTree();
  $('productCategory').innerHTML=buildCategoryOptions(false);
  $('categoryParentSelect').innerHTML=buildCategoryOptions(false,state.editingCategoryId);
}
function renderCategoryTree(){
  const byParent=new Map();
  state.categories.forEach(c=>{const k=c.parent_id||0;if(!byParent.has(k))byParent.set(k,[]);byParent.get(k).push(c);});
  let html='<button class="category-item '+(state.selectedCategoryId===null?'active':'')+'" data-cat="">📦 Tất cả sản phẩm</button>';
  function walk(parent=0,depth=0){
    (byParent.get(parent)||[]).forEach(c=>{
      html+='<div class="category-line" style="padding-left:'+(depth*16)+'px"><button class="category-item '+(state.selectedCategoryId===c.id?'active':'')+'" data-cat="'+c.id+'">📁 '+esc(c.name)+'</button><button class="mini edit-cat" data-id="'+c.id+'">✏️</button></div>';
      walk(c.id,depth+1);
    });
  }
  walk();
  $('categoryTree').innerHTML=html;
  $('categoryTree').querySelectorAll('.category-item').forEach(b=>b.onclick=async()=>{state.selectedCategoryId=b.dataset.cat?Number(b.dataset.cat):null;renderCategoryTree();await loadProducts();});
  $('categoryTree').querySelectorAll('.edit-cat').forEach(b=>b.onclick=()=>openCategoryDialog(Number(b.dataset.id)));
}

async function loadProducts(){
  state.products=await window.autoSocial.listProducts(state.selectedCategoryId);
  renderProducts();
  refreshProductSelects();
}
function renderProducts(){
  if(!state.products.length){$('productList').innerHTML='<div class="empty">Chưa có sản phẩm trong danh mục này.</div>';return;}
  $('productList').innerHTML=state.products.map(p=>'<button class="product-card" data-id="'+p.id+'"><div class="product-card-title">'+esc(p.name)+'</div><div class="muted">'+esc(p.category_name||'Chưa phân loại')+'</div><div class="tags-preview">'+esc(p.default_hashtags||'')+'</div><span class="badge '+(p.active?'ok':'muted-badge')+'">'+(p.active?'Đang dùng':'Tạm ẩn')+'</span></button>').join('');
  $('productList').querySelectorAll('.product-card').forEach(b=>b.onclick=()=>openProduct(Number(b.dataset.id)));
}
function refreshProductSelects(){
  const opts=['<option value="">Chọn sản phẩm</option>'].concat(state.products.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>')).join('');
  $('contentProductFilter').innerHTML=opts;
  $('scheduleProduct').innerHTML=opts;
}

$('addCategoryBtn').onclick=()=>openCategoryDialog(null);
function openCategoryDialog(id){
  state.editingCategoryId=id;
  const c=id?state.categories.find(x=>x.id===id):null;
  $('categoryDialogTitle').textContent=id?'Sửa danh mục':'Thêm danh mục';
  $('categoryNameInput').value=c?.name||'';
  $('categoryParentSelect').innerHTML=buildCategoryOptions(false,id);
  $('categoryParentSelect').value=c?.parent_id||'';
  $('categoryDialog').showModal();
}
$('saveCategoryDialogBtn').onclick=async e=>{
  e.preventDefault();
  const name=$('categoryNameInput').value.trim();
  if(!name)return alert('Nhập tên danh mục.');
  const parentId=$('categoryParentSelect').value?Number($('categoryParentSelect').value):null;
  if(state.editingCategoryId)await window.autoSocial.updateCategory(state.editingCategoryId,{name,parentId});
  else await window.autoSocial.createCategory({name,parentId});
  $('categoryDialog').close();state.editingCategoryId=null;await loadCategories();await loadProducts();
};

$('addProductBtn').onclick=()=>openProduct(null);
$('closeProductEditor').onclick=()=>{$('productEditor').classList.add('hidden');state.editingProductId=null;};
async function openProduct(id){
  state.editingProductId=id;
  $('productEditor').classList.remove('hidden');
  $('productEditorTitle').textContent=id?'Chi tiết sản phẩm':'Thêm sản phẩm mới';
  $('deleteProductBtn').classList.toggle('hidden',!id);
  let p=id?state.products.find(x=>x.id===id):null;
  if(id&&!p){const all=await window.autoSocial.listProducts();p=all.find(x=>x.id===id);}
  $('productName').value=p?.name||'';
  $('productCategory').innerHTML=buildCategoryOptions(false);
  $('productCategory').value=p?.category_id||state.selectedCategoryId||'';
  $('productDescription').value=p?.description||'';
  $('productInfo').value=p?.info_text||'';
  $('productHashtags').value=p?.default_hashtags||'';
  $('productActive').checked=p?!!p.active:true;
  state.images=id?await window.autoSocial.listImages(id):[];
  renderImages();
  $('productEditor').scrollIntoView({behavior:'smooth',block:'start'});
}
$('saveProductBtn').onclick=async()=>{
  const data={categoryId:$('productCategory').value?Number($('productCategory').value):null,name:$('productName').value.trim(),description:$('productDescription').value.trim(),infoText:$('productInfo').value.trim(),defaultHashtags:$('productHashtags').value.trim(),active:$('productActive').checked};
  if(!data.name)return alert('Nhập tên sản phẩm.');
  const saved=state.editingProductId?await window.autoSocial.updateProduct(state.editingProductId,data):await window.autoSocial.createProduct(data);
  state.editingProductId=saved.id;setStatus('✅ Đã lưu sản phẩm');await loadProducts();await openProduct(saved.id);
};
$('deleteProductBtn').onclick=async()=>{
  if(!state.editingProductId)return;
  if(!confirm('Xóa sản phẩm này và toàn bộ ảnh/nội dung/lịch liên quan?'))return;
  await window.autoSocial.deleteProduct(state.editingProductId);$('productEditor').classList.add('hidden');state.editingProductId=null;await loadProducts();
};
$('addImagesBtn').onclick=async()=>{
  if(!state.editingProductId)return alert('Hãy lưu sản phẩm trước khi thêm ảnh.');
  state.images=await window.autoSocial.addImages(state.editingProductId);renderImages();
};
function renderImages(){
  if(!state.images.length){$('imageGrid').innerHTML='<div class="empty">Chưa có ảnh.</div>';return;}
  $('imageGrid').innerHTML=state.images.map(img=>'<div class="image-card" data-id="'+img.id+'"><img src="'+fileUrl(img.file_path)+'" alt=""><textarea class="image-note" rows="3" placeholder="Ghi chú riêng cho ảnh...">'+esc(img.note||'')+'</textarea><div class="row compact"><label class="switch-row small"><input class="image-active" type="checkbox" '+(img.active?'checked':'')+'> Dùng ảnh</label><button class="mini save-image">Lưu</button><button class="mini danger delete-image">Xóa</button></div><div class="muted smalltext">Đã dùng '+(img.used_count||0)+' lần</div></div>').join('');
  $('imageGrid').querySelectorAll('.image-card').forEach(card=>{
    const id=Number(card.dataset.id);
    card.querySelector('.save-image').onclick=async()=>{await window.autoSocial.updateImage(id,{note:card.querySelector('.image-note').value.trim(),active:card.querySelector('.image-active').checked});setStatus('✅ Đã lưu ghi chú ảnh');};
    card.querySelector('.delete-image').onclick=async()=>{if(!confirm('Xóa ảnh này khỏi sản phẩm? File ảnh gốc trên máy sẽ không bị xóa.'))return;await window.autoSocial.deleteImage(id);state.images=await window.autoSocial.listImages(state.editingProductId);renderImages();};
  });
}

async function loadAllProductsForSelectors(){state.products=await window.autoSocial.listProducts();refreshProductSelects();}
async function loadContents(){
  await loadAllProductsForSelectors();
  const pid=$('contentProductFilter').value?Number($('contentProductFilter').value):undefined;
  state.contents=await window.autoSocial.listContents(pid);renderContents();
}
$('contentProductFilter').onchange=loadContents;
$('generateContentBtn').onclick=async()=>{
  const pid=Number($('contentProductFilter').value);if(!pid)return alert('Chọn sản phẩm trước.');
  setStatus('✨ AI đang tạo nội dung...');
  try{const item=await window.autoSocial.generateContent(pid);setStatus('✅ AI đã tạo nội dung');await loadContents();openContentDialog(item);}catch(e){setStatus('❌ '+e.message);alert(e.message);}
};
$('manualContentBtn').onclick=()=>{const pid=Number($('contentProductFilter').value);if(!pid)return alert('Chọn sản phẩm trước.');state.editingContentId=null;$('contentDialogTitle').textContent='Viết nội dung thủ công';$('contentTitleInput').value='';$('contentCaptionInput').value='';$('contentHashtagsInput').value='';$('contentStatusInput').value='draft';$('contentDialog').dataset.productId=String(pid);$('contentDialog').showModal();};
function renderContents(){
  if(!state.contents.length){$('contentList').innerHTML='<div class="empty">Chưa có nội dung.</div>';return;}
  $('contentList').innerHTML=state.contents.map(c=>'<article class="content-card"><div class="content-head"><div><b>'+esc(c.product_name||'')+'</b><h3>'+esc(c.title||'(không tiêu đề)')+'</h3></div><span class="badge">'+statusLabel(c.status)+'</span></div><p>'+esc(c.caption||'').replace(/\n/g,'<br>')+'</p><div class="hashtags">'+esc(c.hashtags||'')+'</div><div class="row compact"><button class="mini edit-content" data-id="'+c.id+'">✏️ Sửa</button><button class="mini approve-content" data-id="'+c.id+'">✅ Duyệt</button><button class="mini danger delete-content" data-id="'+c.id+'">🗑</button></div></article>').join('');
  document.querySelectorAll('.edit-content').forEach(b=>b.onclick=()=>openContentDialog(state.contents.find(x=>x.id===Number(b.dataset.id))));
  document.querySelectorAll('.approve-content').forEach(b=>b.onclick=async()=>{await window.autoSocial.updateContent(Number(b.dataset.id),{status:'approved'});await loadContents();});
  document.querySelectorAll('.delete-content').forEach(b=>b.onclick=async()=>{if(confirm('Xóa nội dung này?')){await window.autoSocial.deleteContent(Number(b.dataset.id));await loadContents();}});
}
function openContentDialog(item){
  state.editingContentId=item?.id||null;$('contentDialogTitle').textContent=item?.source==='ai'?'Nội dung AI':'Nội dung bài đăng';$('contentTitleInput').value=item?.title||'';$('contentCaptionInput').value=item?.caption||'';$('contentHashtagsInput').value=item?.hashtags||'';$('contentStatusInput').value=item?.status||'draft';$('contentDialog').dataset.productId=String(item?.product_id||$('contentProductFilter').value||'');$('contentDialog').showModal();
}
$('saveContentDialogBtn').onclick=async e=>{
  e.preventDefault();
  const data={title:$('contentTitleInput').value.trim(),caption:$('contentCaptionInput').value.trim(),hashtags:$('contentHashtagsInput').value.trim(),status:$('contentStatusInput').value};
  if(!data.caption)return alert('Nội dung không được để trống.');
  if(state.editingContentId)await window.autoSocial.updateContent(state.editingContentId,data);
  else await window.autoSocial.saveManualContent(Number($('contentDialog').dataset.productId),data);
  $('contentDialog').close();state.editingContentId=null;await loadContents();
};

$('newScheduleBtn').onclick=async()=>{await loadAllProductsForSelectors();$('scheduleProduct').value='';$('scheduleContent').innerHTML='<option value="">Chọn sản phẩm trước</option>';$('scheduleImagePicker').innerHTML='<div class="empty">Chọn sản phẩm trước.</div>';$('scheduleAt').value='';$('scheduleDialog').showModal();};
$('scheduleProduct').onchange=async()=>{
  const pid=Number($('scheduleProduct').value);if(!pid)return;
  const res=await Promise.all([window.autoSocial.listContents(pid),window.autoSocial.listImages(pid)]);const contents=res[0],images=res[1];
  const usable=contents.filter(c=>c.status!=='used');
  $('scheduleContent').innerHTML=['<option value="">Chọn nội dung</option>'].concat(usable.map(c=>'<option value="'+c.id+'">'+esc((c.title||c.caption).slice(0,70))+'</option>')).join('');
  $('scheduleImagePicker').innerHTML=images.filter(i=>i.active).map(i=>'<label class="picker-card"><input type="checkbox" value="'+i.id+'" checked><img src="'+fileUrl(i.file_path)+'"><span>'+esc(i.note||'Không ghi chú')+'</span></label>').join('')||'<div class="empty">Sản phẩm chưa có ảnh hoạt động.</div>';
};
$('saveScheduleDialogBtn').onclick=async e=>{
  e.preventDefault();
  const productId=Number($('scheduleProduct').value),contentId=Number($('scheduleContent').value);
  const imageIds=[...$('scheduleImagePicker').querySelectorAll('input[type=checkbox]:checked')].map(x=>Number(x.value));
  const scheduledAt=$('scheduleAt').value||null;
  if(!productId||!contentId)return alert('Chọn sản phẩm và nội dung.');
  if(!imageIds.length)return alert('Chọn ít nhất 1 ảnh.');
  await window.autoSocial.schedulePost({productId,contentId,imageIds,scheduledAt});$('scheduleDialog').close();await loadSchedules();
};

async function loadSchedules(){
  const rows=await window.autoSocial.listScheduledPosts();
  $('scheduleList').innerHTML=rows.length?rows.map(r=>'<div class="table-row"><div><b>'+esc(r.product_name||'')+'</b><div class="muted">'+esc(r.title||'')+'</div></div><div>'+(r.scheduled_at?fmtDate(r.scheduled_at):'Chưa đặt giờ')+'</div><div><span class="badge '+(r.status==='failed'?'error':'')+'">'+statusLabel(r.status)+'</span>'+(r.error_message?'<div class="error-text">'+esc(r.error_message)+'</div>':'')+'</div><div class="row compact actions">'+(r.status!=='posting'?'<button class="mini post-now" data-id="'+r.id+'">▶ Đăng ngay</button>':'')+(!['posted','cancelled'].includes(r.status)?'<button class="mini danger cancel-post" data-id="'+r.id+'">Hủy</button>':'')+'</div></div>').join(''):'<div class="empty">Chưa có bài trong hàng đợi.</div>';
  document.querySelectorAll('.post-now').forEach(b=>b.onclick=async()=>{if(!confirm('Đăng bài này lên Facebook ngay?'))return;try{await window.autoSocial.postNow(Number(b.dataset.id));await Promise.all([loadSchedules(),loadHistory()]);}catch(e){alert(e.message);await loadSchedules();}});
  document.querySelectorAll('.cancel-post').forEach(b=>b.onclick=async()=>{await window.autoSocial.cancelPost(Number(b.dataset.id));await loadSchedules();});
}
async function loadHistory(){
  const rows=await window.autoSocial.listHistory();
  $('historyList').innerHTML=rows.length?rows.map(r=>'<div class="table-row"><div><b>'+esc(r.product_name||'')+'</b><div class="muted">'+esc(r.title||'')+'</div></div><div>'+fmtDate(r.posted_at||r.updated_at)+'</div><div><span class="badge '+(r.status==='failed'?'error':'')+'">'+statusLabel(r.status)+'</span><div class="muted">Thử: '+(r.attempt_count||0)+'</div></div><div>'+(r.error_message?'<span class="error-text">'+esc(r.error_message)+'</span>':'—')+'</div></div>').join(''):'<div class="empty">Chưa có lịch sử.</div>';
}
$('refreshHistoryBtn').onclick=loadHistory;

function providerUI(){const deep=$('aiProvider').value==='deepseek';$('deepseekFields').classList.toggle('hidden',!deep);$('ollamaFields').classList.toggle('hidden',deep);}
$('aiProvider').onchange=providerUI;
async function loadSettings(){
  const c=await window.autoSocial.getConfig();
  $('rootFolder').value=c.rootFolder||'';$('aiProvider').value=c.aiProvider||'deepseek';$('deepseekApiKey').value=c.deepseekApiKey||'';$('deepseekModel').value=c.deepseekModel||'deepseek-chat';$('ollamaUrl').value=c.ollamaUrl||'http://127.0.0.1:11434';$('ollamaModel').value=c.ollamaModel||'qwen2.5:3b';$('stylePrompt').value=c.stylePrompt||'';$('postingTimes').value=(c.postingTimes||[]).join(', ');$('repeatDays').value=c.daysBeforeRepeatProduct??7;$('imagesPerPost').value=c.imagesPerPost??4;$('autoPostEnabled').checked=!!c.autoPostEnabled;providerUI();
}
$('chooseFolder').onclick=async()=>{const c=await window.autoSocial.chooseFolder();if(c)$('rootFolder').value=c.rootFolder||'';};
$('saveSettingsBtn').onclick=async()=>{await window.autoSocial.saveConfig({aiProvider:$('aiProvider').value,deepseekApiKey:$('deepseekApiKey').value.trim(),deepseekModel:$('deepseekModel').value.trim(),ollamaUrl:$('ollamaUrl').value.trim(),ollamaModel:$('ollamaModel').value.trim(),stylePrompt:$('stylePrompt').value.trim(),postingTimes:$('postingTimes').value.split(',').map(x=>x.trim()).filter(Boolean),daysBeforeRepeatProduct:Number($('repeatDays').value||7),imagesPerPost:Number($('imagesPerPost').value||4),autoPostEnabled:$('autoPostEnabled').checked});setStatus('✅ Đã lưu cài đặt');};
$('loginBtn').onclick=async()=>{setStatus('🌐 Chrome đang mở. Đăng nhập Facebook rồi đóng cửa sổ Chrome.');try{await window.autoSocial.openLogin();}catch(e){setStatus('❌ '+e.message);}};

window.autoSocial.onStatus(setStatus);
(async()=>{try{await loadSettings();await loadCategories();await loadProducts();await loadHistory();}catch(e){setStatus('❌ '+e.message);}})();
