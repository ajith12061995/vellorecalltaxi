import { initBackend, DEMO, isActive } from "./data.js";
import { BUSINESS } from "./firebase-config.js";
import { VEHICLES, haversineKm, estimateFare, estimateMinutes, upiLink } from "./fare.js";

/* ------------------------------------------------------------------ text */
const TXT = {
  en: {
    login_sub: "Book auto, bike and car rides in Vellore",
    phone: "Mobile number", send_otp: "Send OTP", enter_otp: "Enter OTP", verify: "Verify",
    change_number: "Change number", language: "தமிழ்", demo_note: "Demo mode: any number works, OTP is 123456",
    pickup: "Pickup location", drop: "Where to?", bike: "Bike", auto: "Auto", car: "Car",
    cash: "Cash", upi: "UPI / QR", book: "Book", min: "min",
    searching: "Finding a driver…", accepted: "Driver is on the way", arrived: "Driver has arrived",
    started: "Trip in progress", completed: "Trip completed", cancelled: "Ride cancelled",
    share_otp: "Tell this OTP to the driver to start the trip",
    cancel: "Cancel ride", confirm_cancel: "Cancel this ride?", call_driver: "Call driver",
    pay_cash: "Please pay cash to the driver", pay_upi: "Pay with UPI app", scan_qr: "or scan this QR with any UPI app",
    done: "Done", back_home: "Back to home",
    bookings: "My bookings", profile: "Profile & emergency", help: "Help / Call us", logout: "Logout",
    no_rides: "No bookings yet", name: "Your name", em_name: "Emergency contact name", em_phone: "Emergency contact number",
    save: "Save", saved: "Saved", call_em: "Call emergency contact", no_support: "Support number not set yet",
    locating: "Finding your location…", same_place: "Pickup and drop are the same place", bad_phone: "Enter a valid 10 digit mobile number",
    bad_otp: "Enter the OTP", fare: "Fare", payment: "Payment", driver: "Driver",
  },
  ta: {
    login_sub: "வேலூரில் ஆட்டோ, பைக், கார் புக் செய்யுங்கள்",
    phone: "மொபைல் எண்", send_otp: "OTP அனுப்பு", enter_otp: "OTP உள்ளிடவும்", verify: "சரிபார்",
    change_number: "எண்ணை மாற்று", language: "English", demo_note: "டெமோ மோட்: எந்த எண்ணும் சரி, OTP 123456",
    pickup: "ஏறும் இடம்", drop: "எங்கே போகணும்?", bike: "பைக்", auto: "ஆட்டோ", car: "கார்",
    cash: "ரொக்கம்", upi: "UPI / QR", book: "புக் பண்ணு", min: "நிமிடம்",
    searching: "டிரைவரைத் தேடுகிறோம்…", accepted: "டிரைவர் வந்துகொண்டிருக்கிறார்", arrived: "டிரைவர் வந்துவிட்டார்",
    started: "பயணம் நடக்கிறது", completed: "பயணம் முடிந்தது", cancelled: "ரைடு ரத்து செய்யப்பட்டது",
    share_otp: "பயணத்தைத் தொடங்க இந்த OTP-ஐ டிரைவரிடம் சொல்லுங்கள்",
    cancel: "ரைடை ரத்து செய்", confirm_cancel: "இந்த ரைடை ரத்து செய்யவா?", call_driver: "டிரைவரை அழை",
    pay_cash: "டிரைவருக்கு ரொக்கமாக செலுத்துங்கள்", pay_upi: "UPI ஆப்பில் செலுத்து", scan_qr: "அல்லது எந்த UPI ஆப்பிலும் இந்த QR-ஐ ஸ்கேன் செய்யுங்கள்",
    done: "முடிந்தது", back_home: "முகப்புக்குத் திரும்பு",
    bookings: "என் புக்கிங்ஸ்", profile: "சுயவிவரம் & அவசர தொடர்பு", help: "உதவி / அழைக்கவும்", logout: "வெளியேறு",
    no_rides: "இன்னும் புக்கிங் இல்லை", name: "உங்கள் பெயர்", em_name: "அவசர தொடர்பு பெயர்", em_phone: "அவசர தொடர்பு எண்",
    save: "சேமி", saved: "சேமிக்கப்பட்டது", call_em: "அவசர தொடர்பை அழை", no_support: "உதவி எண் இன்னும் சேர்க்கப்படவில்லை",
    locating: "உங்கள் இருப்பிடத்தைத் தேடுகிறோம்…", same_place: "ஏறும் இடமும் இறங்கும் இடமும் ஒன்றே", bad_phone: "சரியான 10 இலக்க மொபைல் எண்ணை உள்ளிடவும்",
    bad_otp: "OTP-ஐ உள்ளிடவும்", fare: "கட்டணம்", payment: "பணம் செலுத்தும் முறை", driver: "டிரைவர்",
  },
};
let lang = localStorage.getItem("lang") || "en";
const t = (k) => (TXT[lang] && TXT[lang][k]) || TXT.en[k] || k;

