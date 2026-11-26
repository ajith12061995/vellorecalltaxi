#!/usr/bin/env python3
"""Builds the search landing pages under /taxi/ (one folder per page) and the sitemap.
Run: python3 tools/seo_pages.py   (tests/unit/seopages.test.js checks the files are in sync with this script)
Prices are never written here: the fare tables are filled in the browser from the same prices as the apps (taxi/seo.js).
Distances are approximate road distances and are always shown as "about"."""
import json, os, html
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://velloretaxi.app'
GUARD = '<script>/* anti-clickjacking (same guard as the apps) */if(window.top!==window.self&&!/^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)){document.documentElement.style.display="none";try{window.top.location=window.self.location.href}catch(e){}}</script>'
STEPS = ['Open velloretaxi.app on your phone. Nothing to install.', 'Choose your pickup and drop. The fare for every vehicle is shown before you book.', 'Confirm with an OTP on your mobile number. You get the driver’s name and vehicle number when a driver accepts.']
PAGES = [
 dict(slug='katpadi-railway-station-taxi', h1='Taxi from Katpadi Railway Station', title='Katpadi Railway Station Taxi & Auto | Vellore Taxi',
  desc='Book a taxi or auto from Katpadi Junction railway station to CMC, VIT, Vellore town and outstation. See the fare before you book. Call 93446 40416.',
  lead='Arriving at Katpadi Junction? Book an auto or a car to CMC Hospital, VIT, the New Bus Stand or anywhere in Vellore, and know the fare before you get in.',
  ta='காட்பாடி ரயில் நிலையத்திலிருந்து ஆட்டோ, டாக்ஸி. விலை முன்னாடியே தெரியும்.',
  img=('katpadi', 'Katpadi Junction railway station'), kind='local', km=7, kmnote='Katpadi Junction to CMC Hospital (town campus) is about 7 km by road.',
  body=['Katpadi Junction is the main railway station for Vellore. Most passengers go on to CMC Hospital, VIT, Sripuram Golden Temple or the bus stands.',
        'With Vellore Taxi the fare is fixed by distance and shown in the app before you confirm, so there is nothing to negotiate at the station.'],
  faq=[('How much is a taxi from Katpadi station to CMC Hospital?', 'The trip is about 7 km. The table on this page shows today’s fare for each vehicle for that distance. Your exact fare is shown in the app before you book.'),
       ('Can I book before my train arrives?', 'Yes. Choose a pickup time in the app and schedule the ride, or book when you are near Katpadi.'),
       ('Do you have autos at Katpadi?', 'Yes. Autos run on the Tamil Nadu Government fare: ₹50 for the first 1.8 km and ₹25 for each km after that.')]),
 dict(slug='cmc-hospital-vellore-taxi', h1='Taxi to and from CMC Hospital, Vellore', title='CMC Hospital Vellore Taxi & Auto | Vellore Taxi',
  desc='Taxi and auto for CMC Hospital Vellore: from Katpadi station, lodges and bus stands, and back. Fare shown before booking. Call 93446 40416.',
  lead='Patients and families visiting Christian Medical College Hospital can book an auto or a car to the hospital and back, with the fare shown first.',
  ta='CMC மருத்துவமனைக்கு ஆட்டோ, டாக்ஸி. விலை முன்னாடியே தெரியும்.',
  img=('cmc', 'CMC Hospital, Vellore'), kind='local', km=7, kmnote='Katpadi Junction to CMC Hospital (town campus) is about 7 km by road.',
  body=['Many visitors to CMC come from other states and do not know local rates. The app shows the fare for each vehicle before you book, in English or Tamil.',
        'For a day of appointments you can also take an hourly rental, where one vehicle and driver stay with you.'],
  faq=[('How do I get from Katpadi railway station to CMC?', 'Book an auto or a car in the app from Katpadi Junction to CMC Hospital. The trip is about 7 km.'),
       ('Can someone else book for a patient?', 'Yes. When you book, choose “someone else” and enter the passenger’s name and number.'),
       ('Can the driver wait while we are at the hospital?', 'For long visits use Rental in the app: the vehicle waits and you pay by the hours and km in the package.')]),
 dict(slug='vit-vellore-taxi', h1='Taxi for VIT Vellore', title='VIT Vellore Taxi & Auto Booking | Vellore Taxi',
  desc='Taxi and auto for VIT Vellore students and parents: Katpadi station, Vellore town, Chennai Airport and Bengaluru. Fare shown before booking.',
  lead='For VIT students, parents and visitors: short rides to Katpadi station and Vellore town, and outstation trips to Chennai Airport or Bengaluru.',
  ta='VIT மாணவர்கள், பெற்றோருக்கு ஆட்டோ, டாக்ஸி. விலை முன்னாடியே தெரியும்.',
  img=('vit', 'VIT Vellore campus'), kind='local', km=3, kmnote='VIT main gate to Katpadi Junction is about 3 km by road.',
  body=['VIT is in Katpadi, a short ride from the railway station. Autos follow the Government fare, and cars are priced by distance.',
        'Going home for the holidays? Share one car to Chennai Airport or Bengaluru with friends; the outstation fare is for the whole vehicle, not per person.'],
  faq=[('How much is an auto from VIT to Katpadi station?', 'It is about 3 km. Autos charge the Tamil Nadu Government fare: ₹50 for the first 1.8 km, then ₹25 per km.'),
       ('Do you go from VIT to Chennai Airport?', 'Yes. See the Vellore to Chennai Airport page for today’s one-way fare for each vehicle.'),
       ('Can I pay by UPI?', 'Yes. You can pay the driver by cash or UPI at the end of the trip.')],
  more=['vellore-to-chennai-airport-taxi', 'vellore-to-bangalore-taxi']),
 dict(slug='vellore-auto-booking', h1='Auto booking in Vellore', title='Auto Booking in Vellore – Govt Fare | Vellore Taxi',
  desc='Book an auto in Vellore and Katpadi online at the Tamil Nadu Government fare: ₹50 for the first 1.8 km, ₹25 per km after. No bargaining.',
  lead='Book an auto from your phone at the Tamil Nadu Government fare. The amount is calculated by distance and shown before you book.',
  ta='வேலூர், காட்பாடியில் ஆட்டோ booking. தமிழ்நாடு அரசு கட்டணம்.',
  img=None, kind='local', km=5, only='auto', kmnote='Example: a 5 km auto ride.',
  body=['Autos on Vellore Taxi charge the Tamil Nadu Government revised fare: ₹50 for the first 1.8 km and ₹25 for every km after that. Between 10 pm and 5 am the Government night rate applies.',
        'Autos are available for trips in and around Vellore town and Katpadi. For longer trips the app offers a car.'],
  faq=[('What is the auto fare in Vellore?', '₹50 for the first 1.8 km, then ₹25 a km, as set by the Tamil Nadu Government. Night rate applies from 10 pm to 5 am.'),
       ('Is there a waiting charge?', 'The Government fare includes a waiting charge of ₹1 per minute.'),
       ('How many people can travel in an auto?', 'Three passengers.')]),
 dict(slug='vellore-to-chennai-airport-taxi', h1='Vellore to Chennai Airport taxi', title='Vellore to Chennai Airport Taxi Fare | Vellore Taxi',
  desc='One-way and round-trip taxi from Vellore and Katpadi to Chennai Airport. Today’s fare for Mini, Sedan, Ertiga, Innova and Tempo Traveller.',
  lead='One-way drop from Vellore, Katpadi or VIT to Chennai Airport. You pay for the trip one way; the fare for each vehicle is below.',
  ta='வேலூர் → சென்னை விமான நிலையம் டாக்ஸி. ஒரு வழி கட்டணம்.',
  img=None, kind='out', km=124, kmnote='Vellore to Chennai Airport is about 124 km by road.',
  body=['The fare covers the distance and the driver’s allowance. Tolls, parking and any state permit are extra and are paid as they come.',
        'Book a day ahead for early-morning flights so a vehicle can be arranged in time.'],
  faq=[('How far is Chennai Airport from Vellore?', 'About 124 km by road.'),
       ('Is the fare one way or return?', 'You can book either. The table shows the one-way fare and the same-day round-trip fare.'),
       ('What is extra?', 'Tolls, airport parking and state permits, if any.')]),
 dict(slug='vellore-to-bangalore-taxi', h1='Vellore to Bangalore taxi', title='Vellore to Bangalore Taxi Fare | Vellore Taxi',
  desc='One-way and round-trip taxi from Vellore to Bangalore. Today’s fare for Mini, Sedan, Ertiga, Innova and Tempo Traveller. Call 93446 40416.',
  lead='One-way and round-trip cars from Vellore and Katpadi to Bengaluru, priced for the whole vehicle.',
  ta='வேலூர் → பெங்களூரு டாக்ஸி. ஒரு வழி, இரு வழி கட்டணம்.',
  img=None, kind='out', km=215, kmnote='Vellore to Bengaluru is about 215 km by road. The fare changes with your exact drop point in the city.',
  body=['The fare covers the distance and the driver’s allowance. Tolls, parking and the Karnataka state permit are extra.',
        'Enter your exact pickup and drop in the app to get the fare for your trip.'],
  faq=[('How far is Bangalore from Vellore?', 'About 215 km by road, depending on where in Bengaluru you are going.'),
       ('Is the state permit included?', 'No. Tolls, parking and the state permit are paid extra as they come.'),
       ('Can I book a Tempo Traveller?', 'Yes. A 12-seat Tempo Traveller is available for outstation trips.')]),
 dict(slug='vellore-to-tirupati-taxi', h1='Vellore to Tirupati taxi', title='Vellore to Tirupati Taxi Fare | Vellore Taxi',
  desc='Taxi from Vellore to Tirupati and back. Today’s fare for Mini, Sedan, Ertiga, Innova and Tempo Traveller. See the fare before you book.',
  lead='Cars and Tempo Travellers from Vellore and Katpadi to Tirupati, for families and groups.',
  ta='வேலூர் → திருப்பதி டாக்ஸி. குடும்பத்துக்கு கார், Tempo Traveller.',
  img=None, kind='out', km=110, kmnote='Vellore to Tirupati is about 110 km by road.',
  body=['The fare covers the distance and the driver’s allowance. Tolls, parking and the Andhra Pradesh state permit are extra.',
        'If you plan to stay overnight, choose your return date in the app so the fare is worked out for the right number of days.'],
  faq=[('How far is Tirupati from Vellore?', 'About 110 km by road.'),
       ('Can we return the same day?', 'Yes. The table shows the same-day round-trip fare. For an overnight stay, pick the return date in the app.'),
       ('What is extra?', 'Tolls, parking and the state permit.')]),
]
NAME = {p['slug']: p['h1'] for p in PAGES}
e = lambda s: html.escape(s, quote=True)

