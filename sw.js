/* 私享衣橱 · Service Worker
 *
 * 必须和 index.html 放在同一个目录，它只管这个目录及以下。
 *
 * 策略：
 *   - 页面：先走网络，拿到就顺手存一份；断网 / 网络出错时用存的那份。
 *     所以有网时永远是最新版，不会出现「代码改了手机上还是旧的」。
 *   - 同源的其它 GET 资源：同上。
 *   - 跨域请求（AI 接口、天气、反查城市）：完全不碰，直接放行。
 *   - 非 GET（POST 等）：不碰。
 *
 * 改了这里的缓存逻辑就把 VERSION 改一下，新 SW 接管时会清掉旧缓存。
 * 缓存名带上了 scope，同一个域名下的其它版本（比如根目录那份）互不清理。
 */
const VERSION = 'v1';
const SCOPE = self.registration.scope;              // 形如 https://xxx.github.io/repo/DEV/
const PREFIX = 'boudoir|' + SCOPE + '|';
const CACHE = PREFIX + VERSION;

/* 首次安装就先存一份首页，这样装完立刻断网也能打开 */
self.addEventListener('install', (e) => {
  e.waitUntil(
    fetch(new Request(SCOPE, { cache: 'reload' }))
      .then(res => save(SCOPE, res))
      .catch(() => {})                              // 预存失败不影响安装，下次正常打开时会再存
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.indexOf(PREFIX) === 0 && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // 跨域完全放行
  if (url.href.indexOf(SCOPE) !== 0) return;        // 不归这个目录管的也放行

  if (req.mode === 'navigate') {
    /* 同一个页面可能带不同的 ?参数 / #锚点 打开，统一按「不带参数」的地址存，
     * 免得缓存里堆一堆重复的首页 */
    const key = url.origin + url.pathname;
    e.respondWith(
      fetch(req)
        .then(res => { e.waitUntil(save(key, res.clone())); return res; })
        .catch(() => offlinePage(key))
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then(res => { e.waitUntil(save(req, res.clone())); return res; })
      .catch(() => caches.match(req).then(hit => hit || Response.error()))
  );
});

/* 只存正常的同源响应。
 * 被重定向过的响应（比如 GitHub Pages 把 /DEV 跳到 /DEV/）不能直接拿来回给页面导航，
 * 浏览器会报错，所以先拆成一个干净的新响应再存。 */
function save(key, res) {
  if (!res || !res.ok || res.type !== 'basic') return Promise.resolve();
  const clean = res.redirected
    ? res.blob().then(b => new Response(b, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers
      }))
    : Promise.resolve(res);
  return clean
    .then(r => caches.open(CACHE).then(c => c.put(key, r)))
    .catch(() => {});
}

/* 断网时按顺序找：这个地址存的那份 → 首页 → index.html → 一个说明页 */
function offlinePage(key) {
  return caches.open(CACHE).then(c =>
    c.match(key)
      .then(hit => hit || c.match(SCOPE))
      .then(hit => hit || c.match(SCOPE + 'index.html'))
      .then(hit => hit || new Response(
        '<!doctype html><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<body style="background:#0a0a0c;color:#ccc;font:15px/1.8 sans-serif;'
        + 'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'
        + 'text-align:center;padding:0 24px">'
        + '<div>现在没网，而且这台设备上还没存过页面。<br>联网后打开一次，以后断网也能用了。</div>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      ))
  );
}
