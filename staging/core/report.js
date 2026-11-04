/* VCT core · error reports: any script error on a real phone is saved (small, at most 5 per visit) to the
   `errors` collection so the owner can see in Office → Settings what is going wrong for customers and drivers. */
(function () {
  let sent = 0; const seen = new Set();
  const app = /\/office\//.test(location.pathname) ? 'office' : /\/driver\/join\//.test(location.pathname) ? 'join' : /\/driver\//.test(location.pathname) ? 'driver' : 'customer';
  function send(msg, src, line) {
    msg = String(msg || '').slice(0, 900); const key = msg + '|' + line;
    if (sent >= 5 || seen.has(key) || /ResizeObserver|Script error\.?$/.test(msg)) return; seen.add(key); sent++;
    Promise.resolve(window.CLOUD_READY).then(c => {
      if (!c || !c.fs) return;
      return c.fs.addDoc(c.fs.collection(c.db, 'errors'), { app, v: (window.VCT_V || ''), msg, src: String(src || '').slice(-200), line: +line || 0,
        ua: navigator.userAgent.slice(0, 160), at: Date.now(), who: c.phone || (c.user && c.user.uid) || '' });
    }).catch(() => {});
  }
  window.addEventListener('error', e => send(e.message, e.filename, e.lineno));
  window.addEventListener('unhandledrejection', e => { const r = e.reason; if (r && r.code && /permission-denied|unavailable|aborted/.test(r.code)) return; send('promise: ' + (r && (r.message || r.code) || r), '', 0); });
})();
