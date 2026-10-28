
  ArrowUpDown, 
  MapPin, 
  Search, 
  Users, 
  Clock, import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronRight, 
  Sparkles,
  PhoneCall,
  X,
  Sliders,
  Calendar,
  Compass,
  Info,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Navigation,
  Zap,
  AlertCircle,
  Bookmark,
  Star,
  Home,
  Briefcase,
  Train,
  Cross,
  Loader2,
  LocateFixed,
  Globe,
  Mic,
  MicOff,
  Map as MapIcon,
  ExternalLink
} from 'lucide-react';
import { searchNominatimLocations, reverseGeocodeNominatim } from '../services/nominatim';
import { speechService, SpeechStatus } from '../services/speech';
import { MapPinPickerModal } from './MapPinPickerModal';
import { OsmNavigationModal } from './OsmNavigationModal';
import { 
  Language, 
  LocationPoint, 
  RentalPackage, 
  TripMode, 
  VehicleTariff, 
  VehicleType,
  SavedPlace 
} from '../types/taxi';
import { 
  POPULAR_ALL_INDIA_HUBS, 
  RENTAL_PACKAGES, 
  TAMIL_NADU_DISTRICTS, 
  CATEGORY_LABELS, 
  HubCategory, 
  DetailedLocationHub, 
  VEHICLE_CONFIGS, 
  BUSINESS_CONFIG,
  LOCAL_MAX_KM 
} from '../constants/locations';
import { TRANSLATIONS } from '../constants/translations';
import { computeTripFare, estimatePickupTime } from '../utils/fare';
import { FarePredictionChart } from './FarePredictionChart';
import { SavedPlacesModal } from './SavedPlacesModal';
import { getStoredSavedPlaces, addSavedPlace } from '../services/storage';
import { playNotificationSound } from '../services/notifications';

interface BookingSheetProps {
  language: Language;
  pickup: LocationPoint | null;
  drop: LocationPoint | null;
  selectedVehicle: VehicleType;
  paymentMethod: 'cash' | 'upi';
  distanceKm: number;
  tripMode: TripMode;
  outstationDays: number;
  rentalPackageId: string;
  tariffs: Record<VehicleType, VehicleTariff>;
  userPoints: number;
  onSelectPickup: (loc: LocationPoint) => void;
  onSelectDrop: (loc: LocationPoint) => void;
  onSelectVehicle: (v: VehicleType) => void;
  onSelectPayment: (m: 'cash' | 'upi') => void;
  onSelectTripMode: (mode: TripMode) => void;
  onSelectOutstationDays: (days: number) => void;
  onSelectRentalPackage: (pkgId: string) => void;
  onConfirmBooking: (
    redemption?: { pointsRedeemed: number; discountAmount: number },
    schedule?: { isScheduled: boolean; scheduledTimeMs: number }
  ) => void;
  onSwapLocations: () => void;
  onOpenTariffModal: () => void;
  onOpenPointsModal: () => void;
  onOpenSupport: () => void;
  activeInput: 'pickup' | 'drop' | null;
  setActiveInput: (which: 'pickup' | 'drop' | null) => void;
  routeCoordinates?: [number, number][];
}

