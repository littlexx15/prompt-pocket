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

  async function signedUrl(path) {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
    if (error) throw error;
    return data.signedUrl;
  }
  async function uploadFile(file, scope, id) {
    if (!user) throw new Error('请先登录后再上传视频或同步素材。');
    const path = `${user.id}/${scope}/${id}-${Date.now()}-${cleanName(file.name)}`;
    const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return { storagePath: path, mediaType: mediaKind(file.type), image: await signedUrl(path) };
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
