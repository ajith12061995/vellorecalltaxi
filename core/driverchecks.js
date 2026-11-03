/* VCT core · driver application: automatic checks + the driver agreement.
   Used by the join form (blocks only what a taxi business really needs) and by the office (full checklist).
   level: 'bad'  = must be fixed before sending (join form) / approving needs an owner override (office)
          'warn' = the office should look at it; does not block
          'ok'   = fine */
const VCTCHK = (() => {
  const DAY = 864e5;
  const clean = s => String(s || '').toUpperCase().replace(/[\s.-]/g, '');
  // Indian number plates: TN23AB1234, TN 23 Q 7788, 23BH1234AA (BH series)
  const plateOk = p => /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(clean(p)) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(clean(p));
  // Driving licence: 2 letters (state) + 13–14 more letters/digits, e.g. TN2320190001234 (spaces and dashes ignored)
  const dlOk = d => /^[A-Z]{2}\d{2}[A-Z0-9]{9,12}$/.test(clean(d));
  const upiOk = u => /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(String(u || '').trim());
  const REQ_PHOTOS = ['photo', 'aadhaarF', 'aadhaarB', 'dlF', 'dlB', 'rcF', 'rcB', 'ins', 'vehF'];

  // a = the application (driverApps doc shape), others = existing drivers [{id, plate, dlNo}], now = time
  function check(a, others, now) {
    now = now || Date.now(); a = a || {}; const out = [], files = a.files || [], exp = a.exp || {};
    const add = (k, level, ta, en) => out.push({ k, level, ta, en });
    // who
    (a.name || '').trim().length >= 3 ? add('name', 'ok', 'பெயர்', 'Name') : add('name', 'bad', 'பெயர் இல்லை', 'Name missing');
    dlOk(a.dlNo) ? add('dlNo', 'ok', 'உரிம எண் சரியான format', 'Licence number format OK') : add('dlNo', 'bad', 'உரிம எண் சரியா இல்லை (உதா: TN23 20190001234)', 'Licence number looks wrong (e.g. TN23 20190001234)');
    /^\+?9?1?[6-9]\d{9}$/.test(String(a.ecPhone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')) && String(a.ecPhone || '').replace(/\D/g, '').slice(-10) !== String(a.phone || '').replace(/\D/g, '').slice(-10)
      ? add('ec', 'ok', 'அவசர தொடர்பு', 'Emergency contact') : add('ec', 'bad', 'அவசர தொடர்பு (வேற ஒருத்தர் நம்பர்) வேணும்', 'An emergency contact (someone else\'s number) is needed');
    // vehicle
    plateOk(a.plate) ? add('plate', 'ok', 'வண்டி எண் format', 'Number plate format OK') : add('plate', 'bad', 'வண்டி எண் சரியா இல்லை (உதா: TN 23 AB 1234)', 'Number plate looks wrong (e.g. TN 23 AB 1234)');
    const age = a.year ? new Date(now).getFullYear() - +a.year : null;
    age == null ? add('year', 'bad', 'தயாரிப்பு வருஷம் இல்லை', 'Year of manufacture missing')
      : age > 12 ? add('year', 'warn', `வண்டி ${age} வருஷம் பழசு — நேர்ல பாருங்க`, `Vehicle is ${age} years old — inspect it`)
      : add('year', 'ok', `வண்டி ${age} வருஷம்`, `Vehicle ${age} years old`);
    if (a.ownVehicle === false) add('own', 'warn', 'சொந்த வண்டி இல்லை — வண்டி owner ஒப்புதல் வாங்குங்க', 'Not their own vehicle — get the owner\'s consent');
    // documents
    const missing = REQ_PHOTOS.filter(k => !files.includes(k));
    missing.length ? add('photos', 'bad', `Photo இல்லை: ${missing.length}`, `Photos missing: ${missing.length}`) : add('photos', 'ok', 'கட்டாய photo எல்லாம் இருக்கு', 'All required photos present');
    [['dl', 'DL', 'Licence', true], ['ins', 'Insurance', 'Insurance', true], ['permit', 'Permit', 'Permit', false], ['fc', 'FC', 'FC', false]].forEach(([k, ta, en, req]) => {
      const t = +exp[k] || 0;
      if (!t) add('x_' + k, req ? 'bad' : 'warn', `${ta} காலாவதி தேதி இல்லை`, `${en} expiry date missing`);
      else if (t < now) add('x_' + k, 'bad', `${ta} காலாவதி ஆயிடுச்சு`, `${en} has expired`);
      else if (t - now < 30 * DAY) add('x_' + k, 'warn', `${ta} ${Math.ceil((t - now) / DAY)} நாள்ல முடியுது`, `${en} ends in ${Math.ceil((t - now) / DAY)} days`);
      else add('x_' + k, 'ok', `${ta} செல்லுபடி`, `${en} valid`);
    });
    if (!files.includes('permit') || !files.includes('fc')) add('pf', 'warn', 'Permit / FC photo இல்லை (வணிக வண்டிக்கு வேணும்)', 'Permit / FC photo missing (needed for commercial vehicles)');
    files.includes('pcc') ? add('pcc', 'ok', 'Police verification இருக்கு', 'Police verification provided') : add('pcc', 'warn', 'Police verification இன்னும் இல்லை — வாங்குங்க', 'No police verification yet — collect it');
    upiOk(a.upi) ? add('upi', 'ok', 'UPI ID', 'UPI ID') : add('upi', 'warn', 'UPI ID இல்லை / தப்பு — customer QR வராது', 'UPI ID missing or wrong — no customer QR');
    // agreement
    const c = a.consent;
    c && c.v === AGREEMENT.v && c.name && c.at ? add('consent', 'ok', `ஒப்பந்தம் கையெழுத்து: ${c.name}`, `Agreement signed: ${c.name}`)
      : add('consent', 'bad', 'Driver ஒப்பந்தம் ஏற்கப்படவில்லை', 'Driver agreement not accepted');
    // duplicates with existing drivers (office only)
    (others || []).forEach(d => {
      if (d.id === a.id) return;
      if (a.plate && d.plate && clean(d.plate) === clean(a.plate)) add('dupPlate', 'bad', `இதே வண்டி எண் ஏற்கனவே: ${d.name || d.id}`, `Same plate already used by ${d.name || d.id}`);
      if (a.dlNo && d.dlNo && clean(d.dlNo) === clean(a.dlNo)) add('dupDl', 'bad', `இதே உரிம எண் ஏற்கனவே: ${d.name || d.id}`, `Same licence already used by ${d.name || d.id}`);
    });
    const bad = out.filter(x => x.level === 'bad').length, warn = out.filter(x => x.level === 'warn').length;
    return { items: out, bad, warn, ok: !bad };
  }

  // The driver agreement (shown in the join form, signed by typing the full name; printable in the office).
  // Plain-language business terms; have a lawyer review before relying on it in a dispute.
  const AGREEMENT = {
    v: '2026-11-03',
    ta: [
      'நான் Vellore Taxi (VCT) app வழியா வரும் பயணங்களை என் சொந்த பொறுப்பில் ஓட்டும் தனி ஓட்டுநர் / வண்டி உரிமையாளர். VCT ஒரு booking தளம் மட்டுமே.',
      'என் ஓட்டுநர் உரிமம், RC, Insurance, Permit, FC எப்போதும் செல்லுபடியாக இருக்கும். காலாவதி ஆனால் புதுப்பிக்கும் வரை ride எடுக்க மாட்டேன்; புது copy-ஐ உடனே office-க்கு அனுப்புவேன்.',
      'மது / போதைப்பொருள் அருந்தி வண்டி ஓட்ட மாட்டேன். வேக வரம்பு, போக்குவரத்து விதிகள், seat belt, helmet விதிகளை பின்பற்றுவேன். ஓட்டும்போது phone பேச மாட்டேன்.',
      'பயணியிடம் (குறிப்பாக பெண்கள், குழந்தைகள், முதியோர்) மரியாதையாக நடப்பேன். தகாத பேச்சு, தொடுதல், மிரட்டல், கூடுதல் பணம் கேட்பது, வழி மாற்றுவது செய்ய மாட்டேன்.',
      'Customer-ன் phone நம்பர், முகவரி, பயண விவரங்களை அந்த பயணத்துக்கு மட்டுமே பயன்படுத்துவேன். பின்னர் அழைப்பது, message அனுப்புவது, பகிர்வது, நேரடி booking வாங்குவது செய்ய மாட்டேன்.',
      'App காட்டும் கட்டணம், toll, parking மட்டுமே வாங்குவேன். ஒவ்வொரு trip-க்கும் VCT commission என் wallet-ல் இருந்து கழிக்கப்படுவதை ஏற்கிறேன்.',
      'என் செயல்களால் ஏற்படும் விபத்து, சேதம், அபராதம், காவல் / நீதிமன்ற நடவடிக்கை, சட்டப்படியான பொறுப்பு எல்லாம் என்னுடையதும் / வண்டி உரிமையாளருடையதும் ஆகும். VCT-க்கு ஏற்படும் இழப்புக்கும் நான் பொறுப்பு.',
      'Police verification, document சரிபார்ப்பு, பின்னணி விசாரணைக்கு ஒப்புக்கொள்கிறேன். என் விவரங்களை சரிபார்ப்புக்காக VCT பயன்படுத்தலாம்.',
      'புகார், விதிமீறல், போலி document, தொடர் ரத்து இருந்தால் VCT என் account-ஐ எந்த நேரத்திலும் நிறுத்தலாம் / நீக்கலாம்.',
      'நான் கொடுத்த எல்லா விவரங்களும் documents-ம் உண்மை. இந்த ஒப்பந்தத்தை படித்து புரிந்து என் விருப்பத்தின் பேரில் ஏற்கிறேன்.'],
    en: [
      'I am an independent driver / vehicle owner who drives trips received through the Vellore Taxi (VCT) app on my own responsibility. VCT is only a booking platform.',
      'My driving licence, RC, insurance, permit and FC will always be valid. If one expires I will not take rides until it is renewed, and I will send the new copy to the office at once.',
      'I will never drive after drinking alcohol or taking drugs. I will follow speed limits, traffic rules, seat belt and helmet rules, and will not use the phone while driving.',
      'I will treat every passenger (especially women, children and the elderly) with respect. No abusive talk, touching, threats, asking for extra money or changing the route.',
      'I will use a customer\'s phone number, address and trip details only for that trip. I will not call, message, share them later or take direct bookings from them.',
      'I will collect only the fare, toll and parking shown in the app. I accept that VCT\'s commission for each trip is taken from my wallet.',
      'Accidents, damage, fines, police or court action and any legal liability caused by my actions are mine and/or the vehicle owner\'s. I am also responsible for any loss caused to VCT.',
      'I agree to police verification, document checks and background checks. VCT may use my details for these checks.',
      'VCT may suspend or remove my account at any time for complaints, rule breaking, false documents or repeated cancellations.',
      'All details and documents I gave are true. I have read and understood this agreement and accept it of my own free will.'],
  };
  // the typed signature must match the name given (works for Tamil or English letters; spaces, dots, case ignored)
  const norm = v => String(v || '').toLowerCase().replace(/[\s.,\-_]/g, '');
  const sameName = (typed, name) => norm(typed).length >= 3 && norm(typed) === norm(name);
  return { check, plateOk, dlOk, upiOk, AGREEMENT, sameName, REQ_PHOTOS };
})();
if (typeof module !== 'undefined') module.exports = VCTCHK;
