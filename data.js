// Backend layer. Real mode = Firebase (Auth + Firestore). Demo mode = localStorage + fake driver.
import { firebaseConfig } from "./firebase-config.js";
import { DEFAULT_FARES } from "./fare.js";

export const DEMO = !firebaseConfig.apiKey;
const ACTIVE = ["searching", "accepted", "arrived", "started"];
export const isActive = (r) => ACTIVE.includes(r.status);

const rand4 = () => String(Math.floor(1000 + Math.random() * 9000));

// ---------------------------------------------------------------- DEMO
function demoBackend() {
  const K = "demo_rides", U = "demo_user";
  const listeners = new Set();
  const load = () => JSON.parse(localStorage.getItem(K) || "[]");
  const save = (x) => localStorage.setItem(K, JSON.stringify(x));

  // Fake driver progression driven by elapsed time, so it survives page reloads.
  const derive = (r) => {
    if (r.status === "cancelled" || r.status === "completed") return r;
    const s = (Date.now() - r.createdMs) / 1000;
    const status = s < 4 ? "searching" : s < 14 ? "accepted" : s < 22 ? "arrived" : s < 40 ? "started" : "completed";
    const out = { ...r, status };
    if (status !== "searching") {
      out.driver = { name: "Demo Driver", phone: "9000000000", vehicleNo: "TN 23 XX 0000" };
    }
    return out;
  };
  const all = () => load().map(derive).sort((a, b) => b.createdMs - a.createdMs);
  const emit = () => listeners.forEach((fn) => fn(all()));
  setInterval(emit, 1000);

  return {
    mode: "demo",
    currentUser: () => JSON.parse(localStorage.getItem(U) || "null"),
    async sendOtp(phone) { return { hint: "Demo mode: use OTP 123456" }; },
    async verifyOtp(phone, code) {
      if (code !== "123456") throw new Error("Wrong OTP (demo OTP is 123456)");
      const user = { uid: "demo-" + phone, phone };
      localStorage.setItem(U, JSON.stringify(user));
      return user;
    },
    async logout() { localStorage.removeItem(U); },
    onAuth(cb) { cb(this.currentUser()); return () => {}; },
    async getFares() { return DEFAULT_FARES; },
    async createRide(data) {
      const ride = { id: "r" + Date.now(), ...data, status: "searching", otp: rand4(), createdMs: Date.now() };
      save([ride, ...load()]);
      emit();
      return ride.id;
    },
    async cancelRide(id) {
      const cancellable = ["searching", "accepted", "arrived"];
      save(load().map((r) => (r.id === id && cancellable.includes(derive(r).status) ? { ...r, status: "cancelled" } : r)));
      emit();
    },
    watchRides(uid, cb) { listeners.add(cb); cb(all()); return () => listeners.delete(cb); },
    async getProfile() { return JSON.parse(localStorage.getItem("demo_profile") || "{}"); },
    async saveProfile(uid, p) { localStorage.setItem("demo_profile", JSON.stringify(p)); },
  };
}

// ---------------------------------------------------------------- FIREBASE
async function firebaseBackend() {
  const V = "10.14.1";
  const base = `https://www.gstatic.com/firebasejs/${V}`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  let verifier = null, confirmation = null;

  const toMs = (t) => (t && t.toMillis ? t.toMillis() : Date.now());

  return {
    mode: "firebase",
    currentUser: () => (auth.currentUser ? { uid: auth.currentUser.uid, phone: auth.currentUser.phoneNumber } : null),
    async sendOtp(phone) {
      if (!verifier) verifier = new A.RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
      confirmation = await A.signInWithPhoneNumber(auth, "+91" + phone, verifier);
      return {};
    },
    async verifyOtp(phone, code) {
      const cred = await confirmation.confirm(code);
      return { uid: cred.user.uid, phone: cred.user.phoneNumber };
    },
    logout: () => A.signOut(auth),
    onAuth(cb) {
      return A.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, phone: u.phoneNumber } : null));
    },
    async getFares() {
      try {
        const s = await F.getDoc(F.doc(db, "settings", "fares"));
        return s.exists() ? { ...DEFAULT_FARES, ...s.data() } : DEFAULT_FARES;
      } catch { return DEFAULT_FARES; }
    },
    async createRide(data) {
      const ref = await F.addDoc(F.collection(db, "rides"), {
        ...data, status: "searching", otp: rand4(), createdAt: F.serverTimestamp(),
      });
      return ref.id;
    },
    async cancelRide(id) {
      await F.updateDoc(F.doc(db, "rides", id), { status: "cancelled" });
    },
    watchRides(uid, cb) {
      const q = F.query(F.collection(db, "rides"), F.where("customerId", "==", uid));
      return F.onSnapshot(q, (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data(), createdMs: toMs(d.data().createdAt) }));
        cb(list.sort((a, b) => b.createdMs - a.createdMs));
      });
    },
    async getProfile(uid) {
      const s = await F.getDoc(F.doc(db, "users", uid));
      return s.exists() ? s.data() : {};
    },
    async saveProfile(uid, p) {
      await F.setDoc(F.doc(db, "users", uid), p, { merge: true });
    },
  };
}

export async function initBackend() {
  return DEMO ? demoBackend() : firebaseBackend();
}
