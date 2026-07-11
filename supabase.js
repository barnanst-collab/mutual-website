/* ============================================
   PostSwap — Supabase REST helpers (fetch API)
   BUILD: 2026-07-11a (redeploy stamp)
   Matched to existing project tables:
     - public.swaps
     - public."messages (for DMs)"
   Profiles use public.profiles when available.
   ============================================ */

(function (global) {
  "use strict";

  const BUILD = "2026-07-11a";
  const SUPABASE_URL = "https://olfystbcngdcevtndkdq.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZnlzdGJjbmdkY2V2dG5ka2RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MzE5NTMsImV4cCI6MjA5OTIwNzk1M30.Kr47X97Wrpppt2Vs-XhOzYMsQD8PmAPwbuWEyG8xEAk";

  const REST = `${SUPABASE_URL}/rest/v1`;
  const MESSAGES_TABLE = "messages%20(for%20DMs)";

  // Client-side geocode for map pins (swaps table has no lat/lng columns)
  const CITY_COORDS = {
    "north las vegas": { lat: 36.1989, lng: -115.1175 },
    "las vegas": { lat: 36.1699, lng: -115.1398 },
    henderson: { lat: 36.0395, lng: -114.9817 },
    phoenix: { lat: 33.4484, lng: -112.074 },
    mesa: { lat: 33.4152, lng: -111.8315 },
    tucson: { lat: 32.2226, lng: -110.9747 },
    "san diego": { lat: 32.7157, lng: -117.1611 },
    denver: { lat: 39.7392, lng: -104.9903 },
    dallas: { lat: 32.7767, lng: -96.797 },
    chicago: { lat: 41.8781, lng: -87.6298 },
    atlanta: { lat: 33.749, lng: -84.388 },
    "los angeles": { lat: 34.0522, lng: -118.2437 },
    albuquerque: { lat: 35.0844, lng: -106.6504 },
    "salt lake": { lat: 40.7608, lng: -111.891 },
  };

  function headers(extra = {}) {
    return {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async function request(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const url = `${REST}${path}`;
    const hdrs = headers(options.headers || {});

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

  function geocode(cityStr) {
    const lower = String(cityStr || "").toLowerCase();
    for (const [key, coords] of Object.entries(CITY_COORDS)) {
      if (lower.includes(key)) {
        return {
          lat: coords.lat + (Math.random() - 0.5) * 0.04,
          lng: coords.lng + (Math.random() - 0.5) * 0.04,
        };
      }
    }
    return {
      lat: 34.5 + (Math.random() - 0.5) * 4,
      lng: -112 + (Math.random() - 0.5) * 6,
    };
  }

  function regionFromLocation(loc) {
    const l = String(loc || "").toLowerCase();
    if (/nv|az|nm|las vegas|phoenix|tucson|henderson|mesa/.test(l)) return "Southwest Region";
    if (/ca|san diego|los angeles/.test(l)) return "Pacific Region";
    if (/co|ut|denver|salt lake/.test(l)) return "Mountain West";
    if (/tx|dallas|houston/.test(l)) return "South Central";
    if (/il|chicago|mi|oh|wi/.test(l)) return "Great Lakes";
    if (/ga|fl|nc|sc|atlanta/.test(l)) return "Southeast Region";
    return "United States";
  }

  /** Map DB row → app swap shape */
  function mapSwapFromDb(row) {
    if (!row) return null;
    const current = row.current_location || "";
    const coords = geocode(current);
    const region = regionFromLocation(current);
    const username = row.username || null;
    return {
      id: row.id,
      current,
      desired: row.desired_location || "",
      craft: row.craft || "Letter Carrier",
      seniority: Number(row.seniority) || 0,
      swapType: row.swap_type || "Permanent",
      notes: row.notes || "",
      lat: coords.lat,
      lng: coords.lng,
      region,
      privacyLabel: username
        ? `Verified Carrier • ${username}`
        : `Verified Carrier • ${region}`,
      ownerId: row.user_id || null,
      username: username,
      createdAt: row.created_at || null,
    };
  }

  function mapSwapToDb(swap) {
    return {
      current_location: swap.current,
      desired_location: swap.desired,
      craft: swap.craft,
      seniority: swap.seniority,
      notes: swap.notes || "",
      user_id: swap.ownerId || null,
      username: swap.username || null,
    };
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

  async function createSwap(swap) {
    const body = mapSwapToDb(swap);
    console.log("[PostSwapDB] createSwap payload →", body);
    try {
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
      // Prefer server id + preserve client lat if we already computed it
      const mapped = mapSwapFromDb(row);
      if (swap.lat != null && swap.lng != null) {
        mapped.lat = swap.lat;
        mapped.lng = swap.lng;
      }
      if (swap.swapType) mapped.swapType = swap.swapType;
      if (swap.region) mapped.region = swap.region;
      if (swap.privacyLabel) mapped.privacyLabel = swap.privacyLabel;
      console.log("[PostSwapDB] createSwap success →", mapped);
      return mapped;
    } catch (err) {
      console.error("[PostSwapDB] createSwap FAILED", {
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        payload: body,
        tip:
          "If status is 401/403: disable RLS on public.swaps (see supabase-schema.sql). " +
          "If 400: column mismatch. If network: check CORS / project URL.",
      });
      throw err;
    }
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

  async function fetchMessages(swapId) {
    console.log("[PostSwapDB] fetchMessages() swapId=", swapId);
    try {
      const rows = await request(
        `/${MESSAGES_TABLE}?swap_id=eq.${encodeURIComponent(String(swapId))}&select=*&order=created_at.asc`
      );
      const mapped = (rows || []).map(mapMessageRow);
      console.log("[PostSwapDB] fetchMessages result count:", mapped.length, mapped);
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

  /** Fetch recent DMs across all swaps (for inbox). */
  async function fetchAllMessages(limit) {
    const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
    console.log("[PostSwapDB] fetchAllMessages() limit=", lim);
    try {
      const rows = await request(
        `/${MESSAGES_TABLE}?select=*&order=created_at.desc&limit=${lim}`
      );
      const mapped = (rows || []).map(mapMessageRow);
      console.log("[PostSwapDB] fetchAllMessages result count:", mapped.length);
      return mapped;
    } catch (err) {
      console.error("[PostSwapDB] fetchAllMessages FAILED", {
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        error: err,
      });
      throw err;
    }
  }

  async function sendMessage({ swapId, senderId, toUser, body }) {
    const payload = {
      swap_id: String(swapId),
      from_user: senderId || "anonymous",
      to_user: toUser || null,
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
        tip:
          'If status is 401/403: disable RLS on public."messages (for DMs)" (see supabase-schema.sql).',
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
    const body = mapProfileToDb(profile);
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

  /**
   * Fully self-contained INSERT probe for swaps + messages.
   * Uses direct fetch (does not depend on other helpers failing).
   * Global: await window.PostSwapDB.testAnonInserts()
   */
  async function testAnonInserts() {
    const stamp = new Date().toISOString();
    console.log("%c[PostSwapDB] testAnonInserts() START", "color:#003087;font-weight:bold", stamp);
    console.log("[PostSwapDB] project URL:", SUPABASE_URL);

    const results = {
      ok: false,
      url: SUPABASE_URL,
      at: stamp,
      swaps: null,
      messages: null,
      summary: "",
    };

    // --- 1) INSERT into swaps ---
    const swapPayload = {
      current_location: "RLS Probe, NV",
      desired_location: "RLS Probe Desired, AZ",
      craft: "Letter Carrier",
      seniority: 0,
      notes: "Automated anon insert probe — safe to delete (" + stamp + ")",
      user_id: "probe",
      username: "probe",
    };
    console.log("[PostSwapDB] Step 1/2 — POST /swaps", swapPayload);

    try {
      const swapRes = await fetch(REST + "/swaps", {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(swapPayload),
      });
      const swapText = await swapRes.text();
      let swapData = null;
      try {
        swapData = swapText ? JSON.parse(swapText) : null;
      } catch (parseErr) {
        swapData = swapText;
      }

      console.log("[PostSwapDB] swaps response", {
        status: swapRes.status,
        ok: swapRes.ok,
        body: swapData,
      });

      if (!swapRes.ok) {
        results.swaps = {
          ok: false,
          status: swapRes.status,
          statusText: swapRes.statusText,
          body: swapData,
          hint:
            swapRes.status === 401 || swapRes.status === 403
              ? "RLS/auth blocked INSERT — disable RLS on public.swaps"
              : swapRes.status === 400
                ? "Bad payload — check column names"
                : "See body for details",
        };
        console.error("[PostSwapDB] swaps INSERT FAILED", results.swaps);
      } else {
        const row = Array.isArray(swapData) ? swapData[0] : swapData;
        results.swaps = {
          ok: true,
          status: swapRes.status,
          id: row && row.id,
          row: row,
        };
        console.log("%c[PostSwapDB] swaps INSERT OK id=" + (row && row.id), "color:green;font-weight:bold", row);
      }
    } catch (err) {
      results.swaps = {
        ok: false,
        network: true,
        message: err && err.message,
        error: String(err),
      };
      console.error("[PostSwapDB] swaps INSERT network error", err);
    }

    // --- 2) INSERT into messages (for DMs) ---
    const swapIdForMsg =
      results.swaps && results.swaps.ok && results.swaps.id != null
        ? String(results.swaps.id)
        : "0";
    const msgPayload = {
      swap_id: swapIdForMsg,
      from_user: "probe",
      to_user: null,
      message: "Automated anon message probe — safe to delete (" + stamp + ")",
    };
    const msgUrl = REST + "/" + MESSAGES_TABLE;
    console.log("[PostSwapDB] Step 2/2 — POST messages (for DMs)", {
      url: msgUrl,
      payload: msgPayload,
    });

    try {
      const msgRes = await fetch(msgUrl, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(msgPayload),
      });
      const msgText = await msgRes.text();
      let msgData = null;
      try {
        msgData = msgText ? JSON.parse(msgText) : null;
      } catch (parseErr) {
        msgData = msgText;
      }

      console.log("[PostSwapDB] messages response", {
        status: msgRes.status,
        ok: msgRes.ok,
        body: msgData,
      });

      if (!msgRes.ok) {
        results.messages = {
          ok: false,
          status: msgRes.status,
          statusText: msgRes.statusText,
          body: msgData,
          hint:
            msgRes.status === 401 || msgRes.status === 403
              ? 'RLS/auth blocked INSERT — disable RLS on public."messages (for DMs)"'
              : "See body for details",
        };
        console.error("[PostSwapDB] messages INSERT FAILED", results.messages);
      } else {
        const row = Array.isArray(msgData) ? msgData[0] : msgData;
        results.messages = {
          ok: true,
          status: msgRes.status,
          id: row && row.id,
          row: row,
        };
        console.log(
          "%c[PostSwapDB] messages INSERT OK id=" + (row && row.id),
          "color:green;font-weight:bold",
          row
        );
      }
    } catch (err) {
      results.messages = {
        ok: false,
        network: true,
        message: err && err.message,
        error: String(err),
      };
      console.error("[PostSwapDB] messages INSERT network error", err);
    }

    results.ok = !!(results.swaps && results.swaps.ok && results.messages && results.messages.ok);
    results.summary = results.ok
      ? "PASS — anon can INSERT into swaps and messages"
      : "FAIL — see swaps/messages details above (RLS, columns, or network)";

    console.log(
      "%c[PostSwapDB] testAnonInserts() DONE — " + results.summary,
      results.ok ? "color:green;font-weight:bold" : "color:#B22234;font-weight:bold"
    );
    console.log("[PostSwapDB] testAnonInserts() DETAILED RESULTS:", results);
    console.table({
      swaps_ok: !!(results.swaps && results.swaps.ok),
      swaps_id: results.swaps && results.swaps.id,
      swaps_status: results.swaps && results.swaps.status,
      messages_ok: !!(results.messages && results.messages.ok),
      messages_id: results.messages && results.messages.id,
      messages_status: results.messages && results.messages.status,
    });

    return results;
  }

  // Public API object
  const api = {
    BUILD: BUILD,
    SUPABASE_URL: SUPABASE_URL,
    fetchSwaps: fetchSwaps,
    createSwap: createSwap,
    fetchMessages: fetchMessages,
    fetchAllMessages: fetchAllMessages,
    sendMessage: sendMessage,
    fetchProfile: fetchProfile,
    fetchProfileByEmail: fetchProfileByEmail,
    saveProfile: saveProfile,
    mapSwapFromDb: mapSwapFromDb,
    geocode: geocode,
    testAnonInserts: testAnonInserts,
  };

  // Force global exposure for DevTools / console
  global.PostSwapDB = api;
  if (typeof globalThis !== "undefined") {
    globalThis.PostSwapDB = api;
  }
  if (typeof window !== "undefined") {
    window.PostSwapDB = api;
    try {
      Object.defineProperty(window.PostSwapDB, "testAnonInserts", {
        value: testAnonInserts,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch (e) {
      window.PostSwapDB.testAnonInserts = testAnonInserts;
    }
    window.testAnonInserts = function () {
      return window.PostSwapDB.testAnonInserts();
    };
  }

  console.log("PostSwapDB ready");
  console.log("[PostSwapDB] build=" + BUILD, {
    testAnonInserts: typeof api.testAnonInserts,
    url: SUPABASE_URL,
  });
})(typeof window !== "undefined" ? window : globalThis);

// Post-load guarantee
(function bindTestAnonInsertsGlobal() {
  if (typeof window === "undefined") return;
  if (!window.PostSwapDB) {
    console.error("[PostSwapDB] window.PostSwapDB is undefined after supabase.js load");
    return;
  }
  if (typeof window.PostSwapDB.testAnonInserts !== "function") {
    console.error(
      "[PostSwapDB] testAnonInserts missing — keys:",
      Object.keys(window.PostSwapDB)
    );
    return;
  }
  window.testAnonInserts = function testAnonInsertsAlias() {
    return window.PostSwapDB.testAnonInserts();
  };
  console.log("PostSwapDB ready");
  console.log(
    "[PostSwapDB] build=" +
      (window.PostSwapDB.BUILD || "?") +
      " · Run: await PostSwapDB.testAnonInserts()"
  );
})();


