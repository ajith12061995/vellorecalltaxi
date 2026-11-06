// Vellore Call Taxi — shared Firebase layer for the customer, driver and office apps.
// Loaded as a module; resolves window.__cloud(api). If anything fails the apps fall back to demo mode.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, onSnapshot, serverTimestamp, increment, runTransaction, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig, VCT_ENV, APPCHECK_SITE_KEY } from './firebase-config.js';

if (!firebaseConfig) throw new Error('no Firebase config for ' + VCT_ENV + ' (see firebase-config.js)');
const app = initializeApp(firebaseConfig);
// TEST copy (velloretaxi.app/staging/, separate Firebase project): a red banner so nobody mistakes it for the real app
if (VCT_ENV === 'staging' && typeof document !== 'undefined') {
  const show = () => { if (document.getElementById('vct-testbar')) return; const b = document.createElement('div'); b.id = 'vct-testbar';
    b.textContent = 'TEST · சோதனை — real bookings are NOT made here';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#C23B3B;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;pointer-events:none;opacity:.92';
    document.body.appendChild(b); };
  if (document.body) show(); else addEventListener('DOMContentLoaded', show);
}
// App Check first, so every database / function call carries the proof that it comes from our site.
// Loaded only when a site key is set; a failure here never stops the app (the server decides what to enforce).
let appCheckOn = false;
if (APPCHECK_SITE_KEY) {
  try {
    const ac = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js');
    ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    appCheckOn = true;
  } catch (e) { console.warn('app check', e); }
}
const auth = getAuth(app);
auth.languageCode = 'ta';
// Offline cache: a trip closed or a request written with no signal is kept on the phone and sent when the
// network returns (even if the app was closed). Falls back to memory-only where the browser has no storage.
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { console.warn('offline cache off', e); db = getFirestore(app); }