/* --------------------------------------------------------------- helpers */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "₹" + n;
const app = document.getElementById("app");

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ----------------------------------------------------------------- state */
let be, user = null, rides = [], fares, view = "", currentRideId = null;
let map = null, loaded = false, unwatch = null, started = false, lastSig = "";
const H = { pickup: null, drop: null, active: "drop", km: 0, vehicle: "auto", pay: "cash", markers: {}, routeLine: null };

/* ------------------------------------------------------------------ boot */
async function boot() {
  app.innerHTML = `<div class="splash">🚖<br>${esc(BUSINESS.name)}</div>`;
  try {
    be = await initBackend();
  } catch (e) {
    app.innerHTML = `<div class="splash small">Could not start the app.<br>${esc(e.message)}</div>`;
    return;
  }
  be.onAuth((u) => {
    user = u;
    if (u) afterLogin();
    else { resetSession(); go("login"); }
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function resetSession() {
  if (unwatch) unwatch();
  unwatch = null; started = false; loaded = false; rides = []; currentRideId = null;
  H.pickup = H.drop = null; H.km = 0;
}

async function afterLogin() {
  if (started) return;
  started = true;
  fares = await be.getFares();
  unwatch = be.watchRides(user.uid, (list) => {
    rides = list;
    if (!loaded) {
      loaded = true;
      const a = rides.find(isActive);
      if (a) { currentRideId = a.id; go("ride"); } else go("home");
      return;
    }
    if (view === "ride") renderRide();
    else if (view === "bookings") renderBookings();
  });
}

function go(v) {
  leaveMap();
  view = v;
  lastSig = "";
  ({ login: renderLogin, home: renderHome, ride: renderRide, bookings: renderBookings, profile: renderProfile }[v])();
}

function leaveMap() {
  if (map) { map.remove(); map = null; }
  H.markers = {}; H.routeLine = null;
}

/* ----------------------------------------------------------------- login */
function renderLogin() {
  app.innerHTML = `
  <div class="login">
    <div class="brand">🚖<h1>${esc(BUSINESS.name)}</h1></div>
    <p class="muted">${t("login_sub")}</p>
    <div id="step1">
      <label>${t("phone")}</label>
      <div class="phone"><span>+91</span><input id="phone" type="tel" inputmode="numeric" maxlength="10" placeholder="9XXXXXXXXX"></div>
      <button class="btn" id="send">${t("send_otp")}</button>
    </div>
    <div id="step2" hidden>
      <label>${t("enter_otp")}</label>
      <input id="otp" class="otp" type="tel" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
      <button class="btn" id="verify">${t("verify")}</button>
      <button class="link" id="back">${t("change_number")}</button>
    </div>
    <p class="err" id="err"></p>
    <p class="muted small">${DEMO ? t("demo_note") : ""}</p>
    <button class="link" id="lang">${t("language")}</button>
    <div id="recaptcha-container"></div>
  </div>`;
  const err = (m) => ($("#err").textContent = m || "");
  $("#lang").onclick = () => { lang = lang === "en" ? "ta" : "en"; localStorage.setItem("lang", lang); renderLogin(); };
  $("#back").onclick = () => { $("#step2").hidden = true; $("#step1").hidden = false; err(); };
  $("#send").onclick = async () => {
    const phone = $("#phone").value.trim();
    if (!/^[6-9]\d{9}$/.test(phone)) return err(t("bad_phone"));
    err(); $("#send").disabled = true;
    try {
      await be.sendOtp(phone);
      $("#step1").hidden = true; $("#step2").hidden = false; $("#otp").focus();
    } catch (e) { err(e.message); }
    $("#send").disabled = false;
  };
  $("#verify").onclick = async () => {
    const code = $("#otp").value.trim();
    if (!code) return err(t("bad_otp"));
    err(); $("#verify").disabled = true;
    try {
      user = await be.verifyOtp($("#phone").value.trim(), code);
      afterLogin();
    } catch (e) { err(e.message); $("#verify").disabled = false; }
  };
}

/* ------------------------------------------------------------------ home */
function renderHome() {
  app.innerHTML = `
  <div class="home">
    <div id="map"></div>
    <button class="fab menu" id="menu" aria-label="menu">☰</button>
    <button class="fab loc" id="gps" aria-label="my location">◎</button>
    <div class="sheet">
      <div class="field"><span class="dot g"></span><input id="in-pickup" autocomplete="off" placeholder="${t("pickup")}" value="${esc(H.pickup?.address || "")}"></div>
      <div class="field"><span class="dot r"></span><input id="in-drop" autocomplete="off" placeholder="${t("drop")}" value="${esc(H.drop?.address || "")}"></div>
      <div id="suggest"></div>
      <div id="options"></div>
    </div>
    <div class="overlay" id="drawer" hidden>
      <div class="panel">
        <div class="who">📱 ${esc(user?.phone || "")}</div>
        <button data-go="bookings">📅 ${t("bookings")}</button>
        <button data-go="profile">👤 ${t("profile")}</button>
        <button data-go="help">☎️ ${t("help")}</button>
        <button data-go="lang">🌐 ${t("language")}</button>
        <button data-go="logout">🚪 ${t("logout")}</button>
      </div>
    </div>
  </div>`;

  initMap();
  bindSearch("pickup");
  bindSearch("drop");
  $("#gps").onclick = locate;

  const drawer = $("#drawer");
  $("#menu").onclick = () => (drawer.hidden = false);
  drawer.onclick = async (e) => {
    if (e.target === drawer) { drawer.hidden = true; return; }
    const b = e.target.closest("button[data-go]");
    if (!b) return;
    const a = b.dataset.go;
    drawer.hidden = true;
    if (a === "bookings" || a === "profile") go(a);
    else if (a === "lang") { lang = lang === "en" ? "ta" : "en"; localStorage.setItem("lang", lang); go("home"); }
    else if (a === "help") { BUSINESS.supportPhone ? (location.href = "tel:" + BUSINESS.supportPhone) : toast(t("no_support")); }
    else if (a === "logout") { await be.logout(); user = null; resetSession(); go("login"); }
  };
  renderOptions();
}

function pinIcon(cls) { return L.divIcon({ className: "pin " + cls, iconSize: [20, 20], iconAnchor: [10, 10] }); }

function initMap() {
  map = L.map("map", { zoomControl: false }).setView([BUSINESS.center.lat, BUSINESS.center.lng], 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  map.on("click", (e) => setPoint(H.active, { lat: e.latlng.lat, lng: e.latlng.lng }));
  if (H.pickup) drawMarker("pickup");
  if (H.drop) drawMarker("drop");
  if (H.pickup && H.drop) computeRoute();
  else if (H.pickup) map.setView([H.pickup.lat, H.pickup.lng], 15);
  else locate();
}

function drawMarker(which) {
  if (!map || !H[which]) return;
  const p = H[which];
  if (H.markers[which]) H.markers[which].setLatLng([p.lat, p.lng]);
  else H.markers[which] = L.marker([p.lat, p.lng], { icon: pinIcon(which === "pickup" ? "g" : "r") }).addTo(map);
}

function setInput(which) {
  const el = $("#in-" + which);
  if (el && H[which]) el.value = H[which].address;
}

function locate() {
  if (!navigator.geolocation) return;
  $("#in-pickup").placeholder = t("locating");
  navigator.geolocation.getCurrentPosition(
    (pos) => { if (map) setPoint("pickup", { lat: pos.coords.latitude, lng: pos.coords.longitude }); },
    () => { const el = $("#in-pickup"); if (el) el.placeholder = t("pickup"); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function reverse(ll) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${ll.lat}&lon=${ll.lng}`);
    const j = await r.json();
    return (j.display_name || "").split(",").slice(0, 3).join(",").trim() || null;
  } catch { return null; }
}

async function setPoint(which, ll, address) {
  if (!map) return;
  H[which] = { lat: ll.lat, lng: ll.lng, address: address || `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}` };
  drawMarker(which);
  setInput(which);
  const sg = $("#suggest"); if (sg) sg.innerHTML = "";
  if (which === "pickup" && !H.drop) { H.active = "drop"; map.setView([ll.lat, ll.lng], 15); }
  if (H.pickup && H.drop) computeRoute(); else renderOptions();
  if (!address) {
    const a = await reverse(ll);
    if (a && H[which] && H[which].lat === ll.lat && H[which].lng === ll.lng) { H[which].address = a; setInput(which); }
  }
}

function bindSearch(which) {
  const input = $("#in-" + which);
  let timer;
  input.onfocus = () => { H.active = which; input.select(); };
  input.oninput = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { $("#suggest").innerHTML = ""; return; }
    timer = setTimeout(async () => {
      try {
        const c = BUSINESS.center, d = 0.4;
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in&accept-language=en` +
          `&viewbox=${c.lng - d},${c.lat + d},${c.lng + d},${c.lat - d}&q=${encodeURIComponent(q + " " + BUSINESS.city)}`;
        const list = await (await fetch(url)).json();
        const box = $("#suggest");
        if (!box) return;
        box.innerHTML = list.map((p, i) =>
          `<button class="sg" data-i="${i}">📍 ${esc(p.display_name.split(",").slice(0, 3).join(","))}</button>`).join("");
        box.onclick = (e) => {
          const b = e.target.closest(".sg"); if (!b) return;
          const p = list[+b.dataset.i];
          setPoint(which, { lat: +p.lat, lng: +p.lon }, p.display_name.split(",").slice(0, 3).join(",").trim());
        };
      } catch { /* offline: user can still tap the map */ }
    }, 500);
  };
}

async function computeRoute() {
  const a = H.pickup, b = H.drop;
  if (!a || !b) return;
  let km, coords = null;
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
    const j = await r.json();
    km = j.routes[0].distance / 1000;
    coords = j.routes[0].geometry.coordinates.map(([x, y]) => [y, x]);
  } catch { km = haversineKm(a, b) * 1.3; }
  if (!map || H.pickup !== a || H.drop !== b) return; // user moved on while we waited
  H.km = Math.round(km * 10) / 10;
  if (H.routeLine) map.removeLayer(H.routeLine);
  H.routeLine = L.polyline(coords || [[a.lat, a.lng], [b.lat, b.lng]], { color: "#111", weight: 4 }).addTo(map);
  map.fitBounds(H.routeLine.getBounds(), { paddingTopLeft: [30, 30], paddingBottomRight: [30, 300] });
  renderOptions();
}

