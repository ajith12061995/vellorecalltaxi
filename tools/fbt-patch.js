#!/usr/bin/env node
/* Vellore Taxi — make `firebase deploy` of Firestore-trigger functions reliable in Cloud Shell.
 *
 * firebase-tools 13.35.1 asks the Firestore Admin API for the database location once PER Firestore-trigger
 * function, all at the same moment (deploy/functions/services/firestore.js caches the answer only after the first
 * reply, so 7 trigger functions = 7 parallel requests) — even when `--only` names other functions. In Cloud Shell
 * that lookup kept failing ("There was an error retrieving the Firestore database") and stopped every functions deploy.
 *
 * This replaces that one file in a PRIVATE copy of firebase-tools (never the global one):
 *   - the location found by `gcloud firestore databases describe` is passed in VCT_FIRESTORE_LOCATION /
 *     VCT_FIRESTORE_PROJECT and used directly for the (default) database of that project — no request at all;
 *   - anything else still asks the API, but once (the promise is cached), not once per function.
 * The region check itself ("a firestore trigger location must match the database region") is unchanged.
 *
 * It refuses to touch any other firebase-tools version or a file that is not byte-identical to the one reviewed.
 *   node tools/fbt-patch.js <dir with node_modules/firebase-tools>     patch + self-test
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const VERSION = '13.35.1';
const ORIG_SHA = '73dceaaff72cf923bc6680af7e4e2c9ded2322555dd812c51eb3f11647c509ce';
const MARK = '/* vct-patched */';
const PATCHED = `"use strict";
${MARK}
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureFirestoreTriggerRegion = void 0;
const firestore = require("../../../gcp/firestore");
const error_1 = require("../../../error");
const dbCache = new Map();
function getDatabase(project, databaseId) {
    const key = \`\${project}/\${databaseId}\`;
    if (!dbCache.has(key)) {
        const known = process.env.VCT_FIRESTORE_LOCATION;
        const use = known && databaseId === "(default)" && project === process.env.VCT_FIRESTORE_PROJECT;
        dbCache.set(key, use ? Promise.resolve({ locationId: known }) : firestore.getDatabase(project, databaseId, false));
    }
    return dbCache.get(key);
}
async function ensureFirestoreTriggerRegion(endpoint) {
    var _a;
    const db = await getDatabase(endpoint.project, ((_a = endpoint.eventTrigger.eventFilters) === null || _a === void 0 ? void 0 : _a.database) || "(default)");
    const dbRegion = db.locationId;
    if (!endpoint.eventTrigger.region) {
        endpoint.eventTrigger.region = dbRegion;
    }
    if (endpoint.eventTrigger.region !== dbRegion) {
        throw new error_1.FirebaseError("A firestore trigger location must match the firestore database region.");
    }
}
exports.ensureFirestoreTriggerRegion = ensureFirestoreTriggerRegion;
`;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const die = m => { console.error('fbt-patch: ' + m); process.exit(1); };

const root = path.join(path.resolve(process.argv[2] || die('usage: node tools/fbt-patch.js <dir>')), 'node_modules', 'firebase-tools');
if (!fs.existsSync(path.join(root, 'package.json'))) die('firebase-tools is not installed in ' + root);
const ver = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (ver !== VERSION) die(`firebase-tools ${ver} found, only ${VERSION} was reviewed — not patched`);
const file = path.join(root, 'lib', 'deploy', 'functions', 'services', 'firestore.js');
const cur = fs.readFileSync(file, 'utf8');
if (cur === PATCHED) console.log('fbt-patch: already patched');
else if (sha(cur) !== ORIG_SHA) die('services/firestore.js is not the reviewed file — not patched');
else { fs.writeFileSync(file, PATCHED); console.log('fbt-patch: patched firebase-tools ' + ver); }

/* self-test against the real patched file, with the network lookup replaced by a counter */
(async () => {
  const assert = require('assert');
  const gcp = require(path.join(root, 'lib', 'gcp', 'firestore.js'));
  let calls = 0, mode = 'fail';
  gcp.getDatabase = async () => { calls++; if (mode === 'fail') throw new Error('lookup must not be called'); return { locationId: 'asia-south1' }; };
  const load = () => { delete require.cache[require.resolve(file)]; return require(file).ensureFirestoreTriggerRegion; };
  const ep = (project, region, database) => ({ project, eventTrigger: { region, eventFilters: database ? { database } : {} } });

  process.env.VCT_FIRESTORE_LOCATION = 'asia-south1'; process.env.VCT_FIRESTORE_PROJECT = 'p1';
  let f = load(); const eps = Array.from({ length: 7 }, () => ep('p1'));
  await Promise.all(eps.map(f));
  assert.strictEqual(calls, 0); assert.ok(eps.every(e => e.eventTrigger.region === 'asia-south1'));
  await f(ep('p1', 'asia-south1'));                                        // explicit matching region: fine
  await assert.rejects(f(ep('p1', 'us-central1')), /must match/);          // wrong region still refused
  assert.strictEqual(calls, 0);

  mode = 'ok';                                                             // other project / named database → API, once
  f = load(); await Promise.all([ep('p2'), ep('p2'), ep('p2')].map(f)); assert.strictEqual(calls, 1);
  await Promise.all([ep('p1', undefined, 'other'), ep('p1', undefined, 'other')].map(f)); assert.strictEqual(calls, 2);

  delete process.env.VCT_FIRESTORE_LOCATION;                               // without the variables: API, once for 7
  calls = 0; f = load(); await Promise.all(Array.from({ length: 7 }, () => ep('p1')).map(f)); assert.strictEqual(calls, 1);
  console.log('fbt-patch: self-test ok (7/7)');
})().catch(e => die('SELF-TEST FAILED — ' + e.message));