let verifier = null, confirmation = null;
function recaptchaBox() {
  let el = document.getElementById('vct-recaptcha');
  if (!el) { el = document.createElement('div'); el.id = 'vct-recaptcha'; el.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99'; document.body.appendChild(el); }
  return el;
}

getRedirectResult(auth).catch(() => {});

const toMs = (v) => (v && typeof v.toMillis === 'function') ? v.toMillis() : (typeof v === 'number' ? v : 0);

const api = {
  live: true,
  env: VCT_ENV,
  appCheck: () => appCheckOn,
  // web push for the driver app (loaded only when used). Returns the device token or null.
  async pushToken(vapidKey, swUrl, scope) {
    try {
      const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js');
      if (!(await m.isSupported())) return null;
      const reg = await navigator.serviceWorker.register(swUrl, { scope });
      return await m.getToken(m.getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
    } catch (e) { console.warn('push', e); return null; }
  },
  // native Android app (Capacitor wrapper built with Firebase config): FCM token through the native plugin
  nativePush() { const C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform() && /VCTPush/.test(navigator.userAgent)); },
  async nativePushToken() {
    if (!api.nativePush()) return null;
    try {
      const PN = window.Capacitor.registerPlugin('PushNotifications');
      let p = await PN.checkPermissions();
      if (p.receive !== 'granted') { p = await PN.requestPermissions(); if (p.receive !== 'granted') return null; }
      try { await PN.createChannel({ id: 'rides', name: 'Ride alerts', description: 'Ride and trip alerts', importance: 5, visibility: 1, vibration: true, lights: true }); } catch (e) { /* older Android */ }
      return await new Promise(res => {
        const tm = setTimeout(() => res(null), 15000);
        PN.addListener('registration', x => { clearTimeout(tm); res(x && x.value || null); });
        PN.addListener('registrationError', () => { clearTimeout(tm); res(null); });
        PN.register().catch(() => { clearTimeout(tm); res(null); });
      });
    } catch (e) { console.warn('native push', e); return null; }
  },
  // Cloud Functions callable (loaded only when used), e.g. call('verifyPin', {bookingId, pin}) → the function's result
  async call(name, data, region = 'asia-south1') {
    const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
    const r = await m.httpsCallable(m.getFunctions(app, region), name, { timeout: 15000 })(data);
    return r.data;
  },
  auth, db,
  fs: { doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, onSnapshot, serverTimestamp, increment, runTransaction, writeBatch },
  toMs,
  get user() { return auth.currentUser; },
  get phone() { return auth.currentUser ? auth.currentUser.phoneNumber : null; },
  // phone10: 10 digits without +91
  async sendOtp(phone10) {
    try { if (verifier) verifier.clear(); } catch (e) {}
    recaptchaBox().innerHTML = '<div id="vct-recaptcha-inner"></div>';
    verifier = new RecaptchaVerifier(auth, 'vct-recaptcha-inner', { size: 'invisible' });
    confirmation = await signInWithPhoneNumber(auth, '+91' + phone10, verifier);
    return true;
  },
  async verifyOtp(code) {
    if (!confirmation) throw new Error('no-otp');
    const cred = await confirmation.confirm(code);
    return cred.user;
  },
  // Sign in with Google (no SMS needed). Popup first; full-page redirect if the popup is blocked.
  async googleLogin() {
    const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    try { return (await signInWithPopup(auth, p)).user; }
    catch (e) {
      const c = (e && e.code) || '';
      if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment' || c === 'auth/web-storage-unsupported') { await signInWithRedirect(auth, p); return null; }
      throw e;
    }
  },
  waitUser() {
    return new Promise((res) => { const off = onAuthStateChanged(auth, (u) => { off(); res(u); }); });
  },
  onUser(cb) { return onAuthStateChanged(auth, cb); },
  logout() { return signOut(auth); },
  errText(e, ta) {
    const c = (e && e.code) || '';
    const m = {
      'auth/invalid-verification-code': ['OTP தவறு. மறுபடி பாருங்க', 'Wrong OTP. Please check it'],
      'auth/code-expired': ['OTP காலாவதி ஆயிடுச்சு. மறுபடி அனுப்புங்க', 'The OTP expired. Send a new one'],
      'auth/too-many-requests': ['ரொம்ப முறை முயற்சி. கொஞ்ச நேரம் கழிச்சு முயற்சி பண்ணுங்க', 'Too many attempts. Try again later'],
      'auth/quota-exceeded': ['இன்றைய SMS அளவு முடிஞ்சது. நாளை முயற்சி பண்ணுங்க', 'Today’s SMS limit is used up. Try tomorrow'],
      'auth/invalid-phone-number': ['நம்பர் சரியா இல்லை', 'That number is not valid'],
      'auth/network-request-failed': ['Internet இல்லை. Connection-ஐ பாருங்க', 'No internet. Check your connection'],
      'auth/captcha-check-failed': ['பாதுகாப்பு check தோல்வி. Page-ஐ refresh பண்ணுங்க', 'Security check failed. Refresh the page'],
      'permission-denied': ['அனுமதி இல்லை', 'Permission denied'],
      'auth/popup-closed-by-user': ['Google login நிறுத்தப்பட்டது', 'Google sign-in was closed'],
      'auth/cancelled-popup-request': ['Google login நிறுத்தப்பட்டது', 'Google sign-in was closed'],
      'auth/operation-not-allowed': ['இந்த login முறை இன்னும் on பண்ணல (Firebase)', 'This sign-in method is not turned on yet (Firebase)'],
      'auth/unauthorized-domain': ['இந்த website-க்கு அனுமதி இல்லை (Firebase)', 'This website is not authorised (Firebase)'],
    };
    const hit = m[c] || m[(c.split('/')[1] || '')];
    return hit ? (ta ? hit[0] : hit[1]) : (ta ? 'ஏதோ பிரச்சனை. மறுபடி முயற்சி பண்ணுங்க' : 'Something went wrong. Please try again') + (c ? ` (${c})` : '');
  },
};

if (window.__cloud) window.__cloud(api);
export { api };
