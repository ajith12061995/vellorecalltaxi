/* VCT core · booking funnel: counts how far a visit to the customer app gets (opened → home → saw a fare → pressed Book →
   booked → driver found → trip done), so the owner can see in Office → Reports where people stop.
   No name, phone or login id is stored: only the step, a random id that lasts for this visit, and where the visit came from. */
(function () {
  var STEPS = ['open', 'home', 'fare', 'login', 'book', 'booked', 'driver', 'done', 'nodriver'];
  var seen = {}, sid = '', src = 'direct';
  try {
    sid = sessionStorage.getItem('vct_fsid') || '';
    if (!sid) { sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); sessionStorage.setItem('vct_fsid', sid); }
    var s0 = sessionStorage.getItem('vct_fsrc');
    if (!s0) {
      var q = new URLSearchParams(location.search), r = '';
      try { r = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
      s0 = q.get('utm_source') || (q.get('fbclid') ? 'facebook' : q.get('gclid') ? 'google' : '') ||
        (/facebook|fb\.|instagram/.test(r) ? 'facebook' : /google\./.test(r) ? 'google' : /whatsapp|wa\.me/.test(r) ? 'whatsapp' : r && r.indexOf('velloretaxi') < 0 ? 'other' : '') ||
        (/FBAN|FBAV|Instagram/.test(navigator.userAgent) ? 'facebook' : 'direct');
      s0 = String(s0).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'direct';
      sessionStorage.setItem('vct_fsrc', s0);
    }
    src = s0;
    (sessionStorage.getItem('vct_fseen') || '').split(',').forEach(function (k) { if (k) seen[k] = 1; });
  } catch (e) { sid = sid || Math.random().toString(36).slice(2, 12); }
  window.VCTF = function (step) {
    try {
      if (STEPS.indexOf(step) < 0 || seen[step]) return; seen[step] = 1;
      try { sessionStorage.setItem('vct_fseen', Object.keys(seen).join(',')); } catch (e) {}
      Promise.resolve(window.CLOUD_READY).then(function (c) {
        if (!c || !c.fs) return;
        return c.fs.addDoc(c.fs.collection(c.db, 'events'), { app: 'customer', v: String(window.VCT_V || ''), step: step, sid: sid, src: src, at: Date.now() });
      }).catch(function () {});
    } catch (e) {}
  };
  window.VCTF.steps = STEPS;
  window.VCTF('open');
})();