function renderOptions() {
  const el = $("#options");
  if (!el) return;
  if (!(H.pickup && H.drop)) { el.innerHTML = ""; return; }
  if (!H.km || H.km < 0.1) { el.innerHTML = H.km === 0 ? "" : `<p class="err">${t("same_place")}</p>`; return; }
  const upiOk = DEMO || !!BUSINESS.upiId;
  if (H.pay === "upi" && !upiOk) H.pay = "cash";
  const fare = estimateFare(H.vehicle, H.km, fares);
  el.innerHTML = `
    <div class="vehs">${Object.keys(VEHICLES).map((v) => `
      <button class="veh ${H.vehicle === v ? "sel" : ""}" data-v="${v}">
        <span class="em">${VEHICLES[v].emoji}</span><b>${t(v)}</b>
        <small>${estimateMinutes(v, H.km)} ${t("min")} · ${H.km} km</small>
        <strong>${money(estimateFare(v, H.km, fares))}</strong>
      </button>`).join("")}</div>
    <div class="pay">
      <button data-p="cash" class="${H.pay === "cash" ? "sel" : ""}">💵 ${t("cash")}</button>
      ${upiOk ? `<button data-p="upi" class="${H.pay === "upi" ? "sel" : ""}">📱 ${t("upi")}</button>` : ""}
    </div>
    <button class="btn" id="book">${t("book")} ${t(H.vehicle)} · ${money(fare)}</button>`;
  el.onclick = async (e) => {
    const v = e.target.closest("[data-v]"), p = e.target.closest("[data-p]");
    if (v) { H.vehicle = v.dataset.v; renderOptions(); }
    else if (p) { H.pay = p.dataset.p; renderOptions(); }
    else if (e.target.id === "book") await book(e.target);
  };
}

