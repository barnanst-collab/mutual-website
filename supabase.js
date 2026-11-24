/* ============================================
   PostSwap — Supabase REST helpers (fetch API)
   BUILD: 2026-07-11c (email notifications)
   Matched to existing project tables:
     - public.swaps
     - public."messages (for DMs)"
   Profiles use public.profiles when available.
   ============================================ */

(function (global) {
  "use strict";

  const BUILD = "2026-11-23name";
  const SUPABASE_URL = "https://olfystbcngdcevtndkdq.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZnlzdGJjbmdkY2V2dG5ka2RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MzE5NTMsImV4cCI6MjA5OTIwNzk1M30.Kr47X97Wrpppt2Vs-XhOzYMsQD8PmAPwbuWEyG8xEAk";

  const REST = `${SUPABASE_URL}/rest/v1`;

  /** Encode a table name for the REST path, including spaces and parentheses. */
  function encodeRestSegment(name) {
    return encodeURIComponent(name).replace(/[!'()*]/g, function (ch) {
      return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
    });
  }

  // public."messages (for DMs)" — never request this table without a participant filter.
  const MESSAGES_TABLE = encodeRestSegment("messages (for DMs)");

  /** UTF-8 base64 so identity keys (including “•”) are a legal HTTP header value. */
  function utf8ToB64(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (_) {
      return btoa(String(str));
    }
  }

  /** Header the messages RLS policy reads. Keys are joined with “|” then base64-encoded. */
  function participantKeysHeader(keys) {
    try {
      const joined = (keys || [])
        .map(function (k) {
          return k == null ? "" : String(k).trim().replace(/\|/g, "/");
        })
        .filter(Boolean)
        .join("|");
      if (!joined) return {};
      return { "x-postswap-keys": utf8ToB64(joined) };
    } catch (_) {
      return {};
    }
  }

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

  /** Map DB row → app swap shape */
  function mapSwapFromDb(row) {
    if (!row) return null;
    const current = row.current_location || "";
    const coords = geocode(current, row.id != null ? row.id : current);
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
   * Identity keys for the logged-in user (id, username-style labels, email, name).
   * Used so older rows stored under username still match.
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
      const keys = Array.isArray(userOrKeys)
        ? userOrKeys
        : userIdentityKeys(userOrKeys);
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

      const rows = await request(path, { headers: participantKeysHeader(keys) });

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
    const keys = userIdentityKeys(user);
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
      const rows = await request(path, { headers: participantKeysHeader(keys) });

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

  /** Refuses an unfiltered messages read. Inbox must use fetchMessagesForUser. */
  async function fetchAllMessages() {
    console.warn(
      "[PostSwapDB] fetchAllMessages refused — messages are loaded only for the signed-in participant"
    );
    return [];
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

  /** Recent email_queue rows for this user's email (real notification activity). */
  async function fetchEmailQueueForUser(email, limit) {
    if (!email) return [];
    const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
    console.log("[PostSwapDB] fetchEmailQueueForUser()", email);
    try {
      const rows = await request(
        "/email_queue?to_email=eq." +
          encodeURIComponent(String(email)) +
          "&select=*&order=created_at.desc&limit=" +
          lim
      );
      return (rows || []).map(function (r) {
        return {
          id: r.id,
          toEmail: r.to_email,
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

  async function sendMessage({ swapId, senderId, toUser, body, identityKeys }) {
    const payload = {
      swap_id: String(swapId),
      from_user: senderId || "anonymous",
      to_user: toUser || null,
      message: body,
    };
    const keys =
      identityKeys && identityKeys.length
        ? identityKeys
        : [senderId].filter(Boolean);
    console.log("[PostSwapDB] sendMessage payload →", payload);
    try {
      const rows = await request(`/${MESSAGES_TABLE}`, {
        method: "POST",
        headers: Object.assign(
          { Prefer: "return=representation" },
          participantKeysHeader(keys)
        ),
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
          'If status is 401/403: messages RLS only allows rows whose from_user or to_user is in the x-postswap-keys header (see supabase-schema.sql).',
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

  async function fetchAllProfiles() {
    console.log("[PostSwapDB] fetchAllProfiles()");
    try {
      const rows = await request("/profiles?select=*&order=updated_at.desc&limit=500");
      const mapped = (rows || []).map(mapProfileFromDb).filter(Boolean);
      console.log("[PostSwapDB] fetchAllProfiles count:", mapped.length);
      return mapped;
    } catch (err) {
      console.error("[PostSwapDB] fetchAllProfiles FAILED", err);
      if (err.status === 404) return [];
      throw err;
    }
  }

  // ---------- Email notifications (queue + optional Edge Function) ----------
  function prefsOf(profile) {
    const n = (profile && profile.notifications) || {};
    return {
      emailEnabled: n.emailEnabled !== false,
      onInterest: n.onInterest !== false,
      onStateSwap: n.onStateSwap !== false,
      onDm: n.onDm !== false,
    };
  }

  function wantsEmail(profile, kind) {
    if (!profile || !profile.email) return false;
    const p = prefsOf(profile);
    if (!p.emailEnabled) return false;
    if (kind === "new_dm") return p.onDm;
    if (kind === "matching_swap") return p.onStateSwap;
    if (kind === "interest") return p.onInterest;
    return false;
  }

  async function queueEmail({ toEmail, toUserId, subject, body, eventType, meta }) {
    const payload = {
      to_email: toEmail,
      to_user_id: toUserId || null,
      subject,
      body,
      event_type: eventType || "general",
      meta: meta || {},
      status: "pending",
    };
    console.log("[PostSwapDB] queueEmail →", payload);
    try {
      const rows = await request("/email_queue", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload),
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      console.log("[PostSwapDB] queueEmail success", row);
      return row;
    } catch (err) {
      console.error("[PostSwapDB] queueEmail FAILED", {
        message: err && err.message,
        status: err && err.status,
        data: err && err.data,
        tip: "Create public.email_queue via supabase-schema.sql",
      });
      throw err;
    }
  }

  /** Best-effort: invoke Edge Function to flush pending queue (if deployed). */
  async function dispatchEmailQueue() {
    const url = `${SUPABASE_URL}/functions/v1/dispatch-emails`;
    console.log("[PostSwapDB] dispatchEmailQueue →", url);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ process: true }),
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      console.log("[PostSwapDB] dispatchEmailQueue response", res.status, data);
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      console.warn("[PostSwapDB] dispatchEmailQueue unavailable", err && err.message);
      return { ok: false, skipped: true, message: err && err.message };
    }
  }

  /**
   * Notify swap owner of a new DM (if their profile opts in).
   * @param {{ swap, messageBody, fromUser }} args
   */
  async function notifyNewDm({ swap, messageBody, fromUser, recipientId }) {
    console.log("[PostSwapDB] notifyNewDm", {
      swapId: swap && swap.id,
      fromUser,
      recipientId: recipientId || null,
    });
    if (!swap) return { queued: 0 };

    const senderId = fromUser && (fromUser.id || fromUser);
    const explicit = recipientId != null && String(recipientId) !== "";
    let recipient = null;

    if (explicit && String(recipientId) !== String(senderId)) {
      try {
        recipient = await fetchProfile(recipientId);
      } catch (err) {
        console.warn("[PostSwapDB] notifyNewDm: recipient lookup failed", err);
      }
    }

    const senderIsOwner =
      !!(senderId && swap.ownerId && String(senderId) === String(swap.ownerId));

    if (!recipient && !senderIsOwner && swap.ownerId && String(swap.ownerId) !== String(senderId)) {
      try {
        recipient = await fetchProfile(swap.ownerId);
      } catch (err) {
        console.warn("[PostSwapDB] notifyNewDm: owner lookup failed", err);
      }
    }

    // Fallback: match by username label when the sender is not the listing owner
    if (!recipient && !senderIsOwner && swap.username) {
      try {
        const all = await fetchAllProfiles();
        recipient = all.find(
          (p) =>
            p.name &&
            swap.username &&
            p.name.toLowerCase().includes(String(swap.username).split("•")[0].trim().toLowerCase())
        ) || null;
      } catch (_) { /* ignore */ }
    }

    if (!recipient || !wantsEmail(recipient, "new_dm")) {
      console.log("[PostSwapDB] notifyNewDm: no recipient or prefs off", recipient);
      return { queued: 0, reason: "no_recipient_or_prefs" };
    }

    // Don't email yourself
    if (senderId && String(recipient.id) === String(senderId)) {
      console.log("[PostSwapDB] notifyNewDm: skip self");
      return { queued: 0, reason: "self" };
    }

    const route = `${swap.current || "?"} → ${swap.desired || "?"}`;
    const fromName = (fromUser && fromUser.name) || "A verified carrier";
    const subject = `New PostSwap DM on ${route}`;
    const body = [
      `Hi ${recipient.name || "Carrier"},`,
      "",
      `${fromName} sent you a message about a swap:`,
      route,
      "",
      `Message:`,
      `"${messageBody || ""}"`,
      "",
      `Open PostSwap → Mailbox → My Messages to reply.`,
      "",
      `— PostSwap (built by carriers, for carriers)`,
      `You're receiving this because email notifications are enabled in your profile.`,
    ].join("\n");

    const row = await queueEmail({
      toEmail: recipient.email,
      toUserId: recipient.id,
      subject,
      body,
      eventType: "new_dm",
      meta: {
        swap_id: swap.id,
        from_user_id: senderId || null,
      },
    });

    const dispatch = await dispatchEmailQueue();
    return { queued: 1, row, dispatch, to: recipient.email };
  }

  function normalizeCraft(craft) {
    return String(craft || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function craftsMatchExactly(a, b) {
    const ca = normalizeCraft(a);
    const cb = normalizeCraft(b);
    if (!ca || !cb) return false;
    // Strict exact match only — no "any craft" / partial / family matching
    return ca === cb;
  }

  /**
   * Notify carriers about a new swap ONLY when:
   *  1) listing involves their home state, AND
   *  2) craft exactly matches their profile craft
   * (No "any craft" option.)
   */
  async function notifyMatchingSwap({ swap, excludeUserId }) {
    console.log("[PostSwapDB] notifyMatchingSwap", {
      swapId: swap && swap.id,
      craft: swap && swap.craft,
    });
    if (!swap) return { queued: 0 };

    const swapCraft = normalizeCraft(swap.craft);
    if (!swapCraft) {
      console.log("[PostSwapDB] notifyMatchingSwap: swap has no craft — skip");
      return { queued: 0, reason: "no_swap_craft" };
    }

    let profiles = [];
    try {
      profiles = await fetchAllProfiles();
    } catch (err) {
      console.error("[PostSwapDB] notifyMatchingSwap: profiles failed", err);
      return { queued: 0, error: err.message };
    }

    const hay = `${swap.current || ""} ${swap.desired || ""}`.toUpperCase();
    const STATE_NAMES = {
      AL: "ALABAMA", AK: "ALASKA", AZ: "ARIZONA", AR: "ARKANSAS", CA: "CALIFORNIA",
      CO: "COLORADO", CT: "CONNECTICUT", DE: "DELAWARE", FL: "FLORIDA", GA: "GEORGIA",
      HI: "HAWAII", ID: "IDAHO", IL: "ILLINOIS", IN: "INDIANA", IA: "IOWA",
      KS: "KANSAS", KY: "KENTUCKY", LA: "LOUISIANA", ME: "MAINE", MD: "MARYLAND",
      MA: "MASSACHUSETTS", MI: "MICHIGAN", MN: "MINNESOTA", MS: "MISSISSIPPI",
      MO: "MISSOURI", MT: "MONTANA", NE: "NEBRASKA", NV: "NEVADA", NH: "NEW HAMPSHIRE",
      NJ: "NEW JERSEY", NM: "NEW MEXICO", NY: "NEW YORK", NC: "NORTH CAROLINA",
      ND: "NORTH DAKOTA", OH: "OHIO", OK: "OKLAHOMA", OR: "OREGON", PA: "PENNSYLVANIA",
      RI: "RHODE ISLAND", SC: "SOUTH CAROLINA", SD: "SOUTH DAKOTA", TN: "TENNESSEE",
      TX: "TEXAS", UT: "UTAH", VT: "VERMONT", VA: "VIRGINIA", WA: "WASHINGTON",
      WV: "WEST VIRGINIA", WI: "WISCONSIN", WY: "WYOMING", DC: "DISTRICT OF COLUMBIA",
    };

    const recipients = profiles.filter((p) => {
      if (!wantsEmail(p, "matching_swap")) return false;
      if (excludeUserId && String(p.id) === String(excludeUserId)) return false;
      if (!p.state) return false;
      // Strict craft match required
      if (!craftsMatchExactly(p.craft, swap.craft)) return false;
      const abbr = String(p.state).toUpperCase();
      const full = STATE_NAMES[abbr] || "";
      const stateHit = hay.includes(abbr) || (full && hay.includes(full));
      return stateHit;
    });

    console.log("[PostSwapDB] notifyMatchingSwap recipients (state+exact craft):", {
      count: recipients.length,
      swapCraft: swap.craft,
    });

    const queued = [];
    const route = `${swap.current || "?"} → ${swap.desired || "?"}`;
    for (const p of recipients) {
      const subject = `New ${swap.craft} swap in ${p.state}`;
      const body = [
        `Hi ${p.name || "Carrier"},`,
        "",
        `A new mutual swap was posted in your state (${p.state}) for your craft:`,
        route,
        `Craft: ${swap.craft} (exact match to your profile)`,
        `Seniority: ${swap.seniority != null ? swap.seniority : "—"} yrs`,
        swap.notes ? `Note: ${swap.notes}` : "",
        "",
        `Browse Open Swaps on PostSwap to learn more or send a DM.`,
        "",
        `— PostSwap`,
        `You only get these when craft matches yours exactly. Turn off in Profile → Email notifications.`,
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const row = await queueEmail({
          toEmail: p.email,
          toUserId: p.id,
          subject,
          body,
          eventType: "matching_swap",
          meta: {
            swap_id: swap.id,
            state: p.state,
            craft: swap.craft,
            profile_craft: p.craft,
            craft_match: "exact",
          },
        });
        queued.push({ email: p.email, id: row && row.id, craft: p.craft });
      } catch (err) {
        console.warn("[PostSwapDB] notifyMatchingSwap queue failed for", p.email, err);
      }
    }

    const dispatch = queued.length ? await dispatchEmailQueue() : { skipped: true };
    return { queued: queued.length, recipients: queued, dispatch };
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
        headers: Object.assign(
          {
            apikey: SUPABASE_ANON_KEY,
            Authorization: "Bearer " + SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          participantKeysHeader(["probe"])
        ),
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
              ? 'RLS blocked INSERT — from_user must be listed in the x-postswap-keys header (see supabase-schema.sql).'
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
    messagesTable: MESSAGES_TABLE,
    fetchMessages: fetchMessages,
    fetchMessagesForUser: fetchMessagesForUser,
    fetchAllMessages: fetchAllMessages,
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
    queueEmail: queueEmail,
    dispatchEmailQueue: dispatchEmailQueue,
    notifyNewDm: notifyNewDm,
    notifyMatchingSwap: notifyMatchingSwap,
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


