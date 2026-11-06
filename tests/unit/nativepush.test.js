// The Android apps load vct-cloud.js from velloretaxi.app: window.Capacitor is only the native bridge
// (nativePromise / addListener), no registerPlugin. This runs the real nativePushToken() code against that shape.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../../vct-cloud.js', 'utf8');
const start = src.indexOf('async nativePushToken() {'), end = src.indexOf('\n  },', start);
assert(start > 0 && end > start, 'nativePushToken() not found');
const body = src.slice(start + 'async nativePushToken() {'.length, end);
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; };
async function run(perm, regOk) {
  const calls = [];
  global.window = { Capacitor: {
    nativePromise: (p, m, o) => { calls.push(p + '.' + m); if (m === 'checkPermissions') return Promise.resolve({ receive: perm });
      if (m === 'requestPermissions') return Promise.resolve({ receive: 'granted' }); return Promise.resolve({}); },
    addListener: (p, ev, cb) => { calls.push(p + '.addListener:' + ev); if (ev === 'registration' && regOk) setTimeout(() => cb({ value: 'FCM_TOKEN_1' }), 5);
      if (ev === 'registrationError' && !regOk) setTimeout(() => cb({ error: 'x' }), 5); return { remove: async () => {} }; } } };
  const api = { nativePush: () => true };
  const fn = new Function('api', 'window', 'console', 'return (async function(){' + body + '})')(api, global.window, console);
  return { token: await fn(), calls };
}
(async () => {
  let r = await run('granted', true);
  ok(r.token === 'FCM_TOKEN_1', 'token through the bridge');
  ok(r.calls.includes('PushNotifications.createChannel'), 'rides channel created');
  ok(r.calls.indexOf('PushNotifications.addListener:registration') < r.calls.indexOf('PushNotifications.register'), 'listener before register');
  r = await run('prompt', true);
  ok(r.calls.includes('PushNotifications.requestPermissions') && r.token === 'FCM_TOKEN_1', 'asks permission when needed');
  r = await run('granted', false);
  ok(r.token === null, 'registration error → null, no crash');
  console.log(pass + ' native push tests passed');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