async function book(btn) {
  btn.disabled = true;
  try {
    const id = await be.createRide({
      customerId: user.uid, customerPhone: user.phone || "",
      vehicleType: H.vehicle, pickup: H.pickup, drop: H.drop,
      distanceKm: H.km, fare: estimateFare(H.vehicle, H.km, fares), paymentMethod: H.pay,
    });
    currentRideId = id;
    H.drop = null; H.km = 0;
    go("ride");
  } catch (e) { toast(e.message); btn.disabled = false; }
}

/* ------------------------------------------------------------------ ride */
const STEPS = ["searching", "accepted", "arrived", "started", "completed"];

function renderRide() {
  const r = rides.find((x) => x.id === currentRideId);
  if (!r) { app.innerHTML = `<div class="splash small">${t("searching")}</div>`; return; }
  const sig = [r.id, r.status, r.driver?.name].join("|");
  if (sig === lastSig) return;
  lastSig = sig;

  const idx = STEPS.indexOf(r.status);
  const progress = r.status === "cancelled" ? "" :
    `<div class="steps">${STEPS.map((s, i) => `<i class="${i <= idx ? "on" : ""}"></i>`).join("")}</div>`;
  const driver = r.driver ? `
    <div class="card"><small class="muted">${t("driver")}</small>
      <div class="drv"><div><b>${esc(r.driver.name)}</b><br><span class="plate">${esc(r.driver.vehicleNo)}</span></div>
      <a class="btn small" href="tel:${esc(r.driver.phone)}">📞 ${t("call_driver")}</a></div></div>` : "";
  const otp = ["accepted", "arrived"].includes(r.status) ? `
    <div class="card otpbox"><small class="muted">${t("share_otp")}</small><div class="bigotp">${esc(r.otp)}</div></div>` : "";

  let pay = "";
  const upiId = BUSINESS.upiId || (DEMO ? "demo@upi" : "");
  if (r.status === "completed") {
    pay = r.paymentMethod === "upi" && upiId
      ? `<div class="card center"><h3>${money(r.fare)}</h3>
          <a class="btn" href="${esc(upiLink({ upiId, name: BUSINESS.upiName, amount: r.fare, note: "Ride " + r.id.slice(-5) }))}">${t("pay_upi")}</a>
          <p class="muted small">${t("scan_qr")}</p><canvas id="qr"></canvas></div>`
      : `<div class="card center"><h3>${money(r.fare)}</h3><p>${t("pay_cash")}</p></div>`;
  }
  const canCancel = ["searching", "accepted", "arrived"].includes(r.status);
  const finished = ["completed", "cancelled"].includes(r.status);

  app.innerHTML = `
  <div class="page">
    <div class="status s-${r.status}"><h2>${t(r.status)}</h2>${progress}</div>
    ${driver}${otp}
    <div class="card">
      <div class="route"><span class="dot g"></span>${esc(r.pickup.address)}</div>
      <div class="route"><span class="dot r"></span>${esc(r.drop.address)}</div>
      <div class="meta"><span>${VEHICLES[r.vehicleType].emoji} ${t(r.vehicleType)} · ${r.distanceKm} km</span>
      <span>${t("fare")}: <b>${money(r.fare)}</b> · ${r.paymentMethod === "upi" ? t("upi") : t("cash")}</span></div>
    </div>
    ${pay}
    ${canCancel ? `<button class="btn ghost" id="cancel">${t("cancel")}</button>` : ""}
    ${finished ? `<button class="btn" id="done">${r.status === "completed" ? t("done") : t("back_home")}</button>` : ""}
  </div>`;

  const qr = $("#qr");
  if (qr && window.QRCode) {
    QRCode.toCanvas(qr, upiLink({ upiId, name: BUSINESS.upiName, amount: r.fare, note: "Ride " + r.id.slice(-5) }), { width: 200, margin: 1 });
  }
  if ($("#cancel")) $("#cancel").onclick = async () => {
    if (!confirm(t("confirm_cancel"))) return;
    try { await be.cancelRide(r.id); } catch (e) { toast(e.message); }
  };
  if ($("#done")) $("#done").onclick = () => { currentRideId = null; go("home"); };
}

