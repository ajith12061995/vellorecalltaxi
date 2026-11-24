/* "Get the app" card for the customer and driver apps (shared).
   - Inside the Play Store app (Capacitor) it shows nothing.
   - When the owner has switched on Office → Settings → 📲 Play Store (config/app.play {on, cust, drv})
     and the phone is Android: "The app is on the Play Store → Download" (also for people using the
     installed website app, since Play Store updates never reach them).
   - Inside the Facebook / Instagram in-app browser (where ad visitors land; it can't install apps):
     Android → "Open in Chrome" (intent link; Chrome then offers the install); iPhone → how to open in Safari.
   - Otherwise, when Chrome offers to install the website app (beforeinstallprompt): "Install the app" in one tap.
   - On a phone browser that has not offered it (yet): "How to install" with the 2 steps for that phone.
   The page puts <div id="appget"></div> where the card goes and calls APPGET.paint() after drawing it. */
(function () {
  const W = window;
  let kind = 'cust', lang = () => 'ta', prompt = null, play = null, installed = false;
  const KEY = k => 'vct_appget_' + kind + '_' + k;
  const ls = { get(k) { try { return localStorage.getItem(KEY(k)) } catch (e) { return null } },
               set(k, v) { try { localStorage.setItem(KEY(k), v) } catch (e) {} } };
  const native = () => { try { return !!(W.Capacitor && W.Capacitor.isNativePlatform && W.Capacitor.isNativePlatform()) } catch (e) { return false } };
  const standalone = () => { try { return W.matchMedia('(display-mode: standalone)').matches || W.navigator.standalone === true } catch (e) { return false } };
  const UA = () => W.navigator.userAgent || '';
  const android = () => /Android/i.test(UA());
  const ios = () => /iPhone|iPad|iPod/i.test(UA());
  const iab = () => /FBAN|FBAV|FB_IAB|FBIOS|Instagram/i.test(UA());
  const chromeIntent = () => { const l = W.location; return 'intent://' + l.host + l.pathname + l.search + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(l.href) + ';end' };
  const DAY = 864e5;
  const hidden = (what, days) => { const t = +ls.get('hide_' + what) || 0; return t && Date.now() - t < (days || 7) * DAY };
  let open = false, asked = false; // asked: Chrome's own install prompt was shown this visit → no more cards
  const L = (ta, en) => lang() === 'en' ? en : ta;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const okUrl = u => typeof u === 'string' && /^https:\/\/play\.google\.com\//.test(u);

  function state() {
    if (native()) return null;
    const url = play && play.on ? (kind === 'drv' ? play.drv : play.cust) : '';
    if (okUrl(url) && android() && !hidden('play')) return { what: 'play', url };
    if (standalone() || installed || asked) return null;
    // one "nudge" switch for all install cards: × hides them (1 day inside Facebook, where every ad tap lands; else 3 days)
    if (iab()) return (android() || ios()) && !hidden('nudge', 1) ? { what: 'iab', os: android() ? 'and' : 'ios' } : null;
    if (hidden('nudge', 3)) return null;
    if (prompt) return { what: 'install' };
    if (android() || ios()) return { what: 'howto', os: android() ? 'and' : 'ios' };
    return null;
  }
  function steps(os) {
    return os === 'ios'
      ? L('Safari-ல கீழே உள்ள Share ⬆ button → "Add to Home Screen" → Add.', 'In Safari tap Share ⬆ at the bottom → "Add to Home Screen" → Add.')
      : L('Chrome-ல மேல வலது ⋮ → "Install app" அல்லது "Add to Home screen" → Install.', 'In Chrome tap ⋮ at the top right → "Install app" or "Add to Home screen" → Install.');
  }
  function html(st) {
    const name = kind === 'drv' ? 'VCT Driver' : 'Vellore Taxi';
    const x = `<button class="agx" id="agX" type="button" aria-label="${L('மூடு', 'Close')}">×</button>`;
    if (st.what === 'iab') {
      const head = L(`📲 ${name}-ஐ app-ஆ phone-ல வச்சுக்கோங்க`, `📲 Keep ${name} as an app on your phone`);
      const sub = st.os === 'and'
        ? L('இப்போ Facebook-க்குள்ள திறந்திருக்கு. Chrome-ல திறந்தா ஒரே தொடுதல்ல install ஆகும் — அடுத்த தடவை icon-ஐ தொட்டு நேரா book பண்ணலாம்.', 'You are inside Facebook. Open it in Chrome to install it in one tap — next time just tap the icon to book.')
        : L('இப்போ Facebook-க்குள்ள திறந்திருக்கு. மேல ⋯ அழுத்தி "Open in external browser" (Safari) தேர்வு பண்ணுங்க. அப்புறம் Share ⬆ → "Add to Home Screen".', 'You are inside Facebook. Tap ⋯ at the top and choose "Open in external browser" (Safari). Then Share ⬆ → "Add to Home Screen".');
      const btn = st.os === 'and' ? `<a class="agbtn" id="agGo" href="${esc(chromeIntent())}">${L('Chrome-ல திற', 'Open in Chrome')}</a>` : '';
      return `<div class="agcard" role="region" aria-label="${esc(head)}"><div class="agtxt"><b>${head}</b><small>${sub}</small></div>${btn}${x}</div>`;
    }
    if (st.what === 'howto') {
      const head = L(`📲 ${name}-ஐ app-ஆ install பண்ணுங்க`, `📲 Install ${name} as an app`);
      const sub = open ? steps(st.os) : L('Play Store தேவையில்லை, 2 தொடுதல் போதும். Home screen-ல icon வரும்.', 'No Play Store needed — 2 taps. An icon appears on your home screen.');
      const btn = open ? '' : `<button class="agbtn" id="agGo" type="button">${L('எப்படி install பண்றது?', 'How to install')}</button>`;
      return `<div class="agcard" role="region" aria-label="${esc(head)}"><div class="agtxt"><b>${head}</b><small id="agSteps">${sub}</small></div>${btn}${x}</div>`;
    }
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
    if (st.what === 'howto' && go) go.onclick = () => { open = true; paint(); };
    if (st.what === 'install') go.onclick = async () => {
      const p = prompt; if (!p) return paint(); prompt = null; asked = true;
      try { p.prompt(); const r = await p.userChoice; if (r && r.outcome === 'accepted') installed = true; } catch (e) {}
      paint();
    };
    x.onclick = () => { ls.set('hide_' + (st.what === 'play' ? 'play' : 'nudge'), String(Date.now())); paint(); };
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
