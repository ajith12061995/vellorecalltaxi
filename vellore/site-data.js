// Vellore website · data: reads the public website content and prices, sends the contact form.
// Loaded after the page has shown (it never slows the first paint). Uses Firestore Lite (small) + App Check like the apps.
// window.SITEDB() → Promise<{get(path), enquiry(data)}>; rejects where there is no Firebase (tests on localhost, offline).
import { firebaseConfig, APPCHECK_SITE_KEY } from '/firebase-config.js';
const G = 'https://www.gstatic.com/firebasejs/10.12.2/';
let api = null;
async function boot() {
  if (!firebaseConfig) throw new Error('no-config');
  const { initializeApp } = await import(G + 'firebase-app.js');
  const app = initializeApp(firebaseConfig, 'site');
  if (APPCHECK_SITE_KEY) {
    try { const ac = await import(G + 'firebase-app-check.js'); ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true }); }
    catch (e) { console.warn('app check', e); }
  }
  const fs = await import(G + 'firebase-firestore-lite.js');
  const db = fs.getFirestore(app);
  return {
    get: async path => { const s = await fs.getDoc(fs.doc(db, ...path.split('/'))); return s.exists() ? s.data() : null; },
    enquiry: d => fs.addDoc(fs.collection(db, 'enquiries'), { name: d.name, phone: d.phone, kind: d.kind, msg: d.msg, status: 'open', src: 'web', createdAt: fs.serverTimestamp() })
  };
}
window.SITEDB = () => api || (api = boot().catch(e => { api = null; throw e; }));
document.dispatchEvent(new Event('sitedb-ready'));
