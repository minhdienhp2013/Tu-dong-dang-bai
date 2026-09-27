const $ = id => document.getElementById(id);
let state = {
  categories: [], products: [], selectedCategoryId: null, editingProductId: null,
  editingCategoryId: null, editingContentId: null, editingStyleId: null,
  contents: [], images: [], styles: []
};
let currentDraft = null;
let currentProducts = [];
let currentHistoryCaption = '';

function esc(s=''){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function setStatus(msg){ const el=$('status'); el.textContent=msg; el.title=msg; }
function friendlyError(error){
  let msg=String(error?.message||error||'Lỗi không xác định');
  msg=msg.replace(/^Error invoking remote method '[^']+':\s*/i,'').replace(/^Error:\s*/i,'');
  return msg;
}
function fmtDate(v){ if(!v) return '—'; try{return new Date(v).toLocaleString('vi-VN');}catch{return v;} }
function fileUrl(p){ return 'file:///' + encodeURI(String(p).replace(/\\/g,'/')); }
function statusLabel(s){ return ({draft:'Nháp',pending:'Chờ',preparing:'Đang chuẩn bị',approved:'Đã duyệt',used:'Đã dùng',scheduled:'Đã lên lịch',posting:'Đang đăng',prepared:'TEST đã chuẩn bị',posted:'Đã đăng',failed:'Lỗi',uncertain:'Cần kiểm tra',cancelled:'Đã hủy'})[s] || s; }

function activateTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  $('tab-'+name).classList.add('active');
  if(name==='dashboard') loadDashboard();
  if(name==='content') loadContents();
  if(name==='schedule') loadSchedules();
  if(name==='history') loadHistory();
  if(name==='styles') loadStyles();
}
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>activateTab(btn.dataset.tab));

async function checkFacebookStatus(){
  setStatus('Đang kiểm tra Facebook...');
  const s=await window.autoSocial.checkFacebookStatus();
  const label=s==='logged_in'?'🟢 Đã đăng nhập':s==='logged_out'?'🔴 Chưa đăng nhập':'🟡 Cần kiểm tra';
  $('fbStatus').textContent=label;
  $('settingsFbStatus').textContent=label;
  setStatus(label);
  return s;
}
$('checkFbBtn').onclick=checkFacebookStatus;
$('settingsCheckFbBtn').onclick=checkFacebookStatus;

async function loadDashboard(){
  const d=await window.autoSocial.getDashboard();
  const c=await window.autoSocial.getConfig();
  $('modeSummary').textContent=(c.runMode||'test').toUpperCase();
  $('autoSummary').textContent=c.autoPostEnabled?'BẬT':'TẮT';
  $('pauseSummary').textContent=d.paused?'Đang tạm dừng':'Lịch đang chạy';
  $('nextPostSummary').textContent=d.nextPostAt?fmtDate(d.nextPostAt):'—';
  $('nextProductSummary').textContent=d.nextProduct||'—';
  $('inventorySummary').textContent=(d.productCount||0)+' mặt hàng';
  $('imageSummary').textContent=(d.imageCount||0)+' ảnh';
  $('todaySummary').textContent=(d.postedToday||0)+' đã đăng';
  $('todayFailSummary').textContent=(d.failedToday||0)+' lỗi';
  $('pauseBtn').textContent=d.paused?'▶ Tiếp tục lịch':'⏸ Tạm dừng lịch';
}
$('pauseBtn').onclick=async()=>{
  const d=await window.autoSocial.getDashboard();
  if(d.paused) await window.autoSocial.resumeScheduler(); else await window.autoSocial.pauseScheduler();
  await loadDashboard();
};
$('postNextBtn').onclick=async()=>{
  if(!confirm('Thực hiện bài tiếp theo theo chế độ TEST/AUTO hiện tại?'))return;
  try{await window.autoSocial.postNext();await loadDashboard();await loadHistory();}catch(e){alert(e.message);}
};

