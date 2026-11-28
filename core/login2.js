/* VCT core · login2: the 2-tap phone login shared by the customer and the driver app (owner 28 Nov, "Rapido level").
   Happy path in the Play Store app: open → Google's "choose your number" popup opens by itself → tap the number →
   the OTP goes out at once → Android reads the SMS → signed in. No typing, no Next / Verify button.
   - native (Play Store app with the VctAuth plugin): number popup, OTP sent by the native Firebase SDK (no reCAPTCHA),
     SMS read by Android (SMS Retriever); "instant" sign-in exchanged on the server (nativeLogin)
   - website / older app: the same screens; the number is typed (auto-sends at the 10th digit), web reCAPTCHA OTP,
     SMS User Consent where the old app has it
   - before every OTP: loginCheck on the server (5 OTPs per number and per device in an hour; the driver app only for
     numbers the office added — never an SMS to an unknown number)
   - wrong code: shake, clear, message; 5 wrong → 10 minutes wait (this phone)
   The page passes its own helpers (opts below); this file only draws into the page's #app with the page's styles. */
const VCTLOGIN = (() => {
  const T0 = (window.performance && performance.timeOrigin) || Date.now(), marks = {};
  const dbg = () => { try { return !!(window.VCT_DEBUG || localStorage.getItem('vct-debug')) } catch (e) { return false } };
  function mark(k) { marks[k] = Math.round(Date.now() - T0); if (dbg()) console.log('[login] ' + k + ' at ' + marks[k] + ' ms'); }
  const nat = () => { try { const C = window.Capacitor; return C && C.isNativePlatform && C.isNativePlatform() && C.isPluginAvailable && C.isPluginAvailable('VctAuth') ? C.Plugins.VctAuth : null } catch (e) { return null } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ls = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) { } }, del(k) { try { localStorage.removeItem(k) } catch (e) { } } };
  const dev = () => { let d = ls.get('vct-dev'); if (!d || !/^[A-Za-z0-9]{16}$/.test(d)) { d = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join(''); ls.set('vct-dev', d) } return d };
  const mask = p => p.slice(0, 2) + 'XXXXXX' + p.slice(8);
  const strip = s => { let d = String(s || '').replace(/\D/g, ''); if (d.length === 12 && d.startsWith('91')) d = d.slice(2); else if (d.length === 11 && d.startsWith('0')) d = d.slice(1); return d };
  const okPhone = p => /^[6-9]\d{9}$/.test(p);
  const LOCK_N = 5, LOCK_MS = 10 * 60e3;
  const lockLeft = p => { const u = +ls.get('vct-otplock-' + p) || 0; return u > Date.now() ? u - Date.now() : 0 };
  let O = null, phone = '', sending = false, listeners = [], tries = 0, timer = null, verifying = false;
  const L = (ta, en) => O.lang() === 'ta' ? ta : en;
  const CSS = `.l2over{position:fixed;inset:0;background:rgba(255,255,255,.72);display:flex;align-items:center;justify-content:center;z-index:9000}
.l2over i{width:44px;height:44px;border-radius:50%;border:4px solid rgba(0,0,0,.12);border-top-color:var(--navy,#0B4A36);animation:l2spin .8s linear infinite}
@keyframes l2spin{to{transform:rotate(360deg)}}@keyframes l2shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-8px)}40%,60%{transform:translateX(8px)}}
.l2shake{animation:l2shake .45s}.l2sent{margin:0;font-size:15px}.l2sent b{letter-spacing:.04em}.l2rs{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:14px}
.l2card{display:flex;flex-direction:column;gap:12px;text-align:center;align-items:center;padding:24px 4px}.l2card h2{margin:0}.l2card p{margin:0}`;
  function css() { if (document.getElementById('l2css')) return; const s = document.createElement('style'); s.id = 'l2css'; s.textContent = CSS; document.head.appendChild(s) }
  function busy(on) { let o = document.getElementById('l2over'); if (on && !o) { o = document.createElement('div'); o.id = 'l2over'; o.className = 'l2over'; o.innerHTML = '<i role="progressbar" aria-label="…"></i>'; document.body.appendChild(o) } else if (!on && o) o.remove() }
  function off() { listeners.forEach(h => { try { h.remove() } catch (e) { } }); listeners = []; clearInterval(timer); timer = null; busy(false) }
  function err(m) { const e = document.getElementById('e'); if (e) e.textContent = m || '' }
  const cl = () => O.cl();

  /* ---------- 1. phone ---------- */
  function phoneScreen(autoHint) {
    off(); css(); mark('phone-screen');
    O.go(`<section class="screen"><div class="hero pad">${O.header || ''}<h1>${esc(L(O.title[0], O.title[1]))}</h1>${O.sub ? `<p>${esc(L(O.sub[0], O.sub[1]))}</p>` : ''}
      <div class="lang2"><button data-l="ta" class="${O.lang() === 'ta' ? 'on' : ''}">தமிழ்</button><button data-l="en" class="${O.lang() === 'en' ? 'on' : ''}">English</button></div></div>
     <div class="body pad"><label class="muted" for="ph" style="font-weight:600">${L('மொபைல் நம்பர்', 'Mobile number')}</label>
      <div class="field"><span class="cc">+91</span><input id="ph" inputmode="numeric" maxlength="10" autocomplete="tel" value="${esc(phone)}" placeholder="98765 43210"></div>
      <div class="err" id="e"></div>${O.below ? O.below(L) : ''}<div style="flex:1"></div>
      ${nat() ? '' : `<button class="btn" id="go" ${okPhone(phone) ? '' : 'disabled'}>${L('OTP அனுப்பு', 'Get OTP')}</button>`}${O.extra ? O.extra(L) : ''}</div></section>`, () => {
      document.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { O.setLang(b.dataset.l); phoneScreen(false) });
      const ph = document.getElementById('ph'), go = document.getElementById('go');
      ph.oninput = () => { ph.value = strip(ph.value).slice(0, 10); err(''); if (go) go.disabled = ph.value.length !== 10; if (ph.value.length === 10 && nat()) submit(ph.value) };   // the app sends at the 10th digit; the website keeps its Get OTP button
      if (go) go.onclick = () => submit(ph.value);
      if (O.bind) O.bind();
      const n = nat();
      if (n && autoHint) setTimeout(() => {      // Google's number picker at once; closing it leaves the keypad
        mark('popup-asked');
        n.hint().then(r => { mark('popup-answered'); if (r && r.phone) { const p = strip(r.phone); ph.value = p; if (okPhone(p)) submit(p); else err(L('இந்த நம்பர் சரியில்லை. Type பண்ணுங்க', 'This number is not valid. Please type it')) } else ph.focus() })
          .catch(() => ph.focus());
      }, 150);
      else setTimeout(() => ph.focus(), 250);
    });
  }
  async function submit(p, resend) {
    p = strip(p);
    if (!okPhone(p)) { err(L('சரியான 10 இலக்க மொபைல் நம்பர் போடுங்க (6–9-ல தொடங்கணும்)', 'Enter a valid 10-digit mobile number (starts with 6–9)')); return }
    if (sending) return;
    const lk = lockLeft(p);
    if (lk) { err(L(`பல தடவை தப்பான OTP. ${Math.ceil(lk / 60e3)} நிமிஷம் கழிச்சு முயற்சி பண்ணுங்க`, `Too many wrong codes. Try again in ${Math.ceil(lk / 60e3)} min`)); return }
    sending = true; phone = p; O.setPhone(p); busy(true); err('');
    try {
      if (cl()) {
        let ck = null;
        try { ck = await cl().call('loginCheck', { phone: p, app: O.app, dev: dev() }) } catch (e) { ck = null; console.warn('loginCheck', e) } // not reachable: the OTP step decides
        if (ck && ck.ok === false) { busy(false); sending = false; return refused(ck) }
        const n = nat();
        if (n) {
          const r = await n.send({ phone: p, resend: !!resend });
          mark('otp-sent');
          if (r && r.vid) cl().nativeVid(r.vid);
        } else {
          const consent = !resend && window.VCTOTP ? VCTOTP.native() : null;
          await cl().sendOtp(p); mark('otp-sent');
          if (consent) consent.then(c => { if (c) fillCode(c) });
        }
      }
      busy(false); sending = false;
      if (resend) { O.toast(L('OTP மறுபடி அனுப்பியாச்சு', 'OTP sent again')); startTimer(); return }
      otpScreen();
    } catch (e) {
      busy(false); sending = false;
      const c = (e && (e.code || e.message)) || '';
      err(c === 'too-many-requests' || c === 'auth/too-many-requests' ? L('ரொம்ப முறை முயற்சி. கொஞ்ச நேரம் கழிச்சு முயற்சி பண்ணுங்க', 'Too many attempts. Try again later')
        : c === 'network' || c === 'auth/network-request-failed' ? L('Internet இணைப்பு இல்லை. பார்த்துட்டு மறுபடி முயற்சி பண்ணுங்க', 'No internet. Check it and try again')
        : c === 'invalid-phone' || c === 'auth/invalid-phone-number' ? L('இந்த நம்பர் சரியில்லை', 'This number is not valid')
        : cl() ? cl().errText(e, O.lang() === 'ta') : String(c));
    }
  }
  function refused(ck) {
    if (ck.why === 'rate') { const m = Math.max(1, Math.ceil((+ck.wait || 3600) / 60)); err(L(`இந்த நம்பருக்கு மணி நேரத்துல 5 OTP தான். ${m} நிமிஷம் கழிச்சு முயற்சி பண்ணுங்க`, `Only 5 OTPs an hour for a number. Try again in ${m} min`)); return }
    if (ck.why === 'invalid-phone') { err(L('இந்த நம்பர் சரியில்லை', 'This number is not valid')); return }
    const office = String(ck.office || O.office || '').replace(/\D/g, '').slice(-10);
    off();
    const blocked = ck.why === 'blocked';
    O.go(`<section class="screen"><div class="head pad"><button class="back" id="bk" aria-label="Back">←</button></div><div class="body pad"><div class="l2card">
      <h2>${blocked ? L('உங்க account நிறுத்தி வைக்கப்பட்டிருக்கு', 'Your account is on hold') : L('இந்த நம்பர் பதிவு செய்யப்படலை', 'This number is not registered')}</h2>
      <p class="muted">+91 ${esc(phone.slice(0, 5) + ' ' + phone.slice(5))}</p>
      ${blocked ? `${ck.reason ? `<div class="note" id="bwhy">${L('காரணம்: ', 'Reason: ')}${esc(ck.reason)}</div>` : ''}<p>${L('மேலும் தெரிஞ்சுக்க Vellore Call Taxi office-ஐ அழைங்க.', 'Please call the Vellore Call Taxi office.')}</p>`
        : `<p>${L('Vellore Call Taxi office-ஐ தொடர்பு கொள்ளுங்க.', 'Contact the Vellore Call Taxi office.')}</p>`}
      ${office ? `<a class="btn" id="l2call" href="tel:+91${office}">${L('Office-ஐ அழை', 'Call the office')}</a>` : ''}
      ${!blocked && O.joinUrl ? `<a class="btn ghost" id="l2join" href="${O.joinUrl}">${L('புது driver-ஆ சேரணுமா? Apply பண்ணுங்க', 'New driver? Apply to join')}</a>` : ''}
      <button class="linkbtn" id="l2other">${L('வேற நம்பர்', 'Use another number')}</button></div></div></section>`, () => {
      document.getElementById('bk').onclick = document.getElementById('l2other').onclick = () => { phone = ''; phoneScreen(false) };
    });
  }

  /* ---------- 2. OTP ---------- */
  function otpScreen() {
    off(); tries = 0; mark('otp-screen');
    const n6 = cl() ? 6 : 4;
    O.go(`<section class="screen"><div class="head pad"><button class="back" id="bk" aria-label="${L('நம்பர் மாத்த', 'Change number')}">←</button><h2>${L('Verification code போடுங்க', 'Enter verification code')}</h2></div>
     <div class="body pad" style="padding-top:8px"><p class="l2sent muted">${L('அனுப்பியது', 'Sent to')} <b>${mask(phone)}</b> · <button class="linkbtn" id="ch">${L('மாத்து', 'Edit')}</button></p>
      <div class="otp" id="l2otp">${[...Array(n6).keys()].map(i => `<input id="o${i}" inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="OTP ${i + 1}">`).join('')}</div>
      <div class="err" id="e"></div>${cl() ? '' : `<div class="note">Demo OTP: 1234</div>`}
      <div class="l2rs" id="rs"></div>${O.waOtp ? `<button class="btn ghost" id="l2wa">${L('WhatsApp-ல அனுப்பு', 'Send via WhatsApp')}</button>` : ''}</div></section>`, () => {
      const ins = [...document.querySelectorAll('#l2otp input')];
      box = VCTOTP.bind(ins, n6, code => verify(code), () => err(''));
      document.getElementById('bk').onclick = document.getElementById('ch').onclick = () => { if (window.VCTOTP) VCTOTP.stop(); phoneScreen(false) };
      const wa = document.getElementById('l2wa'); if (wa) wa.onclick = () => O.waOtp(phone);
      const n = nat();
      if (n && n.addListener) {
        Promise.resolve(n.addListener('code', e => { if (e && e.vid) cl().nativeVid(e.vid); mark('otp-autofilled'); fillCode(e && e.code) })).then(h => listeners.push(h));
        Promise.resolve(n.addListener('instant', e => instant(e && e.idToken))).then(h => listeners.push(h));
        Promise.resolve(n.addListener('failed', e => err(L('OTP அனுப்ப முடியலை. மறுபடி அனுப்புங்க', 'Could not send the OTP. Please resend')))).then(h => listeners.push(h));
      }
      startTimer();
      setTimeout(() => ins[0] && ins[0].focus(), 250);
    });
  }
  let box = null;
  function fillCode(c) { const ins = [...document.querySelectorAll('#l2otp input')]; if (c && ins.length && window.VCTOTP) VCTOTP.fill(ins, c) }
  function startTimer() {
    clearInterval(timer); let s = 30; const rs = document.getElementById('rs'); if (!rs) return;
    const draw = () => {
      if (!document.body.contains(rs)) { clearInterval(timer); return }
      if (s > 0) { rs.innerHTML = `<span class="muted">${L('மறுபடி அனுப்ப', 'Resend in')} ${s}s</span>`; s--; return }
      clearInterval(timer); rs.innerHTML = `<button class="linkbtn" id="rsb">${L('SMS மறுபடி அனுப்பு', 'Resend SMS')}</button>`;
      document.getElementById('rsb').onclick = () => submit(phone, true);
    };
    draw(); timer = setInterval(draw, 1000);
  }
  async function verify(code) {
    if (verifying) return; verifying = true; busy(true);
    try {
      let u = null;
      if (cl()) u = await cl().verifyOtp(code);
      else if (code !== '1234') throw { code: 'auth/invalid-verification-code' };
      done(u);
    } catch (e) {
      busy(false); verifying = false;
      const c = (e && e.code) || '';
      if (c === 'auth/invalid-verification-code' || c === 'auth/missing-verification-code') {
        tries++;
        const w = document.getElementById('l2otp'); if (w) { w.classList.remove('l2shake'); void w.offsetWidth; w.classList.add('l2shake') }
        if (box) box.reset();
        if (tries >= LOCK_N) { ls.set('vct-otplock-' + phone, String(Date.now() + LOCK_MS)); off(); phoneScreen(false); err(L('5 தடவை தப்பான OTP. 10 நிமிஷம் கழிச்சு முயற்சி பண்ணுங்க', '5 wrong codes. Try again in 10 minutes')); return }
        err(L(`OTP தவறு. இன்னும் ${LOCK_N - tries} வாய்ப்பு`, `Wrong code. ${LOCK_N - tries} tries left`));
      } else { if (box) box.reset(); err(cl() ? cl().errText(e, O.lang() === 'ta') : String(c)) }
    }
  }
  async function instant(idToken) {
    if (verifying || !idToken) return; verifying = true; busy(true);
    try { const r = await cl().call('nativeLogin', { idToken }); const u = await cl().customLogin(r.token); mark('otp-autofilled'); done(u) }
    catch (e) { busy(false); verifying = false; err(L('தானா login ஆகலை. SMS-ல வந்த OTP-ஐ போடுங்க', 'Automatic sign-in failed. Enter the OTP from the SMS')) }
  }
  function done(u) {
    mark('verified'); ls.del('vct-otplock-' + phone);
    const n = nat(); if (n) n.signOut().catch(() => { });   // the page keeps its own session
    off(); verifying = false;
    Promise.resolve(O.done(u, phone)).then(() => mark('home-ready'));
  }

  // opts: app 'customer'|'driver', go(html,bind), lang(), setLang(l), setPhone(p), phone, toast(m), cl() → CL or null,
  //       title [ta,en], sub [ta,en], header html, below(L) / extra(L) html + bind(), office, joinUrl, waOtp(phone) | null, done(user, phone)
  function start(opts) { O = opts; phone = strip(opts.phone || ''); if (!okPhone(phone)) phone = ''; verifying = false; sending = false; phoneScreen(opts.autoHint !== false) }
  return { start, marks: () => ({ ...marks }), mark, native: () => !!nat(), _strip: strip, _mask: mask, stop: off };
})();