def page(p):
    url = f"{SITE}/taxi/{p['slug']}/"
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "TaxiService", "name": "Vellore Taxi", "alternateName": ["Vellore Call Taxi", "வேலூர் டாக்ஸி"], "url": url, "telephone": "+91-93446-40416",
         "areaServed": [{"@type": "City", "name": "Vellore"}, {"@type": "Place", "name": "Katpadi"}],
         "provider": {"@type": "LocalBusiness", "name": "Vellore Call Taxi", "telephone": "+91-93446-40416", "image": SITE + "/brand/logo-main.png",
                      "address": {"@type": "PostalAddress", "addressLocality": "Vellore", "addressRegion": "Tamil Nadu", "addressCountry": "IN"}}},
        {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Vellore Taxi", "item": SITE + "/vellore/"}, {"@type": "ListItem", "position": 2, "name": p['h1'], "item": url}]},
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in p['faq']]}]}
    img = ''
    if p.get('img'):
        img = f'<img class="photo" src="/places/{p["img"][0]}.webp" alt="{e(p["img"][1])}" width="1200" height="675" loading="lazy"><p class="credit">Photo: Wikimedia Commons</p>'
    others = [s for s in (p.get('more') or []) if s != p['slug']] + [q['slug'] for q in PAGES if q['slug'] != p['slug'] and q['slug'] not in (p.get('more') or [])]
    fares_head = 'Today’s fares' if p['kind'] == 'local' else 'Today’s fare for this trip'
    only = f' data-only="{p["only"]}"' if p.get('only') else ''
    return f'''<!doctype html>
<html lang="en">
<head>{GUARD}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(p['title'])}</title>
<meta name="description" content="{e(p['desc'])}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#0B4A36">
<meta property="og:type" content="website"><meta property="og:site_name" content="Vellore Taxi"><meta property="og:url" content="{url}">
<meta property="og:title" content="{e(p['h1'])} | Vellore Taxi"><meta property="og:description" content="{e(p['desc'])}"><meta property="og:image" content="{SITE}/brand/logo-main.png">
<link rel="icon" type="image/png" href="/icon-192.png?v=9">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anek+Tamil:wdth,wght@75..100,600..800&family=Hind+Madurai:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/taxi/seo.css">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body>
<header class="top"><div class="wrap"><a class="logo" href="/vellore/"><img src="/icon-192.png?v=9" alt="" width="38" height="38">Vellore Taxi</a><a class="btn y" href="/?utm_source=seo">Book now</a></div></header>
<div class="hero"><div class="wrap">
  <p class="crumb"><a href="/vellore/">Vellore Taxi</a> / {e(p['h1'])}</p>
  <h1>{e(p['h1'])}</h1>
  <p class="lead">{e(p['lead'])}</p>
  <p class="tamil" lang="ta">{e(p['ta'])}</p>
  <div class="cta"><a class="btn y" href="/?utm_source=seo">Book in the app</a><a class="btn o" href="tel:+919344640416">Call 93446 40416</a></div>
</div></div>
<main>
<section><div class="wrap">
  <h2>{fares_head}</h2>
  <p>{e(p['kmnote'])}</p>
  <table class="fares" data-fares="{p['kind']}" data-km="{p['km']}"{only}><tbody><tr><td>Open the app to see today’s fare for your trip.</td></tr></tbody></table>
  <p class="note">{'Fares are by distance; tolls and parking are extra. A night charge applies late at night.' if p['kind'] == 'local' else 'Includes the distance charge and driver allowance. Tolls, parking and state permits are extra.'} The exact fare for your pickup and drop is shown in the app before you book.</p>
</div></section>
<section><div class="wrap">
  <h2>About this trip</h2>
  {''.join(f'<p>{e(b)}</p>' for b in p['body'])}
  {img}
</div></section>
<section><div class="wrap">
  <h2>How to book</h2>
  <ol class="steps">{''.join(f'<li>{e(s)}</li>' for s in STEPS)}</ol>
</div></section>
<section><div class="wrap">
  <h2>Questions</h2>
  {''.join(f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in p['faq'])}
</div></section>
<section><div class="wrap">
  <h2>More from Vellore Taxi</h2>
  <ul class="links">{''.join(f'<li><a href="/taxi/{s}/">{e(NAME[s])}</a></li>' for s in others)}<li><a href="/vellore/">All services and fares</a></li></ul>
</div></section>
</main>
<footer><div class="wrap"><p><b>Vellore Taxi</b> · Vellore and Katpadi, Tamil Nadu</p><p>Booking: <a href="tel:+919344640416">93446 40416</a> · <a href="/vellore/">velloretaxi.app</a> · <a href="/privacy/">Privacy</a></p></div></footer>
<script src="/core/fare.js"></script>
<script src="/vellore/quote.js"></script>
<script src="/taxi/seo.js"></script>
<script type="module" src="/vellore/site-data.js"></script>
</body>
</html>
'''