async function generateDraft(){
  setStatus('✨ AI đang tạo bài...');
  try{
    currentDraft=await window.autoSocial.generateDraft();
    $('draftName').textContent=currentDraft.productName;
    $('draftCaption').value=currentDraft.caption;
    $('draftModeNote').textContent=(currentDraft.mode||'test')==='test'?'🧪 TEST: sẽ dừng trước nút Đăng':'🤖 AUTO: sẽ tự bấm Đăng';
    $('draftBox').classList.remove('hidden');
    currentProducts=await window.autoSocial.scan();
    renderDraftImages();
    setStatus('✅ Đã tạo bài. Hãy kiểm tra nội dung và ảnh.');
  }catch(e){const msg=friendlyError(e);setStatus('❌ '+msg);alert(msg);}
}
$('generateBtn').onclick=generateDraft;
$('closeDraftBtn').onclick=()=>{$('draftBox').classList.add('hidden');};
function renderDraftImages(){
  if(!currentDraft)return;
  $('draftImages').innerHTML=currentDraft.images.map((p,i)=>
    '<div class="draft-image-card" data-index="'+i+'"><img src="'+fileUrl(p)+'"><div class="row compact">'+
    '<button class="mini draft-left" '+(i===0?'disabled':'')+'>←</button>'+
    '<button class="mini draft-right" '+(i===currentDraft.images.length-1?'disabled':'')+'>→</button>'+
    '<button class="mini danger draft-remove">Bỏ</button></div></div>'
  ).join('');
  $('draftImages').querySelectorAll('.draft-image-card').forEach(card=>{
    const i=Number(card.dataset.index);
    card.querySelector('img').onclick=()=>showImage(currentDraft.images[i]);
    card.querySelector('.draft-remove').onclick=()=>{currentDraft.images.splice(i,1);renderDraftImages();};
    card.querySelector('.draft-left').onclick=()=>{const x=currentDraft.images.splice(i,1)[0];currentDraft.images.splice(i-1,0,x);renderDraftImages();};
    card.querySelector('.draft-right').onclick=()=>{const x=currentDraft.images.splice(i,1)[0];currentDraft.images.splice(i+1,0,x);renderDraftImages();};
  });
  const product=currentProducts.find(p=>p.folderPath===currentDraft.productFolder);
  const extras=(product?.images||[]).filter(p=>!currentDraft.images.includes(p));
  $('draftAddImages').classList.toggle('hidden',extras.length===0);
  $('draftAddImages').innerHTML=extras.length?'<b>Thêm ảnh khác:</b> '+extras.map((p,i)=>'<button class="mini add-draft-image" data-path="'+esc(p)+'">＋ '+(i+1)+'</button>').join(''):'';
  document.querySelectorAll('.add-draft-image').forEach(b=>b.onclick=()=>{currentDraft.images.push(b.dataset.path);renderDraftImages();});
}
function showImage(p){$('imagePreviewLarge').src=fileUrl(p);$('imagePreviewDialog').showModal();}
$('postNowBtn').onclick=async()=>{
  if(!currentDraft)return;
  if(!currentDraft.images.length)return alert('Cần ít nhất 1 ảnh.');
  currentDraft.caption=$('draftCaption').value.trim();
  if(!currentDraft.caption)return alert('Caption không được để trống.');
  if(!confirm('Thực hiện bài này theo chế độ hiện tại?'))return;
  try{
    const result=await window.autoSocial.postDraft(currentDraft);
    if(result.posted){$('draftBox').classList.add('hidden');currentDraft=null;}
    await Promise.all([loadDashboard(),loadHistory()]);
  }catch(e){alert(e.message);}
};

