// Vellore Taxi — Firebase web config. These values are PUBLIC by design (every Firebase web app ships them);
// security comes from firestore.rules, Authentication settings and the API-key restrictions in Google Cloud.
// Two separate projects: PRODUCTION (real customers) and STAGING (testing). The site picks one by where it runs:
//   https://ajith12061995.github.io/vellorecalltaxi/...          → production
//   any address containing "staging", or localhost / 127.0.0.1 → staging
// Fill STAGING after creating the second Firebase project (see docs/DEPLOY.md). While it is empty, staging
// addresses show the "offline" screen instead of ever touching production data.
const PRODUCTION = {
  apiKey: "AIzaSyDdO6xnD1hmakweVjJw52p3Wj1wP-jMB9g",
  authDomain: "vellore-taxi23.firebaseapp.com",
  projectId: "vellore-taxi23",
  storageBucket: "vellore-taxi23.firebasestorage.app",
  messagingSenderId: "764188040315",
  appId: "1:764188040315:web:54bf2a9b3c806b71a696de",
  measurementId: "G-X9WBCXVGQ2"
};
const STAGING = null; // e.g. { apiKey: "...", authDomain: "vellore-taxi-staging.firebaseapp.com", projectId: "vellore-taxi-staging", ... }

const isStaging = /staging/i.test(location.href) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
export const VCT_ENV = isStaging ? 'staging' : 'production';
export const firebaseConfig = isStaging ? STAGING : PRODUCTION;