def sitemap():
    rows = [(f'{SITE}/vellore/', 'weekly', '1.0'), (f'{SITE}/', 'monthly', '0.8')] + [(f"{SITE}/taxi/{p['slug']}/", 'weekly', '0.9') for p in PAGES] + [(f'{SITE}/privacy/', 'yearly', '0.3')]
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemaps/0.9">\n'.replace('sitemaps/0.9', 'sitemap/0.9') + ''.join(f'  <url><loc>{u}</loc><changefreq>{c}</changefreq><priority>{pr}</priority></url>\n' for u, c, pr in rows) + '</urlset>\n'

def build():
    out = {f"taxi/{p['slug']}/index.html": page(p) for p in PAGES}
    out['sitemap.xml'] = sitemap()
    return out

if __name__ == '__main__':
    import sys
    files = build()
    if '--check' in sys.argv:
        bad = [f for f, c in files.items() if not os.path.exists(os.path.join(ROOT, f)) or open(os.path.join(ROOT, f), encoding='utf-8').read() != c]
        print('OUT OF SYNC: ' + ', '.join(bad) if bad else 'in sync'); sys.exit(1 if bad else 0)
    for f, c in files.items():
        os.makedirs(os.path.dirname(os.path.join(ROOT, f)) or ROOT, exist_ok=True); open(os.path.join(ROOT, f), 'w', encoding='utf-8').write(c)
    print('wrote', len(files), 'files')