/* -------------------------------------------------------------- bookings */
function renderBookings() {
  const sig = rides.map((r) => r.id + r.status).join();
  if (sig === lastSig) return;
  lastSig = sig;
  const fmt = (ms) => new Date(ms).toLocaleString(lang === "ta" ? "ta-IN" : "en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  app.innerHTML = `
  <div class="page">
    <div class="top"><button class="link" id="back">←</button><b>${t("bookings")}</b></div>
    ${rides.length ? rides.map((r) => `
      <button class="card ride-item" data-id="${esc(r.id)}">
        <div class="row"><span>${fmt(r.createdMs)}</span><span class="badge b-${r.status}">${t(r.status)}</span></div>
        <div class="route"><span class="dot g"></span>${esc(r.pickup.address)}</div>
        <div class="route"><span class="dot r"></span>${esc(r.drop.address)}</div>
        <div class="row"><span>${VEHICLES[r.vehicleType].emoji} ${t(r.vehicleType)} · ${r.distanceKm} km</span><b>${money(r.fare)}</b></div>
      </button>`).join("") : `<p class="muted center">${t("no_rides")}</p>`}
  </div>`;
  $("#back").onclick = () => go("home");
  app.onclick = (e) => {
    const b = e.target.closest(".ride-item");
    if (b && view === "bookings") { currentRideId = b.dataset.id; go("ride"); }
  };
}

/* --------------------------------------------------------------- profile */
async function renderProfile() {
  const p = (await be.getProfile(user.uid)) || {};
  app.innerHTML = `
  <div class="page">
    <div class="top"><button class="link" id="back">←</button><b>${t("profile")}</b></div>
    <div class="card form">
      <label>${t("name")}</label><input id="pn" value="${esc(p.name || "")}">
      <label>${t("em_name")}</label><input id="en" value="${esc(p.emName || "")}">
      <label>${t("em_phone")}</label><input id="ep" type="tel" inputmode="numeric" maxlength="10" value="${esc(p.emPhone || "")}">
      <button class="btn" id="save">${t("save")}</button>
      ${p.emPhone ? `<a class="btn ghost" href="tel:${esc(p.emPhone)}">🆘 ${t("call_em")}</a>` : ""}
    </div>
  </div>`;
  $("#back").onclick = () => go("home");
  $("#save").onclick = async () => {
    try {
      await be.saveProfile(user.uid, { name: $("#pn").value.trim(), emName: $("#en").value.trim(), emPhone: $("#ep").value.trim() });
      toast(t("saved"));
      renderProfile();
    } catch (e) { toast(e.message); }
  };
}

boot();
