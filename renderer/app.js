const $ = id => document.getElementById(id);
const state = {
  config: null,
  categories: [],
  products: [],
  selectedCategoryId: null,
  selectedProductId: null,
  images: [],
  contents: [],
  selectedContentId: null,
  selectedImageIds: new Set(),
  schedule: [],
  history: [],
  editingCategoryId: null,
  creatingProduct: false
};

const titles = {
  dashboard: ['Tổng quan', 'Quản lý nội dung và tự động đăng trong cùng một phần mềm.'],
  catalog: ['Sản phẩm & hình ảnh', 'Danh mục, mục con, thông tin sản phẩm và ghi chú riêng từng ảnh.'],
  content: ['Nội dung AI', 'Tạo, duyệt, sửa caption và hashtag trước khi đăng.'],
  schedule: ['Lịch đăng', 'Theo dõi chính xác bài nào sẽ được đăng và khi nào.'],
  history: ['Lịch sử đăng', 'Xem bài đã đăng, lỗi, hủy và số lần thử.'],
  settings: ['Cài đặt', 'Facebook, AI và phong cách viết đã duyệt.']
};

function setStatus(msg){ $('status').textContent = msg || 'Sẵn sàng'; }
function esc(s=''){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function fileUrl(p=''){ return encodeURI('file:///' + String(p).replace(/\\/g,'/')); }
function fmtDate(v){
  if(!v) return '—';
  const d = new Date(v);
  if(Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('vi-VN');
}
function currentProduct(){ return state.products.find(p=>p.id===state.selectedProductId) || null; }
function currentContent(){ return state.contents.find(c=>c.id===state.selectedContentId) || null; }

function showTab(name){
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));
  $('tab-'+name).classList.add('active');
  document.querySelector('.nav[data-tab="'+name+'"]').classList.add('active');
  $('pageTitle').textContent = titles[name][0];
  $('pageSubtitle').textContent = titles[name][1];
  if(name==='dashboard') renderDashboard();
  if(name==='schedule') refreshSchedule();
  if(name==='history') refreshHistory();
}
document.querySelectorAll('.nav').forEach(btn=>btn.onclick=()=>showTab(btn.dataset.tab));

function flattenCategories(){
  const byParent = new Map();
  state.categories.forEach(c=>{
    const k = c.parent_id || 0;
    if(!byParent.has(k)) byParent.set(k,[]);
    byParent.get(k).push(c);
  });
  const out=[], visited=new Set();
  function walk(parent, depth){
    (byParent.get(parent)||[]).forEach(c=>{
      if(visited.has(c.id)) return;
      visited.add(c.id);
      out.push({...c, depth});
      walk(c.id, depth+1);
    });
  }
  walk(0,0);
  state.categories.forEach(c=>{ if(!visited.has(c.id)) out.push({...c,depth:0}); });
  return out;
}

function fillCategorySelect(select, value=null, allowNone=true, excludeId=null){
  const flat = flattenCategories().filter(c=>c.id!==excludeId);
  select.innerHTML = (allowNone?'<option value="">— Không chọn —</option>':'') +
    flat.map(c=>'<option value="'+c.id+'">'+esc('— '.repeat(c.depth)+c.name)+'</option>').join('');
  if(value!=null) select.value=String(value);
}

async function loadCategories(){
  state.categories = await window.autoSocial.listCategories();
  renderCategories();
  fillCategorySelect($('productCategory'));
  fillCategorySelect($('categoryParent'));
}

