/* ============================================
   PostSwap — US geocoding for map pins
   Large city set + state centroids + stable spread
   ============================================ */

(function (global) {
  "use strict";

  /** Major / mid-size US cities (lat, lng) */
  const CITY_COORDS = {
    // Southwest / Mountain
    "north las vegas": [36.1989, -115.1175],
    "las vegas": [36.1699, -115.1398],
    henderson: [36.0395, -114.9817],
    "reno": [39.5296, -119.8138],
    "sparks": [39.5349, -119.7527],
    phoenix: [33.4484, -112.074],
    mesa: [33.4152, -111.8315],
    "scottsdale": [33.4942, -111.9261],
    "chandler": [33.3062, -111.8413],
    "gilbert": [33.3528, -111.789],
    "glendale, az": [33.5387, -112.186],
    "peoria, az": [33.5806, -112.2374],
    tucson: [32.2226, -110.9747],
    "flagstaff": [35.1983, -111.6513],
    "yuma": [32.6927, -114.6277],
    albuquerque: [35.0844, -106.6504],
    "santa fe": [35.687, -105.9378],
    "las cruces": [32.3199, -106.7637],
    denver: [39.7392, -104.9903],
    "colorado springs": [38.8339, -104.8214],
    "aurora, co": [39.7294, -104.8319],
    "fort collins": [40.5853, -105.0844],
    "boulder": [40.015, -105.2705],
    "salt lake city": [40.7608, -111.891],
    "salt lake": [40.7608, -111.891],
    "west valley city": [40.6916, -112.0011],
    "provo": [40.2338, -111.6585],
    "ogden": [41.223, -111.9738],
    "boise": [43.615, -116.2023],
    "billings": [45.7833, -108.5007],
    "cheyenne": [41.14, -104.8202],

    // Pacific
    "los angeles": [34.0522, -118.2437],
    "long beach": [33.7701, -118.1937],
    "anaheim": [33.8366, -117.9143],
    "santa ana": [33.7455, -117.8677],
    "riverside": [33.9806, -117.3755],
    "san bernardino": [34.1083, -117.2898],
    "bakersfield": [35.3733, -119.0187],
    "fresno": [36.7378, -119.7871],
    "sacramento": [38.5816, -121.4944],
    "oakland": [37.8044, -122.2712],
    "san francisco": [37.7749, -122.4194],
    "san jose": [37.3382, -121.8863],
    "san diego": [32.7157, -117.1611],
    "stockton": [37.9577, -121.2908],
    "modesto": [37.6391, -120.9969],
    "irvine": [33.6846, -117.8265],
    "chula vista": [32.6401, -117.0842],
    "seattle": [47.6062, -122.3321],
    "tacoma": [47.2529, -122.4443],
    "spokane": [47.6588, -117.426],
    "vancouver, wa": [45.6387, -122.6615],
    "bellevue": [47.6101, -122.2015],
    "portland": [45.5152, -122.6784],
    "eugene": [44.0521, -123.0868],
    "salem, or": [44.9429, -123.0351],
    "honolulu": [21.3069, -157.8583],
    "anchorage": [61.2181, -149.9003],

    // South Central / Texas / OK / AR / LA
    dallas: [32.7767, -96.797],
    "fort worth": [32.7555, -97.3308],
    "arlington, tx": [32.7357, -97.1081],
    "plano": [33.0198, -96.6989],
    houston: [29.7604, -95.3698],
    "san antonio": [29.4241, -98.4936],
    austin: [30.2672, -97.7431],
    "el paso": [31.7619, -106.485],
    "corpus christi": [27.8006, -97.3964],
    "lubbock": [33.5779, -101.8552],
    "amarillo": [35.222, -101.8313],
    "oklahoma city": [35.4676, -97.5164],
    tulsa: [36.154, -95.9928],
    "little rock": [34.7465, -92.2896],
    "new orleans": [29.9511, -90.0715],
    "baton rouge": [30.4515, -91.1871],
    shreveport: [32.5252, -93.7502],

    // Midwest / Great Lakes
    chicago: [41.8781, -87.6298],
    "naperville": [41.7508, -88.1535],
    "aurora, il": [41.7606, -88.3201],
    "rockford": [42.2711, -89.094],
    "milwaukee": [43.0389, -87.9065],
    madison: [43.0731, -89.4012],
    "minneapolis": [44.9778, -93.265],
    "saint paul": [44.9537, -93.09],
    "st. paul": [44.9537, -93.09],
    "st paul": [44.9537, -93.09],
    "des moines": [41.5868, -93.625],
    "kansas city": [39.0997, -94.5786],
    "st. louis": [38.627, -90.1994],
    "st louis": [38.627, -90.1994],
    "saint louis": [38.627, -90.1994],
    "springfield, mo": [37.209, -93.2923],
    omaha: [41.2565, -95.9345],
    "wichita": [37.6872, -97.3301],
    "indianapolis": [39.7684, -86.1581],
    "fort wayne": [41.0793, -85.1394],
    "columbus, oh": [39.9612, -82.9988],
    cleveland: [41.4993, -81.6944],
    cincinnati: [39.1031, -84.512],
    toledo: [41.6528, -83.5379],
    "akron": [41.0814, -81.519],
    detroit: [42.3314, -83.0458],
    "grand rapids": [42.9634, -85.6681],
    "ann arbor": [42.2808, -83.743],
    "louisville": [38.2527, -85.7585],
    lexington: [38.0406, -84.5037],

    // Northeast
    "new york": [40.7128, -74.006],
    brooklyn: [40.6782, -73.9442],
    queens: [40.7282, -73.7949],
    bronx: [40.8448, -73.8648],
    "staten island": [40.5795, -74.1502],
    buffalo: [42.8864, -78.8784],
    rochester: [43.1566, -77.6088],
    albany: [42.6526, -73.7562],
    syracuse: [43.0481, -76.1474],
    "jersey city": [40.7178, -74.0431],
    newark: [40.7357, -74.1724],
    "paterson": [40.9168, -74.1718],
    philadelphia: [39.9526, -75.1652],
    pittsburgh: [40.4406, -79.9959],
    "allentown": [40.6084, -75.4902],
    boston: [42.3601, -71.0589],
    "worcester": [42.2626, -71.8023],
    springfield: [42.1015, -72.5898],
    "providence": [41.824, -71.4128],
    hartford: [41.7658, -72.6734],
    "new haven": [41.3083, -72.9279],
    "bridgeport": [41.1865, -73.1952],
    "manchester, nh": [42.9956, -71.4548],
    portland: [43.6591, -70.2568], // ME — note OR portland is longer key matched first if "portland, or"
    "portland, me": [43.6591, -70.2568],
    "portland, or": [45.5152, -122.6784],
    burlington: [44.4759, -73.2121],

    // Mid-Atlantic / Southeast
    baltimore: [39.2904, -76.6122],
    "washington": [38.9072, -77.0369],
    "washington, dc": [38.9072, -77.0369],
    "washington dc": [38.9072, -77.0369],
    "arlington, va": [38.8816, -77.091],
    "virginia beach": [36.8529, -75.978],
    norfolk: [36.8508, -76.2859],
    richmond: [37.5407, -77.436],
    "charlotte": [35.2271, -80.8431],
    raleigh: [35.7796, -78.6382],
    durham: [35.994, -78.8986],
    "greensboro": [36.0726, -79.792],
    "winston-salem": [36.0999, -80.2442],
    "charleston, sc": [32.7765, -79.9311],
    columbia: [34.0007, -81.0348],
    greenville: [34.8526, -82.394],
    atlanta: [33.749, -84.388],
    savannah: [32.0809, -81.0912],
    "augusta": [33.4735, -82.0105],
    jacksonville: [30.3322, -81.6557],
    miami: [25.7617, -80.1918],
    tampa: [27.9506, -82.4572],
    orlando: [28.5383, -81.3792],
    "st. petersburg": [27.7676, -82.6403],
    "fort lauderdale": [26.1224, -80.1373],
    tallahassee: [30.4383, -84.2807],
    birmingham: [33.5186, -86.8104],
    mobile: [30.6954, -88.0399],
    huntsville: [34.7304, -86.5861],
    memphis: [35.1495, -90.049],
    nashville: [36.1627, -86.7816],
    knoxville: [35.9606, -83.9207],
    chattanooga: [35.0456, -85.3097],
    "jackson, ms": [32.2988, -90.1848],
    "gulfport": [30.3674, -89.0928],

    // Other majors
    "las vegas": [36.1699, -115.1398],
    phoenix: [33.4484, -112.074],
    philadelphia: [39.9526, -75.1652],
    "san diego": [32.7157, -117.1611],
    "san antonio": [29.4241, -98.4936],
    "new york city": [40.7128, -74.006],
    nyc: [40.7128, -74.006],
    "sioux falls": [43.5446, -96.7311],
    fargo: [46.8772, -96.7898],
    "rapid city": [44.0805, -103.231],
    "green bay": [44.5133, -88.0133],
    "cedar rapids": [41.9778, -91.6656],
    "iowa city": [41.6611, -91.5302],
    lincoln: [40.8258, -96.6852],
    "overland park": [38.9822, -94.6708],
    "independence, mo": [39.0911, -94.4155],
    "toledo": [41.6528, -83.5379],
    "dayton": [39.7589, -84.1916],
    "youngstown": [41.0998, -80.6495],
    "erie": [42.1292, -80.0851],
    "harrisburg": [40.2732, -76.8867],
    "scranton": [41.409, -75.6624],
    "wilmington": [39.7391, -75.5398],
    "trenton": [40.2206, -74.7597],
    "camden": [39.9259, -75.1196],
    "white plains": [41.034, -73.7629],
    "yonkers": [40.9312, -73.8987],
    "new rochelle": [40.9115, -73.7824],
  };

  /** State centroids (continental + AK/HI) */
  const STATE_COORDS = {
    AL: [32.8067, -86.7911],
    AK: [61.3707, -152.4044],
    AZ: [33.7298, -111.4312],
    AR: [34.9697, -92.3731],
    CA: [36.1162, -119.6816],
    CO: [39.0598, -105.3111],
    CT: [41.5978, -72.7554],
    DE: [39.3185, -75.5071],
    DC: [38.9072, -77.0369],
    FL: [27.7663, -81.6868],
    GA: [33.0406, -83.6431],
    HI: [21.0943, -157.4983],
    ID: [44.2405, -114.4788],
    IL: [40.3495, -88.9861],
    IN: [39.8494, -86.2583],
    IA: [42.0115, -93.2105],
    KS: [38.5266, -96.7265],
    KY: [37.6681, -84.6701],
    LA: [31.1695, -91.8678],
    ME: [44.6939, -69.3819],
    MD: [39.0639, -76.8021],
    MA: [42.2304, -71.5301],
    MI: [43.3266, -84.5361],
    MN: [45.6945, -93.9002],
    MS: [32.7416, -89.6787],
    MO: [38.4561, -92.2884],
    MT: [46.9219, -110.4544],
    NE: [41.1254, -98.2681],
    NV: [38.3135, -117.0554],
    NH: [43.4525, -71.5639],
    NJ: [40.2989, -74.521],
    NM: [34.8405, -106.2485],
    NY: [42.1657, -74.9481],
    NC: [35.6301, -79.8064],
    ND: [47.5289, -99.784],
    OH: [40.3888, -82.7649],
    OK: [35.5653, -96.9289],
    OR: [44.572, -122.0709],
    PA: [40.5908, -77.2098],
    RI: [41.6809, -71.5118],
    SC: [33.8569, -80.945],
    SD: [44.2998, -99.4388],
    TN: [35.7478, -86.6923],
    TX: [31.0545, -97.5635],
    UT: [40.15, -111.8624],
    VT: [44.0459, -72.7107],
    VA: [37.7693, -78.17],
    WA: [47.4009, -121.4905],
    WV: [38.4912, -80.9545],
    WI: [44.2685, -89.6165],
    WY: [42.7559, -107.3025],
  };

  const STATE_NAMES = {
    alabama: "AL",
    alaska: "AK",
    arizona: "AZ",
    arkansas: "AR",
    california: "CA",
    colorado: "CO",
    connecticut: "CT",
    delaware: "DE",
    "district of columbia": "DC",
    florida: "FL",
    georgia: "GA",
    hawaii: "HI",
    idaho: "ID",
    illinois: "IL",
    indiana: "IN",
    iowa: "IA",
    kansas: "KS",
    kentucky: "KY",
    louisiana: "LA",
    maine: "ME",
    maryland: "MD",
    massachusetts: "MA",
    michigan: "MI",
    minnesota: "MN",
    mississippi: "MS",
    missouri: "MO",
    montana: "MT",
    nebraska: "NE",
    nevada: "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    ohio: "OH",
    oklahoma: "OK",
    oregon: "OR",
    pennsylvania: "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    tennessee: "TN",
    texas: "TX",
    utah: "UT",
    vermont: "VT",
    virginia: "VA",
    washington: "WA",
    "west virginia": "WV",
    wisconsin: "WI",
    wyoming: "WY",
  };

  const CITY_KEYS = Object.keys(CITY_COORDS).sort(function (a, b) {
    return b.length - a.length;
  });

  function hashStr(str) {
    var h = 2166136261;
    var s = String(str || "");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function jitter(coords, seed, spread) {
    var s = typeof seed === "number" ? seed : hashStr(seed);
    var sp = spread == null ? 0.12 : spread;
    // Deterministic pseudo-random in [-0.5, 0.5]
    var r1 = ((s % 10000) / 10000) - 0.5;
    var r2 = ((((s / 10000) | 0) % 10000) / 10000) - 0.5;
    return {
      lat: coords[0] + r1 * sp,
      lng: coords[1] + r2 * sp,
    };
  }

  /** Spread unknown places across CONUS so they don't stack in AZ */
  function usSpreadFallback(seed) {
    var s = typeof seed === "number" ? seed : hashStr(seed);
    // Continental US-ish box (excludes stacking in one metro)
    var lat = 26 + ((s % 1000) / 1000) * 22; // ~26–48
    var lng = -124 + ((((s / 1000) | 0) % 1000) / 1000) * 56; // ~-124–-68
    // Small secondary jitter
    lat += (((s % 97) / 97) - 0.5) * 0.4;
    lng += ((((s / 97) | 0) % 89) / 89 - 0.5) * 0.4;
    return { lat: lat, lng: lng };
  }

  function extractStateAbbr(lower) {
    // ", ny" or " ny" at end
    var m = lower.match(/,\s*([a-z]{2})\s*$/i);
    if (m) return m[1].toUpperCase();
    m = lower.match(/\s([a-z]{2})\s*$/i);
    if (m) {
      var ab = m[1].toUpperCase();
      if (STATE_COORDS[ab]) return ab;
    }
    // full state name
    var names = Object.keys(STATE_NAMES).sort(function (a, b) {
      return b.length - a.length;
    });
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (lower.indexOf(name) !== -1) return STATE_NAMES[name];
    }
    return null;
  }

  /**
   * Geocode a free-text location for map pins.
   * @param {string} locationStr
   * @param {string|number} [seed] - stable seed (e.g. swap id) for jitter
   */
  function geocode(locationStr, seed) {
    var raw = String(locationStr || "").trim();
    var lower = raw.toLowerCase().replace(/\./g, "");
    var seedKey = seed != null ? String(seed) + "|" + raw : raw;
    var h = hashStr(seedKey);

    // 1) Longest city name match first
    for (var i = 0; i < CITY_KEYS.length; i++) {
      var key = CITY_KEYS[i];
      if (lower.indexOf(key) !== -1) {
        return jitter(CITY_COORDS[key], h, 0.08);
      }
    }

    // 2) State from ", XX" / full name → state centroid with wider spread
    var st = extractStateAbbr(lower);
    if (st && STATE_COORDS[st]) {
      return jitter(STATE_COORDS[st], h, 1.8);
    }

    // 3) Last-resort CONUS spread (NOT Arizona-only)
    return usSpreadFallback(h);
  }

  function regionFromLocation(loc) {
    var l = String(loc || "").toLowerCase();
    var st = extractStateAbbr(l);
    var southwest = { AZ: 1, NM: 1, NV: 1, UT: 1 };
    var pacific = { CA: 1, OR: 1, WA: 1, HI: 1, AK: 1 };
    var mountain = { CO: 1, WY: 1, MT: 1, ID: 1 };
    var southCentral = { TX: 1, OK: 1, AR: 1, LA: 1 };
    var greatLakes = { IL: 1, IN: 1, MI: 1, OH: 1, WI: 1, MN: 1, IA: 1 };
    var southeast = {
      FL: 1,
      GA: 1,
      AL: 1,
      MS: 1,
      TN: 1,
      SC: 1,
      NC: 1,
      KY: 1,
    };
    var northeast = {
      NY: 1,
      NJ: 1,
      PA: 1,
      CT: 1,
      MA: 1,
      RI: 1,
      NH: 1,
      VT: 1,
      ME: 1,
      MD: 1,
      DE: 1,
      DC: 1,
      VA: 1,
      WV: 1,
    };

    if (st) {
      if (southwest[st]) return "Southwest Region";
      if (pacific[st]) return "Pacific Region";
      if (mountain[st]) return "Mountain West";
      if (southCentral[st]) return "South Central";
      if (greatLakes[st]) return "Great Lakes";
      if (southeast[st]) return "Southeast Region";
      if (northeast[st]) return "Northeast Region";
      if (st === "MO" || st === "KS" || st === "NE" || st === "SD" || st === "ND")
        return "Midwest";
    }

    if (/nv|az|nm|las vegas|phoenix|tucson|henderson|mesa/.test(l))
      return "Southwest Region";
    if (/ca|or|wa|san diego|los angeles|seattle|portland/.test(l))
      return "Pacific Region";
    if (/co|ut|mt|id|wy|denver|salt lake|boise/.test(l)) return "Mountain West";
    if (/tx|ok|ar|la|dallas|houston|austin|san antonio/.test(l))
      return "South Central";
    if (/il|in|mi|oh|wi|mn|chicago|detroit|columbus|milwaukee/.test(l))
      return "Great Lakes";
    if (/ga|fl|nc|sc|tn|al|ms|atlanta|miami|tampa|nashville/.test(l))
      return "Southeast Region";
    if (/ny|nj|pa|ma|ct|md|boston|philadelphia|new york/.test(l))
      return "Northeast Region";
    return "United States";
  }

  var api = {
    geocode: geocode,
    regionFromLocation: regionFromLocation,
    CITY_COORDS: CITY_COORDS,
    STATE_COORDS: STATE_COORDS,
  };

  global.PostSwapGeocode = api;
  if (typeof window !== "undefined") window.PostSwapGeocode = api;
  if (typeof globalThis !== "undefined") globalThis.PostSwapGeocode = api;
})(typeof window !== "undefined" ? window : globalThis);
