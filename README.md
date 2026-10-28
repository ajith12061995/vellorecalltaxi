# Vellore Call Taxi

A React + TypeScript call-taxi booking interface designed for customers to choose pickup and drop-off locations, select a vehicle, estimate a fare, and request a ride. The code supplied for this project includes location search, voice input, saved places, trip scheduling, and OpenStreetMap-based location features.

> **Project note:** This README is based on the source code supplied. The uploaded text does not include `package.json`, deployment configuration, backend/API server, or driver-side implementation details. Confirm those parts in the actual repository before publishing.

## Features visible in the supplied source

- **Pickup and drop-off selection** with location search.
- **Location autocomplete** using local verified location hubs and OpenStreetMap Nominatim search.
- **Tamil and English interface support** through a translation module.
- **Voice location search** in Tamil or English, using the project's speech service.
- **Map pin selection** through a map-pin picker modal.
- **OpenStreetMap navigation UI** through a navigation modal.
- **Vehicle selection** and vehicle tariff configuration.
- **Trip types** for local trips, rentals, and outstation journeys.
- **Fare calculation** through a dedicated fare utility.
- **Pickup-time estimate** through a dedicated utility.
- **Scheduled rides**, with date/time validation.
- **Cash and UPI payment selection** in the booking interface.
- **Saved places / quick places** such as Home and Work.
- **Rewards points** and points-redemption UI.
- **Notification sounds** for selected actions.
- **Rental packages**, Tamil Nadu district data, and popular transport hubs.
- **Fare prediction chart** component.

Some of these are user-interface or client-side features. Actual booking persistence, payment collection, driver dispatch, SMS/OTP, and live driver tracking require working backend services and should not be assumed to be implemented merely because the interface contains the relevant controls.

## Technology indicated by the source

- React
- TypeScript
- `lucide-react` icons
- OpenStreetMap Nominatim for location search / reverse geocoding
- Browser speech-recognition functionality through a project speech service
- Project-specific components, constants, services, and fare utilities

The exact React version, build tool, package manager, and production command should be confirmed from `package.json` and the repository configuration.

## Project structure

The supplied source refers to modules with paths similar to these:

```text
src/
├── components/
│   ├── BookingSheet
│   ├── MapPinPickerModal
│   ├── OsmNavigationModal
│   ├── FarePredictionChart
│   └── SavedPlacesModal
├── constants/
│   ├── locations
│   └── translations
├── services/
│   ├── nominatim
│   ├── speech
│   ├── storage
│   └── notifications
├── types/
│   └── taxi
└── utils/
    └── fare
```

This is an indicative structure derived from import paths in the supplied code; use the actual repository tree as the source of truth.

## Requirements

Install a current supported version of Node.js and npm. You will also need the full project repository, including its package manifest and configuration files.

## Run locally

1. Download or clone the complete repository.
2. Open a terminal in the repository's root folder.
3. Install the dependencies:

   ```bash
   npm install
   ```

4. Start the development server using the script defined by the repository. For a project whose `package.json` defines a `dev` script, run:

   ```bash
   npm run dev
   ```

5. Open the local URL printed by the terminal.

If `npm run dev` is not available, open `package.json` and use the script listed under `"scripts"`. Do not create a new package manifest blindly; preserve the existing project's framework and build configuration.

## Location search and maps

The supplied code imports `searchNominatimLocations` and `reverseGeocodeNominatim`, and refers to OpenStreetMap Nominatim.

- Test pickup and destination searches with recognizable place names.
- Check that search failures, empty results, and slow responses are handled gracefully.
- Respect the Nominatim service's usage policy and attribution requirements. Do not use public geocoding infrastructure as an unrestricted, high-volume production service.
- If the application grows, consider a suitable provider or a self-hosted geocoding service and configure request limits/caching appropriately.
- A map display, route line, or navigation modal does not by itself guarantee turn-by-turn navigation or a reliable route distance. Verify the actual routing integration separately.

## Voice search

The booking component calls a project speech service and requests Tamil (`ta`) or English (`en`) recognition based on the selected language.