function renderCategories(){
  const flat=flattenCategories();
  $('categoryList').innerHTML = flat.length ? flat.map(c=>{
    const active = state.selectedCategoryId===c.id?'active':'';
    return '<div class="category-wrap" style="padding-left:'+(c.depth*16)+'px">'+
      '<div class="category-item '+active+'">'+
      '<span class="cat-select" data-id="'+c.id+'">📁 '+esc(c.name)+'</span>'+
      '<span><button class="cat-edit ghost" data-id="'+c.id+'" title="Sửa">✏️</button> '+
      '<button class="cat-delete ghost" data-id="'+c.id+'" title="Xóa">×</button></span>'+
      '</div></div>';
  }).join('') : '<p class="hint">Chưa có danh mục.</p>';

  document.querySelectorAll('.cat-select').forEach(x=>x.onclick=async()=>{
    state.selectedCategoryId=Number(x.dataset.id);
    renderCategories();
    await loadProducts();
  });
  document.querySelectorAll('.cat-edit').forEach(x=>x.onclick=()=>{
    const c=state.categories.find(v=>v.id===Number(x.dataset.id));
    if(!c) return;
    state.editingCategoryId=c.id;
    $('categoryForm').classList.remove('hidden');
    $('categoryName').value=c.name;
    fillCategorySelect($('categoryParent'), c.parent_id, true, c.id);
  });
  document.querySelectorAll('.cat-delete').forEach(x=>x.onclick=async()=>{
    const id=Number(x.dataset.id);
    const c=state.categories.find(v=>v.id===id);
    if(!confirm('Xóa danh mục "'+(c?.name||'')+'"? Sản phẩm sẽ không bị xóa.')) return;
    await window.autoSocial.deleteCategory(id);
    if(state.selectedCategoryId===id) state.selectedCategoryId=null;
    await loadCategories(); await loadProducts();
  });
}

$('newCategoryBtn').onclick=()=>{
  state.editingCategoryId=null;
  $('categoryForm').classList.remove('hidden');
  $('categoryName').value='';
  fillCategorySelect($('categoryParent'), null);
  $('categoryName').focus();
};
$('cancelCategoryBtn').onclick=()=>{$('categoryForm').classList.add('hidden'); state.editingCategoryId=null;};
$('saveCategoryBtn').onclick=async()=>{
  const name=$('categoryName').value.trim();
  if(!name) return alert('Hãy nhập tên danh mục.');
  const parentId=Number($('categoryParent').value)||null;
  if(state.editingCategoryId) await window.autoSocial.updateCategory(state.editingCategoryId,{name,parentId});
  else await window.autoSocial.createCategory({name,parentId});
  $('categoryForm').classList.add('hidden');
  state.editingCategoryId=null;
  await loadCategories();
  setStatus('✅ Đã lưu danh mục');
};

document.querySelector('.category-item[data-category=""]').onclick=async()=>{
  state.selectedCategoryId=null; renderCategories(); await loadProducts();
};

async function loadProducts(){
  state.products = await window.autoSocial.listProducts(state.selectedCategoryId);
  renderProductList();
  fillProductSelects();
  renderDashboard();
}

function renderProductList(){
  const q=$('productSearch').value.trim().toLowerCase();
  const rows=state.products.filter(p=>p.name.toLowerCase().includes(q));
  $('productList').innerHTML = rows.length ? rows.map(p=>
    '<div class="product-row '+(p.id===state.selectedProductId?'active':'')+'" data-id="'+p.id+'">'+
      '<b>'+esc(p.name)+'</b><small>'+(p.category_name?esc(p.category_name)+' · ':'')+(p.active?'Đang dùng':'Đã ẩn')+'</small></div>'
  ).join('') : '<div class="empty">Không có sản phẩm.</div>';
  document.querySelectorAll('.product-row').forEach(x=>x.onclick=()=>selectProduct(Number(x.dataset.id)));
}
$('productSearch').oninput=renderProductList;

function fillProductSelects(){
  const all=state.products;
  $('contentProduct').innerHTML = '<option value="">— Chọn sản phẩm —</option>'+
    all.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
  if(state.selectedProductId) $('contentProduct').value=String(state.selectedProductId);
}

