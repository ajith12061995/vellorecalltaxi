# WhatsApp message templates (Meta → WhatsApp Manager → Message templates)

Category: **Utility** for all. Submitted 9 Nov 2026 to the test WhatsApp account 979987628508850; for the real account (29068467292795781, number 93446 40416) submit with `python3 tools/wa-templates.py --send` in Cloud Shell. Each name is created twice: language **Tamil (ta)** and **English (en)**.
Variables are filled by `functions/lib/wa.js` (`waMessage`) in exactly this order. Meta rule: a template body must not
start or end with a variable, so every body starts with "வணக்கம்" / "Hello" and ends with fixed text.

## vct_booking_confirmed — 1 name · 2 vehicle · 3 pickup · 4 time · 5 fare · 6 booking no.
**ta**
```
வணக்கம் {{1}}, உங்க Vellore Taxi booking உறுதியாச்சு.
வண்டி: {{2}}
Pickup: {{3}}
நேரம்: {{4}}
கட்டணம் (தோராயம்): ₹{{5}}
Booking எண்: {{6}}
Driver ஒதுக்கியதும் இங்கே தகவல் அனுப்புவோம்.
```
**en**
```
Hello {{1}}, your Vellore Taxi booking is confirmed.
Vehicle: {{2}}
Pickup: {{3}}
Time: {{4}}
Fare (approx.): ₹{{5}}
Booking no.: {{6}}
We will message you here when a driver is assigned.
```
Samples: Priya · Mini · Katpadi · 10 Nov, 9:30 AM · 450 · AB12CD

## vct_driver_assigned — 1 name · 2 driver · 3 car + plate · 4 booking no.
(No ride PIN: Meta classes a template with "PIN" as an OTP/authentication message. App customers see the PIN in the app.)
**ta**
```
வணக்கம் {{1}}, உங்க ride-க்கு driver ரெடி.
Driver: {{2}}
வண்டி: {{3}}
Booking எண்: {{4}}
தேவைப்பட்டா driver உங்களை அழைப்பார்.
```
**en**
```
Hello {{1}}, your driver is on the way.
Driver: {{2}}
Vehicle: {{3}}
Booking no.: {{4}}
The driver will call you if needed.
```

## vct_trip_started — 1 name · 2 number plate · 3 help phone
**ta**
```
வணக்கம் {{1}}, உங்க பயணம் ஆரம்பிச்சது.
வண்டி எண்: {{2}}
உதவிக்கு அழைக்க: {{3}}
பாதுகாப்பான பயணம்!
```
**en**
```
Hello {{1}}, your trip has started.
Vehicle no.: {{2}}
For help call: {{3}}
Have a safe trip!
```

## vct_trip_completed — 1 name · 2 fare · 3 booking no.
**ta**
```
வணக்கம் {{1}}, உங்க பயணம் முடிஞ்சது.
மொத்த கட்டணம்: ₹{{2}}
Booking எண்: {{3}}
Vellore Taxi-ஐ தேர்ந்தெடுத்ததுக்கு நன்றி.
```
**en**
```
Hello {{1}}, your trip is complete.
Total fare: ₹{{2}}
Booking no.: {{3}}
Thank you for riding with Vellore Taxi.
```

## vct_booking_cancelled — 1 name · 2 booking no. · 3 office phone
**ta**
```
வணக்கம் {{1}}, உங்க booking ({{2}}) cancel ஆகிவிட்டது.
மீண்டும் book பண்ண அழைக்க: {{3}}
சிரமத்திற்கு மன்னிக்கவும்.
```
**en**
```
Hello {{1}}, your booking ({{2}}) has been cancelled.
To book again, call: {{3}}
Sorry for the trouble.
```

## vct_driver_welcome — 1 driver name · 2 driver help phone
Sent to a NEW DRIVER (not a customer) once, when the office approves their app application.
**ta**
```
வணக்கம் {{1}}, உங்க Vellore Taxi driver கணக்கு approve ஆகிவிட்டது 🎉
Vellore Taxi குடும்பத்துக்கு உங்களை அன்புடன் வரவேற்கிறோம்!
Driver app-ஐ திறந்து, wallet recharge செய்து, Online போனதும் ride-கள் வரத் தொடங்கும்.
உதவிக்கு அழைக்க: {{2}}
உங்க முதல் சவாரி இனிதாக அமைய வாழ்த்துக்கள்!
```
**en**
```
Hello {{1}}, your Vellore Taxi driver account has been approved 🎉
A warm welcome to the Vellore Taxi family!
Open the driver app, recharge your wallet and go Online to start getting rides.
For help, call: {{2}}
Wishing you a great first ride!
```

## vct_owner_request — 1 staff name · 2 request · 3 booking / driver · 4 reason
Sent to the OWNER (not a customer) when an office staff member asks for approval (fare / bill change, extra km, block).
**ta**
```
வணக்கம்! Vellore Taxi Office-ல {{1}} உங்க அனுமதி கேட்டிருக்காங்க.
கோரிக்கை: {{2}}
விவரம்: {{3}}
காரணம்: {{4}}
Office app → Approvals-ல பார்த்து முடிவு பண்ணுங்க.
```
**en**
```
Hello! {{1}} at the Vellore Taxi office has asked for your approval.
Request: {{2}}
Details: {{3}}
Reason: {{4}}
Please open the Office app → Approvals to decide.
```

## Cost (Meta, India, per delivered template — check the current rate card before going live)
Utility messages are charged per message; a reply from the customer opens a free 24-hour window for utility templates.
Message types can be turned off one by one in Office → Settings → WhatsApp to save cost (e.g. "trip started").