export const BookingSheet: React.FC<BookingSheetProps> = ({
  language,
  pickup,
  drop,
  selectedVehicle,
  paymentMethod,
  distanceKm,
  tripMode,
  outstationDays,
  rentalPackageId,
  tariffs,
  userPoints,
  onSelectPickup,
  onSelectDrop,
  onSelectVehicle,
  onSelectPayment,
  onSelectTripMode,
  onSelectOutstationDays,
  onSelectRentalPackage,
  onConfirmBooking,
  onSwapLocations,
  onOpenTariffModal,
  onOpenPointsModal,
  onOpenSupport,
  activeInput,
  setActiveInput,
  routeCoordinates,
}) => {
  const t = TRANSLATIONS[language];
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<HubCategory | 'all'>('all');
  const [searchResults, setSearchResults] = useState<LocationPoint[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [isDetectingGps, setIsDetectingGps] = useState<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Map Pin Picker & OSM Navigation Modal states
  const [mapPinPickerTarget, setMapPinPickerTarget] = useState<'pickup' | 'drop' | null>(null);
  const [showOsmNavModal, setShowOsmNavModal] = useState<boolean>(false);

  // Speech Recognition state
  const [voiceTarget, setVoiceTarget] = useState<'pickup' | 'drop' | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<SpeechStatus>('idle');
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);

  // Handle voice speech input
  const handleStartVoice = (target: 'pickup' | 'drop') => {
    if (voiceTarget === target && voiceStatus === 'listening') {
      speechService.stopListening();
      setVoiceTarget(null);
      setVoiceStatus('idle');
      setVoiceMessage(null);
      return;
    }

    setActiveInput(target);
    setVoiceTarget(target);
    setVoiceStatus('listening');
    setVoiceMessage(
      language === 'ta'
        ? '🎙️ கேட்கிறது... நீங்கள் செல்ல வேண்டிய இடத்தை தமிழில் அல்லது ஆங்கிலத்தில் கூறவும்...'
        : '🎙️ Listening... Speak your location in Tamil or English...'
    );

    speechService.startListening({
      language: language === 'ta' ? 'ta' : 'en',
      onResult: (spokenText) => {
        setSearchQuery(spokenText);
        setVoiceStatus('processing');
        setVoiceMessage(
          language === 'ta'
            ? `✓ "${spokenText}" கண்டறியப்பட்டது!`
            : `✓ Recognized "${spokenText}"!`
        );
        setTimeout(() => {
          setVoiceTarget(null);
          setVoiceStatus('idle');
          setVoiceMessage(null);
        }, 2200);
      },
      onError: (err) => {
        setVoiceStatus('error');
        setVoiceMessage(err);
        setTimeout(() => {
          setVoiceTarget(null);
          setVoiceStatus('idle');
          setVoiceMessage(null);
        }, 4000);
      },
      onStatusChange: (st) => {
        setVoiceStatus(st);
        if (st === 'idle') {
          setVoiceTarget(null);
        }
      },
    });
  };

  // Saved Places State
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>(() => getStoredSavedPlaces());
  const [showSavedPlacesModal, setShowSavedPlacesModal] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const handleSelectSavedPlace = (sp: SavedPlace) => {
    const loc: LocationPoint = {
      lat: sp.lat,
      lng: sp.lng,
      address: sp.address,
      shortName: sp.shortName || sp.title,
      city: sp.address.split(',')[1]?.trim() || 'Vellore',
      district: 'Vellore',
      districtTa: 'வேலூர்',
      state: 'Tamil Nadu',
      stateTa: 'தமிழ்நாடு',
    };
    if (activeInput === 'pickup') {
      onSelectPickup(loc);
      setActiveInput('drop');
      setSearchQuery('');
    } else {
      onSelectDrop(loc);
      setActiveInput(null);
      setSearchQuery('');
    }
    playNotificationSound('confirmed');
  };

  const handleSaveCurrentPoint = (loc: LocationPoint | null, defaultType: SavedPlace['type'] = 'home') => {
    if (!loc) return;
    const newSp: SavedPlace = {
      id: `sp_${Date.now()}`,
      type: defaultType,
      title: loc.shortName || (defaultType === 'home' ? 'Home' : 'Work'),
      titleTa: defaultType === 'home' ? 'வீடு' : 'வேலை',
      address: loc.address,
      shortName: loc.shortName || loc.address.split(',')[0],
      lat: loc.lat,
      lng: loc.lng,
    };
    const updated = addSavedPlace(newSp);
    setSavedPlaces(updated);
    setSavedNotice(language === 'ta' ? 'இடம் சேமிக்கப்பட்டது!' : 'Location saved to Quick Places!');
    playNotificationSound('confirmed');
    setTimeout(() => setSavedNotice(null), 3000);
  };

  // Schedule Ride Timing States
  const [bookingTiming, setBookingTiming] = useState<'now' | 'schedule'>('now');
  const [scheduleDate, setScheduleDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [scheduleTime, setScheduleTime] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 45);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const getFutureDateStr = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const getTargetScheduleTimestamp = (): number => {
    if (!scheduleDate || !scheduleTime) return Date.now();
    const [year, month, day] = scheduleDate.split('-').map(Number);
    const [hours, minutes] = scheduleTime.split(':').map(Number);
    const target = new Date(year, month - 1, day, hours, minutes, 0, 0);
    return target.getTime();
  };

  const scheduledTimestamp = getTargetScheduleTimestamp();
  const isScheduleTimeValid = bookingTiming === 'now' || (scheduledTimestamp > Date.now() + 10 * 60 * 1000);

  const formatScheduleDisplay = (ms: number) => {
    const d = new Date(ms);
    return d.toLocaleString(language === 'ta' ? 'ta-IN' : 'en-IN', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Auto detect if distance exceeds 15 km when user is on Local mode
  const isDistanceAbove15 = distanceKm > LOCAL_MAX_KM;

  // Real-time Autocomplete Search using Nominatim OpenStreetMap API + Verified Hubs
  useEffect(() => {
    if (!activeInput) {
      setSearchResults([]);
      setIsSearching(false);
      setHighlightedIndex(-1);
      return;
    }

    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      setHighlightedIndex(-1);
      return;
    }

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const qLower = trimmed.toLowerCase();

      // Check instant in-memory verified hubs
      const matchedLocalHubs: LocationPoint[] = POPULAR_ALL_INDIA_HUBS.filter((hub) => {
        const matchesName = hub.nameEn.toLowerCase().includes(qLower) ||
          hub.nameTa.includes(qLower) ||
          (hub.shortName && hub.shortName.toLowerCase().includes(qLower));
        const matchesDistrict = hub.district.toLowerCase().includes(qLower) ||
          hub.districtTa.includes(qLower);
        const matchesKeyword = hub.popularKeywords?.some((kw) => kw.toLowerCase().includes(qLower));
        return matchesName || matchesDistrict || matchesKeyword;
      }).map((hub) => ({
        lat: hub.lat,
        lng: hub.lng,
        shortName: language === 'ta' ? hub.nameTa : (hub.shortName || hub.nameEn),
        address: hub.address,
        city: hub.city || hub.district,
        district: hub.district,
        districtTa: hub.districtTa,
        state: hub.state || 'Tamil Nadu',
        stateTa: hub.state === 'Karnataka' ? 'கர்நாடகா' : hub.state === 'Andhra Pradesh' ? 'ஆந்திரா' : 'தமிழ்நாடு',
      }));

      try {
        // Query Nominatim OpenStreetMap API with localized addressdetails and abort signal
        const apiResults = await searchNominatimLocations(trimmed, language, controller.signal);

        // Merge: local verified hubs first, then real-time Nominatim results without duplicate coordinates
        const combined = [
          ...matchedLocalHubs,
          ...apiResults.filter((api) => !matchedLocalHubs.some((lh) => Math.abs(lh.lat - api.lat) < 0.008 && Math.abs(lh.lng - api.lng) < 0.008)),
        ];

        setSearchResults(combined);
        setHighlightedIndex(-1);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setSearchResults(matchedLocalHubs);
        }
      } finally {
        setIsSearching(false);
      }
    }, 260);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, activeInput, language]);

  const handlePickLocation = (loc: LocationPoint) => {
    if (activeInput === 'pickup') {
      onSelectPickup(loc);
      setActiveInput('drop');
      setSearchQuery('');
      setHighlightedIndex(-1);
    } else {
      onSelectDrop(loc);
      setActiveInput(null);
      setSearchQuery('');
      setHighlightedIndex(-1);
    }
    playNotificationSound('confirmed');
  };

  // Keyboard navigation for autocomplete list (ArrowDown, ArrowUp, Enter, Escape)
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < searchResults.length) {
        handlePickLocation(searchResults[highlightedIndex]);
      } else if (searchResults.length > 0) {
        handlePickLocation(searchResults[0]);
      }
    } else if (e.key === 'Escape') {
      setActiveInput(null);
      setSearchQuery('');
      setHighlightedIndex(-1);
    }
  };

  // One-tap GPS Geolocation with Nominatim Reverse Geocoding
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      return;
    }
    setIsDetectingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const resolved = await reverseGeocodeNominatim(latitude, longitude, language);
          const point: LocationPoint = resolved || {
            lat: latitude,
            lng: longitude,
            shortName: language === 'ta' ? 'தற்போதைய ஜிபிஎஸ் இடம்' : 'Current GPS Location',
            address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}, Tamil Nadu`,
            city: 'Vellore',
            district: 'Vellore',
            districtTa: 'வேலூர்',
            state: 'Tamil Nadu',
            stateTa: 'தமிழ்நாடு',
          };
          handlePickLocation(point);
        } finally {
          setIsDetectingGps(false);
        }
      },
      (err) => {
        console.warn('Geolocation error:', err);
        setIsDetectingGps(false);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  // Filter verified hubs by selected district and category for instant browsing
  const filteredHubs = POPULAR_ALL_INDIA_HUBS.filter((hub) => {
    const matchesDist = selectedDistrict === 'all' || hub.district.toLowerCase() === selectedDistrict.toLowerCase();
    const matchesCat = selectedCategory === 'all' || hub.category === selectedCategory;
    return matchesDist && matchesCat;
  });

  const currentFareBreakdown = computeTripFare(
    tripMode,
    selectedVehicle,
    distanceKm,
    outstationDays,
    rentalPackageId,
    tariffs
  );

  const isLocalMode = tripMode === 'local';
  const isOutstationMode = tripMode.includes('outstation');

  // Filter vehicles allowed for current mode
  const allowedVehicles: VehicleType[] = (['auto', 'car', 'sedan', 'suv', 'bike'] as VehicleType[]).filter(
    (vt) => VEHICLE_CONFIGS[vt].allowedModes.includes(tripMode)
  );

  return (
    <div className="w-full bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border-t border-slate-200/80 p-3.5 sm:p-4 flex flex-col gap-3 max-h-[88vh] sm:max-h-[660px] overflow-y-auto no-scrollbar transition-all">
      {/* Top drag handle for mobile */}
      <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto sm:hidden -mt-1 mb-0.5" />

      {/* Primary Customer Dashboard Tabs: [ லோக்கல் (Local <= 15 km) ] | [ அவுட் ஸ்டேஷன் (Outstation > 15 km) ] */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100/90 rounded-2xl border border-slate-200">
        <button
          type="button"
          onClick={() => onSelectTripMode('local')}
          className={`py-2 px-3 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition ${
            isLocalMode
              ? 'bg-amber-400 text-slate-950 shadow-md font-black ring-1 ring-amber-500'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
          }`}
        >
          <span className="text-base">🏙️</span>
          <span className="truncate">{language === 'ta' ? 'லோக்கல் பயணம் (<= 15 km)' : 'Local Tariff (<= 15 km)'}</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTripMode(tripMode === 'outstation_round' ? 'outstation_round' : 'outstation_oneway')}
          className={`py-2 px-3 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition ${
            isOutstationMode
              ? 'bg-slate-900 text-white shadow-md font-black ring-1 ring-slate-800'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
          }`}
        >
          <span className="text-base">🛣️</span>
          <span className="truncate">{language === 'ta' ? 'அவுட் ஸ்டேஷன் (> 15 km)' : 'Outstation (> 15 km)'}</span>
        </button>
      </div>

      {/* Outstation Sub-options (One-Way vs Round Trip Return) */}
      {isOutstationMode && (
        <div className="bg-slate-50 border border-slate-200 p-1.5 rounded-2xl flex items-center justify-between gap-1 text-xs animate-in fade-in">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSelectTripMode('outstation_oneway')}
              className={`py-1.5 px-3 rounded-xl font-bold transition ${
                tripMode === 'outstation_oneway'
                  ? 'bg-slate-900 text-white shadow'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {language === 'ta' ? 'ஒருவழிப் பயணம் (One-Way)' : 'One-Way Drop'}
            </button>
            <button
              type="button"
              onClick={() => onSelectTripMode('outstation_round')}
              className={`py-1.5 px-3 rounded-xl font-bold transition ${
                tripMode === 'outstation_round'
                  ? 'bg-slate-900 text-white shadow'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {language === 'ta' ? 'இருவழிப் பயணம் (Round Trip)' : 'Round Trip (Return)'}
            </button>
          </div>

          {tripMode === 'outstation_round' && (
            <div className="flex items-center gap-1 pl-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase">{t.days}:</span>
              {[1, 2, 3, 5].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onSelectOutstationDays(d)}
                  className={`w-6 h-6 rounded-lg text-xs font-black transition ${
                    outstationDays === d
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Gentle Informational Patch for > 15 km in local mode (Low Alarm, Small Orange Patch, Single Line, Info Icon) */}
      {isLocalMode && isDistanceAbove15 && drop && (
        <div className="bg-amber-50/90 border border-amber-200/90 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs text-amber-900 shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2 min-w-0">
            <Info className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span className="font-medium text-[11px] sm:text-xs leading-tight">
              {language === 'ta'
                ? `தகவல்: பயணத் தொலைவு ${distanceKm.toFixed(1)} கி.மீ (15 கி.மீ மேல்) - அவுட்ஸ்டேஷன் கட்டண முறை பொருந்தும்.`
                : `Notice: Ride distance is ${distanceKm.toFixed(1)} km (>15 km) - Outstation tariff applies.`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSelectTripMode('outstation_oneway')}
            className="px-2.5 py-1 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold rounded-lg text-[10px] sm:text-[11px] whitespace-nowrap transition cursor-pointer flex-shrink-0"
          >
            {language === 'ta' ? 'அவுட்ஸ்டேஷன் முறை' : 'Outstation Mode'}
          </button>
        </div>
      )}

      {/* Voice Recognition Active Feedback Banner */}
      {(voiceStatus === 'listening' || voiceMessage) && (
        <div className={`p-2.5 rounded-2xl border flex items-center justify-between gap-2 text-xs animate-in slide-in-from-top-2 duration-200 ${
          voiceStatus === 'listening' 
            ? 'bg-amber-50 border-amber-300 text-amber-950 shadow-md ring-2 ring-amber-400/40' 
            : voiceStatus === 'processing'
            ? 'bg-emerald-50 border-emerald-300 text-emerald-950 shadow-sm'
            : voiceStatus === 'error' || voiceStatus === 'denied'
            ? 'bg-rose-50 border-rose-300 text-rose-950'
            : 'bg-slate-100 border-slate-300 text-slate-800'
        }`}>
          <div className="flex items-center gap-2 min-w-0">
            {voiceStatus === 'listening' ? (
              <div className="relative flex items-center justify-center shrink-0">
                <span className="w-3.5 h-3.5 rounded-full bg-rose-500 animate-ping absolute" />
                <span className="w-3 h-3 rounded-full bg-rose-600 flex items-center justify-center text-white relative">
                  <Mic className="w-2 h-2" />
                </span>
              </div>
            ) : (
              <Mic className="w-4 h-4 text-emerald-600 shrink-0" />
            )}
            <span className="font-bold text-xs truncate">
              {voiceMessage || (language === 'ta' ? '🎙️ உங்கள் இருப்பிடத்தைக் கூறவும்...' : '🎙️ Speak your destination...')}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              speechService.stopListening();
              setVoiceTarget(null);
              setVoiceStatus('idle');
              setVoiceMessage(null);
            }}
            className="p-1 rounded-full hover:bg-black/10 text-slate-600 hover:text-slate-900 transition shrink-0"
            title={language === 'ta' ? 'ரத்து' : 'Dismiss'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Location Input Section: Full Readable Address + Typing + Voice + Search + Pin on Map + OSM Navigation */}
      <div className="bg-slate-50/90 rounded-2xl p-2.5 sm:p-3 border border-slate-200/90 flex flex-col gap-2 relative">
        {/* ===================== PICKUP CARD ===================== */}
        <div 
          className={`flex flex-col gap-2 p-2.5 sm:p-3 rounded-2xl transition border ${
            activeInput === 'pickup' 
              ? 'bg-emerald-50/90 ring-2 ring-emerald-500 border-emerald-300 shadow-sm' 
              : 'bg-white hover:bg-slate-50/90 border-slate-200/90'
          }`}
        >
          {/* Pickup Header with Badges and Direct Controls */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 ring-4 ring-emerald-100 flex-shrink-0" />
              <span className="text-[11px] sm:text-xs font-black text-emerald-800 uppercase tracking-wide flex items-center gap-1.5">
                <span>{t.pickup_label}</span>
                {activeInput === 'pickup' && (
                  <span className="text-[9px] bg-emerald-600 text-white font-black px-1.5 py-0.2 rounded-full uppercase animate-pulse">
                    {language === 'ta' ? 'தட்டச்சு' : 'Typing'}
                  </span>
                )}
              </span>
            </div>

            {/* City / District / State Info Badges */}
            {pickup && activeInput !== 'pickup' && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="px-1.5 py-0.5 rounded-md bg-emerald-100/90 text-emerald-800 text-[10px] font-bold">
                  {language === 'ta' ? `சிட்டி: ${pickup.city || 'வேலூர்'}` : `City: ${pickup.city || 'Vellore'}`}
                </span>
                <span className="px-1.5 py-0.5 rounded-md bg-blue-100/90 text-blue-800 text-[10px] font-bold">
                  {language === 'ta' ? `மாவட்டம்: ${pickup.districtTa || pickup.district || 'வேலூர்'}` : `Dist: ${pickup.district || 'Vellore'}`}
                </span>
                <span className="px-1.5 py-0.5 rounded-md bg-slate-200/90 text-slate-800 text-[10px] font-bold">
                  {language === 'ta' ? `மாநிலம்: ${pickup.stateTa || pickup.state || 'தமிழ்நாடு'}` : `State: ${pickup.state || 'Tamil Nadu'}`}
                </span>
              </div>
            )}
          </div>

          {/* Active Inline Autocomplete Search Input */}
          {activeInput === 'pickup' ? (
            <div className="flex items-center gap-1.5 relative">
              <Search className="w-4 h-4 text-emerald-600 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={language === 'ta' ? 'பிக்கப் இடத்தை தட்டச்சு செய்யவும் (எ.கா: சிஎம்சி, காட்பாடி, அண்ணா சாலை)...' : 'Type pickup location or landmark (e.g. CMC Hospital, Katpadi)...'}
                className="w-full text-xs sm:text-sm bg-white rounded-lg px-2.5 py-1.5 outline-none border border-emerald-300 focus:border-emerald-600 font-semibold text-slate-900 shadow-2xs"
              />
              
              {/* Inside-Input Voice Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartVoice('pickup');
                }}
                title={language === 'ta' ? 'குரல் உள்ளீடு' : 'Voice search'}
                className={`p-1.5 rounded-lg border transition ${
                  voiceTarget === 'pickup' && voiceStatus === 'listening'
                    ? 'bg-rose-500 text-white border-rose-600 animate-pulse'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
              </button>

              {isSearching && (
                <Loader2 className="w-4 h-4 text-emerald-600 animate-spin shrink-0" />
              )}
              {searchQuery && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200/80 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveInput(null);
                  setSearchQuery('');
                }}
                className="px-2 py-1 text-[11px] font-bold text-slate-500 hover:text-slate-800 bg-slate-200/80 hover:bg-slate-300 rounded-md shrink-0 transition"
              >
                {language === 'ta' ? 'முடிந்தது' : 'Done'}
              </button>
            </div>
          ) : (
            <div 
              onClick={() => {
                setActiveInput('pickup');
                setSearchQuery('');
              }}
              className="cursor-pointer"
            >
              <p className="text-xs sm:text-sm font-black text-slate-900 leading-snug">
                {pickup?.shortName || (pickup?.address ? pickup.address.split(',')[0] : t.pickup_placeholder)}
              </p>

              {/* Full readable address */}
              {pickup?.address && (
                <p className="text-[11px] text-slate-600 leading-relaxed mt-0.5 line-clamp-2">
                  {pickup.address}
                </p>
              )}
            </div>
          )}

          {/* Direct Action Buttons Row for Pickup: Typing, Voice, Search, and Open Map to Pin */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
            {/* Search Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveInput('pickup');
                setSearchQuery('');
                setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold border border-emerald-200 active:scale-95 transition cursor-pointer"
            >
              <Search className="w-3 h-3 text-emerald-600" />
              <span>{language === 'ta' ? 'தேடல்' : 'Search'}</span>
            </button>

            {/* Voice Input Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleStartVoice('pickup');
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border active:scale-95 transition cursor-pointer ${
                voiceTarget === 'pickup' && voiceStatus === 'listening'
                  ? 'bg-rose-500 text-white border-rose-600 ring-2 ring-rose-300 animate-pulse'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
              }`}
            >
              <Mic className="w-3 h-3 text-rose-600" />
              <span>{language === 'ta' ? 'குரல்' : 'Voice'}</span>
            </button>

            {/* Open Map to Pin Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMapPinPickerTarget('pickup');
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 text-[11px] font-bold border border-amber-300 shadow-2xs active:scale-95 transition cursor-pointer"
            >
              <MapPin className="w-3 h-3 text-amber-600" />
              <span>{language === 'ta' ? 'மேப்பில் பின் செய்' : 'Pin on Map'}</span>
            </button>

            {/* Current GPS button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleUseCurrentLocation();
              }}
              disabled={isDetectingGps}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold border border-slate-200 ml-auto cursor-pointer"
              title={language === 'ta' ? 'தற்போதைய ஜிபிஎஸ்' : 'My GPS'}
            >
              {isDetectingGps ? (
                <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
              ) : (
                <LocateFixed className="w-3 h-3 text-emerald-600" />
              )}
              <span className="hidden sm:inline">{language === 'ta' ? 'என் இடம்' : 'GPS'}</span>
            </button>
          </div>
        </div>

        {/* Swap Locations Bar (Thumb-friendly & High Visibility) */}
        <div className="relative flex items-center justify-center my-0.5">
          <div className="w-full border-t border-slate-200/90 absolute left-0 right-0 z-0" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSwapLocations();
            }}
            title={language === 'ta' ? 'இடங்களை மாற்று (Swap Locations)' : 'Swap Pickup & Destination'}
            className="relative z-10 px-3 py-1 bg-white hover:bg-amber-50 active:scale-95 text-slate-700 hover:text-amber-800 font-bold text-xs rounded-full border border-slate-300 shadow-sm transition flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-amber-600" />
            <span>{language === 'ta' ? 'இடங்களை மாற்று' : 'Swap'}</span>
          </button>
        </div>

        {/* ===================== DESTINATION / DROP CARD ===================== */}
        <div 
          className={`flex flex-col gap-2 p-2.5 sm:p-3 rounded-2xl transition border ${
            activeInput === 'drop' 
              ? 'bg-rose-50/90 ring-2 ring-rose-500 border-rose-300 shadow-sm' 
              : 'bg-white hover:bg-slate-50/90 border-slate-200/90'
          }`}
        >
          {/* Destination Header with Badges and Direct Controls */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-full bg-rose-500 ring-4 ring-rose-100 flex-shrink-0" />
              <span className="text-[11px] sm:text-xs font-black text-rose-800 uppercase tracking-wide flex items-center gap-1.5">
                <span>{t.drop_label}</span>
                {activeInput === 'drop' && (
                  <span className="text-[9px] bg-rose-600 text-white font-black px-1.5 py-0.2 rounded-full uppercase animate-pulse">
                    {language === 'ta' ? 'தட்டச்சு' : 'Typing'}
                  </span>
                )}
              </span>
            </div>

            {/* City / District / State Info Badges */}
            {drop && activeInput !== 'drop' && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="px-1.5 py-0.5 rounded-md bg-rose-100/90 text-rose-800 text-[10px] font-bold">
                  {language === 'ta' ? `சிட்டி: ${drop.city || 'சென்னை'}` : `City: ${drop.city || 'Chennai'}`}
                </span>
                <span className="px-1.5 py-0.5 rounded-md bg-blue-100/90 text-blue-800 text-[10px] font-bold">
                  {language === 'ta' ? `மாவட்டம்: ${drop.districtTa || drop.district || 'சென்னை'}` : `Dist: ${drop.district || 'Chennai'}`}
                </span>
                <span className="px-1.5 py-0.5 rounded-md bg-slate-200/90 text-slate-800 text-[10px] font-bold">
                  {language === 'ta' ? `மாநிலம்: ${drop.stateTa || drop.state || 'தமிழ்நாடு'}` : `State: ${drop.state || 'Tamil Nadu'}`}
                </span>
              </div>
            )}
          </div>

          {/* Active Inline Autocomplete Search Input */}
          {activeInput === 'drop' ? (
            <div className="flex items-center gap-1.5 relative">
              <Search className="w-4 h-4 text-rose-600 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={language === 'ta' ? 'இலக்கு இடத்தை தட்டச்சு செய்யவும் (எ.கா: சென்னை சென்ட்ரல், விமான நிலையம், ஈரோடு)...' : 'Type drop destination (e.g. Chennai Central, Airport, Salem)...'}
                className="w-full text-xs sm:text-sm bg-white rounded-lg px-2.5 py-1.5 outline-none border border-rose-300 focus:border-rose-600 font-semibold text-slate-900 shadow-2xs"
              />

              {/* Inside-Input Voice Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartVoice('drop');
                }}
                title={language === 'ta' ? 'குரல் உள்ளீடு' : 'Voice search'}
                className={`p-1.5 rounded-lg border transition ${
                  voiceTarget === 'drop' && voiceStatus === 'listening'
                    ? 'bg-rose-500 text-white border-rose-600 animate-pulse'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
              </button>

              {isSearching && (
                <Loader2 className="w-4 h-4 text-rose-600 animate-spin shrink-0" />
              )}
              {searchQuery && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200/80 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveInput(null);
                  setSearchQuery('');
                }}
                className="px-2 py-1 text-[11px] font-bold text-slate-500 hover:text-slate-800 bg-slate-200/80 hover:bg-slate-300 rounded-md shrink-0 transition"
              >
                {language === 'ta' ? 'முடிந்தது' : 'Done'}
              </button>
            </div>
          ) : (
            <div 
              onClick={() => {
                setActiveInput('drop');
                setSearchQuery('');
              }}
              className="cursor-pointer"
            >
              <p className="text-xs sm:text-sm font-black text-slate-900 leading-snug">
                {drop?.shortName || (drop?.address ? drop.address.split(',')[0] : t.drop_placeholder)}
              </p>

              {/* Full readable address */}
              {drop?.address && (
                <p className="text-[11px] text-slate-600 leading-relaxed mt-0.5 line-clamp-2">
                  {drop.address}
                </p>
              )}
            </div>
          )}

          {/* Action Row right next to Destination: OpenStreetMap Navigation + Search + Voice + Pin on Map */}
          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
            {/* OpenStreetMap Navigation Action Button right next to Destination as requested */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowOsmNavModal(true);
              }}
              title={language === 'ta' ? 'OpenStreetMap வழிசெலுத்தல் & நேரலை பாதை' : 'OpenStreetMap Navigation & Route Directions'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white text-[11px] sm:text-xs font-black shadow-md shadow-sky-600/20 active:scale-95 transition cursor-pointer"
            >
              <Navigation className="w-3.5 h-3.5 fill-white" />
              <span>{language === 'ta' ? 'OSM நேவிகேஷன்' : 'OSM Navigation'}</span>
              <span className="text-[9px] bg-white/20 px-1 py-0.2 rounded font-mono">Live</span>
            </button>

            {/* Search Button right next to Destination */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveInput('drop');
                setSearchQuery('');
                setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 text-[11px] font-bold border border-rose-200 active:scale-95 transition cursor-pointer"
            >
              <Search className="w-3.5 h-3.5 text-rose-600" />
              <span>{language === 'ta' ? 'தேடல்' : 'Search'}</span>
            </button>

            {/* Voice Input Button right next to Destination */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleStartVoice('drop');
              }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border active:scale-95 transition cursor-pointer ${
                voiceTarget === 'drop' && voiceStatus === 'listening'
                  ? 'bg-rose-500 text-white border-rose-600 ring-2 ring-rose-300 animate-pulse'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
              }`}
            >
              <Mic className="w-3.5 h-3.5 text-rose-600" />
              <span>{language === 'ta' ? 'குரல்' : 'Voice'}</span>
            </button>

            {/* Open Map to Pin Destination */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMapPinPickerTarget('drop');
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 text-[11px] font-bold border border-amber-300 shadow-2xs active:scale-95 transition cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5 text-amber-600" />
              <span>{language === 'ta' ? 'மேப்பில் பின் செய்' : 'Pin on Map'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Quick Saved Places Chips Row */}
      <div className="flex flex-col gap-1.5 -mt-1">
        <div className="flex items-center justify-between text-[11px] px-0.5">
          <div className="flex items-center gap-1.5 text-slate-600 font-bold">
            <Bookmark className="w-3.5 h-3.5 text-amber-500" />
            <span>{language === 'ta' ? 'சேமிக்கப்பட்ட இடங்கள்' : 'Saved Places'}</span>
            <span className="text-[10px] text-slate-400 font-normal">
              ({activeInput === 'pickup' 
                ? (language === 'ta' ? 'பிக்கப்பிற்கு' : 'for pickup') 
                : (language === 'ta' ? 'இலக்கிற்கு' : 'for drop')})
            </span>
          </div>

          <div className="flex items-center gap-2">
            {drop && (
              <button
                type="button"
                onClick={() => handleSaveCurrentPoint(drop, 'home')}
                title={language === 'ta' ? 'தற்போதைய இடத்தை சேமி' : 'Bookmark this place'}
                className="text-amber-700 hover:text-amber-900 font-bold text-[10px] flex items-center gap-0.5"
              >
                <Star className="w-3 h-3 text-amber-500 fill-amber-400" />
                <span>{language === 'ta' ? 'இடத்தை சேமி' : 'Save Place'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSavedPlacesModal(true)}
              className="text-slate-500 hover:text-slate-900 font-bold text-[10px] flex items-center gap-0.5"
            >
              <span>{language === 'ta' ? 'நிர்வகி' : 'Manage'}</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {savedPlaces.map((sp) => {
            const isHome = sp.type === 'home';
            const isWork = sp.type === 'work';
            const isStation = sp.type === 'station';
            return (
              <button
                key={sp.id}
                type="button"
                onClick={() => handleSelectSavedPlace(sp)}
                title={sp.address}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white hover:bg-amber-50/80 text-slate-800 hover:text-slate-950 border border-slate-200 shadow-2xs text-xs font-bold whitespace-nowrap active:scale-95 transition"
              >
                {isHome ? (
                  <Home className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                ) : isWork ? (
                  <Briefcase className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                ) : isStation ? (
                  <Train className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                ) : (
                  <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                )}
                <span>{language === 'ta' && sp.titleTa ? sp.titleTa : sp.title}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setShowSavedPlacesModal(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-dashed border-slate-300 hover:border-amber-400 hover:bg-amber-50/60 text-slate-600 hover:text-amber-900 text-xs font-bold whitespace-nowrap active:scale-95 transition"
          >
            <span>+ {language === 'ta' ? 'சேர்' : 'Add'}</span>
          </button>
        </div>

        {savedNotice && (
          <p className="text-[11px] text-emerald-700 font-bold px-1 animate-in fade-in">
            ✓ {savedNotice}
          </p>
        )}
      </div>

      {/* Autocomplete-Style Suggestions Panel (Powered by OpenStreetMap Nominatim API + Curated Transit Directory) */}
      {activeInput && (
        <div 
          className="bg-white rounded-2xl sm:rounded-3xl border-2 border-amber-300 shadow-2xl p-3 sm:p-4 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150 ring-2 ring-amber-100"
          role="listbox"
          aria-label="Location autocomplete suggestions"
        >
          {/* Panel Header */}
          <div className="flex items-center justify-between pb-1 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                activeInput === 'pickup' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
              }`}>
                <Search className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h4 className="font-extrabold text-xs sm:text-sm text-slate-900 tracking-tight leading-none">
                    {activeInput === 'pickup' ? t.pickup_label : t.drop_label}
                  </h4>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                    <Globe className="w-2.5 h-2.5 text-amber-600" />
                    <span>OpenStreetMap Nominatim</span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  {language === 'ta'
                    ? 'முகவரியை தட்டச்சு செய்து பரிந்துரையிலிருந்து தேர்ந்தெடுக்கவும்'
                    : 'Type and select from real-time address suggestions'}
                </p>
              </div>
            </div>

            <button 
              type="button"
              onClick={() => {
                setActiveInput(null);
                setSearchQuery('');
                setHighlightedIndex(-1);
              }} 
              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 transition cursor-pointer"
              title={language === 'ta' ? 'மூடு' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick-Access Toolbar: GPS Current Location + Saved Places Fast Chips */}
          <div className="flex items-center gap-1.5 flex-wrap bg-slate-50 p-2 rounded-xl border border-slate-200/80">
            {/* One-Tap GPS Locate Me Button */}
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={isDetectingGps}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold shadow-2xs transition cursor-pointer disabled:opacity-60"
            >
              {isDetectingGps ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LocateFixed className="w-3.5 h-3.5 text-emerald-100" />
              )}
              <span>
                {isDetectingGps
                  ? (language === 'ta' ? 'ஜிபிஎஸ் கண்டறிகிறது...' : 'Detecting GPS...')
                  : (language === 'ta' ? 'என் ஜிபிஎஸ் இடம்' : 'Use Current GPS')}
              </span>
            </button>

            {/* Quick Saved Places Chips */}
            {savedPlaces.slice(0, 3).map((sp) => (
              <button
                key={`autocomplete-sp-${sp.id}`}
                type="button"
                onClick={() => handleSelectSavedPlace(sp)}
                title={sp.address}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-amber-100/70 border border-slate-200 text-slate-800 text-[11px] font-bold shadow-2xs transition active:scale-95 cursor-pointer"
              >
                {sp.type === 'home' ? (
                  <Home className="w-3 h-3 text-emerald-600" />
                ) : sp.type === 'work' ? (
                  <Briefcase className="w-3 h-3 text-sky-600" />
                ) : (
                  <Train className="w-3 h-3 text-amber-600" />
                )}
                <span>{language === 'ta' && sp.titleTa ? sp.titleTa : sp.title}</span>
              </button>
            ))}
          </div>

          {/* Real-time Nominatim Search Suggestions List (When user is typing) */}
          {searchQuery.trim().length >= 2 ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase px-1">
                <span className="flex items-center gap-1.5">
                  <span>{language === 'ta' ? 'நேரலை பரிந்துரைகள்' : 'Real-time Suggestions'}</span>
                  {isSearching && <Loader2 className="w-3 h-3 text-amber-600 animate-spin" />}
                </span>
                <span className="text-[10px] text-amber-700 font-semibold lowercase">
                  {searchResults.length} {language === 'ta' ? 'முடிவுகள்' : 'results'} · {language === 'ta' ? '↑ ↓ மூலம் தேர்வு செய்க' : '↑ ↓ to navigate'}
                </span>
              </div>

              {/* Suggestions Container */}
              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl p-1 bg-white shadow-inner no-scrollbar">
                {isSearching && searchResults.length === 0 && (
                  <div className="p-4 flex flex-col items-center justify-center gap-2 text-center text-slate-500 text-xs">
                    <Loader2 className="w-5 h-5 text-amber-600 animate-spin" />
                    <span>
                      {language === 'ta'
                        ? 'ஓபன்ஸ்ட்ரீட்மேப்-ல் நேரலை முகவரிகளை தேடுகிறது...'
                        : `Fetching real-time Nominatim addresses for "${searchQuery}"...`}
                    </span>
                  </div>
                )}

                {searchResults.map((loc, i) => {
                  const isHighlighted = highlightedIndex === i;
                  return (
                    <button
                      key={`osm-sugg-${i}`}
                      type="button"
                      onClick={() => handlePickLocation(loc)}
                      onMouseEnter={() => setHighlightedIndex(i)}
                      className={`flex items-start gap-2.5 text-left p-2.5 rounded-xl transition cursor-pointer ${
                        isHighlighted 
                          ? 'bg-amber-100/90 text-amber-950 border border-amber-300 ring-1 ring-amber-300 shadow-2xs' 
                          : 'hover:bg-slate-50 text-slate-900 border border-transparent'
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 font-bold ${
                        loc.shortName?.toLowerCase().includes('rail') || loc.shortName?.toLowerCase().includes('station')
                          ? 'bg-amber-100 text-amber-800'
                          : loc.shortName?.toLowerCase().includes('airport')
                          ? 'bg-sky-100 text-sky-800'
                          : loc.shortName?.toLowerCase().includes('hospital') || loc.shortName?.toLowerCase().includes('cmc')
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {loc.shortName?.toLowerCase().includes('rail') || loc.shortName?.toLowerCase().includes('station') ? (
                          <Train className="w-3.5 h-3.5" />
                        ) : loc.shortName?.toLowerCase().includes('hospital') || loc.shortName?.toLowerCase().includes('cmc') ? (
                          <Cross className="w-3.5 h-3.5" />
                        ) : loc.shortName?.toLowerCase().includes('airport') ? (
                          <Navigation className="w-3.5 h-3.5" />
                        ) : (
                          <MapPin className="w-3.5 h-3.5" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <p className="text-xs sm:text-sm font-black text-slate-900 truncate">
                            {loc.shortName || loc.address.split(',')[0]}
                          </p>

                          <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
                            OSM Live
                          </span>
                        </div>

                        {/* Readable District, City, and State Pills as requested */}
                        <div className="flex items-center gap-1 flex-wrap mt-1">
                          {loc.city && (
                            <span className="px-1.5 py-0.2 rounded-md bg-emerald-100/80 text-emerald-900 text-[10px] font-bold">
                              {language === 'ta' ? `சிட்டி: ${loc.city}` : `City: ${loc.city}`}
                            </span>
                          )}
                          {loc.district && (
                            <span className="px-1.5 py-0.2 rounded-md bg-blue-100/80 text-blue-900 text-[10px] font-bold">
                              {language === 'ta' ? `மாவட்டம்: ${loc.districtTa || loc.district}` : `Dist: ${loc.district}`}
                            </span>
                          )}
                          {loc.state && (
                            <span className="px-1.5 py-0.2 rounded-md bg-slate-200/80 text-slate-800 text-[10px] font-bold">
                              {language === 'ta' ? `மாநிலம்: ${loc.stateTa || loc.state}` : `State: ${loc.state}`}
                            </span>
                          )}
                        </div>

                        {/* Full readable address snippet */}
                        <p className="text-[11px] text-slate-600 line-clamp-1 mt-1 font-medium">
                          {loc.address}
                        </p>
                      </div>
                    </button>
                  );
                })}

                {!isSearching && searchResults.length === 0 && (
                  <div className="p-4 text-center text-slate-500 text-xs flex flex-col items-center gap-1">
                    <AlertCircle className="w-5 h-5 text-amber-500" />
                    <span className="font-semibold text-slate-800">
                      {language === 'ta'
                        ? `"${searchQuery}" என்ற முகவரி கிடைக்கவில்லை`
                        : `No address suggestions found for "${searchQuery}"`}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {language === 'ta'
                        ? 'நகரம், மாவட்டம் அல்லது முக்கிய அடையாளத்தின் பெயரை உள்ளிடவும் அல்லது வரைபடத்தில் தொடவும்'
                        : 'Try searching by district name, landmark, or tap directly on the map'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Curated Transit Directory (When query is empty or 1 letter) */
            <div className="flex flex-col gap-2">
              {/* District Quick Filter Carousel */}
              <div>
                <div className="flex items-center justify-between mb-1 text-[11px] font-bold text-slate-500 uppercase">
                  <span>{language === 'ta' ? 'மாவட்டங்கள் & நகரங்கள்' : 'Districts & Cities'}</span>
                  <span className="text-[10px] text-amber-600">{language === 'ta' ? 'தொட்டு உடனே பார்க்க' : 'Tap to filter hubs'}</span>
                </div>
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  <button
                    type="button"
                    onClick={() => { setSelectedDistrict('all'); setSearchQuery(''); }}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg whitespace-nowrap transition cursor-pointer ${
                      selectedDistrict === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {language === 'ta' ? 'அனைத்து மாவட்டங்களும்' : 'All Districts'}
                  </button>
                  {TAMIL_NADU_DISTRICTS.map((dist) => (
                    <button
                      key={dist.id}
                      type="button"
                      onClick={() => { setSelectedDistrict(dist.id); setSearchQuery(''); }}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg whitespace-nowrap transition border cursor-pointer ${
                        selectedDistrict === dist.id
                          ? 'bg-amber-400 text-slate-950 border-amber-500 shadow-sm'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-amber-100/60'
                      }`}
                    >
                      {language === 'ta' ? dist.nameTa : dist.nameEn}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category Quick Filter (Metro, Airport, Central/Railway, Bus Terminus, GH) */}
              <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`px-2 py-0.5 text-[11px] font-bold rounded-md whitespace-nowrap transition cursor-pointer ${
                    selectedCategory === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {language === 'ta' ? 'எல்லாமே' : 'All'}
                </button>
                {(Object.keys(CATEGORY_LABELS) as HubCategory[]).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded-md whitespace-nowrap transition flex items-center gap-1 cursor-pointer ${
                      selectedCategory === cat ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <span>{CATEGORY_LABELS[cat].emoji}</span>
                    <span>{language === 'ta' ? CATEGORY_LABELS[cat].ta.split(' ')[0] : CATEGORY_LABELS[cat].en.split(' ')[0]}</span>
                  </button>
                ))}
              </div>

              {/* District / Category Curated Hubs List */}
              <div className="flex flex-col gap-1 max-h-56 overflow-y-auto border border-slate-200 rounded-xl p-1 divide-y divide-slate-100 bg-white no-scrollbar">
                <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase text-slate-400">
                  <span>
                    {selectedDistrict === 'all'
                      ? (language === 'ta' ? 'அகில இந்திய முக்கிய மையங்கள்' : 'Major Hubs & Stations')
                      : `${selectedDistrict.toUpperCase()} - ${language === 'ta' ? 'முக்கிய மையங்கள்' : 'Key Locations'}`}
                  </span>
                  <span>{filteredHubs.length} {language === 'ta' ? 'இடங்கள்' : 'places'}</span>
                </div>
                {filteredHubs.map((hub, i) => {
                  const catInfo = CATEGORY_LABELS[hub.category];
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handlePickLocation({
                        lat: hub.lat,
                        lng: hub.lng,
                        shortName: language === 'ta' ? hub.nameTa : (hub.shortName || hub.nameEn),
                        address: hub.address,
                        city: hub.city || hub.district,
                        district: hub.district,
                        districtTa: hub.districtTa,
                        state: hub.state || 'Tamil Nadu',
                        stateTa: hub.state === 'Karnataka' ? 'கர்நாடகா' : hub.state === 'Andhra Pradesh' ? 'ஆந்திரா' : 'தமிழ்நாடு',
                      })}
                      className="flex items-start gap-2.5 text-left py-2 px-2 hover:bg-amber-50/80 rounded-lg transition group cursor-pointer"
                    >
                      <span className="text-lg flex-shrink-0 mt-0.5">{catInfo.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-bold text-slate-900 group-hover:text-amber-950 truncate">
                            {language === 'ta' ? hub.nameTa : hub.nameEn}
                          </p>
                          <span className="text-[9px] font-bold px-1 rounded bg-blue-50 text-blue-800">
                            {hub.districtTa || hub.district}
                          </span>
                          <span className="text-[9px] font-semibold px-1 rounded bg-slate-100 text-slate-700">
                            {hub.state === 'Karnataka' ? (language === 'ta' ? 'கர்நாடகா' : 'Karnataka') : (language === 'ta' ? 'தமிழ்நாடு' : 'Tamil Nadu')}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{hub.address}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Interactive Map Tip Note */}
          <div className="p-2 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-2 text-[11px] text-slate-600">
            <Navigation className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
            <span>
              {language === 'ta'
                ? 'வரைபடத்தில் நீங்கள் தொடும் எந்த ஒரு இடமும் உடனடியாக தேர்வு செய்யப்படும்'
                : 'You can also tap anywhere directly on the map to pick location'}
            </span>
          </div>
        </div>
      )}

      {/* Vehicle Selection & Live Tariff Display */}
      {pickup && drop && (
        <div className="flex flex-col gap-2.5">
          {/* Timing Mode Toggle: Ride Now vs Schedule */}
          <div className="bg-slate-100 p-1 rounded-2xl flex items-center gap-1 border border-slate-200">
            <button
              type="button"
              onClick={() => setBookingTiming('now')}
              className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
                bookingTiming === 'now'
                  ? 'bg-white text-slate-950 shadow-xs border border-slate-200/80 font-black'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <Zap className={`w-3.5 h-3.5 ${bookingTiming === 'now' ? 'text-amber-500 fill-amber-500' : ''}`} />
              <span>{t.ride_now}</span>
            </button>
            <button
              type="button"
              onClick={() => setBookingTiming('schedule')}
              className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
                bookingTiming === 'schedule'
                  ? 'bg-amber-400 text-slate-950 shadow-xs border border-amber-500/30 font-black'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>{t.schedule_ride}</span>
            </button>
          </div>

          {/* Interactive Schedule Date & Time Picker */}
          {bookingTiming === 'schedule' && (
            <div className="bg-gradient-to-b from-amber-50/80 to-orange-50/40 border border-amber-300 rounded-2xl p-3 flex flex-col gap-2.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <span>{t.schedule_pickup_time}</span>
                </div>
                <span className="text-[10px] bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-full font-bold">
                  {language === 'ta' ? 'முன்பதிவு' : 'Advance Booking'}
                </span>
              </div>

              {/* Date Selection */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                  {language === 'ta' ? 'தேதி (Date)' : 'Select Date'}
                </label>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <button
                    type="button"
                    onClick={() => setScheduleDate(getTodayStr())}
                    className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-semibold border transition ${
                      scheduleDate === getTodayStr()
                        ? 'bg-amber-500 text-slate-950 border-amber-600 font-bold shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50'
                    }`}
                  >
                    {t.today}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleDate(getFutureDateStr(1))}
                    className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-semibold border transition ${
                      scheduleDate === getFutureDateStr(1)
                        ? 'bg-amber-500 text-slate-950 border-amber-600 font-bold shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50'
                    }`}
                  >
                    {t.tomorrow}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleDate(getFutureDateStr(2))}
                    className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-semibold border transition ${
                      scheduleDate === getFutureDateStr(2)
                        ? 'bg-amber-500 text-slate-950 border-amber-600 font-bold shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50'
                    }`}
                  >
                    {t.day_after}
                  </button>
                </div>
                <input
                  type="date"
                  value={scheduleDate}
                  min={getTodayStr()}
                  max={getFutureDateStr(30)}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Time Selection */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    {language === 'ta' ? 'புறப்படும் நேரம் (Time)' : 'Pickup Time'}
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        d.setMinutes(d.getMinutes() + 30);
                        setScheduleDate(getTodayStr());
                        setScheduleTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
                      }}
                      className="text-[10px] px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-amber-100 font-semibold"
                    >
                      +30m
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        d.setMinutes(d.getMinutes() + 60);
                        setScheduleDate(getTodayStr());
                        setScheduleTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
                      }}
                      className="text-[10px] px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-amber-100 font-semibold"
                    >
                      +1h
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleTime('08:00')}
                      className="text-[10px] px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-amber-100 font-semibold"
                    >
                      08:00 AM
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleTime('18:00')}
                      className="text-[10px] px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-amber-100 font-semibold"
                    >
                      06:00 PM
                    </button>
                  </div>
                </div>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Formatted Summary Bar */}
              <div className={`p-2 rounded-xl text-xs flex items-center justify-between border ${
                isScheduleTimeValid 
                  ? 'bg-amber-100/70 border-amber-300 text-amber-950 font-medium'
                  : 'bg-rose-50 border-rose-300 text-rose-800'
              }`}>
                {isScheduleTimeValid ? (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-amber-700" />
                    <span>
                      {language === 'ta' ? 'திட்டமிடப்பட்ட புறப்பாடு: ' : 'Scheduled for: '}
                      <strong className="font-bold">{formatScheduleDisplay(scheduledTimestamp)}</strong>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-rose-700">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-[11px] font-semibold">
                      {language === 'ta' 
                        ? 'குறைந்தது 10 நிமிடங்களுக்குப் பிறகு உள்ள எதிர்கால நேரத்தை தேர்வு செய்யவும்' 
                        : 'Please choose a future time at least 10 minutes ahead'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {t.vehicle_types}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-800">
                {distanceKm} {t.km} · {isDistanceAbove15 ? (language === 'ta' ? 'அவுட் ஸ்டேஷன்' : 'Outstation') : (language === 'ta' ? 'லோக்கல்' : 'Local')}
              </span>
              <button
                onClick={onOpenTariffModal}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg border border-amber-300 transition"
              >
                <Sliders className="w-3 h-3" />
                <span>{language === 'ta' ? 'டேரிஃப் மாற்றுக' : 'Tariff Rates'}</span>
              </button>
            </div>
          </div>

          {/* Vehicle options grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {allowedVehicles.map((vType) => {
              const cfg = VEHICLE_CONFIGS[vType];
              const breakdown = computeTripFare(
                tripMode,
                vType,
                distanceKm,
                outstationDays,
                rentalPackageId,
                tariffs
              );
              const isSelected = selectedVehicle === vType;
              const ratePerKm = isDistanceAbove15 ? (tariffs[vType]?.outstationPerKm || 15) : (tariffs[vType]?.localPerKm || 13);
              const vTypeEta = estimatePickupTime(
                pickup,
                vType,
                bookingTiming,
                bookingTiming === 'schedule' ? scheduledTimestamp : undefined
              );

              return (
                <div
                  key={vType}
                  onClick={() => onSelectVehicle(vType)}
                  className={`flex items-center justify-between p-2.5 sm:p-3 rounded-2xl cursor-pointer border transition ${
                    isSelected
                      ? 'border-amber-500 bg-amber-50/70 shadow-sm ring-1 ring-amber-400'
                      : 'border-slate-200 bg-white hover:bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl sm:text-3xl">{cfg.emoji}</span>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs sm:text-sm font-bold text-slate-900">
                          {language === 'ta' ? cfg.nameTa : cfg.nameEn}
                        </span>
                        <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                          <Users className="w-2.5 h-2.5" />
                          {cfg.capacity}
                        </span>
                        {/* Dynamic Estimated Pick-up Time Tag */}
                        <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded-md bg-amber-100/90 text-amber-900 border border-amber-300/80 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5 text-amber-700" />
                          <span>
                            {bookingTiming === 'schedule'
                              ? vTypeEta.arrivalClockTime
                              : `${vTypeEta.waitMinutes} ${language === 'ta' ? 'நிமி பிக்கப்' : 'min pickup'}`}
                          </span>
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        {isDistanceAbove15 ? `₹${ratePerKm}/km (Outstation)` : (language === 'ta' ? cfg.taglineTa : cfg.taglineEn)}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-sm sm:text-base font-extrabold text-slate-950">
                      ₹{breakdown.totalAmount}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {isDistanceAbove15 ? (language === 'ta' ? 'அவுட் ஸ்டேஷன்' : 'Outstation') : (language === 'ta' ? 'லோக்கல் கட்டணம்' : 'Local Fare')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recharts Price Prediction & Peak Hours Chart */}
          <FarePredictionChart
            language={language}
            vehicleType={selectedVehicle}
            baseFare={currentFareBreakdown.totalAmount}
            distanceKm={distanceKm}
          />

          {/* Transparent Fare & Tariff Breakdown */}
          <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200 text-[11px] text-slate-600 flex flex-col gap-1">
            <div className="flex justify-between font-semibold text-slate-800">
              <span>{t.fare_breakdown}:</span>
              <span>{VEHICLE_CONFIGS[selectedVehicle]?.emoji} {language === 'ta' ? VEHICLE_CONFIGS[selectedVehicle]?.nameTa : VEHICLE_CONFIGS[selectedVehicle]?.nameEn}</span>
            </div>
            {currentFareBreakdown.baseAmount > 0 && (
              <div className="flex justify-between">
                <span>{t.base_fare}:</span>
                <span>₹{currentFareBreakdown.baseAmount}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>{t.distance_charge} ({distanceKm} km @ ₹{currentFareBreakdown.ratePerKmUsed}/km):</span>
              <span>₹{currentFareBreakdown.distanceAmount}</span>
            </div>
            {currentFareBreakdown.driverBetaAmount && currentFareBreakdown.driverBetaAmount > 0 ? (
              <div className="flex justify-between text-blue-700 font-medium">
                <span>{t.driver_beta}:</span>
                <span>₹{currentFareBreakdown.driverBetaAmount}</span>
              </div>
            ) : null}
            {currentFareBreakdown.tollEstimate && currentFareBreakdown.tollEstimate > 0 ? (
              <div className="flex justify-between text-slate-500">
                <span>{t.toll_est}:</span>
                <span>₹{currentFareBreakdown.tollEstimate}</span>
              </div>
            ) : null}
            {redeemPoints && (
              <div className="flex justify-between text-emerald-700 font-bold border-t border-slate-200/80 pt-1">
                <span>{language === 'ta' ? 'வேலூர் பாயிண்ட்ஸ் தள்ளுபடி' : 'Vellore Points Discount'}:</span>
                <span>-₹{Math.min(userPoints, Math.floor(currentFareBreakdown.totalAmount * 0.4))}</span>
              </div>
            )}
          </div>

          {/* Vellore Points Redemption Toggle */}
          {userPoints > 0 && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50/60 border border-amber-300/80 rounded-2xl p-2.5 flex items-center justify-between gap-2 shadow-2xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-amber-400 text-slate-950 flex items-center justify-center font-black text-xs flex-shrink-0">
                  🪙
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {language === 'ta' ? 'வேலூர் பாயிண்ட்ஸ் தள்ளுபடி' : 'Redeem Vellore Points'}
                    </span>
                    <button
                      type="button"
                      onClick={onOpenPointsModal}
                      className="text-[10px] text-amber-700 underline font-semibold flex-shrink-0"
                    >
                      ({userPoints} Pts)
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 truncate">
                    {redeemPoints 
                      ? (language === 'ta' ? `${Math.min(userPoints, Math.floor(currentFareBreakdown.totalAmount * 0.4))} பாயிண்ட்ஸ் பயன்படுத்தப்பட்டுள்ளது` : `Redeemed ${Math.min(userPoints, Math.floor(currentFareBreakdown.totalAmount * 0.4))} points`)
                      : (language === 'ta' ? `ரூ. ${Math.min(userPoints, Math.floor(currentFareBreakdown.totalAmount * 0.4))} வரை தள்ளுபடி பெறலாம்` : `Save up to ₹${Math.min(userPoints, Math.floor(currentFareBreakdown.totalAmount * 0.4))} off`)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setRedeemPoints(!redeemPoints)}
                className={`px-3 py-1.5 rounded-xl font-extrabold text-xs transition border flex-shrink-0 ${
                  redeemPoints
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white text-slate-800 border-amber-300 hover:bg-amber-100'
                }`}
              >
                {redeemPoints ? (language === 'ta' ? 'கழிந்தது ✓' : 'Applied ✓') : (language === 'ta' ? 'பயன்படுத்துக' : 'Apply')}
              </button>
            </div>
          )}

          {/* Payment Method Selector */}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-xs font-bold text-slate-600">
              {t.payment_method}:
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onSelectPayment('cash')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition ${
                  paymentMethod === 'cash'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                💵 {t.cash}
              </button>
              <button
                onClick={() => onSelectPayment('upi')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition ${
                  paymentMethod === 'upi'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                📱 {t.upi}
              </button>
            </div>
          </div>

          {/* Dynamic Estimated Pick-up Time Card (Before Booking Confirmation) */}
          {(() => {
            const eta = estimatePickupTime(
              pickup,
              selectedVehicle,
              bookingTiming,
              bookingTiming === 'schedule' ? scheduledTimestamp : undefined
            );

            return (
              <div className="bg-gradient-to-b from-blue-50/70 via-white to-slate-50 border-2 border-blue-200/90 rounded-2xl p-3 sm:p-3.5 shadow-sm flex flex-col gap-2 relative overflow-hidden">
                {/* Header Row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold shadow-xs">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs sm:text-sm font-extrabold text-slate-900 tracking-tight leading-tight">
                          {language === 'ta' ? 'மதிப்பிடப்பட்ட பிக்கப் நேரம்' : 'Estimated Pick-up Time'}
                        </span>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block" />
                      </div>
                      <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium">
                        {bookingTiming === 'schedule'
                          ? (language === 'ta' ? 'முன்பதிவு செய்யப்பட்ட திட்ட நேரம்' : 'Confirmed advance scheduled arrival')
                          : (language === 'ta' ? 'டிரைவர் உங்களை வந்து சேரும் நேரம்' : 'When driver will reach your location')}
                      </p>
                    </div>
                  </div>

                  {/* Highlighted Clock Time Badge */}
                  <div className="bg-blue-600 text-white px-2.5 py-1 rounded-xl text-xs sm:text-sm font-mono font-black shadow-xs flex items-center gap-1.5">
                    <span>
                      {bookingTiming === 'schedule'
                        ? eta.arrivalClockTime
                        : `~${eta.arrivalClockTime}`}
                    </span>
                  </div>
                </div>

                {/* Main Estimated Wait & Distance Details */}
                <div className="bg-white/90 border border-blue-100 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-2xl shrink-0">
                      {VEHICLE_CONFIGS[selectedVehicle]?.emoji || '🚖'}
                    </span>
                    <div className="min-w-0">
                      <p className="font-extrabold text-slate-900 text-xs sm:text-sm truncate">
                        {bookingTiming === 'schedule' ? (
                          language === 'ta' 
                            ? `${formatScheduleDisplay(scheduledTimestamp)} அன்று பிக்கப்` 
                            : `Pick-up on ${formatScheduleDisplay(scheduledTimestamp)}`
                        ) : (
                          language === 'ta'
                            ? `~${eta.waitMinutes} நிமிடங்களில் டிரைவர் வருவார்`
                            : `Driver reaches in ~${eta.waitMinutes} mins`
                        )}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {pickup?.shortName ? (
                          language === 'ta'
                            ? `${pickup.shortName} நோக்கி அருகிலுள்ள டிரைவர் (~${eta.distanceKm} கி.மீ)`
                            : `Nearest driver is ~${eta.distanceKm} km from ${pickup.shortName}`
                        ) : (
                          language === 'ta'
                            ? `அருகிலுள்ள டிரைவர் தொலைவு: ~${eta.distanceKm} கி.மீ`
                            : `Nearest driver distance: ~${eta.distanceKm} km`
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Dispatch Badge */}
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>{language === 'ta' ? `${eta.nearbyDriversCount} டிரைவர்கள் தயார்` : `${eta.nearbyDriversCount} drivers nearby`}</span>
                    </span>
                    <span className="text-[9px] text-slate-400 font-medium mt-0.5">
                      {eta.trafficLevel === 'moderate'
                        ? (language === 'ta' ? 'மிதமான போக்குவரத்து' : 'Moderate traffic')
                        : (language === 'ta' ? 'சாதாரண போக்குவரத்து' : 'Smooth traffic')}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Big Action Button */}
          {(() => {
            const maxDisc = Math.min(userPoints, Math.floor(currentFareBreakdown.totalAmount * 0.4));
            const disc = redeemPoints ? maxDisc : 0;
            const finalFare = Math.max(10, currentFareBreakdown.totalAmount - disc);

            return (
              <button
                disabled={bookingTiming === 'schedule' && !isScheduleTimeValid}
                onClick={() =>
                  onConfirmBooking(
                    redeemPoints && disc > 0 ? { pointsRedeemed: disc, discountAmount: disc } : undefined,
                    bookingTiming === 'schedule'
                      ? { isScheduled: true, scheduledTimeMs: scheduledTimestamp }
                      : { isScheduled: false, scheduledTimeMs: Date.now() }
                  )
                }
                className={`w-full mt-1 py-3.5 px-4 font-extrabold text-sm sm:text-base rounded-2xl shadow-xl active:scale-[0.98] transition flex items-center justify-between ${
                  bookingTiming === 'schedule' && !isScheduleTimeValid
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                    : 'bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-600 hover:to-amber-500 text-slate-950 shadow-amber-500/25'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {bookingTiming === 'schedule' ? '🗓️' : VEHICLE_CONFIGS[selectedVehicle]?.emoji}
                  </span>
                  <div className="text-left">
                    <div className="leading-tight">
                      {bookingTiming === 'schedule'
                        ? (language === 'ta'
                            ? `${VEHICLE_CONFIGS[selectedVehicle]?.nameTa} முன்பதிவு செய்`
                            : `Schedule ${VEHICLE_CONFIGS[selectedVehicle]?.nameEn}`)
                        : `${t.book_ride_for} ${language === 'ta' ? VEHICLE_CONFIGS[selectedVehicle]?.nameTa : VEHICLE_CONFIGS[selectedVehicle]?.nameEn}`}
                    </div>
                    {bookingTiming === 'schedule' && isScheduleTimeValid && (
                      <div className="text-[10px] text-amber-950/80 font-bold">
                        {formatScheduleDisplay(scheduledTimestamp)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-950 text-white px-3 py-1 rounded-xl text-xs sm:text-sm font-black">
                  {disc > 0 && (
                    <span className="line-through text-slate-400 text-xs">
                      ₹{currentFareBreakdown.totalAmount}
                    </span>
                  )}
                  <span>₹{finalFare}</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </button>
            );
          })()}
        </div>
      )}

      {/* Prompts when locations are incomplete */}
      {(!pickup || !drop) && (
        <div className="py-2 flex flex-col gap-2">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-2 text-xs text-amber-900 font-medium">
            <Sparkles className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>{t.select_both_points}</span>
          </div>

          {/* Quick Outstation Call Banner */}
          <div className="p-3 bg-slate-900 text-white rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-amber-400">
                {language === 'ta' ? 'அவுட் ஸ்டேஷன் & வெளியூர் டூர் முன்பதிவு' : 'All-India Outstation & Tour Booking'}
              </p>
              <p className="text-[11px] text-slate-300">
                {language === 'ta' ? '24/7 உதவி மையம்: ' + BUSINESS_CONFIG.supportPhone : '24/7 Helpline: ' + BUSINESS_CONFIG.supportPhone}
              </p>
            </div>
            <a
              href={`tel:${BUSINESS_CONFIG.supportPhone}`}
              className="p-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition"
              title="Call Now"
            >
              <PhoneCall className="w-4 h-4" />
            </a>
          </div>
        </div>
      )}

      {/* Saved Places Management Modal */}
      {showSavedPlacesModal && (
        <SavedPlacesModal
          language={language}
          onClose={() => {
            setShowSavedPlacesModal(false);
            setSavedPlaces(getStoredSavedPlaces());
          }}
          onSelectPlace={(place, target) => {
            const loc: LocationPoint = {
              lat: place.lat,
              lng: place.lng,
              address: place.address,
              shortName: place.shortName || place.title,
            };
            if (target === 'pickup') {
              onSelectPickup(loc);
            } else {
              onSelectDrop(loc);
            }
            playNotificationSound('confirmed');
            setSavedPlaces(getStoredSavedPlaces());
          }}
        />
      )}

      {/* Interactive Map Pin Picker Modal */}
      {mapPinPickerTarget && (
        <MapPinPickerModal
          language={language}
          target={mapPinPickerTarget}
          currentPoint={mapPinPickerTarget === 'pickup' ? pickup : drop}
          onConfirm={(location) => {
            if (mapPinPickerTarget === 'pickup') {
              onSelectPickup(location);
            } else {
              onSelectDrop(location);
            }
            playNotificationSound('confirmed');
            setMapPinPickerTarget(null);
          }}
          onClose={() => setMapPinPickerTarget(null)}
        />
      )}

      {/* OpenStreetMap Route & Turn-by-Turn Navigation Modal */}
      {showOsmNavModal && pickup && drop && (
        <OsmNavigationModal
          language={language}
          pickup={pickup}
          drop={drop}
          distanceKm={distanceKm}
          routeCoordinates={routeCoordinates}
          onClose={() => setShowOsmNavModal(false)}
        />
      )}
    </div>
  );
};
