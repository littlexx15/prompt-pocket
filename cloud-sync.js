(function () {
  const SUPABASE_URL = 'https://zghljhzlechjryqjrrwt.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_D7UryQlJDSpVEhPFWVQzRw_n-LbQbYU';
  const BUCKET = 'prompt-pocket-media';
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  let user = null;
  let applyingCloud = false;
  let saveTimer = null;

  const el = id => document.getElementById(id);
  function status(text, state = '') {
    const node = el('syncStatus');
    if (node) { node.textContent = text; node.dataset.state = state; }
    const note = el('storageNote');
    if (note) note.textContent = user ? '已启用云同步，本机同时保留缓存。' : '未登录时内容只保存在当前浏览器。';
  }
  function cleanName(name) { return (name || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80); }
  function mediaKind(type = '') { return type.startsWith('video/') ? 'video' : 'image'; }

  function xhrJson(method, url, headers, body, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      xhr.timeout = 180000;
      if (onProgress) xhr.upload.onprogress = event => event.lengthComputable && onProgress(Math.round(event.loaded / event.total * 100));
      xhr.onload = () => {
        let data = {}; try { data = JSON.parse(xhr.responseText || '{}'); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.message || data.error || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('无法连接 Supabase。请换用 Chrome/Edge、关闭广告拦截扩展，或切换网络后重试。'));
      xhr.ontimeout = () => reject(new Error('上传超过 3 分钟仍未完成，请压缩视频或切换网络后重试。'));
      xhr.send(body);
    });
  }

  async function uploadWithXhr(file, path, onProgress) {
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('登录状态已过期，请退出后重新登录。');
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': file.type, 'x-upsert': 'false' };
    await xhrJson('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodedPath}`, headers, file, onProgress);
    const signed = await xhrJson('POST', `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${encodedPath}`, { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, JSON.stringify({ expiresIn: 604800 }));
    const partial = signed.signedURL || signed.signedUrl;
    if (!partial) throw new Error('视频已上传，但生成播放地址失败，请刷新页面重试。');
    return partial.startsWith('http') ? partial : `${SUPABASE_URL}/storage/v1${partial}`;
  }

  async function signedUrl(path) {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (error) throw error;
    return data.signedUrl;
  }
  async function uploadFile(file, scope, id, onProgress) {
    if (!user) throw new Error('请先登录后再上传视频或同步素材。');
    const path = `${user.id}/${scope}/${id}-${Date.now()}-${cleanName(file.name)}`;
    let image;
    try {
      const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      image = await signedUrl(path);
    } catch (error) {
      if (!/fetch|network|load failed/i.test(error?.message || '')) throw error;
      image = await uploadWithXhr(file, path, onProgress);
    }
    return { storagePath: path, mediaType: mediaKind(file.type), image };
  }
  async function uploadDataUrl(dataUrl, scope, id) {
    const blob = await (await fetch(dataUrl)).blob();
    const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    return uploadFile(new File([blob], `${id}.${ext}`, { type: blob.type }), scope, id);
  }
  async function hydrateMedia(items) {
    return Promise.all((items || []).map(async item => {
      if (!item.storagePath) return item;
      try { return { ...item, image: await signedUrl(item.storagePath) }; }
      catch { return { ...item, image: '' }; }
    }));
  }
  async function migrateMedia(items, scope) {
    const output = [];
    for (const item of items || []) {
      if (item.storagePath || !item.image?.startsWith('data:')) { output.push(item); continue; }
      status(`正在迁移${scope === 'cases' ? '案例' : '资产'}…`, 'syncing');
      try { output.push({ ...item, ...await uploadDataUrl(item.image, scope, item.id) }); }
      catch (error) { console.warn('Media migration failed', error); output.push(item); }
    }
    return output;
  }
  function serializable(data) {
    const strip = item => item.storagePath ? { ...item, image: '' } : item;
    return { prompts: data.prompts, cases: data.cases.map(strip), assets: data.assets.map(strip) };
  }
  async function saveNow() {
    if (!user || applyingCloud || !window.promptPocket) return;
    clearTimeout(saveTimer);
    status('正在同步…', 'syncing');
    const data = serializable(window.promptPocket.getData());
    const { error } = await client.from('user_library').upsert({ user_id: user.id, ...data, updated_at: new Date().toISOString() });
    if (error) { status('同步失败', 'error'); throw error; }
    status('已同步', 'ok');
  }
  function queueSave() {
    if (!user || applyingCloud) return;
    clearTimeout(saveTimer);
    status('等待同步…', 'syncing');
    saveTimer = setTimeout(() => saveNow().catch(error => console.error(error)), 650);
  }
  async function loadOrMigrate() {
    status('正在读取云端…', 'syncing');
    const { data: row, error } = await client.from('user_library').select('prompts,cases,assets').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    applyingCloud = true;
    try {
      if (row) {
        window.promptPocket.replaceData({ prompts: row.prompts || [], cases: await hydrateMedia(row.cases), assets: await hydrateMedia(row.assets) });
      } else {
        const local = window.promptPocket.getData();
        const migrated = { prompts: local.prompts, cases: await migrateMedia(local.cases, 'cases'), assets: await migrateMedia(local.assets, 'assets') };
        window.promptPocket.replaceData(migrated);
        applyingCloud = false;
        await saveNow();
        applyingCloud = true;
      }
    } finally { applyingCloud = false; }
    status('已同步', 'ok');
  }
  async function handleSession(session) {
    user = session?.user || null;
    const button = el('authBtn');
    if (button) button.textContent = user ? '账户 / 退出' : '登录同步';
    if (!user) { status('仅本机', 'local'); return; }
    try { await loadOrMigrate(); }
    catch (error) { console.error(error); status('云端未配置', 'error'); window.promptPocket?.showToast('请先在 Supabase 执行初始化脚本'); }
  }
  async function init() {
    const dialog = el('authDialog');
    el('authBtn')?.addEventListener('click', () => {
      if (user) { el('authEmail').value = user.email || ''; el('authPasswordWrap').hidden = true; el('loginSubmitBtn').hidden = true; el('logoutBtn').hidden = false; }
      else { el('authEmail').value = ''; el('authPasswordWrap').hidden = false; el('loginSubmitBtn').hidden = false; el('logoutBtn').hidden = true; }
      dialog.showModal();
    });
    el('authForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = el('loginSubmitBtn'); submit.disabled = true; submit.textContent = '登录中…';
      const { error } = await client.auth.signInWithPassword({ email: el('authEmail').value.trim(), password: el('authPassword').value });
      submit.disabled = false; submit.textContent = '登录并同步';
      if (error) return alert(`登录失败：${error.message}`);
      dialog.close(); window.promptPocket.showToast('登录成功，正在同步');
    });
    el('logoutBtn')?.addEventListener('click', async () => { await client.auth.signOut(); dialog.close(); window.promptPocket.showToast('已退出云同步'); });
    const { data } = await client.auth.getSession();
    await handleSession(data.session);
    client.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') handleSession(session); });
  }
  window.cloudSync = {
    queueSave, saveNow, uploadFile,
    deleteFile: path => user && path ? client.storage.from(BUCKET).remove([path]) : Promise.resolve(),
    isSignedIn: () => Boolean(user)
  };
  init();
})();