$('newProductBtn').onclick=()=>{
  state.selectedProductId=null;
  state.creatingProduct=true;
  $('emptyProduct').classList.add('hidden');
  $('productEditor').classList.remove('hidden');
  $('productEditorTitle').textContent='Thêm sản phẩm';
  $('productName').value='';
  $('productDescription').value='';
  $('productInfo').value='';
  $('productHashtags').value='';
  $('productActive').checked=true;
  fillCategorySelect($('productCategory'), state.selectedCategoryId);
  $('imageGrid').innerHTML='<div class="empty">Lưu sản phẩm trước rồi thêm ảnh.</div>';
  $('deleteProductBtn').classList.add('hidden');
};

async function selectProduct(id){
  const p=state.products.find(x=>x.id===id);
  if(!p) return;
  state.selectedProductId=id; state.creatingProduct=false;
  renderProductList();
  $('emptyProduct').classList.add('hidden');
  $('productEditor').classList.remove('hidden');
  $('productEditorTitle').textContent=p.name;
  $('productName').value=p.name;
  $('productDescription').value=p.description||'';
  $('productInfo').value=p.info_text||'';
  $('productHashtags').value=p.default_hashtags||'';
  $('productActive').checked=!!p.active;
  fillCategorySelect($('productCategory'),p.category_id);
  $('deleteProductBtn').classList.remove('hidden');
  await loadImages();
}

$('saveProductBtn').onclick=async()=>{
  const data={
    name:$('productName').value.trim(),
    categoryId:Number($('productCategory').value)||null,
    description:$('productDescription').value.trim(),
    infoText:$('productInfo').value.trim(),
    defaultHashtags:$('productHashtags').value.trim(),
    active:$('productActive').checked
  };
  if(!data.name) return alert('Hãy nhập tên sản phẩm.');
  let saved;
  if(state.creatingProduct) saved=await window.autoSocial.createProduct(data);
  else saved=await window.autoSocial.updateProduct(state.selectedProductId,data);
  state.selectedProductId=saved.id; state.creatingProduct=false;
  await loadProducts(); await selectProduct(saved.id);
  setStatus('✅ Đã lưu sản phẩm');
};

$('deleteProductBtn').onclick=async()=>{
  const p=currentProduct(); if(!p) return;
  if(!confirm('Ẩn sản phẩm "'+p.name+'"? Dữ liệu lịch sử vẫn được giữ.')) return;
  await window.autoSocial.deleteProduct(p.id);
  state.selectedProductId=null;
  $('productEditor').classList.add('hidden'); $('emptyProduct').classList.remove('hidden');
  await loadProducts();
};

async function loadImages(){
  if(!state.selectedProductId){ state.images=[]; return; }
  state.images=await window.autoSocial.listImages(state.selectedProductId);
  renderImages();
}

function renderImages(){
  $('imageGrid').innerHTML=state.images.length?state.images.map(img=>
    '<div class="image-card" data-id="'+img.id+'">'+
      '<img src="'+fileUrl(img.file_path)+'" alt="">'+
      '<div class="body"><textarea class="img-note" placeholder="Ghi chú riêng cho ảnh...">'+esc(img.note||'')+'</textarea>'+
      '<div class="mini"><label><input class="img-active" type="checkbox" '+(img.active?'checked':'')+'> dùng ảnh</label>'+
      '<span><button class="img-save">Lưu</button> <button class="img-remove danger">×</button></span></div>'+
      '<small>Đã dùng '+img.used_count+' lần</small></div></div>'
  ).join(''):'<div class="empty">Chưa có ảnh. Bấm “Thêm ảnh”.</div>';

  document.querySelectorAll('.image-card').forEach(card=>{
    const id=Number(card.dataset.id);
    card.querySelector('.img-save').onclick=async()=>{
      await window.autoSocial.updateImage(id,{note:card.querySelector('.img-note').value,active:card.querySelector('.img-active').checked});
      setStatus('✅ Đã lưu ghi chú ảnh');
    };
    card.querySelector('.img-remove').onclick=async()=>{
      if(!confirm('Bỏ ảnh này khỏi sản phẩm? File ảnh gốc trên máy không bị xóa.')) return;
      await window.autoSocial.deleteImage(id); await loadImages();
    };
  });
}
$('addImagesBtn').onclick=async()=>{
  if(!state.selectedProductId) return alert('Hãy lưu sản phẩm trước.');
  state.images=await window.autoSocial.addImages(state.selectedProductId);
  renderImages(); setStatus('✅ Đã thêm ảnh');
};