To test it:

1. Open the app in a browser that supports the required speech-recognition feature.
2. Allow microphone access when prompted.
3. Select the pickup or drop-off field and activate voice search.
4. Speak a location clearly and confirm the recognized text before choosing a result.

Voice recognition availability and accuracy vary by browser, device, language, network, and permissions. Keep typed search available as a fallback.

## Fare calculation

The booking interface uses a project utility named `computeTripFare` and a pickup-time utility named `estimatePickupTime`. Vehicle tariffs and rental packages are supplied through project configuration.

Before accepting real bookings, verify and document:

- Base fare and minimum fare
- Per-kilometre rates and distance calculation
- Waiting charges, night charges, tolls, parking, and other fees
- Local-trip distance limits
- Rental package duration and kilometre limits
- Outstation day calculations and driver allowance, if applicable
- Rounding, cancellations, and refunds
- Whether the displayed fare is an estimate or a guaranteed quote

Keep fare rules consistent between the customer interface and any backend that validates bookings. Do not rely on client-side calculations alone for final billing.

## Payments

The supplied booking component offers **Cash** and **UPI** as payment-method choices. This alone does not prove that UPI payments are processed.

Before enabling online payments, integrate a legitimate payment gateway or verified payment flow, validate payment status on a trusted server, and never store UPI PINs, card details, or payment credentials in the app.

## Production deployment

Deployment steps depend on the actual build tool and hosting configuration.

1. Confirm the repository builds successfully on your computer.
2. Check `package.json` for the correct build script.
3. Run the production build, commonly `npm run build` when that script exists.
4. Deploy the generated output directory specified by the build tool to your hosting provider.
5. Configure SPA fallback/routing if the app uses client-side routes.
6. Test the published site on mobile and desktop, including location permission, microphone permission, search, scheduling, fare display, and booking confirmation.
7. Keep API credentials and private configuration out of public source files.

For Cloudflare Pages, select the correct framework/build preset, set the build command and output directory to match the repository, and deploy the complete project—not only this README or an individual component file.

## Pre-launch checklist

- [ ] The full project includes `package.json` and its lockfile.
- [ ] A clean dependency install succeeds.
- [ ] The production build completes without errors.
- [ ] Pickup and drop-off search works.
- [ ] GPS permission denial is handled clearly.
- [ ] Tamil and English labels are checked.
- [ ] Voice search has a typed-input fallback.
- [ ] Map pins and route information are verified.
- [ ] Fare calculations are tested against sample journeys.
- [ ] Scheduled rides reject past or too-soon times.
- [ ] Saved places persist as expected.
- [ ] Booking requests reach a real backend, if bookings are intended to be operational.
- [ ] Payment status is verified securely, if online payments are enabled.
- [ ] Privacy policy, terms, cancellation policy, and contact/support details are published.
- [ ] OpenStreetMap/Nominatim attribution and service usage requirements are followed.
- [ ] The deployed app is tested on actual mobile devices.

## Troubleshooting

**The app does not start**
- Confirm that you are in the repository root.
- Check that `package.json` exists.
- Run `npm install` and review the first error shown.
- Use the development command defined in `package.json`.

**Location search returns no results**
- Check the internet connection and browser console.
- Try a more specific place name.
- Verify the Nominatim service module and request handling.
- Confirm that rate limits or service availability are not blocking requests.

**Voice search does not work**
- Check microphone permission and browser support.
- Use HTTPS or localhost where required by the browser.
- Try typed search instead.

**The site opens to a blank page after deployment**
- Review build logs and browser-console errors.
- Confirm that the hosting output directory matches the build tool.
- Check asset paths and SPA fallback settings.

## Contributing

1. Create a branch for your change.
2. Keep changes focused and follow the existing code style.
3. Test the affected booking, search, language, and fare flows.
4. Submit a pull request with a concise summary and test results.

## License

No license was identifiable in the supplied source text. Add a `LICENSE` file and specify the project's license before allowing reuse or redistribution.

## Support

Add the project's official support phone number, email address, and service area here before publishing this README.