function buildCategoryOptions(includeAll=false,excludeId=null){
  const byParent=new Map();
  state.categories.forEach(c=>{const k=c.parent_id||0;if(!byParent.has(k))byParent.set(k,[]);byParent.get(k).push(c);});
  const out=[includeAll?'<option value="">Tất cả danh mục</option>':'<option value="">Không có danh mục</option>'];
  function walk(parent=0,depth=0){(byParent.get(parent)||[]).forEach(c=>{if(c.id===excludeId)return;out.push('<option value="'+c.id+'">'+esc('— '.repeat(depth)+c.name)+'</option>');walk(c.id,depth+1);});}
  walk();return out.join('');
}
async function loadCategories(){state.categories=await window.autoSocial.listCategories();renderCategoryTree();$('productCategory').innerHTML=buildCategoryOptions(false);$('categoryParentSelect').innerHTML=buildCategoryOptions(false,state.editingCategoryId);}
function renderCategoryTree(){
  const byParent=new Map();state.categories.forEach(c=>{const k=c.parent_id||0;if(!byParent.has(k))byParent.set(k,[]);byParent.get(k).push(c);});
  let html='<button class="category-item '+(state.selectedCategoryId===null?'active':'')+'" data-cat="">📦 Tất cả sản phẩm</button>';
  function walk(parent=0,depth=0){(byParent.get(parent)||[]).forEach(c=>{html+='<div class="category-line" style="padding-left:'+(depth*16)+'px"><button class="category-item '+(state.selectedCategoryId===c.id?'active':'')+'" data-cat="'+c.id+'">📁 '+esc(c.name)+'</button><button class="mini edit-cat" data-id="'+c.id+'">✏️</button></div>';walk(c.id,depth+1);});}
  walk();$('categoryTree').innerHTML=html;
  $('categoryTree').querySelectorAll('.category-item').forEach(b=>b.onclick=async()=>{state.selectedCategoryId=b.dataset.cat?Number(b.dataset.cat):null;renderCategoryTree();await loadProducts();});
  $('categoryTree').querySelectorAll('.edit-cat').forEach(b=>b.onclick=()=>openCategoryDialog(Number(b.dataset.id)));
}
async function loadProducts(){state.products=await window.autoSocial.listProducts(state.selectedCategoryId);renderProducts();refreshProductSelects();}
function renderProducts(){
  if(!state.products.length){$('productList').innerHTML='<div class="empty">Chưa có sản phẩm.</div>';return;}
  $('productList').innerHTML=state.products.map(p=>'<button class="product-card" data-id="'+p.id+'"><div class="product-card-title">'+esc(p.name)+'</div><div class="muted">'+esc(p.category_name||'Chưa phân loại')+'</div><div class="tags-preview">'+esc(p.default_hashtags||'')+'</div><span class="badge '+(p.active?'ok':'muted-badge')+'">'+(p.active?'Đang dùng':'Tạm ẩn')+'</span></button>').join('');
  $('productList').querySelectorAll('.product-card').forEach(b=>b.onclick=()=>openProduct(Number(b.dataset.id)));
}
function refreshProductSelects(){const opts=['<option value="">Chọn sản phẩm</option>'].concat(state.products.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>')).join('');$('contentProductFilter').innerHTML=opts;$('scheduleProduct').innerHTML=opts;}
$('addCategoryBtn').onclick=()=>openCategoryDialog(null);
function openCategoryDialog(id){state.editingCategoryId=id;const c=id?state.categories.find(x=>x.id===id):null;$('categoryDialogTitle').textContent=id?'Sửa danh mục':'Thêm danh mục';$('deleteCategoryDialogBtn').classList.toggle('hidden',!id);$('categoryNameInput').value=c?.name||'';$('categoryParentSelect').innerHTML=buildCategoryOptions(false,id);$('categoryParentSelect').value=c?.parent_id||'';$('categoryDialog').showModal();}
$('deleteCategoryDialogBtn').onclick=async()=>{if(!state.editingCategoryId)return;if(!confirm('Xóa danh mục này?'))return;await window.autoSocial.deleteCategory(state.editingCategoryId);$('categoryDialog').close();state.editingCategoryId=null;state.selectedCategoryId=null;await loadCategories();await loadProducts();};
$('saveCategoryDialogBtn').onclick=async e=>{e.preventDefault();const name=$('categoryNameInput').value.trim();if(!name)return alert('Nhập tên danh mục.');const parentId=$('categoryParentSelect').value?Number($('categoryParentSelect').value):null;if(state.editingCategoryId)await window.autoSocial.updateCategory(state.editingCategoryId,{name,parentId});else await window.autoSocial.createCategory({name,parentId});$('categoryDialog').close();state.editingCategoryId=null;await loadCategories();await loadProducts();};

$('addProductBtn').onclick=()=>openProduct(null);
$('closeProductEditor').onclick=()=>{$('productEditor').classList.add('hidden');state.editingProductId=null;};
async function openProduct(id){
  state.editingProductId=id;$('productEditor').classList.remove('hidden');$('productEditorTitle').textContent=id?'Chi tiết sản phẩm':'Thêm sản phẩm mới';$('deleteProductBtn').classList.toggle('hidden',!id);
  let p=id?state.products.find(x=>x.id===id):null;if(id&&!p){const all=await window.autoSocial.listProducts();p=all.find(x=>x.id===id);}
  $('productName').value=p?.name||'';$('productCategory').innerHTML=buildCategoryOptions(false);$('productCategory').value=p?.category_id||state.selectedCategoryId||'';$('productDescription').value=p?.description||'';$('productInfo').value=p?.info_text||'';$('productHashtags').value=p?.default_hashtags||'';$('productActive').checked=p?!!p.active:true;state.images=id?await window.autoSocial.listImages(id):[];renderImages();$('productEditor').scrollIntoView({behavior:'smooth',block:'start'});
}
$('saveProductBtn').onclick=async()=>{const data={categoryId:$('productCategory').value?Number($('productCategory').value):null,name:$('productName').value.trim(),description:$('productDescription').value.trim(),infoText:$('productInfo').value.trim(),defaultHashtags:$('productHashtags').value.trim(),active:$('productActive').checked};if(!data.name)return alert('Nhập tên sản phẩm.');const saved=state.editingProductId?await window.autoSocial.updateProduct(state.editingProductId,data):await window.autoSocial.createProduct(data);state.editingProductId=saved.id;await loadProducts();await openProduct(saved.id);setStatus('✅ Đã lưu sản phẩm');};
$('deleteProductBtn').onclick=async()=>{if(!state.editingProductId)return;if(!confirm('Xóa sản phẩm và dữ liệu liên quan?'))return;await window.autoSocial.deleteProduct(state.editingProductId);$('productEditor').classList.add('hidden');state.editingProductId=null;await loadProducts();};
$('addImagesBtn').onclick=async()=>{if(!state.editingProductId)return alert('Lưu sản phẩm trước.');state.images=await window.autoSocial.addImages(state.editingProductId);renderImages();};
function renderImages(){
  if(!state.images.length){$('imageGrid').innerHTML='<div class="empty">Chưa có ảnh.</div>';return;}
  $('imageGrid').innerHTML=state.images.map((img,i)=>'<div class="image-card" data-id="'+img.id+'" data-index="'+i+'"><img src="'+fileUrl(img.file_path)+'"><textarea class="image-note" rows="3" placeholder="Ghi chú riêng...">'+esc(img.note||'')+'</textarea><div class="row compact"><button class="mini img-up" '+(i===0?'disabled':'')+'>←</button><button class="mini img-down" '+(i===state.images.length-1?'disabled':'')+'>→</button><label class="switch-row small"><input class="image-active" type="checkbox" '+(img.active?'checked':'')+'> Dùng</label><button class="mini save-image">Lưu</button><button class="mini danger delete-image">Xóa</button></div><div class="muted smalltext">Đã dùng '+(img.used_count||0)+' lần</div></div>').join('');
  $('imageGrid').querySelectorAll('.image-card').forEach(card=>{
    const id=Number(card.dataset.id),i=Number(card.dataset.index),img=state.images[i];
    card.querySelector('img').onclick=()=>showImage(img.file_path);
    card.querySelector('.save-image').onclick=async()=>{await window.autoSocial.updateImage(id,{note:card.querySelector('.image-note').value.trim(),active:card.querySelector('.image-active').checked});setStatus('✅ Đã lưu ảnh');};
    card.querySelector('.delete-image').onclick=async()=>{if(!confirm('Xóa ảnh khỏi phần mềm? File gốc không bị xóa.'))return;await window.autoSocial.deleteImage(id);state.images=await window.autoSocial.listImages(state.editingProductId);renderImages();};
    card.querySelector('.img-up').onclick=async()=>{if(i===0)return;await Promise.all([window.autoSocial.updateImage(id,{sortOrder:i-1}),window.autoSocial.updateImage(state.images[i-1].id,{sortOrder:i})]);state.images=await window.autoSocial.listImages(state.editingProductId);renderImages();};
    card.querySelector('.img-down').onclick=async()=>{if(i===state.images.length-1)return;await Promise.all([window.autoSocial.updateImage(id,{sortOrder:i+1}),window.autoSocial.updateImage(state.images[i+1].id,{sortOrder:i})]);state.images=await window.autoSocial.listImages(state.editingProductId);renderImages();};
  });
}

async function loadAllProductsForSelectors(){state.products=await window.autoSocial.listProducts();refreshProductSelects();}
async function loadContents(){await loadAllProductsForSelectors();const pid=$('contentProductFilter').value?Number($('contentProductFilter').value):undefined;state.contents=await window.autoSocial.listContents(pid);renderContents();}
$('contentProductFilter').onchange=loadContents;
$('generateContentBtn').onclick=async()=>{const pid=Number($('contentProductFilter').value);if(!pid)return alert('Chọn sản phẩm trước.');setStatus('✨ AI đang tạo nội dung...');try{const item=await window.autoSocial.generateContent(pid);await loadContents();openContentDialog(item);setStatus('✅ AI đã tạo nội dung');}catch(e){setStatus('❌ '+e.message);alert(e.message);}};
$('manualContentBtn').onclick=()=>{const pid=Number($('contentProductFilter').value);if(!pid)return alert('Chọn sản phẩm trước.');state.editingContentId=null;$('contentDialogTitle').textContent='Viết nội dung thủ công';$('contentTitleInput').value='';$('contentCaptionInput').value='';$('contentHashtagsInput').value='';$('contentStatusInput').value='draft';$('contentDialog').dataset.productId=String(pid);$('contentDialog').showModal();};
function renderContents(){if(!state.contents.length){$('contentList').innerHTML='<div class="empty">Chưa có nội dung.</div>';return;}$('contentList').innerHTML=state.contents.map(c=>'<article class="content-card"><div class="content-head"><div><b>'+esc(c.product_name||'')+'</b><h3>'+esc(c.title||'(không tiêu đề)')+'</h3></div><span class="badge">'+statusLabel(c.status)+'</span></div><p>'+esc(c.caption||'').replace(/\n/g,'<br>')+'</p><div class="hashtags">'+esc(c.hashtags||'')+'</div><div class="row compact"><button class="mini edit-content" data-id="'+c.id+'">✏️ Sửa</button><button class="mini approve-content" data-id="'+c.id+'">✅ Duyệt</button><button class="mini danger delete-content" data-id="'+c.id+'">🗑</button></div></article>').join('');document.querySelectorAll('.edit-content').forEach(b=>b.onclick=()=>openContentDialog(state.contents.find(x=>x.id===Number(b.dataset.id))));document.querySelectorAll('.approve-content').forEach(b=>b.onclick=async()=>{await window.autoSocial.updateContent(Number(b.dataset.id),{status:'approved'});await loadContents();});document.querySelectorAll('.delete-content').forEach(b=>b.onclick=async()=>{if(confirm('Xóa nội dung này?')){await window.autoSocial.deleteContent(Number(b.dataset.id));await loadContents();}});}
function openContentDialog(item){state.editingContentId=item?.id||null;$('contentDialogTitle').textContent=item?.source==='ai'?'Nội dung AI':'Nội dung bài đăng';$('contentTitleInput').value=item?.title||'';$('contentCaptionInput').value=item?.caption||'';$('contentHashtagsInput').value=item?.hashtags||'';$('contentStatusInput').value=item?.status||'draft';$('contentDialog').dataset.productId=String(item?.product_id||$('contentProductFilter').value||'');$('contentDialog').showModal();}
$('saveContentDialogBtn').onclick=async e=>{e.preventDefault();const data={title:$('contentTitleInput').value.trim(),caption:$('contentCaptionInput').value.trim(),hashtags:$('contentHashtagsInput').value.trim(),status:$('contentStatusInput').value};if(!data.caption)return alert('Nội dung không được để trống.');if(state.editingContentId)await window.autoSocial.updateContent(state.editingContentId,data);else await window.autoSocial.saveManualContent(Number($('contentDialog').dataset.productId),data);$('contentDialog').close();state.editingContentId=null;await loadContents();};

$('newScheduleBtn').onclick=async()=>{await loadAllProductsForSelectors();const c=await window.autoSocial.getConfig();$('scheduleProduct').value='';$('scheduleContent').innerHTML='<option value="">Chọn sản phẩm trước</option>';$('scheduleImagePicker').innerHTML='<div class="empty">Chọn sản phẩm trước.</div>';$('scheduleAt').value='';$('scheduleMode').value=c.runMode||'test';$('scheduleDialog').showModal();};
$('scheduleProduct').onchange=async()=>{const pid=Number($('scheduleProduct').value);if(!pid)return;const res=await Promise.all([window.autoSocial.listContents(pid),window.autoSocial.listImages(pid)]);const contents=res[0],images=res[1];const usable=contents.filter(c=>c.status!=='used');$('scheduleContent').innerHTML=['<option value="">Chọn nội dung</option>'].concat(usable.map(c=>'<option value="'+c.id+'">'+esc((c.title||c.caption).slice(0,70))+'</option>')).join('');$('scheduleImagePicker').innerHTML=images.filter(i=>i.active).map(i=>'<label class="picker-card"><input type="checkbox" value="'+i.id+'" checked><img src="'+fileUrl(i.file_path)+'"><span>'+esc(i.note||'Không ghi chú')+'</span></label>').join('')||'<div class="empty">Chưa có ảnh hoạt động.</div>';};
$('saveScheduleDialogBtn').onclick=async e=>{e.preventDefault();const productId=Number($('scheduleProduct').value),contentId=Number($('scheduleContent').value);const imageIds=[...$('scheduleImagePicker').querySelectorAll('input[type=checkbox]:checked')].map(x=>Number(x.value));const scheduledAt=$('scheduleAt').value||null;if(!productId||!contentId)return alert('Chọn sản phẩm và nội dung.');if(!imageIds.length)return alert('Chọn ít nhất 1 ảnh.');await window.autoSocial.schedulePost({productId,contentId,imageIds,scheduledAt,mode:$('scheduleMode').value});$('scheduleDialog').close();await loadSchedules();};

async function loadSchedules(){const rows=await window.autoSocial.listScheduledPosts();$('scheduleList').innerHTML=rows.length?rows.map(r=>'<div class="table-row"><div><b>'+esc(r.product_name||'')+'</b><div class="muted">'+esc(r.title||'')+'</div></div><div>'+esc((r.mode||'test').toUpperCase())+'<br>'+(r.scheduled_at?fmtDate(r.scheduled_at):'Chưa đặt giờ')+'</div><div><span class="badge '+(['failed','uncertain'].includes(r.status)?'error':'')+'">'+statusLabel(r.status)+'</span>'+(r.error_code?'<div class="error-text">'+esc(r.error_code)+'</div>':'')+'</div><div class="row compact actions">'+(!['posting','posted','uncertain','cancelled'].includes(r.status)?'<button class="mini post-now" data-id="'+r.id+'">▶ Đăng ngay</button>':'')+(!['posted','cancelled'].includes(r.status)?'<button class="mini danger cancel-post" data-id="'+r.id+'">Hủy</button>':'')+'</div></div>').join(''):'<div class="empty">Chưa có bài trong hàng đợi.</div>';document.querySelectorAll('.post-now').forEach(b=>b.onclick=async()=>{if(!confirm('Thực hiện bài này ngay?'))return;try{await window.autoSocial.postNow(Number(b.dataset.id));await Promise.all([loadSchedules(),loadHistory()]);}catch(e){alert(e.message);await loadSchedules();}});document.querySelectorAll('.cancel-post').forEach(b=>b.onclick=async()=>{await window.autoSocial.cancelPost(Number(b.dataset.id));await loadSchedules();});}

async function loadHistory(){
  const res=await Promise.all([window.autoSocial.listHistory(),window.autoSocial.recentPosts()]);
  const managed=res[0].map(r=>({source:'managed',time:r.posted_at||r.updated_at,product:r.product_name||'',caption:r.caption||'',mode:r.mode||'test',status:r.status,error:r.error_code||r.error_message||'',images:r.image_ids_json||'[]',raw:r}));
  const legacy=res[1].map(r=>({source:'folder',time:r.posted_at||r.created_at,product:r.product_name||'',caption:r.caption||'',mode:r.mode||'auto',status:r.status,error:r.error_code||r.error_message||'',images:r.images_json||'[]',raw:r}));
  const rows=managed.concat(legacy).sort((a,b)=>String(b.time).localeCompare(String(a.time)));
  $('historyList').innerHTML=rows.length?rows.map((r,i)=>'<div class="table-row history-row-detail" data-i="'+i+'"><div><b>'+esc(r.product)+'</b><div class="muted">'+esc(r.caption.slice(0,100))+'</div></div><div>'+fmtDate(r.time)+'<br><b>'+esc(String(r.mode).toUpperCase())+'</b></div><div><span class="badge '+(['failed','uncertain'].includes(r.status)?'error':'')+'">'+statusLabel(r.status)+'</span></div><div><button class="mini view-history" data-i="'+i+'">Chi tiết</button></div></div>').join(''):'<div class="empty">Chưa có lịch sử.</div>';
  document.querySelectorAll('.view-history').forEach(b=>b.onclick=()=>{const r=rows[Number(b.dataset.i)];currentHistoryCaption=r.caption;let imgs=[];try{imgs=JSON.parse(r.images||'[]');}catch{}$('historyDetail').innerHTML='<p><b>Thời gian:</b> '+esc(fmtDate(r.time))+'</p><p><b>Mặt hàng:</b> '+esc(r.product)+'</p><p><b>Mode:</b> '+esc(String(r.mode).toUpperCase())+'</p><p><b>Status:</b> '+esc(statusLabel(r.status))+'</p><p><b>Error:</b> '+esc(r.error||'—')+'</p><p><b>Caption:</b></p><pre class="caption-detail">'+esc(r.caption)+'</pre><p><b>Ảnh:</b> '+esc(imgs.join(', ')||'—')+'</p>';$('historyDialog').showModal();});
}
$('refreshHistoryBtn').onclick=loadHistory;
$('copyHistoryCaptionBtn').onclick=async()=>{try{await navigator.clipboard.writeText(currentHistoryCaption);setStatus('✅ Đã copy caption');}catch{alert('Không thể copy tự động.');}};

async function loadStyles(){state.styles=await window.autoSocial.listStyles();$('styleList').innerHTML=state.styles.map(s=>'<article class="content-card"><div class="content-head"><div><h3>'+esc(s.name)+'</h3><span class="badge '+(s.is_default?'ok':'')+'">'+(s.is_default?'Mặc định':s.enabled?'Đang bật':'Đã tắt')+'</span></div></div><p>'+esc(s.prompt)+'</p><div class="row compact"><button class="mini edit-style" data-id="'+s.id+'">✏️ Sửa</button>'+(s.is_default?'':'<button class="mini default-style" data-id="'+s.id+'">⭐ Đặt mặc định</button>')+'</div></article>').join('')||'<div class="empty">Chưa có style.</div>';document.querySelectorAll('.edit-style').forEach(b=>b.onclick=()=>openStyleDialog(Number(b.dataset.id)));document.querySelectorAll('.default-style').forEach(b=>b.onclick=async()=>{await window.autoSocial.setDefaultStyle(Number(b.dataset.id));await loadStyles();});}
$('newStyleBtn').onclick=()=>openStyleDialog(null);
function openStyleDialog(id){state.editingStyleId=id;const s=id?state.styles.find(x=>x.id===id):null;$('styleDialogTitle').textContent=id?'Sửa phong cách':'Phong cách mới';$('styleNameInput').value=s?.name||'';$('stylePromptInput').value=s?.prompt||'';$('styleEnabledInput').checked=s?!!s.enabled:true;$('deleteStyleDialogBtn').classList.toggle('hidden',!id||!!s?.is_default);$('styleDialog').showModal();}
$('saveStyleDialogBtn').onclick=async e=>{e.preventDefault();const data={name:$('styleNameInput').value.trim(),prompt:$('stylePromptInput').value.trim(),enabled:$('styleEnabledInput').checked};if(!data.name||!data.prompt)return alert('Nhập tên và prompt.');if(state.editingStyleId)await window.autoSocial.updateStyle(state.editingStyleId,data);else await window.autoSocial.createStyle(data);$('styleDialog').close();state.editingStyleId=null;await loadStyles();};
$('deleteStyleDialogBtn').onclick=async()=>{if(!state.editingStyleId)return;if(!confirm('Xóa style này?'))return;await window.autoSocial.deleteStyle(state.editingStyleId);$('styleDialog').close();state.editingStyleId=null;await loadStyles();};

function providerUI(){const deep=$('aiProvider').value==='deepseek';$('deepseekFields').classList.toggle('hidden',!deep);$('ollamaFields').classList.toggle('hidden',deep);}
$('aiProvider').onchange=providerUI;
async function loadSettings(){const c=await window.autoSocial.getConfig();$('rootFolder').value=c.rootFolder||'';$('runMode').value=c.runMode||'test';$('autoPostEnabled').checked=!!c.autoPostEnabled;$('postingTimes').value=(c.postingTimes||[]).join(', ');$('autoStartWindows').checked=!!c.autoStartWindows;$('startMinimized').checked=!!c.startMinimized;$('minimizeToTray').checked=!!c.minimizeToTray;$('keepRunningInTray').checked=!!c.keepRunningInTray;$('aiProvider').value=c.aiProvider||'deepseek';$('deepseekApiKey').value='';$('deepseekApiKey').placeholder=c.hasDeepseekApiKey?'Đã lưu an toàn — để trống để giữ nguyên':'sk-...';$('deepseekModel').value=c.deepseekModel||'deepseek-chat';$('ollamaUrl').value=c.ollamaUrl||'http://127.0.0.1:11434';$('ollamaModel').value=c.ollamaModel||'qwen2.5:3b';$('stylePrompt').value=c.stylePrompt||'';$('repeatDays').value=c.daysBeforeRepeatProduct??7;$('imageReuseAfterDays').value=c.imageReuseAfterDays??30;$('imagesPerPost').value=c.imagesPerPost??4;providerUI();}
$('chooseFolder').onclick=async()=>{const c=await window.autoSocial.chooseFolder();if(c)$('rootFolder').value=c.rootFolder||'';};
$('saveSettingsBtn').onclick=async()=>{await window.autoSocial.saveConfig({runMode:$('runMode').value,autoPostEnabled:$('autoPostEnabled').checked,postingTimes:$('postingTimes').value.split(',').map(x=>x.trim()).filter(Boolean),autoStartWindows:$('autoStartWindows').checked,startMinimized:$('startMinimized').checked,minimizeToTray:$('minimizeToTray').checked,keepRunningInTray:$('keepRunningInTray').checked,aiProvider:$('aiProvider').value,deepseekApiKey:$('deepseekApiKey').value.trim(),deepseekModel:$('deepseekModel').value.trim(),ollamaUrl:$('ollamaUrl').value.trim(),ollamaModel:$('ollamaModel').value.trim(),stylePrompt:$('stylePrompt').value.trim(),daysBeforeRepeatProduct:Number($('repeatDays').value||7),imageReuseAfterDays:Number($('imageReuseAfterDays').value||30),imagesPerPost:Number($('imagesPerPost').value||4)});setStatus('✅ Đã lưu cài đặt');await loadDashboard();};
$('loginBtn').onclick=async()=>{
  setStatus('🌐 Đang mở trình duyệt Facebook...');
  try{
    await window.autoSocial.openLogin();
    setStatus('🌐 Trình duyệt thật đã mở. Hãy đăng nhập/xác minh Facebook, sau đó đóng toàn bộ cửa sổ trình duyệt này rồi bấm Kiểm tra trạng thái.');
  }catch(e){
    const msg=friendlyError(e);
    setStatus('❌ '+msg);
    alert(msg);
  }
};

window.autoSocial.onStatus(setStatus);
(async()=>{try{await loadSettings();await loadCategories();await loadProducts();await loadDashboard();await loadHistory();}catch(e){setStatus('❌ '+e.message);}})();