$('contentProduct').onchange=async()=>{
  state.selectedProductId=Number($('contentProduct').value)||null;
  state.selectedContentId=null;
  await loadContents();
};
async function loadContents(){
  if(!state.selectedProductId){state.contents=[];renderContentList();return;}
  state.contents=await window.autoSocial.listContents(state.selectedProductId);
  renderContentList();
  if(state.selectedContentId && !state.contents.some(c=>c.id===state.selectedContentId)) state.selectedContentId=null;
}
function renderContentList(){
  $('contentList').innerHTML=state.contents.length?state.contents.map(c=>
    '<div class="content-row '+(c.id===state.selectedContentId?'active':'')+'" data-id="'+c.id+'">'+
    '<b>'+esc(c.title||'(Không tiêu đề)')+'</b><small>'+esc(c.source)+' · '+esc(c.status)+' · '+fmtDate(c.created_at)+'</small></div>'
  ).join(''):'<div class="empty">Chưa có nội dung.</div>';
  document.querySelectorAll('.content-row').forEach(x=>x.onclick=()=>selectContent(Number(x.dataset.id)));
}

async function selectContent(id){
  const c=state.contents.find(x=>x.id===id); if(!c)return;
  state.selectedContentId=id; renderContentList();
  $('emptyContent').classList.add('hidden'); $('contentEditor').classList.remove('hidden');
  $('contentEditorTitle').textContent=c.title||'Nội dung';
  $('contentMeta').textContent=(c.source==='ai'?'AI tạo':'Viết thủ công')+' · '+fmtDate(c.created_at);
  $('contentStatusBadge').textContent=c.status;
  $('contentTitle').value=c.title||'';
  $('contentCaption').value=c.caption||'';
  $('contentHashtags').value=c.hashtags||'';
  state.images=await window.autoSocial.listImages(c.product_id);
  const max=state.config?.imagesPerPost||4;
  state.selectedImageIds=new Set(state.images.filter(x=>x.active).sort((a,b)=>(a.used_count-b.used_count)||(a.sort_order-b.sort_order)).slice(0,max).map(x=>x.id));
  renderScheduleImages();
}
function renderScheduleImages(){
  $('scheduleImageGrid').innerHTML=state.images.length?state.images.map(img=>
    '<div class="image-card selectable '+(state.selectedImageIds.has(img.id)?'selected':'')+'" data-id="'+img.id+'">'+
    '<img src="'+fileUrl(img.file_path)+'"><div class="body"><div class="mini"><span>'+(img.note?esc(img.note):'Không ghi chú')+'</span>'+
    '<input type="checkbox" '+(state.selectedImageIds.has(img.id)?'checked':'')+'></div></div></div>'
  ).join(''):'<div class="empty">Sản phẩm chưa có ảnh.</div>';
  document.querySelectorAll('#scheduleImageGrid .image-card').forEach(card=>{
    card.onclick=()=>{
      const id=Number(card.dataset.id);
      if(state.selectedImageIds.has(id)) state.selectedImageIds.delete(id); else state.selectedImageIds.add(id);
      renderScheduleImages();
    };
  });
}

