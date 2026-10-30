// Vellore Call Taxi — shared Firebase layer for the customer, driver and office apps.
// Loaded as a module; resolves window.__cloud(api). If anything fails the apps fall back to demo mode.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, onSnapshot, serverTimestamp, increment, runTransaction, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'ta';
const db = getFirestore(app);

let verifier = null, confirmation = null;
function recaptchaBox() {
  let el = document.getElementById('vct-recaptcha');
  if (!el) { el = document.createElement('div'); el.id = 'vct-recaptcha'; el.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99'; document.body.appendChild(el); }
  return el;
}

const toMs = (v) => (v && typeof v.toMillis === 'function') ? v.toMillis() : (typeof v === 'number' ? v : 0);

const api = {
  live: true,
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
    };
    const hit = m[c] || m[(c.split('/')[1] || '')];
    return hit ? (ta ? hit[0] : hit[1]) : (ta ? 'ஏதோ பிரச்சனை. மறுபடி முயற்சி பண்ணுங்க' : 'Something went wrong. Please try again') + (c ? ` (${c})` : '');
  },
};

if (window.__cloud) window.__cloud(api);
export { api };
