/* ============================================
   PostSwap — Supabase REST helpers (fetch API)
   BUILD: 2026-11-25auth
   Auth is Supabase Auth (anon key + user access token).
   Matched to existing project tables:
     - public.swaps
     - public."messages (for DMs)"
   Profiles use public.profiles for the signed-in user
   and public.profiles_public for display names.
   ============================================ */

(function (global) {
  "use strict";

  const BUILD = "2026-11-25auth";
  const SUPABASE_URL = "https://olfystbcngdcevtndkdq.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZnlzdGJjbmdkY2V2dG5ka2RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MzE5NTMsImV4cCI6MjA5OTIwNzk1M30.Kr47X97Wrpppt2Vs-XhOzYMsQD8PmAPwbuWEyG8xEAk";
  const SITE_URL = "https://post-swap.com";
  const PASSWORD_REDIRECT = SITE_URL + "/set-password";

  const REST = `${SUPABASE_URL}/rest/v1`;

  let authClient = null;
  if (global.supabase && typeof global.supabase.createClient === "function") {
    authClient = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit",
      },
    });
  }

  function requireAuthClient() {
    if (!authClient) {
      const err = new Error("Sign-in isn’t available right now.");
      err.status = 503;
      throw err;
    }
    return authClient;
  }

  function asAuthError(error) {
    const err = new Error((error && error.message) || "Auth request failed");
    err.code = error && (error.code || error.error_code);
    err.status = error && error.status;
    return err;
  }

  const auth = {
    signIn: async function (email, password) {
      const result = await requireAuthClient().auth.signInWithPassword({
        email: email,
        password: password,
      });
      if (result.error) throw asAuthError(result.error);
      return result.data;
    },
    signUp: async function (args) {
      const input = args || {};
      const result = await requireAuthClient().auth.signUp({
        email: input.email,
        password: input.password,
        options: input.options || {},
      });
      if (result.error) throw asAuthError(result.error);
      return result.data;
    },
    signOut: async function () {
      const result = await requireAuthClient().auth.signOut();
      if (result.error) throw asAuthError(result.error);
    },
    resetPassword: async function (email) {
      const result = await requireAuthClient().auth.resetPasswordForEmail(email, {
        redirectTo: PASSWORD_REDIRECT,
      });
      if (result.error) throw asAuthError(result.error);
      return result.data;
    },
    updatePassword: async function (password) {
      const result = await requireAuthClient().auth.updateUser({ password: password });
      if (result.error) throw asAuthError(result.error);
      return result.data;
    },
    getSession: async function () {
      if (!authClient) return null;
      const result = await authClient.auth.getSession();
      if (result.error) throw asAuthError(result.error);
      return (result.data && result.data.session) || null;
    },
    onChange: function (callback) {
      if (!authClient) {
        return { data: { subscription: { unsubscribe: function () {} } } };
      }
      return authClient.auth.onAuthStateChange(callback);
    },
    resendSignup: async function (email) {
      const result = await requireAuthClient().auth.resend({
        type: "signup",
        email: email,
        options: { emailRedirectTo: SITE_URL + "/" },
      });
      if (result.error) throw asAuthError(result.error);
      return result.data;
    },
  };

  /** Encode a table name for the REST path, including spaces and parentheses. */
  function encodeRestSegment(name) {
    return encodeURIComponent(name).replace(/[!'()*]/g, function (ch) {
      return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
    });
  }

  // public."messages (for DMs)" — never request this table without a participant filter.
  const MESSAGES_TABLE = encodeRestSegment("messages (for DMs)");

  async function bearerToken() {
    try {
      const session = await auth.getSession();
      const token = session && session.access_token;
      if (token) return token;
    } catch (_) {
      /* The public anon key still authorizes reads of open swaps. */
    }
    return SUPABASE_ANON_KEY;
  }

  function headers(extra, token) {
    return Object.assign(
      {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + (token || SUPABASE_ANON_KEY),
        "Content-Type": "application/json",
      },
      extra || {}
    );
  }

  async function request(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const url = `${REST}${path}`;
    const token = await bearerToken();
    const hdrs = headers(options.headers || {}, token);

    console.log(`[PostSwapDB] ${method} ${url}`, {
      body: options.body ? safeParse(options.body) : undefined,
    });

    let res;
    try {
      res = await fetch(url, {
        ...options,
        headers: hdrs,
      });
    } catch (networkErr) {
      console.error("[PostSwapDB] Network error", {
        method,
        url,
        message: networkErr && networkErr.message,
        error: networkErr,
      });
      const err = new Error(
        `Network error talking to Supabase: ${networkErr && networkErr.message}`
      );
      err.cause = networkErr;
      err.isNetwork = true;
      throw err;
    }

    if (res.status === 204) {
      console.log(`[PostSwapDB] ${method} ${path} → 204 No Content`);
      return null;
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const msg =
        (data && (data.message || data.error_description || data.hint || data.code)) ||
        (typeof data === "string" ? data : res.statusText) ||
        `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      err.path = path;
      err.method = method;
      console.error("[PostSwapDB] Request failed", {
        method,
        path,
        status: res.status,
        statusText: res.statusText,
        message: msg,
        response: data,
        hint:
          res.status === 401 || res.status === 403
            ? "Auth/RLS issue — disable RLS on the table or add INSERT policy for anon."
            : res.status === 404
              ? "Table/route not found — check table name in Supabase."
              : res.status === 400
                ? "Bad request — check column names match the table schema."
                : null,
      });
      throw err;
    }

    console.log(`[PostSwapDB] ${method} ${path} → ${res.status}`, data);
    return data;
  }

  function safeParse(body) {
    if (typeof body !== "string") return body;
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  function geocode(cityStr, seed) {
    if (global.PostSwapGeocode && typeof global.PostSwapGeocode.geocode === "function") {
      return global.PostSwapGeocode.geocode(cityStr, seed != null ? seed : cityStr);
    }
    // CONUS spread fallback (never AZ-only stack)
    var h = 2166136261;
    var s = String(seed != null ? seed : cityStr || "us");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = h >>> 0;
    return {
      lat: 26 + ((h % 1000) / 1000) * 22,
      lng: -124 + ((((h / 1000) | 0) % 1000) / 1000) * 56,
    };
  }

  function regionFromLocation(loc) {
    if (
      global.PostSwapGeocode &&
      typeof global.PostSwapGeocode.regionFromLocation === "function"
    ) {
      return global.PostSwapGeocode.regionFromLocation(loc);
    }
    return "United States";
  }

  function blankToNull(value) {
    if (value == null) return null;
    const text = String(value).trim();
    return text ? text : null;
  }

  function lookupStoredCity(city, state) {
    if (
      !city ||
      !state ||
      !global.PostSwapGeocode ||
      typeof global.PostSwapGeocode.lookupCity !== "function"
    ) {
      return null;
    }
    return global.PostSwapGeocode.lookupCity(city, state);
  }

  /** Map DB row → app swap shape */
  function mapSwapFromDb(row) {
    if (!row) return null;
    const current = row.current_location || "";
    const desired = row.desired_location || "";
    const currentCity = row.current_city || "";
    const currentState = row.current_state || "";
    const desiredCity = row.desired_city || "";
    const desiredState = row.desired_state || "";
    const hit = lookupStoredCity(currentCity, currentState);
    let lat;
    let lng;
    let currentQuality;
    if (hit) {
      lat = hit.lat;
      lng = hit.lng;
      currentQuality = "city";
    } else if (row.lat != null && row.lng != null && currentCity && currentState) {
      lat = Number(row.lat);
      lng = Number(row.lng);
      currentQuality = "city";
    } else {
      const coords = geocode(current, row.id != null ? row.id : current);
      lat = coords.lat;
      lng = coords.lng;
      currentQuality = coords.quality || "approx";
    }
    let desiredMode = "";
    let desiredQuality = "";
    let desiredLat = null;
    let desiredLng = null;
    const desiredHit = lookupStoredCity(desiredCity, desiredState);
    if (desiredHit) {
      desiredMode = "city";
      desiredQuality = "city";
      desiredLat = desiredHit.lat;
      desiredLng = desiredHit.lng;
    } else if (
      global.PostSwapGeocode &&
      typeof global.PostSwapGeocode.parseLocation === "function"
    ) {
      const parsed = global.PostSwapGeocode.parseLocation(desired);
      if (parsed && parsed.ok && parsed.kind === "city") {
        desiredMode = "city";
        desiredQuality = "city";
        desiredLat = parsed.lat;
        desiredLng = parsed.lng;
      } else if (parsed && parsed.ok && parsed.kind === "region") {
        desiredMode = "region";
        desiredQuality = "region";
        desiredLat = parsed.lat;
        desiredLng = parsed.lng;
      } else if (parsed && parsed.ok && parsed.kind === "anywhere") {
        desiredMode = "anywhere";
        desiredQuality = "anywhere";
      }
    }
    const region = regionFromLocation(current);
    const username = row.username || null;
    return {
      id: row.id,
      current,
      desired,
      craft: row.craft || "Letter Carrier",
      seniority: Number(row.seniority) || 0,
      swapType: row.swap_type || "Permanent",
      notes: row.notes || "",
      lat,
      lng,
      currentQuality,
      currentCity,
      currentState,
      currentZip: row.current_zip || "",
      desiredCity,
      desiredState,
      desiredZip: row.desired_zip || "",
      desiredMode,
      desiredQuality,
      desiredLat,
      desiredLng,
      region,
      privacyLabel: username
        ? `PostSwap Member • ${username}`
        : `PostSwap Member • ${region}`,
      ownerId: row.user_id || null,
      username: username,
      createdAt: row.created_at || null,
      status: row.status ? String(row.status).toLowerCase() : "open",
    };
  }

  function mapSwapToDb(swap) {
    return {
      current_location: swap.current,
      desired_location: swap.desired,
      current_city: blankToNull(swap.currentCity),
      current_state: blankToNull(swap.currentState),
      current_zip: blankToNull(swap.currentZip),
      desired_city: blankToNull(swap.desiredCity),
      desired_state: blankToNull(swap.desiredState),
      desired_zip: blankToNull(swap.desiredZip),
      lat: swap.lat == null ? null : Number(swap.lat),
      lng: swap.lng == null ? null : Number(swap.lng),
      craft: swap.craft,
      seniority: swap.seniority,
      notes: swap.notes || "",
      user_id: swap.ownerId || null,
      username: swap.username || null,
    };
  }

  const LOCATION_COLUMNS = [
    "current_city",
    "current_state",
    "current_zip",
    "desired_city",
    "desired_state",
    "desired_zip",
    "lat",
    "lng",
  ];

  function locationColumnError(err) {
    const msg = String((err && err.message) || "");
    return !!(
      err &&
      err.status === 400 &&
      /current_city|current_state|current_zip|desired_city|desired_state|desired_zip|'lat'|'lng'|"lat"|"lng"|schema cache/i.test(
        msg
      )
    );
  }

  function withoutLocationColumns(body) {
    const copy = Object.assign({}, body);
    LOCATION_COLUMNS.forEach(function (key) {
      delete copy[key];
    });
    return copy;
  }

  function mapProfileFromDb(row) {
    if (!row) return null;
    let notifications = row.notifications;
    if (typeof notifications === "string") {
      try {
        notifications = JSON.parse(notifications);
      } catch {
        notifications = null;
      }
    }
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      craft: row.craft || "Letter Carrier",
      station: row.station || "",
      state: row.state || "",
      initials: row.initials || "",
      employeeId: row.employee_id || "",
      notifications: notifications || null,
    };
  }

  function mapProfileToDb(profile) {
    return {
      id: String(profile.id),
      name: profile.name,
      email: profile.email,
      craft: profile.craft || null,
      station: profile.station || null,
      state: profile.state || null,
      initials: profile.initials || null,
      employee_id: profile.employeeId || null,
      notifications: profile.notifications || null,
      updated_at: new Date().toISOString(),
    };
  }

  // ---------- Swaps ----------
  async function fetchSwaps() {
    console.log("[PostSwapDB] fetchSwaps()");
    try {
      const rows = await request("/swaps?select=*&order=created_at.desc");
      const mapped = (rows || [])
        .filter((r) => r.current_location && r.desired_location)
        .map(mapSwapFromDb);
      console.log("[PostSwapDB] fetchSwaps result count:", mapped.length, mapped);
      return mapped;
    } catch (err) {
      console.error("[PostSwapDB] fetchSwaps FAILED", {
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        error: err,
      });
      throw err;
    }
  }

  function finishMappedSwap(row, swap) {
    const mapped = mapSwapFromDb(row);
    if (!mapped || !swap) return mapped;
    if (swap.lat != null && swap.lng != null) {
      mapped.lat = Number(swap.lat);
      mapped.lng = Number(swap.lng);
      mapped.currentQuality = swap.currentQuality || mapped.currentQuality || "city";
    }
    ["currentCity", "currentState", "currentZip", "desiredCity", "desiredState", "desiredZip", "desiredMode", "desiredQuality"].forEach(
      function (key) {
        if (swap[key] != null && swap[key] !== "") mapped[key] = swap[key];
      }
    );
    if (swap.desiredCity === null) mapped.desiredCity = "";
    if (swap.desiredState === null) mapped.desiredState = "";
    if (swap.desiredZip === null) mapped.desiredZip = "";
    if (swap.desiredLat !== undefined) mapped.desiredLat = swap.desiredLat;
    if (swap.desiredLng !== undefined) mapped.desiredLng = swap.desiredLng;
    if (swap.swapType) mapped.swapType = swap.swapType;
    if (swap.region) mapped.region = swap.region;
    if (swap.privacyLabel) mapped.privacyLabel = swap.privacyLabel;
    if (swap.locationColumnsMissing) mapped.locationColumnsMissing = true;
    return mapped;
  }

  async function insertSwapBody(body, swap) {
    const rows = await request("/swaps", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) {
      console.error("[PostSwapDB] createSwap: empty response row", rows);
      throw new Error("Supabase returned no swap row after INSERT");
    }
    return finishMappedSwap(row, swap);
  }

  async function createSwap(swap) {
    if (!swap || swap.ownerId == null || String(swap.ownerId).trim() === "" || String(swap.ownerId) === "guest") {
      const err = new Error("Log in or join free to post / message.");
      err.status = 401;
      throw err;
    }
    const body = mapSwapToDb(swap);
    console.log("[PostSwapDB] createSwap payload →", body);
    try {
      const mapped = await insertSwapBody(body, swap);
      console.log("[PostSwapDB] createSwap success →", mapped);
      return mapped;
    } catch (err) {
      if (locationColumnError(err)) {
        console.warn("[PostSwapDB] location columns missing — saving City, ST text only");
        const mapped = await insertSwapBody(
          withoutLocationColumns(body),
          Object.assign({}, swap, { locationColumnsMissing: true })
        );
        console.log("[PostSwapDB] createSwap success without location columns →", mapped);
        return mapped;
      }
      console.error("[PostSwapDB] createSwap FAILED", {
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        payload: body,
        tip:
          "If status is 401/403: the swap must be posted as the signed-in user. " +
          "If 400: column mismatch. If network: check CORS / project URL.",
      });
      throw err;
    }
  }

  function requireSwapOwner(ownerId) {
    if (ownerId == null || String(ownerId).trim() === "" || String(ownerId) === "guest") {
      const err = new Error("Sign in to change your own swap.");
      err.status = 401;
      throw err;
    }
  }

  function pgTopEq(col, val) {
    const v = String(val);
    if (/[\s,():."']/.test(v) || v.indexOf("•") !== -1) {
      return col + '=eq."' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }
    return col + "=eq." + encodeURIComponent(v);
  }

  function swapOwnedPath(swapId, ownerId) {
    return "/swaps?" + pgTopEq("id", swapId) + "&" + pgTopEq("user_id", ownerId);
  }

  /**
   * Update one swap. The request is limited to user_id = ownerId, and ownerId is required.
   * Does not change who owns the row.
   */
  async function updateSwap(swapId, patch, ownerId) {
    requireSwapOwner(ownerId);
    if (swapId == null || String(swapId).startsWith("local-")) {
      throw new Error("This swap isn’t saved on the server yet.");
    }
    const body = {};
    const src = patch || {};
    if (src.current != null) body.current_location = src.current;
    if (src.desired != null) body.desired_location = src.desired;
    if (src.currentCity !== undefined) body.current_city = blankToNull(src.currentCity);
    if (src.currentState !== undefined) body.current_state = blankToNull(src.currentState);
    if (src.currentZip !== undefined) body.current_zip = blankToNull(src.currentZip);
    if (src.desiredCity !== undefined) body.desired_city = blankToNull(src.desiredCity);
    if (src.desiredState !== undefined) body.desired_state = blankToNull(src.desiredState);
    if (src.desiredZip !== undefined) body.desired_zip = blankToNull(src.desiredZip);
    if (src.lat !== undefined) body.lat = src.lat == null ? null : Number(src.lat);
    if (src.lng !== undefined) body.lng = src.lng == null ? null : Number(src.lng);
    if (src.craft != null) body.craft = src.craft;
    if (src.seniority != null) body.seniority = src.seniority;
    if (src.notes != null) body.notes = src.notes;
    if (src.username != null) body.username = src.username;
    if (src.status != null) {
      const status = String(src.status).toLowerCase();
      if (status !== "open" && status !== "closed" && status !== "archived") {
        throw new Error("Status must be open, closed, or archived.");
      }
      body.status = status;
    }
    if (!Object.keys(body).length) throw new Error("Nothing to update.");
    console.log("[PostSwapDB] updateSwap", swapId, body);
    try {
      return await patchOwnedSwap(swapId, ownerId, body, src);
    } catch (err) {
      if (!locationColumnError(err)) throw err;
      const slim = withoutLocationColumns(body);
      if (!Object.keys(slim).length) throw err;
      console.warn("[PostSwapDB] location columns missing — updating City, ST text only");
      const mapped = await patchOwnedSwap(swapId, ownerId, slim, src);
      mapped.locationColumnsMissing = true;
      return mapped;
    }
  }

  async function patchOwnedSwap(swapId, ownerId, body, src) {
    const rows = await request(swapOwnedPath(swapId, ownerId), {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("That swap wasn’t updated. Only the owner can change it.");
    return finishMappedSwap(row, src);
  }

  /**
   * Delete one swap. Refuses a call with no owner id, and the DELETE
   * only matches a row whose user_id is that owner.
   */
  async function deleteSwap(swapId, ownerId) {
    requireSwapOwner(ownerId);
    if (swapId == null || String(swapId).startsWith("local-")) {
      throw new Error("This swap isn’t saved on the server yet.");
    }
    console.log("[PostSwapDB] deleteSwap", swapId);
    const rows = await request(swapOwnedPath(swapId, ownerId), {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error("That swap wasn’t deleted. Only the owner can remove it.");
    return mapSwapFromDb(row);
  }

  // ---------- Messages (DMs) — table name includes spaces ----------
  function mapMessageRow(r) {
    return {
      id: r.id,
      swapId: r.swap_id,
      senderId: r.from_user || "anonymous",
      toUser: r.to_user || null,
      body: r.message || "",
      createdAt: r.created_at,
    };
  }

  /** Build PostgREST eq filter value (quote if needed). */
  function pgEq(col, val) {
    const v = String(val);
    // Quote values with reserved/special characters
    if (/[\s,():."']/.test(v) || v.indexOf("•") !== -1) {
      return col + '.eq."' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }
    return col + ".eq." + encodeURIComponent(v);
  }

  /**
   * Server filter is the auth user id. Email and display-name keys stay local
   * for labeling. They are not sent as a stand-in for auth.uid().
   */
  function serverParticipantKeys(userOrKeys) {
    if (Array.isArray(userOrKeys)) {
      const ids = userOrKeys.filter(function (k) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(k || ""));
      });
      return ids.length ? [String(ids[0])] : [];
    }
    if (userOrKeys && userOrKeys.id) return [String(userOrKeys.id)];
    return [];
  }

  /**
   * Identity keys for the logged-in user (id, username-style labels, email, name).
   * Used so older rows stored under username still match on screen.
   */
  function userIdentityKeys(user) {
    if (!user) return [];
    const keys = [];
    const push = (v) => {
      if (v == null || v === "") return;
      const s = String(v).trim();
      if (s && keys.indexOf(s) === -1) keys.push(s);
    };
    push(user.id);
    push(user.user_id);
    push(user.email);
    push(user.name);
    push(user.username);
    push(user.initials);
    if (user.name) {
      const first = String(user.name).split(/\s+/)[0];
      push(first);
      // Matches swap username format used when posting
      push(first + " • " + (user.state || "US"));
      push(first + " • " + (user.state || ""));
    }
    return keys;
  }

  /** Nested or(...) for PostgREST and=(); top-level uses or=() */
  function userParticipationOrInner(userKeys) {
    const parts = [];
    (userKeys || []).forEach(function (k) {
      parts.push(pgEq("from_user", k));
      parts.push(pgEq("to_user", k));
    });
    if (!parts.length) return null;
    return "or(" + parts.join(",") + ")";
  }

  function userParticipationOrQuery(userKeys) {
    const parts = [];
    (userKeys || []).forEach(function (k) {
      parts.push(pgEq("from_user", k));
      parts.push(pgEq("to_user", k));
    });
    if (!parts.length) return null;
    return "or=(" + parts.join(",") + ")";
  }

  function messageInvolvesUser(m, keySet) {
    const from = String(m.senderId || "").toLowerCase();
    const to = String(m.toUser || "").toLowerCase();
    return !!(keySet[from] || keySet[to]);
  }

  function keySetFromList(keys) {
    const keySet = {};
    (keys || []).forEach(function (k) {
      keySet[String(k || "").toLowerCase()] = true;
    });
    return keySet;
  }

  function indexProfiles(profiles) {
    const map = new Map();
    (profiles || []).forEach(function (p) {
      if (!p) return;
      userIdentityKeys(p).forEach(function (k) {
        if (k == null || k === "") return;
        map.set(String(k).toLowerCase(), p);
      });
    });
    return map;
  }

  function looksLikeRawId(value) {
    const s = String(value || "").trim();
    if (!s) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
    if (/^user-\d{6,}/i.test(s)) return true;
    if (/^[0-9a-f]{20,}$/i.test(s)) return true;
    return false;
  }

  function readableLabel(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    const lower = s.toLowerCase();
    if (lower === "anonymous" || lower === "guest" || lower === "verified carrier") return "";
    if (looksLikeRawId(s)) return "";
    if (/^verified carrier\b/i.test(s)) {
      const rest = s.replace(/^verified carrier\s*[•·|\-–—:]+\s*/i, "").trim();
      return readableLabel(rest);
    }
    return s;
  }

  function shortNameFromEmail(email) {
    const s = String(email || "").trim();
    if (s.indexOf("@") === -1) return "";
    const local = s.split("@")[0].replace(/[._]+/g, " ").trim();
    if (local && !looksLikeRawId(local) && local.toLowerCase() !== "verified carrier") return local;
    return s;
  }

  /**
   * Visible sender name: profile name, then the stored from_user value,
   * then a short email name. Never a raw UUID or "Verified Carrier".
   */
  function displayNameFor(raw, profileIndex) {
    const s = String(raw || "").trim();
    const profile =
      profileIndex && typeof profileIndex.get === "function" && s
        ? profileIndex.get(s.toLowerCase())
        : null;
    if (profile) {
      const name = readableLabel(profile.name);
      if (name) return name;
      const fromEmail = shortNameFromEmail(profile.email);
      if (fromEmail) return fromEmail;
    }
    const direct = readableLabel(s);
    if (!direct) return "Carrier";
    if (direct.indexOf("@") !== -1) return shortNameFromEmail(direct) || direct;
    if (direct.length > 48) return "Carrier";
    return direct;
  }

  function canonicalPartyToken(raw, swap, profileIndex) {
    const s = String(raw || "").trim();
    if (!s) return "unknown";
    const lower = s.toLowerCase();
    const profile =
      profileIndex && typeof profileIndex.get === "function" ? profileIndex.get(lower) : null;
    if (profile && profile.id) return "id:" + String(profile.id).toLowerCase();
    if (swap) {
      const ownerId = swap.ownerId ? String(swap.ownerId).toLowerCase() : "";
      const username = swap.username ? String(swap.username).toLowerCase() : "";
      if ((ownerId && lower === ownerId) || (username && lower === username)) {
        return "owner:" + String(swap.id) + ":" + (ownerId || username || "listing");
      }
    }
    return "raw:" + lower;
  }

  function addressIdFor(raw, profileIndex) {
    const s = String(raw || "").trim();
    if (!s) return "";
    const profile =
      profileIndex && typeof profileIndex.get === "function" ? profileIndex.get(s.toLowerCase()) : null;
    if (profile && profile.id) return String(profile.id);
    return s;
  }

  /**
   * The other person on a message, using every identity key (id, email, name),
   * not only user.id. Older rows stored mixed from_user / to_user values.
   */
  function otherPartyRaw(message, user, swap) {
    const mySet = keySetFromList(userIdentityKeys(user));
    const from = String((message && message.senderId) || "").trim();
    const to = String((message && message.toUser) || "").trim();
    const fromMe = !!(from && mySet[from.toLowerCase()]);
    const toMe = !!(to && mySet[to.toLowerCase()]);
    if (fromMe && to && !toMe) return to;
    if (toMe && from && !fromMe) return from;
    if (fromMe && !to && swap) {
      const ownerId = swap.ownerId ? String(swap.ownerId) : "";
      const username = swap.username ? String(swap.username) : "";
      const owns =
        (ownerId && mySet[ownerId.toLowerCase()]) ||
        (username && mySet[username.toLowerCase()]);
      if (!owns) return ownerId || username || "";
    }
    return "";
  }

  /**
   * Conversation key is swap id + the other person, so two carriers
   * messaging one listing stay in separate threads.
   */
  function conversationKey(message, user, swap, profileIndex) {
    const mySet = keySetFromList(userIdentityKeys(user));
    const otherRaw = otherPartyRaw(message, user, swap);
    const token = otherRaw ? canonicalPartyToken(otherRaw, swap, profileIndex) : "unknown";
    const from = String((message && message.senderId) || "").trim();
    return {
      key: String(message && message.swapId) + "::" + token,
      otherRaw: otherRaw,
      addressId: addressIdFor(otherRaw, profileIndex),
      fromMe: !!(from && mySet[from.toLowerCase()]),
    };
  }

  /**
   * Messages on a single swap visible only to the current user
   * (from_user / to_user matches their id or username).
   */
  async function fetchMessages(swapId, userOrKeys) {
    console.log("[PostSwapDB] fetchMessages() swapId=", swapId, "userFilter=", !!userOrKeys);
    try {
      const keys = serverParticipantKeys(userOrKeys);
      const orInner = userParticipationOrInner(keys);
      if (!orInner) {
        console.warn(
          "[PostSwapDB] fetchMessages: no user keys — refusing unfiltered swap thread"
        );
        return [];
      }

      // and=(swap_id.eq.X,or(from_user.eq.me,to_user.eq.me,...))
      // Never fall back to an unfiltered swap dump.
      const path =
        "/" +
        MESSAGES_TABLE +
        "?and=(swap_id.eq." +
        encodeURIComponent(String(swapId)) +
        "," +
        orInner +
        ")&select=*&order=created_at.asc";

      const rows = await request(path);

      const keySet = keySetFromList(keys);
      const mapped = (rows || [])
        .map(mapMessageRow)
        .filter(function (m) {
          return messageInvolvesUser(m, keySet);
        });
      console.log("[PostSwapDB] fetchMessages result count:", mapped.length);
      return mapped;
    } catch (err) {
      console.error("[PostSwapDB] fetchMessages FAILED", {
        swapId,
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        error: err,
      });
      throw err;
    }
  }

  /**
   * Inbox: only DMs where current user is from_user or to_user
   * (matched by user id and/or username variants).
   */
  async function fetchMessagesForUser(user, limit) {
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const keys = serverParticipantKeys(user);
    console.log("[PostSwapDB] fetchMessagesForUser()", { keys: keys, limit: lim });

    if (!keys.length) {
      console.warn("[PostSwapDB] fetchMessagesForUser: empty identity — returning []");
      return [];
    }

    const keySet = keySetFromList(keys);

    try {
      const orQuery = userParticipationOrQuery(keys);
      const path =
        "/" +
        MESSAGES_TABLE +
        "?" +
        orQuery +
        "&select=*&order=created_at.desc&limit=" +
        lim;

      // Participant filter is required. Do not load the recent-messages table into the browser.
      const rows = await request(path);

      const mapped = (rows || []).map(mapMessageRow);
      const filtered = mapped.filter(function (m) {
        return messageInvolvesUser(m, keySet);
      });

      console.log(
        "[PostSwapDB] fetchMessagesForUser result:",
        filtered.length,
        "(raw",
        mapped.length + ")"
      );
      return filtered;
    } catch (err) {
      console.error("[PostSwapDB] fetchMessagesForUser FAILED", {
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        error: err,
      });
      throw err;
    }
  }

  /** Per-account read ids stored on profiles.dm_read_ids when that column exists. */
  async function fetchDmReadIds(userId) {
    if (!userId) return null;
    try {
      const rows = await request(
        "/profiles?id=eq." +
          encodeURIComponent(String(userId)) +
          "&select=dm_read_ids&limit=1"
      );
      if (!rows || !rows.length) return [];
      const raw = rows[0].dm_read_ids;
      if (Array.isArray(raw)) return raw.map(String);
      if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch (_) {
          return [];
        }
      }
      return [];
    } catch (err) {
      console.warn("[PostSwapDB] fetchDmReadIds skipped", err && err.message);
      return null;
    }
  }

  async function saveDmReadIds(userId, ids) {
    if (!userId) return false;
    const payload = { dm_read_ids: (ids || []).map(String).slice(-400) };
    try {
      await request("/profiles?id=eq." + encodeURIComponent(String(userId)), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
      return true;
    } catch (err) {
      console.warn("[PostSwapDB] saveDmReadIds skipped", err && err.message);
      return false;
    }
  }

  /** Recent email_queue rows for this signed-in user. */
  async function fetchEmailQueueForUser(userId, limit) {
    if (!userId) return [];
    const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
    console.log("[PostSwapDB] fetchEmailQueueForUser()", userId);
    try {
      const rows = await request(
        "/email_queue?to_user_id=eq." +
          encodeURIComponent(String(userId)) +
          "&select=id,to_user_id,subject,body,event_type,status,created_at,meta&order=created_at.desc&limit=" +
          lim
      );
      return (rows || []).map(function (r) {
        return {
          id: r.id,
          subject: r.subject,
          body: r.body,
          eventType: r.event_type,
          status: r.status,
          createdAt: r.created_at,
          meta: r.meta || {},
        };
      });
    } catch (err) {
      // Table may not exist yet
      console.warn("[PostSwapDB] fetchEmailQueueForUser skipped", err && err.message);
      if (err && (err.status === 404 || err.status === 400)) return [];
      throw err;
    }
  }

  async function sendMessage({ swapId, senderId, toUser, body }) {
    if (!senderId || String(senderId) === "guest" || String(senderId) === "anonymous") {
      const err = new Error("Log in or join free to post / message.");
      err.status = 401;
      throw err;
    }
    if (!toUser || String(toUser) === "guest") {
      const err = new Error("There’s no recipient on this conversation yet.");
      err.status = 400;
      throw err;
    }
    const payload = {
      swap_id: String(swapId),
      from_user: String(senderId),
      to_user: String(toUser),
      message: body,
    };
    console.log("[PostSwapDB] sendMessage payload →", payload);
    try {
      const rows = await request(`/${MESSAGES_TABLE}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
      const r = Array.isArray(rows) ? rows[0] : rows;
      if (!r) {
        console.error("[PostSwapDB] sendMessage: empty response", rows);
        throw new Error("Supabase returned no message row after INSERT");
      }
      const mapped = {
        id: r.id,
        swapId: r.swap_id,
        senderId: r.from_user,
        toUser: r.to_user,
        body: r.message,
        createdAt: r.created_at,
      };
      console.log("[PostSwapDB] sendMessage success →", mapped);
      return mapped;
    } catch (err) {
      console.error("[PostSwapDB] sendMessage FAILED", {
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        payload,
        tip: "If status is 401/403: from_user must be the signed-in user id.",
      });
      throw err;
    }
  }

  // ---------- Profiles (optional table) ----------
  async function fetchProfile(id) {
    console.log("[PostSwapDB] fetchProfile() id=", id);
    try {
      const rows = await request(
        `/profiles?id=eq.${encodeURIComponent(String(id))}&select=*&limit=1`
      );
      if (!rows || !rows.length) {
        console.log("[PostSwapDB] fetchProfile: no row for id", id);
        return null;
      }
      const mapped = mapProfileFromDb(rows[0]);
      console.log("[PostSwapDB] fetchProfile success →", mapped);
      return mapped;
    } catch (err) {
      console.error("[PostSwapDB] fetchProfile FAILED", {
        id,
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        error: err,
      });
      if (err.status === 404) return null;
      throw err;
    }
  }

  async function fetchProfileByEmail(email) {
    console.log("[PostSwapDB] fetchProfileByEmail() email=", email);
    try {
      const rows = await request(
        `/profiles?email=eq.${encodeURIComponent(email)}&select=*&limit=1`
      );
      if (!rows || !rows.length) {
        console.log("[PostSwapDB] fetchProfileByEmail: no row for", email);
        return null;
      }
      const mapped = mapProfileFromDb(rows[0]);
      console.log("[PostSwapDB] fetchProfileByEmail success →", mapped);
      return mapped;
    } catch (err) {
      console.error("[PostSwapDB] fetchProfileByEmail FAILED", {
        email,
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        error: err,
      });
      if (err.status === 404) return null;
      throw err;
    }
  }

  async function saveProfile(profile) {
    const session = await auth.getSession();
    const uid = session && session.user && session.user.id;
    if (!uid) {
      const err = new Error("Log in or join free to post / message.");
      err.status = 401;
      throw err;
    }
    const body = mapProfileToDb(Object.assign({}, profile, { id: uid }));
    console.log("[PostSwapDB] saveProfile payload →", body);
    try {
      const rows = await request("/profiles?on_conflict=id", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(body),
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      const mapped = mapProfileFromDb(row);
      console.log("[PostSwapDB] saveProfile success →", mapped);
      return mapped;
    } catch (err) {
      // Table may not exist yet — app keeps localStorage profile
      console.error("[PostSwapDB] saveProfile FAILED", {
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        payload: body,
        tip:
          err && err.status === 404
            ? "profiles table missing — run supabase-schema.sql"
            : null,
        error: err,
      });
      if (err.status === 404) return null;
      throw err;
    }
  }

  function mapPublicProfile(row) {
    if (!row || row.id == null) return null;
    return {
      id: row.id,
      name: row.name || "",
      email: "",
      craft: row.craft || "",
      station: row.station || "",
      state: row.state || "",
      initials: row.initials || "",
      employeeId: "",
      notifications: null,
    };
  }

  async function fetchAllProfiles() {
    console.log("[PostSwapDB] fetchAllProfiles()");
    try {
      const rows = await request(
        "/profiles_public?select=id,name,initials,craft,station,state&order=name.asc&limit=500"
      );
      const mapped = (rows || []).map(mapPublicProfile).filter(Boolean);
      console.log("[PostSwapDB] fetchAllProfiles count:", mapped.length);
      return mapped;
    } catch (err) {
      console.error("[PostSwapDB] fetchAllProfiles FAILED", err);
      if (err.status === 404) return [];
      throw err;
    }
  }


  // ---------- Email notifications ----------
  // The browser calls security-definer RPCs. It does not insert email_queue
  // and it does not read other members' email addresses.
  async function rpc(name, args) {
    return request("/rpc/" + encodeURIComponent(name), {
      method: "POST",
      body: JSON.stringify(args || {}),
    });
  }

  /** Best-effort flush. dispatch-emails uses the service role on the server. */
  async function dispatchEmailQueue() {
    const url = `${SUPABASE_URL}/functions/v1/dispatch-emails`;
    console.log("[PostSwapDB] dispatchEmailQueue →", url);
    try {
      const token = await bearerToken();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ process: true }),
      });
      const textBody = await res.text();
      let data = null;
      try {
        data = textBody ? JSON.parse(textBody) : null;
      } catch (parseErr) {
        data = textBody;
      }
      console.log("[PostSwapDB] dispatchEmailQueue response", res.status, data);
      return { ok: res.ok, status: res.status, data: data };
    } catch (err) {
      console.warn("[PostSwapDB] dispatchEmailQueue unavailable", err && err.message);
      return { ok: false, skipped: true, message: err && err.message };
    }
  }

  async function notifyNewDm({ swap, messageBody, fromUser, recipientId }) {
    console.log("[PostSwapDB] notifyNewDm", {
      swapId: swap && swap.id,
      recipientId: recipientId || null,
    });
    if (!swap) return { queued: 0 };
    const senderId = fromUser && (fromUser.id || fromUser);
    let toId = recipientId != null && String(recipientId) !== "" ? String(recipientId) : "";
    if ((!toId || toId === "guest") && swap.ownerId && String(swap.ownerId) !== String(senderId)) {
      toId = String(swap.ownerId);
    }
    if (!toId || toId === "guest" || (senderId && String(toId) === String(senderId))) {
      return { queued: 0, reason: "no_recipient" };
    }
    const route = (swap.current || "?") + " → " + (swap.desired || "?");
    const fromName = (fromUser && fromUser.name) || "A carrier";
    const subject = "New PostSwap DM on " + route;
    const body = [
      "Hi,",
      "",
      fromName + " sent you a message about a swap:",
      route,
      "",
      "Message:",
      '"' + (messageBody || "") + '"',
      "",
      "Open PostSwap, then Mailbox, then My Messages to reply.",
      "",
      "— PostSwap (built by carriers, for carriers)",
      "You're receiving this because email notifications are enabled in your profile.",
    ].join("\n");
    const result = await rpc("queue_notification", {
      p_to_user_id: toId,
      p_subject: subject,
      p_body: body,
      p_event: "new_dm",
      p_meta: {
        swap_id: swap.id,
        from_user_id: senderId || null,
      },
    });
    const queued = result && result.queued ? result.queued : 0;
    const dispatch = queued ? await dispatchEmailQueue() : { skipped: true };
    return { queued: queued, dispatch: dispatch };
  }

  async function notifyMatchingSwap({ swap }) {
    console.log("[PostSwapDB] notifyMatchingSwap", { swapId: swap && swap.id });
    if (!swap || swap.id == null) return { queued: 0 };
    const result = await rpc("notify_matching_swap", { p_swap_id: String(swap.id) });
    const queued = result && result.queued ? result.queued : 0;
    const dispatch = queued ? await dispatchEmailQueue() : { skipped: true };
    return { queued: queued, dispatch: dispatch };
  }

  const api = {
    BUILD: BUILD,
    SUPABASE_URL: SUPABASE_URL,
    auth: auth,
    fetchSwaps: fetchSwaps,
    createSwap: createSwap,
    updateSwap: updateSwap,
    deleteSwap: deleteSwap,
    messagesTable: MESSAGES_TABLE,
    fetchMessages: fetchMessages,
    fetchMessagesForUser: fetchMessagesForUser,
    fetchDmReadIds: fetchDmReadIds,
    saveDmReadIds: saveDmReadIds,
    fetchEmailQueueForUser: fetchEmailQueueForUser,
    userIdentityKeys: userIdentityKeys,
    indexProfiles: indexProfiles,
    looksLikeRawId: looksLikeRawId,
    displayNameFor: displayNameFor,
    conversationKey: conversationKey,
    sendMessage: sendMessage,
    fetchProfile: fetchProfile,
    fetchProfileByEmail: fetchProfileByEmail,
    fetchAllProfiles: fetchAllProfiles,
    saveProfile: saveProfile,
    dispatchEmailQueue: dispatchEmailQueue,
    notifyNewDm: notifyNewDm,
    notifyMatchingSwap: notifyMatchingSwap,
    mapSwapFromDb: mapSwapFromDb,
    geocode: geocode,
  };

  global.PostSwapDB = api;
  if (typeof globalThis !== "undefined") {
    globalThis.PostSwapDB = api;
  }
  if (typeof window !== "undefined") {
    window.PostSwapDB = api;
  }

  console.log("PostSwapDB ready");
  console.log("[PostSwapDB] build=" + BUILD, { url: SUPABASE_URL });
})(typeof window !== "undefined" ? window : globalThis);