$('generateAiBtn').onclick=async()=>{
  const id=Number($('contentProduct').value)||state.selectedProductId;
  if(!id) return alert('Hãy chọn sản phẩm.');
  try{
    setStatus('✨ AI đang tạo nội dung...');
    const c=await window.autoSocial.generateContent(id);
    state.selectedProductId=id; await loadContents(); await selectContent(c.id);
  }catch(e){setStatus('❌ '+e.message);alert(e.message);}
};
$('newManualContentBtn').onclick=async()=>{
  const id=Number($('contentProduct').value)||state.selectedProductId;
  if(!id) return alert('Hãy chọn sản phẩm.');
  const c=await window.autoSocial.saveManualContent(id,{title:'',caption:'',hashtags:''});
  state.selectedProductId=id; await loadContents(); await selectContent(c.id);
};
$('saveContentBtn').onclick=async()=>{
  if(!state.selectedContentId)return;
  const c=await window.autoSocial.updateContent(state.selectedContentId,{
    title:$('contentTitle').value,
    caption:$('contentCaption').value,
    hashtags:$('contentHashtags').value
  });
  await loadContents(); await selectContent(c.id); setStatus('✅ Đã lưu nội dung');
};
$('deleteContentBtn').onclick=async()=>{
  if(!state.selectedContentId)return;
  if(!confirm('Xóa nội dung này?'))return;
  await window.autoSocial.deleteContent(state.selectedContentId);
  state.selectedContentId=null;$('contentEditor').classList.add('hidden');$('emptyContent').classList.remove('hidden');
  await loadContents();
};

async function saveContentBeforeScheduling(){
  const c=currentContent(); if(!c) throw new Error('Chưa chọn nội dung.');
  return window.autoSocial.updateContent(c.id,{
    title:$('contentTitle').value,caption:$('contentCaption').value,hashtags:$('contentHashtags').value,status:'approved'
  });
}
$('scheduleBtn').onclick=async()=>{
  try{
    const c=await saveContentBeforeScheduling();
    const when=$('scheduleAt').value;
    if(!when) return alert('Hãy chọn ngày giờ đăng.');
    if(!state.selectedImageIds.size) return alert('Hãy chọn ít nhất một ảnh.');
    await window.autoSocial.schedulePost({productId:c.product_id,contentId:c.id,imageIds:[...state.selectedImageIds],scheduledAt:when});
    setStatus('✅ Đã thêm vào lịch đăng Facebook'); await refreshSchedule(); await loadContents(); renderDashboard();
  }catch(e){setStatus('❌ '+e.message);alert(e.message);}
};
$('postNowBtn').onclick=async()=>{
  try{
    const c=await saveContentBeforeScheduling();
    if(!state.selectedImageIds.size) return alert('Hãy chọn ít nhất một ảnh.');
    if(!confirm('Đăng ngay bài này lên Facebook cá nhân?'))return;
    const p=await window.autoSocial.schedulePost({productId:c.product_id,contentId:c.id,imageIds:[...state.selectedImageIds],scheduledAt:null});
    await window.autoSocial.postNow(p.id);
    setStatus('✅ Đăng Facebook thành công'); await Promise.all([refreshSchedule(),refreshHistory(),loadContents()]);
  }catch(e){setStatus('❌ '+e.message);alert(e.message);}
};

async function refreshSchedule(){
  state.schedule=await window.autoSocial.listScheduledPosts();
  $('scheduleList').innerHTML=state.schedule.length?state.schedule.map(p=>
    '<div class="table-row"><div><b>'+fmtDate(p.scheduled_at)+'</b><small>Facebook</small></div>'+
    '<div><b>'+esc(p.product_name||'')+'</b><small>'+esc(p.title||'')+'</small></div>'+
    '<div class="status-'+esc(p.status)+'"><b>'+esc(p.status)+'</b></div>'+
    '<div class="actions">'+((p.status==='posting')?'':'<button class="post-item" data-id="'+p.id+'">Đăng ngay</button>')+
    '<button class="cancel-item ghost" data-id="'+p.id+'">Hủy</button></div></div>'
  ).join(''):'<div class="empty">Chưa có bài chờ đăng.</div>';
  document.querySelectorAll('.post-item').forEach(x=>x.onclick=async()=>{
    if(!confirm('Đăng bài này ngay bây giờ?'))return;
    try{await window.autoSocial.postNow(Number(x.dataset.id));await Promise.all([refreshSchedule(),refreshHistory()]);}
    catch(e){alert(e.message);await refreshSchedule();}
  });
  document.querySelectorAll('.cancel-item').forEach(x=>x.onclick=async()=>{
    await window.autoSocial.cancelPost(Number(x.dataset.id));await Promise.all([refreshSchedule(),refreshHistory()]);
  });
  renderDashboard();
}
$('refreshScheduleBtn').onclick=refreshSchedule;

