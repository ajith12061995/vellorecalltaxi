# WhatsApp message templates (Meta → WhatsApp Manager → Message templates)

Category: **Utility** for all. Each name is created twice: language **Tamil (ta)** and **English (en)**.
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

## vct_driver_assigned_pin — 1 name · 2 driver · 3 car + plate · 4 ride PIN · 5 booking no.
**ta**
```
வணக்கம் {{1}}, உங்க ride-க்கு driver ரெடி.
Driver: {{2}}
வண்டி: {{3}}
Ride PIN: {{4}}
Booking எண்: {{5}}
பயணம் ஆரம்பிக்கும்போது மட்டும் PIN-ஐ driver-கிட்ட சொல்லுங்க.
```
**en**
```
Hello {{1}}, your driver is on the way.
Driver: {{2}}
Vehicle: {{3}}
Ride PIN: {{4}}
Booking no.: {{5}}
Tell the PIN to the driver only when the trip starts.
```
Samples: Priya · Suresh P · Swift · TN 23 CA 2108 · 4821 · AB12CD

## vct_driver_assigned — same without the PIN (office phone bookings) — 1 name · 2 driver · 3 car + plate · 4 booking no.
**ta**
```
வணக்கம் {{1}}, உங்க ride-க்கு driver ரெடி.
Driver: {{2}}
வண்டி: {{3}}
Booking எண்: {{4}}
Driver சீக்கிரம் உங்களை அழைப்பார்.
```
**en**
```
Hello {{1}}, your driver is on the way.
Driver: {{2}}
Vehicle: {{3}}
Booking no.: {{4}}
The driver will call you shortly.
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

## Cost (Meta, India, per delivered template — check the current rate card before going live)
Utility messages are charged per message; a reply from the customer opens a free 24-hour window for utility templates.
Message types can be turned off one by one in Office → Settings → WhatsApp to save cost (e.g. "trip started").
