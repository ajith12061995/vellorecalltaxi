/* "Get the app" card for the customer and driver apps (shared).
   - Inside the Play Store app (Capacitor) it shows nothing.
   - When the owner has switched on Office → Settings → 📲 Play Store (config/app.play {on, cust, drv})
     and the phone is Android: "The app is on the Play Store → Download" (also for people using the
     installed website app, since Play Store updates never reach them).
   - Otherwise, when Chrome offers to install the website app (beforeinstallprompt): "Install the app" in one tap.
   The page puts <div id="appget"></div> where the card goes and calls APPGET.paint() after drawing it. */
(function () {
  const W = window;
  let kind = 'cust', lang = () => 'ta', prompt = null, play = null, installed = false;
  const KEY = k => 'vct_appget_' + kind + '_' + k;
  const ls = { get(k) { try { return localStorage.getItem(KEY(k)) } catch (e) { return null } },
               set(k, v) { try { localStorage.setItem(KEY(k), v) } catch (e) {} } };
  const native = () => { try { return !!(W.Capacitor && W.Capacitor.isNativePlatform && W.Capacitor.isNativePlatform()) } catch (e) { return false } };
  const standalone = () => { try { return W.matchMedia('(display-mode: standalone)').matches || W.navigator.standalone === true } catch (e) { return false } };
  const android = () => /Android/i.test(W.navigator.userAgent || '');
  const DAY = 864e5;
  const hidden = what => { const t = +ls.get('hide_' + what) || 0; return t && Date.now() - t < 7 * DAY };
  const L = (ta, en) => lang() === 'en' ? en : ta;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const okUrl = u => typeof u === 'string' && /^https:\/\/play\.google\.com\//.test(u);

  function state() {
    if (native()) return null;
    const url = play && play.on ? (kind === 'drv' ? play.drv : play.cust) : '';
    if (okUrl(url) && android() && !hidden('play')) return { what: 'play', url };
    if (prompt && !installed && !standalone() && !hidden('install')) return { what: 'install' };
    return null;
  }
  function html(st) {
    const name = kind === 'drv' ? 'VCT Driver' : 'Vellore Taxi';
    const head = st.what === 'play'
      ? L(`📲 ${name} app இப்போ Play Store-ல!`, `📲 ${name} is now on the Play Store!`)
      : L(`📲 ${name}-ஐ app-ஆ install பண்ணுங்க`, `📲 Install ${name} as an app`);
    const sub = st.what === 'play'
      ? L('Download பண்ணி அதே நம்பர்ல login பண்ணுங்க. உங்க விவரம் எல்லாம் அப்படியே இருக்கும்.', 'Download it and log in with the same number. Everything you have stays.')
      : L('ஒரே தொடுதல். Home screen-ல icon வரும், அடுத்த தடவை நேரா திறக்கலாம்.', 'One tap. An icon appears on your home screen for next time.');
    const btn = st.what === 'play'
      ? `<a class="agbtn" id="agGo" href="${esc(st.url)}" target="_blank" rel="noopener">${L('Play Store-ல Download', 'Get it on Play Store')}</a>`
      : `<button class="agbtn" id="agGo" type="button">${L('Install பண்ணு', 'Install')}</button>`;
    return `<div class="agcard" role="region" aria-label="${esc(head)}"><div class="agtxt"><b>${head}</b><small>${sub}</small></div>${btn}<button class="agx" id="agX" type="button" aria-label="${L('மூடு', 'Close')}">×</button></div>`;
  }
  function paint() {
    const box = W.document && W.document.getElementById('appget'); if (!box) return;
    const st = state();
    box.innerHTML = st ? html(st) : ''; box.hidden = !st; if (!st) return;
    const go = box.querySelector('#agGo'), x = box.querySelector('#agX');
    if (st.what === 'install') go.onclick = async () => {
      const p = prompt; if (!p) return paint(); prompt = null;
      try { p.prompt(); const r = await p.userChoice; if (r && r.outcome === 'accepted') installed = true; } catch (e) {}
      paint();
    };
    x.onclick = () => { ls.set('hide_' + st.what, String(Date.now())); paint(); };
  }
  if (W.addEventListener) {
    W.addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; paint(); });
    W.addEventListener('appinstalled', () => { installed = true; prompt = null; paint(); });
  }
  W.APPGET = {
    init(k, langFn) { kind = k === 'drv' ? 'drv' : 'cust'; if (typeof langFn === 'function') lang = langFn; },
    setPlay(p) { play = p && typeof p === 'object' ? { on: !!p.on, cust: p.cust || '', drv: p.drv || '' } : null; paint(); },
    paint,
    _state: state // for tests
  };
})();