async function refreshHistory(){
  state.history=await window.autoSocial.listHistory();
  $('historyList').innerHTML=state.history.length?state.history.map(p=>
    '<div class="table-row"><div><b>'+fmtDate(p.posted_at||p.updated_at)+'</b><small>'+Number(p.attempt_count||0)+' lần thử</small></div>'+
    '<div><b>'+esc(p.product_name||'')+'</b><small>'+esc(p.title||'')+(p.error_message?'<br>'+esc(p.error_message):'')+'</small></div>'+
    '<div class="status-'+esc(p.status)+'"><b>'+esc(p.status)+'</b></div><div><small>Facebook</small></div></div>'
  ).join(''):'<div class="empty">Chưa có lịch sử.</div>';
  renderDashboard();
}
$('refreshHistoryBtn').onclick=refreshHistory;

function renderDashboard(){
  $('statProducts').textContent=state.products.length;
  const contentCount=state.contents.length || 0;
  $('statContents').textContent=contentCount;
  $('statScheduled').textContent=state.schedule.filter(x=>x.status==='scheduled').length;
  $('statPosted').textContent=state.history.filter(x=>x.status==='posted').length;
  const upcoming=state.schedule.filter(x=>x.status==='scheduled').slice(0,5);
  $('dashboardUpcoming').innerHTML=upcoming.length?upcoming.map(p=>
    '<div class="list-row"><b>'+esc(p.product_name||'')+'</b><small>'+fmtDate(p.scheduled_at)+' · '+esc(p.title||'')+'</small></div>'
  ).join(''):'<div class="empty">Chưa có bài sắp đăng.</div>';
}

function providerUI(){
  const deep=$('aiProvider').value==='deepseek';
  $('deepseekFields').classList.toggle('hidden',!deep);
  $('ollamaFields').classList.toggle('hidden',deep);
}
$('aiProvider').onchange=providerUI;
async function loadConfig(){
  state.config=await window.autoSocial.getConfig();
  const c=state.config;
  $('aiProvider').value=c.aiProvider;
  $('deepseekApiKey').value=c.deepseekApiKey||'';
  $('deepseekModel').value=c.deepseekModel||'deepseek-chat';
  $('ollamaUrl').value=c.ollamaUrl||'http://127.0.0.1:11434';
  $('ollamaModel').value=c.ollamaModel||'qwen2.5:3b';
  $('stylePrompt').value=c.stylePrompt||'';
  providerUI();
}
$('saveSettingsBtn').onclick=async()=>{
  state.config=await window.autoSocial.saveConfig({
    aiProvider:$('aiProvider').value,
    deepseekApiKey:$('deepseekApiKey').value.trim(),
    deepseekModel:$('deepseekModel').value.trim(),
    ollamaUrl:$('ollamaUrl').value.trim(),
    ollamaModel:$('ollamaModel').value.trim(),
    stylePrompt:$('stylePrompt').value.trim()
  });
  setStatus('✅ Đã lưu cài đặt');
};
$('loginBtn').onclick=async()=>{
  setStatus('Chrome đang mở. Hãy đăng nhập Facebook, sau đó đóng cửa sổ Chrome.');
  try{await window.autoSocial.openLogin();}catch(e){setStatus('❌ '+e.message);alert(e.message);}
};

window.autoSocial.onStatus(setStatus);

(async()=>{
  try{
    await loadConfig();
    await loadCategories();
    await loadProducts();
    await Promise.all([refreshSchedule(),refreshHistory()]);
    if(state.products.length){
      state.selectedProductId=state.products[0].id;
      $('contentProduct').value=String(state.selectedProductId);
      await loadContents();
    }
    renderDashboard();
  }catch(e){
    setStatus('❌ '+e.message);
    console.error(e);
  }
})();
