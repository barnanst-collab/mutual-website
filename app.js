/* ============================================
   PostSwap — Interactive application logic
   ============================================ */

// Re-export Supabase helper on window from the main script
(function ensurePostSwapDBOnWindow() {
  if (typeof window === "undefined") return;
  if (window.PostSwapDB && typeof window.PostSwapDB.testAnonInserts === "function") {
    // Keep stable global references for DevTools
    var db = window.PostSwapDB;
    window.PostSwapDB = db;
    window.PostSwapDB.testAnonInserts = db.testAnonInserts.bind(db);
    window.testAnonInserts = function () {
      return window.PostSwapDB.testAnonInserts();
    };
    console.log("PostSwapDB ready");
    return;
  }
  console.error(
    "[PostSwap] window.PostSwapDB missing in app.js — ensure supabase.js loads before app.js"
  );
})();

(function () {
  "use strict";

  // ---------- State ----------
  let swaps = [];
  let map = null;
  let markersLayer = null;
  let markerById = new Map();
  let activeSwapId = null;
  // "leaving" = pins on current location. "coming" = pins on desired location.
  let mapMode = "leaving";
  // Set by Near Me. Null means show the whole filtered list.
  let nearMeCenter = null;
  const NEAR_ME_MILES = 150;
  // The list shows a page at a time. The map plots every swap that matches.
  const LIST_PAGE = 8;
  let listShown = LIST_PAGE;
  let listQueryKey = "";
  let linkedSwapHandled = false;
  let currentDmSwap = null;
  let currentDmAddressId = null;
  let currentDmSig = "";
  let profileIndex = new Map();
  let profileIndexAt = 0;
  let user = null; // full profile + notification prefs
  let useSupabase = typeof window.PostSwapDB !== "undefined";
  let swapsLoaded = false;
  let editingSwapId = null;
  let allowDuplicatePost = false;
  let duplicateSwapId = null;

  function db() {
    return window.PostSwapDB;
  }

  function idEq(a, b) {
    return a != null && b != null && String(a) === String(b);
  }

  function findSwapById(id) {
    return swaps.find((s) => idEq(s.id, id));
  }

  function setExploreLoading(on) {
    const el = $("#explore-loading");
    if (el) el.hidden = !on;
  }

  function setButtonLoading(btn, on) {
    if (!btn) return;
    btn.classList.toggle("is-loading", on);
    btn.disabled = !!on;
  }

  async function loadSwapsFromSupabase() {
    setExploreLoading(true);
    swaps = [];
    try {
      if (!useSupabase || !db()) {
        console.warn("[PostSwap] Supabase helper missing — starting with empty swaps");
        swapsLoaded = true;
        refreshViews();
        forceMapRefresh([]);
        return { ok: false, source: "none", count: 0 };
      }
      const remote = await db().fetchSwaps();
      swaps = Array.isArray(remote) ? remote : [];
      // Known cities use their real coordinates. Older free-text rows keep a fallback pin.
      swaps = swaps.map(withPinCoords);
      swapsLoaded = true;
      refreshViews();
      forceMapRefresh();
      console.log("[PostSwap] loaded swaps from Supabase:", swaps.length);
      return { ok: true, source: "supabase", count: swaps.length };
    } catch (err) {
      console.error("[PostSwap] Supabase fetch failed — empty swaps list", err);
      swaps = [];
      swapsLoaded = true;
      refreshViews();
      forceMapRefresh([]);
      showToast(
        "Couldn’t load swaps",
        "Check Supabase connection. The list is empty until data loads or you post a swap."
      );
      return { ok: false, error: err, count: 0 };
    } finally {
      setExploreLoading(false);
      // One more refresh after loading spinner hides (layout size changes)
      setTimeout(function () {
        forceMapRefresh();
      }, 100);
      queueLinkedSwap();
    }
  }

  const DEFAULT_NOTIFICATIONS = {
    emailEnabled: true,
    onInterest: true,
    onStateSwap: true,
    onDm: true,
  };

  function defaultUserFields(partial) {
    return {
      state: "NV",
      notifications: { ...DEFAULT_NOTIFICATIONS },
      ...partial,
      notifications: {
        ...DEFAULT_NOTIFICATIONS,
        ...(partial.notifications || {}),
      },
    };
  }

  // ---------- DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const els = {
    navbar: $("#navbar"),
    hamburger: $("#hamburger"),
    mobileMenu: $("#mobile-menu"),
    authGuest: $("#auth-guest"),
    authUser: $("#auth-user"),
    userAvatar: $("#user-avatar"),
    userName: $("#user-name"),
    mobileAuth: $("#mobile-auth"),
    filterCity: $("#filter-city"),
    filterCraft: $("#filter-craft"),
    nearMeBtn: $("#near-me-btn"),
    modeLeaving: $("#mode-leaving"),
    modeComing: $("#mode-coming"),
    mapModeHelp: $("#map-mode-help"),
    listModeNote: $("#list-mode-note"),
    swapSort: $("#swap-sort"),
    swapList: $("#swap-list"),
    listCount: $("#list-count"),
    loadMore: $("#swap-load-more"),
    overlay: $("#modal-overlay"),
    modalPost: $("#modal-post"),
    modalDm: $("#modal-dm"),
    modalLogin: $("#modal-login"),
    modalRegister: $("#modal-register"),
    modalMySwaps: $("#modal-my-swaps"),
    modalInbox: $("#modal-inbox"),
    modalShare: $("#modal-share"),
    modalFeedback: $("#modal-feedback"),
    modalProfile: $("#modal-profile"),
    feedbackNote: $("#feedback-note"),
    feedbackSelected: $("#feedback-selected"),
    feedbackOpenForm: $("#feedback-open-form"),
    inboxThreads: $("#inbox-threads"),
    inboxStatus: $("#inbox-status"),
    inboxEmptyThread: $("#inbox-empty-thread"),
    inboxThreadPanel: $("#inbox-thread-panel"),
    inboxThreadTitle: $("#inbox-thread-title"),
    inboxThreadSub: $("#inbox-thread-sub"),
    inboxThreadMessages: $("#inbox-thread-messages"),
    inboxOpenDm: $("#inbox-open-dm"),
    inboxBack: $("#inbox-back"),
    inboxRefresh: $("#inbox-refresh"),
    formInboxReply: $("#form-inbox-reply"),
    inboxReplyInput: $("#inbox-reply-input"),
    inboxReplySend: $("#inbox-reply-send"),
    inboxSendError: $("#inbox-send-error"),
    inboxSendErrorText: $("#inbox-send-error-text"),
    inboxSendRetry: $("#inbox-send-retry"),
    dmSendError: $("#dm-send-error"),
    dmSendErrorText: $("#dm-send-error-text"),
    dmSendRetry: $("#dm-send-retry"),
    shareMessage: $("#share-message"),
    shareCopyMsg: $("#share-copy-msg"),
    shareCopyLink: $("#share-copy-link"),
    shareEmail: $("#share-email"),
    shareGroup: $("#share-group"),
    shareStatus: $("#share-status"),
    formPost: $("#form-post"),
    formLogin: $("#form-login"),
    formRegister: $("#form-register"),
    formDm: $("#form-dm"),
    formProfile: $("#form-profile"),
    chatBody: $("#chat-body"),
    dmInput: $("#dm-input"),
    dmAvatar: $("#dm-avatar"),
    dmTitle: $("#dm-title"),
    dmSubtitle: $("#dm-subtitle"),
    useLocationBtn: $("#use-location-btn"),
    demoLoginBtn: $("#demo-login-btn"),
    mySwapsBody: $("#my-swaps-body"),
    toastContainer: $("#toast-container"),
    mailbox: $("#mailbox"),
    mailboxBtn: $("#mailbox-btn"),
    mailboxPanel: $("#mailbox-panel"),
    mailboxList: $("#mailbox-list"),
    mailboxBadge: $("#mailbox-badge"),
    mailboxMarkAll: $("#mailbox-mark-all"),
    mailboxClose: $("#mailbox-close"),
    profileAvatar: $("#profile-avatar"),
    profileName: $("#profile-name"),
    profileMeta: $("#profile-meta"),
    profileEmail: $("#profile-email"),
    profileCraft: $("#profile-craft"),
    profileStation: $("#profile-station"),
    profileState: $("#profile-state"),
    notifyEmailEnabled: $("#notify-email-enabled"),
    notifyInterest: $("#notify-interest"),
    notifyState: $("#notify-state"),
    notifyDm: $("#notify-dm"),
    notifyOptions: $("#notify-options"),
    notifyPreview: $("#notify-preview"),
    notifyPreviewEmail: $("#notify-preview-email"),
  };

  // ---------- Utils ----------
  function initials(name) {
    return name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function geocodeCurrent(cityStr, seed) {
    if (window.PostSwapGeocode && typeof window.PostSwapGeocode.geocode === "function") {
      var hit = window.PostSwapGeocode.geocode(cityStr, seed || cityStr);
      return {
        lat: hit.lat,
        lng: hit.lng,
        quality: hit.quality || "approx",
      };
    }
    // Minimal fallback if geocode.js missing — spread across CONUS, not AZ-only
    var h = 0;
    var s = String(cityStr || "us");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return {
      lat: 26 + ((h % 1000) / 1000) * 22,
      lng: -124 + ((((h / 1000) | 0) % 1000) / 1000) * 56,
      quality: "approx",
    };
  }

  function finiteCoord(n) {
    return typeof n === "number" && isFinite(n);
  }

  function explicitDesiredMode(s) {
    if (!s) return "";
    if (s.desiredMode === "anywhere" || s.desiredMode === "region" || s.desiredMode === "city") {
      return s.desiredMode;
    }
    var label = String(s.desired || "").trim();
    if (/^anywhere$/i.test(label)) return "anywhere";
    if (/^anywhere in [a-z]{2}$/i.test(label)) return "region";
    return "";
  }

  /**
   * City + state uses the listed coordinate. Explicit Anywhere / region does not invent a city.
   * Older free-text rows still get a fallback pin so they stay on the map.
   */
  function pinFromFields(city, state, text, seed, side, swap) {
    var g = window.PostSwapGeocode;
    var mode = side === "desired" ? explicitDesiredMode(swap) : "";
    if (mode === "anywhere") return { lat: null, lng: null, quality: "anywhere" };
    if (mode === "region") {
      var regionState = (swap && swap.desiredState) || String(text || "").replace(/^anywhere in\s+/i, "");
      var centroid = g && g.stateCentroid ? g.stateCentroid(regionState) : null;
      if (centroid) return { lat: centroid.lat, lng: centroid.lng, quality: "region" };
    }
    if (g && city && state && typeof g.lookupCity === "function") {
      var hit = g.lookupCity(city, state);
      if (hit) return { lat: hit.lat, lng: hit.lng, quality: hit.quality || "city" };
    }
    if (g && text && typeof g.parseLocation === "function") {
      var parsed = g.parseLocation(text);
      if (parsed && parsed.ok && parsed.kind === "city") {
        return { lat: parsed.lat, lng: parsed.lng, quality: "city" };
      }
      if (side === "desired" && parsed && parsed.ok && parsed.kind === "anywhere") {
        return { lat: null, lng: null, quality: "anywhere" };
      }
      if (side === "desired" && parsed && parsed.ok && parsed.kind === "region") {
        return { lat: parsed.lat, lng: parsed.lng, quality: "region" };
      }
    }
    if (
      side === "current" &&
      swap &&
      swap.currentCity &&
      swap.currentState &&
      finiteCoord(Number(swap.lat)) &&
      finiteCoord(Number(swap.lng))
    ) {
      return { lat: Number(swap.lat), lng: Number(swap.lng), quality: "city" };
    }
    var legacy = geocodeCurrent(text, seed);
    return { lat: legacy.lat, lng: legacy.lng, quality: legacy.quality || "approx" };
  }

  /** Attach current + desired coordinates. A known city is not replaced by a guess. */
  function withPinCoords(s) {
    var currentCoords = pinFromFields(
      s.currentCity,
      s.currentState,
      s.current,
      (s.id != null ? s.id : s.current || "") + "|from",
      "current",
      s
    );
    var desiredCoords = pinFromFields(
      s.desiredCity,
      s.desiredState,
      s.desired,
      (s.id != null ? s.id : s.desired || "") + "|to",
      "desired",
      s
    );
    return Object.assign({}, s, {
      lat: currentCoords.lat,
      lng: currentCoords.lng,
      currentLat: currentCoords.lat,
      currentLng: currentCoords.lng,
      currentQuality: currentCoords.quality || "approx",
      desiredLat: desiredCoords.lat,
      desiredLng: desiredCoords.lng,
      desiredQuality: desiredCoords.quality || "approx",
      region: s.region || regionFromLocation(s.current),
    });
  }

  function regionFromLocation(loc) {
    if (
      window.PostSwapGeocode &&
      typeof window.PostSwapGeocode.regionFromLocation === "function"
    ) {
      return window.PostSwapGeocode.regionFromLocation(loc);
    }
    return "United States";
  }

  /** Invalidate map size and fit pins after data load / layout */
  function forceMapRefresh(filtered) {
    if (!map) return;
    // No argument means every swap that matches the filters. Pass [] to clear.
    var list = filtered == null ? getFilteredSwaps() : filtered;
    // Multiple passes help when the explore panel was hidden during first paint
    var pass = function () {
      try {
        map.invalidateSize({ animate: false });
      } catch (_) { /* ignore */ }
      if (list.length) {
        try {
          var points = list
            .map(function (s) {
              var pin = activePin(s);
              return [pin.lat, pin.lng];
            })
            .filter(function (pair) {
              return isFinite(pair[0]) && isFinite(pair[1]);
            });
          if (!points.length) {
            map.setView([39.5, -98.35], 4);
            return;
          }
          var bounds = L.latLngBounds(points);
          if (bounds.isValid()) {
            map.fitBounds(bounds.pad(0.2), {
              maxZoom: list.length === 1 ? 8 : 5,
              animate: true,
            });
          }
        } catch (err) {
          console.warn("[PostSwap] fitBounds failed", err);
          map.setView([39.5, -98.35], 4);
        }
      } else {
        map.setView([39.5, -98.35], 4);
      }
    };
    pass();
    setTimeout(pass, 50);
    setTimeout(pass, 250);
    setTimeout(pass, 600);
  }

  function badgeClass(type) {
    if (type === "Temporary") return "temp";
    if (type === "Either") return "either";
    return "";
  }

  function formatSeniority(y) {
    const n = Number(y);
    return n === 1 ? "1 year" : `${n} years`;
  }

  function timeNow() {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  // ---------- Toasts ----------
  function showToast(title, message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `
      <div class="toast-icon">✓</div>
      <div class="toast-body">
        <strong>${title}</strong>
        <p>${message}</p>
      </div>
    `;
    els.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("out");
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ---------- In-app mailbox (real activity only) ----------
  // Read ids are stored per account. Legacy demo mailbox payload is discarded.
  const MAIL_READ_LEGACY_KEY = "postswap_mailbox_read_ids";
  try {
    localStorage.removeItem("postswap_mailbox");
  } catch (_) { /* ignore */ }

  let mailItems = [];
  let mailReadIds = new Set();
  let mailboxLoading = false;
  let readSyncTimer = null;

  function readStorageKey() {
    if (!user || (!user.id && !user.email)) return null;
    return "postswap_dm_read:" + String(user.id || user.email);
  }

  function loadMailReadIds() {
    mailReadIds = new Set();
    const key = readStorageKey();
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.forEach(function (id) {
            mailReadIds.add(String(id));
          });
        }
      }
    } catch (_) { /* ignore */ }
    // Move the old shared list onto this account once, then drop it
    // so the next person on this browser does not inherit those reads.
    if (mailReadIds.size === 0) {
      try {
        const legacy = localStorage.getItem(MAIL_READ_LEGACY_KEY);
        if (legacy) {
          const arr = JSON.parse(legacy);
          if (Array.isArray(arr)) {
            arr.forEach(function (id) {
              mailReadIds.add(String(id));
            });
          }
          localStorage.removeItem(MAIL_READ_LEGACY_KEY);
          saveMailReadIdsLocal();
        }
      } catch (_) { /* ignore */ }
    }
  }

  function saveMailReadIdsLocal() {
    const key = readStorageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(Array.from(mailReadIds).slice(-400)));
    } catch (_) { /* ignore */ }
  }

  function saveMailReadIds() {
    saveMailReadIdsLocal();
    if (readSyncTimer) clearTimeout(readSyncTimer);
    readSyncTimer = setTimeout(pushReadIdsToServer, 700);
  }

  async function pushReadIdsToServer() {
    if (!user || !user.id || !useSupabase || !db() || typeof db().saveDmReadIds !== "function") return;
    try {
      await db().saveDmReadIds(user.id, Array.from(mailReadIds));
    } catch (err) {
      console.warn("[PostSwap] read-state sync failed", err);
    }
  }

  async function hydrateServerReadIds() {
    if (!user || !user.id || !useSupabase || !db() || typeof db().fetchDmReadIds !== "function") return;
    let remote = null;
    try {
      remote = await db().fetchDmReadIds(user.id);
    } catch (err) {
      console.warn("[PostSwap] read-state load failed", err);
      return;
    }
    if (!Array.isArray(remote)) return;
    let changed = false;
    remote.forEach(function (id) {
      const key = String(id);
      if (!mailReadIds.has(key)) {
        mailReadIds.add(key);
        changed = true;
      }
    });
    if (changed) {
      saveMailReadIdsLocal();
      refreshMailboxFromDb();
      if (els.modalInbox && !els.modalInbox.hidden && inboxThreads.length) {
        renderInboxThreadList();
      }
    }
  }

  function unreadCount() {
    return mailItems.filter(function (n) {
      return n.unread;
    }).length;
  }

  function iconSvg(type) {
    if (type === "dm") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
    }
    if (type === "interest" || type === "matching_swap") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
    }
    if (type === "email" || type === "new_dm") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
  }

  function relativeTimeLabel(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
      if (sec < 60) return "Just now";
      if (sec < 3600) return Math.floor(sec / 60) + " min ago";
      if (sec < 86400) return Math.floor(sec / 3600) + " hr ago";
      if (sec < 86400 * 7) return Math.floor(sec / 86400) + "d ago";
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch (_) {
      return "";
    }
  }

  /**
   * Build mailbox feed from real Supabase activity:
   * - DMs involving the current user
   * - email_queue rows for their email (if table exists)
   */
  async function refreshMailboxFromDb() {
    if (!user) {
      mailItems = [];
      renderMailbox();
      return;
    }

    mailboxLoading = true;
    renderMailbox();

    const items = [];

    // 1) Real DMs — one notification per (swap + other person)
    if (useSupabase && db() && typeof db().fetchMessagesForUser === "function") {
      try {
        await ensureProfileIndex();
        const msgs = await db().fetchMessagesForUser(user, 80);
        const byThread = new Map();
        (msgs || []).forEach(function (m) {
          const swap = findSwapById(m.swapId);
          const info = threadInfoFor(m, swap);
          const prev = byThread.get(info.key);
          if (!prev || new Date(m.createdAt || 0) > new Date(prev.createdAt || 0)) {
            byThread.set(info.key, { message: m, info: info, swap: swap });
          }
        });

        byThread.forEach(function (entry) {
          const m = entry.message;
          const info = entry.info;
          const swap = entry.swap;
          const fromMe = info.fromMe;
          const route = swap
            ? swap.current + " → " + swap.desired
            : swapTitle(null, m.swapId);
          const peer = partyName(info.otherRaw || info.addressId, swap);
          const text = fromMe
            ? "You messaged " + peer + " · " + route
            : "New message from " + peer + " · " + route;
          const nid = "dm-" + String(m.id);
          items.push({
            id: nid,
            type: "dm",
            text: text,
            preview: m.body || "",
            time: relativeTimeLabel(m.createdAt),
            createdAt: m.createdAt,
            unread: !mailReadIds.has(nid),
            swapId: m.swapId,
            threadKey: info.key,
            action: "dm",
          });
        });
      } catch (err) {
        console.warn("[PostSwap] mailbox DM load failed", err);
      }
    }

    // 2) Real email_queue notifications for this user
    if (
      useSupabase &&
      db() &&
      user.email &&
      typeof db().fetchEmailQueueForUser === "function"
    ) {
      try {
        const emails = await db().fetchEmailQueueForUser(user.email, 30);
        (emails || []).forEach(function (row) {
          const nid = "eq-" + String(row.id);
          const et = row.eventType || "email";
          let type = "email";
          if (et === "new_dm") type = "dm";
          else if (et === "matching_swap") type = "matching_swap";
          else if (et === "interest") type = "interest";
          items.push({
            id: nid,
            type: type,
            text: row.subject || "PostSwap notification",
            preview: (row.body || "").slice(0, 120),
            time: relativeTimeLabel(row.createdAt),
            createdAt: row.createdAt,
            unread: !mailReadIds.has(nid),
            swapId: row.meta && (row.meta.swap_id || row.meta.swapId),
            action: "email",
          });
        });
      } catch (err) {
        console.warn("[PostSwap] mailbox email_queue load failed", err);
      }
    }

    // Newest first; prefer unread
    items.sort(function (a, b) {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    mailItems = items;
    mailboxLoading = false;
    renderMailbox();
    console.log("[PostSwap] mailbox real items:", mailItems.length);
  }

  function renderMailbox() {
    if (!els.mailbox || !els.mailboxList) return;

    const count = unreadCount();
    els.mailbox.classList.toggle("has-unread", count > 0);
    els.mailbox.classList.remove("level-1", "level-2", "level-3");
    if (count > 0) {
      els.mailbox.classList.add("level-" + Math.min(3, count));
    }

    if (els.mailboxBadge) {
      if (count > 0) {
        els.mailboxBadge.hidden = false;
        els.mailboxBadge.textContent = count > 9 ? "9+" : String(count);
      } else {
        els.mailboxBadge.hidden = true;
      }
    }

    if (els.mailboxBtn) {
      els.mailboxBtn.setAttribute(
        "aria-label",
        count > 0 ? "Notifications, " + count + " unread" : "Notifications"
      );
    }

    if (els.mailboxMarkAll) {
      els.mailboxMarkAll.disabled = count === 0 || mailboxLoading;
    }

    if (mailboxLoading && !mailItems.length) {
      els.mailboxList.innerHTML = `
        <div class="inbox-loading" style="padding:1.25rem">
          <span class="loading-spinner loading-spinner-sm" aria-hidden="true"></span>
          Loading activity…
        </div>
      `;
      return;
    }

    if (!user) {
      els.mailboxList.innerHTML = `
        <div class="mailbox-empty">
          <p><strong>Sign in for activity</strong><br/>Your real DMs and alerts show up here.</p>
        </div>
      `;
      return;
    }

    if (!mailItems.length) {
      els.mailboxList.innerHTML = `
        <div class="mailbox-empty">
          <div class="mailbox-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg>
          </div>
          <p><strong>No activity yet</strong><br/>When you get real DMs or match alerts, they’ll show up here.</p>
        </div>
      `;
      return;
    }

    els.mailboxList.innerHTML = mailItems
      .map(function (n) {
        return (
          '<button type="button" class="mailbox-item' +
          (n.unread ? " unread" : "") +
          '" data-mail-id="' +
          escapeHtml(String(n.id)) +
          '" role="menuitem">' +
          '<span class="mailbox-dot" aria-hidden="true"></span>' +
          '<span class="mailbox-item-icon ' +
          escapeHtml(n.type) +
          '" aria-hidden="true">' +
          iconSvg(n.type) +
          "</span>" +
          '<span class="mailbox-item-body">' +
          "<p>" +
          escapeHtml(n.text) +
          "</p>" +
          (n.preview
            ? '<span class="mailbox-item-meta" style="display:block;margin-top:0.2rem;opacity:0.85">' +
              escapeHtml(n.preview) +
              "</span>"
            : "") +
          '<span class="mailbox-item-meta">' +
          escapeHtml(n.time || "") +
          (n.unread ? " · New" : "") +
          "</span>" +
          "</span>" +
          "</button>"
        );
      })
      .join("");
  }

  function setMailboxOpen(open) {
    if (!els.mailboxPanel || !els.mailboxBtn) return;
    els.mailboxPanel.hidden = !open;
    els.mailboxBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  async function toggleMailbox(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!user) {
      requireAuth(
        "Sign up free to see real mailbox activity from your DMs and alerts."
      );
      return;
    }
    const open = els.mailboxPanel.hidden;
    setMailboxOpen(open);
    if (open) {
      closeMobileMenu();
      await refreshMailboxFromDb();
    }
  }

  function markAllMailRead() {
    mailItems.forEach(function (n) {
      mailReadIds.add(String(n.id));
      n.unread = false;
    });
    saveMailReadIds();
    renderMailbox();
    showToast("Mailbox cleared", "All activity marked as read.");
  }

  function markOneMailRead(id) {
    mailReadIds.add(String(id));
    mailItems = mailItems.map(function (n) {
      return String(n.id) === String(id) ? Object.assign({}, n, { unread: false }) : n;
    });
    saveMailReadIds();
    renderMailbox();
  }

  function onMailboxItemClick(id) {
    const item = mailItems.find(function (n) {
      return String(n.id) === String(id);
    });
    markOneMailRead(id);
    if (!item) return;
    if (item.swapId && (item.action === "dm" || item.action === "email")) {
      setMailboxOpen(false);
      openInbox({
        threadKey: item.threadKey || null,
        swapId: item.swapId,
      });
    } else if (item.action === "email") {
      setMailboxOpen(false);
      openInbox();
    }
  }

  function newUserId() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "user-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  async function persistProfileToSupabase(profile) {
    if (!useSupabase || !db() || !profile) return null;
    try {
      return await db().saveProfile({
        id: profile.id,
        name: profile.name,
        email: profile.email,
        craft: profile.craft,
        station: profile.station,
        state: profile.state,
        initials: profile.initials,
        employeeId: profile.employeeId || "",
        notifications: profile.notifications || DEFAULT_NOTIFICATIONS,
      });
    } catch (err) {
      console.warn("Profile save failed:", err);
      return null;
    }
  }

  // ---------- Auth ----------
  function setLoggedIn(userData, { quiet, skipRemote } = {}) {
    user = defaultUserFields(userData);
    if (!user.id) user.id = newUserId();
    // Persist a lightweight local copy
    try {
      localStorage.setItem("postswap_user", JSON.stringify(user));
    } catch (_) { /* ignore */ }

    els.authGuest.classList.add("hidden");
    els.authUser.classList.remove("hidden");
    els.userAvatar.textContent = user.initials;
    els.userName.textContent =
      user.name.split(" ")[0] +
      (user.name.split(" ")[1] ? " " + user.name.split(" ")[1][0] + "." : "");
    updateMobileAuth();
    updateGuestParticipateBanner();
    loadMailReadIds();
    renderMailbox();
    refreshMailboxFromDb();
    hydrateServerReadIds();
    if (swapsLoaded) refreshViews();

    if (!skipRemote) {
      persistProfileToSupabase(user).then((remote) => {
        if (remote && remote.id) {
          user = defaultUserFields({ ...user, ...remote });
          try {
            localStorage.setItem("postswap_user", JSON.stringify(user));
          } catch (_) { /* ignore */ }
        }
      });
    }

    if (!quiet) {
      showToast(
        "You're in",
        `Welcome back, ${user.name.split(" ")[0]}! Check your mailbox for updates.`
      );
    }
  }

  function setLoggedOut() {
    user = null;
    try {
      localStorage.removeItem("postswap_user");
    } catch (_) { /* ignore */ }
    els.authGuest.classList.remove("hidden");
    els.authUser.classList.add("hidden");
    setMailboxOpen(false);
    updateMobileAuth();
    updateGuestParticipateBanner();
    mailItems = [];
    mailReadIds = new Set();
    if (readSyncTimer) clearTimeout(readSyncTimer);
    stopMessagePoll();
    renderMailbox();
    if (swapsLoaded) refreshViews();
    showToast(
      "Signed out",
      "You can still browse the map. Sign up free to post or message."
    );
  }

  function updateMobileAuth() {
    if (!els.mobileAuth) return;
    if (user) {
      els.mobileAuth.innerHTML = `
        <button type="button" class="user-chip user-chip-btn" data-action="open-profile" style="align-self:flex-start;margin-bottom:0.5rem">
          <span class="avatar">${user.initials}</span>
          <span class="user-name">${user.name}</span>
        </button>
        <button type="button" class="btn btn-outline btn-block" data-action="open-profile">Profile &amp; Notifications</button>
        <button type="button" class="btn btn-outline btn-block" data-action="open-inbox">My Messages</button>
        <button type="button" class="btn btn-outline btn-block" data-action="show-my-swaps">My Swaps</button>
        <button type="button" class="btn btn-ghost btn-block" data-action="logout">Log out</button>
      `;
    } else {
      els.mobileAuth.innerHTML = `
        <button type="button" class="btn btn-ghost btn-block" data-action="open-login">Login</button>
        <button type="button" class="btn btn-primary btn-block" data-action="open-register">Register</button>
      `;
    }
  }

  function demoLogin() {
    setLoggedIn({
      id: "demo-1",
      name: "Maria Chen",
      email: "maria.demo@postswap.app",
      craft: "Letter Carrier",
      station: "North Las Vegas Main",
      state: "NV",
      initials: "MC",
      notifications: { ...DEFAULT_NOTIFICATIONS },
    });
    closeAllModals();
  }

  function restoreSession() {
    try {
      const raw = localStorage.getItem("postswap_user");
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.name && saved.email) {
          setLoggedIn(saved, { quiet: true });
        }
      }
    } catch (_) { /* ignore */ }
  }

  // ---------- Profile & notifications ----------
  function openProfile() {
    if (!user) {
      openLogin();
      showToast("Sign in first", "Log in to manage your profile and email notifications.");
      return;
    }
    els.profileAvatar.textContent = user.initials;
    els.profileName.textContent = user.name;
    els.profileMeta.textContent = `${user.craft || "Carrier"} · ${user.station || "Station TBD"}`;
    els.profileEmail.value = user.email || "";
    els.profileCraft.value = user.craft || "Letter Carrier";
    els.profileStation.value = user.station || "";
    els.profileState.value = user.state || "";

    const n = user.notifications || DEFAULT_NOTIFICATIONS;
    els.notifyEmailEnabled.checked = !!n.emailEnabled;
    els.notifyInterest.checked = !!n.onInterest;
    els.notifyState.checked = !!n.onStateSwap;
    els.notifyDm.checked = !!n.onDm;
    syncNotifyUi();
    openModal(els.modalProfile);
  }

  function syncNotifyUi() {
    const emailOn = els.notifyEmailEnabled.checked;
    els.notifyOptions.classList.toggle("is-disabled", !emailOn);
    els.notifyPreview.classList.toggle("email-off", !emailOn);
    const addr = (els.profileEmail.value || user?.email || "your email").trim();
    if (emailOn) {
      els.notifyPreview.innerHTML = `
        <span class="notify-preview-icon" aria-hidden="true">✉</span>
        <p>Alerts will go to <strong>${escapeHtml(addr)}</strong> for the options you enable below.</p>
      `;
    } else {
      els.notifyPreview.innerHTML = `
        <span class="notify-preview-icon" aria-hidden="true">○</span>
        <p>Email notifications are <strong>off</strong>. Turn on the master switch to receive alerts at your personal email.</p>
      `;
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    if (!user) return;

    const email = els.profileEmail.value.trim();
    if (!email) return;

    const submitBtn = els.formProfile && els.formProfile.querySelector('button[type="submit"]');
    setButtonLoading(submitBtn, true);

    user = {
      ...user,
      email,
      craft: els.profileCraft.value,
      station: els.profileStation.value.trim(),
      state: els.profileState.value,
      notifications: {
        emailEnabled: els.notifyEmailEnabled.checked,
        onInterest: els.notifyInterest.checked,
        onStateSwap: els.notifyState.checked,
        onDm: els.notifyDm.checked,
      },
    };

    try {
      localStorage.setItem("postswap_user", JSON.stringify(user));
    } catch (_) { /* ignore */ }

    const remote = await persistProfileToSupabase(user);
    setButtonLoading(submitBtn, false);

    if (remote) {
      user = defaultUserFields({ ...user, ...remote });
      try {
        localStorage.setItem("postswap_user", JSON.stringify(user));
      } catch (_) { /* ignore */ }
    }

    els.profileMeta.textContent = `${user.craft || "Carrier"} · ${user.station || "Station TBD"}`;
    closeAllModals();

    const n = user.notifications;
    const summary = !n.emailEnabled
      ? "Email alerts are off."
      : [
          n.onInterest && "interest",
          n.onStateSwap && "state swaps",
          n.onDm && "DMs",
        ]
          .filter(Boolean)
          .join(", ") || "no alert types";

    showToast(
      remote ? "Profile saved to cloud" : "Profile saved locally",
      n.emailEnabled
        ? `Notifications for ${summary} will go to ${email}.`
        : `Saved. Email notifications are disabled for ${email}.`
    );
  }

  // ---------- Filtering ----------
  function activeLocationText(s) {
    return mapMode === "coming" ? s.desired || "" : s.current || "";
  }

  function otherLocationText(s) {
    return mapMode === "coming" ? s.current || "" : s.desired || "";
  }

  /** Pin for the question currently on screen. One pin per swap. */
  function activePin(s) {
    if (mapMode === "coming") {
      var lat = s.desiredLat != null ? Number(s.desiredLat) : NaN;
      var lng = s.desiredLng != null ? Number(s.desiredLng) : NaN;
      return {
        lat: lat,
        lng: lng,
        quality: s.desiredQuality || "anywhere",
        label: s.desired || "",
      };
    }
    return {
      lat: s.currentLat != null ? Number(s.currentLat) : Number(s.lat),
      lng: s.currentLng != null ? Number(s.currentLng) : Number(s.lng),
      quality: s.currentQuality || "approx",
      label: s.current || "",
    };
  }

  function milesBetween(aLat, aLng, bLat, bLng) {
    if (![aLat, aLng, bLat, bLng].every(function (n) { return isFinite(Number(n)); })) return Infinity;
    var R = 3958.8;
    var toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(bLat - aLat);
    var dLng = toRad(bLng - aLng);
    var lat1 = toRad(aLat);
    var lat2 = toRad(bLat);
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Swaps that land on the same spot are walked around a small circle
   * so every pin stays clickable. A lone pin stays on its real coordinate.
   */
  function spreadPins(items) {
    var n = items.length;
    var parent = [];
    for (var i = 0; i < n; i++) parent.push(i);
    function find(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    function near(a, b) {
      return Math.abs(a.lat - b.lat) < 0.015 && Math.abs(a.lng - b.lng) < 0.02;
    }
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        if (near(items[i], items[j])) parent[find(j)] = find(i);
      }
    }
    var groups = new Map();
    for (var g = 0; g < n; g++) {
      var root = find(g);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(items[g]);
    }
    var placed = new Map();
    groups.forEach(function (group) {
      if (group.length === 1) {
        placed.set(String(group[0].id), { lat: group[0].lat, lng: group[0].lng });
        return;
      }
      var lat0 = 0;
      var lng0 = 0;
      group.forEach(function (item) {
        lat0 += item.lat;
        lng0 += item.lng;
      });
      lat0 /= group.length;
      lng0 /= group.length;
      // Chord stays wide enough to tap once clusters break apart (~zoom 12).
      var minChord = 0.014;
      var sinTerm = Math.sin(Math.PI / group.length);
      var radiusDeg = Math.min(0.06, minChord / (2 * Math.max(sinTerm, 0.12)));
      var lngScale = Math.max(0.25, Math.cos((lat0 * Math.PI) / 180));
      group.forEach(function (item, idx) {
        var angle = (2 * Math.PI * idx) / group.length - Math.PI / 2;
        placed.set(String(item.id), {
          lat: lat0 + radiusDeg * Math.cos(angle),
          lng: lng0 + (radiusDeg * Math.sin(angle)) / lngScale,
        });
      });
    });
    return placed;
  }

  function currentSort() {
    var value = els.swapSort ? els.swapSort.value : "newest";
    if (value === "closest" && !nearMeCenter) return "newest";
    if (
      value === "oldest" ||
      value === "seniority-desc" ||
      value === "seniority-asc" ||
      value === "closest"
    ) {
      return value;
    }
    return "newest";
  }

  function syncSortControl() {
    var sel = els.swapSort;
    if (!sel) return;
    var closest = sel.querySelector('option[value="closest"]');
    if (closest) closest.disabled = !nearMeCenter;
    if (!nearMeCenter && sel.value === "closest") sel.value = "newest";
  }

  function listQueryKeyFor() {
    var city = els.filterCity ? (els.filterCity.value || "").trim() : "";
    var craft = els.filterCraft ? els.filterCraft.value || "" : "";
    var near = nearMeCenter
      ? Number(nearMeCenter.lat).toFixed(3) + "," + Number(nearMeCenter.lng).toFixed(3)
      : "";
    return [currentSort(), mapMode, city, craft, near].join("|");
  }

  /** Reset the page when filters or sort change. Keep it when loading more. */
  function windowedSwaps(filtered) {
    var key = listQueryKeyFor();
    if (key !== listQueryKey) {
      listQueryKey = key;
      listShown = LIST_PAGE;
    }
    return filtered.slice(0, listShown);
  }

  function swapTime(s) {
    var t = Date.parse((s && (s.createdAt || s.created_at)) || "");
    return isNaN(t) ? 0 : t;
  }

  function seniorityRank(s) {
    var n = parseFloat(s && s.seniority);
    return isNaN(n) ? 0 : n;
  }

  function compareSwaps(a, b) {
    var sort = currentSort();
    if (sort === "closest" && nearMeCenter) {
      var da = milesBetween(nearMeCenter.lat, nearMeCenter.lng, activePin(a).lat, activePin(a).lng);
      var db = milesBetween(nearMeCenter.lat, nearMeCenter.lng, activePin(b).lat, activePin(b).lng);
      if (da !== db) return da - db;
    } else if (sort === "oldest") {
      if (swapTime(a) !== swapTime(b)) return swapTime(a) - swapTime(b);
    } else if (sort === "seniority-desc") {
      if (seniorityRank(a) !== seniorityRank(b)) return seniorityRank(b) - seniorityRank(a);
    } else if (sort === "seniority-asc") {
      if (seniorityRank(a) !== seniorityRank(b)) return seniorityRank(a) - seniorityRank(b);
    } else if (swapTime(a) !== swapTime(b)) {
      return swapTime(b) - swapTime(a);
    }
    return String(a.id).localeCompare(String(b.id));
  }

  function getFilteredSwaps() {
    const city = (els.filterCity.value || "").trim().toLowerCase();
    const craft = els.filterCraft.value;

    const filtered = swaps.filter((s) => {
      if (!swapIsPublic(s)) return false;
      // Exact craft match only. Blank means "all crafts" (no extra craft invented).
      if (craft && s.craft !== craft) return false;
      if (nearMeCenter) {
        var pin = activePin(s);
        if (!isFinite(pin.lat) || !isFinite(pin.lng)) return false;
        if (milesBetween(nearMeCenter.lat, nearMeCenter.lng, pin.lat, pin.lng) > NEAR_ME_MILES) {
          return false;
        }
      }
      if (city) {
        var primary = activeLocationText(s).toLowerCase();
        var other = otherLocationText(s).toLowerCase();
        var extra = `${s.region || ""} ${s.notes || ""}`.toLowerCase();
        if (!primary.includes(city) && !other.includes(city) && !extra.includes(city)) return false;
      }
      return true;
    });

    filtered.sort(compareSwaps);
    return filtered;
  }

  function modeCopy() {
    if (mapMode === "coming") {
      return {
        help: "See who wants to move TO an area",
        list: "Focused on where carriers want to go",
        placeholder: "Search a city they want…",
      };
    }
    return {
      help: "See who is trying to leave an area",
      list: "Focused on where carriers are leaving from",
      placeholder: "Search a city they’re leaving…",
    };
  }

  function syncModeControls() {
    const coming = mapMode === "coming";
    if (els.modeLeaving) {
      els.modeLeaving.classList.toggle("is-active", !coming);
      els.modeLeaving.setAttribute("aria-pressed", coming ? "false" : "true");
    }
    if (els.modeComing) {
      els.modeComing.classList.toggle("is-active", coming);
      els.modeComing.setAttribute("aria-pressed", coming ? "true" : "false");
    }
    const copy = modeCopy();
    if (els.mapModeHelp) els.mapModeHelp.textContent = copy.help;
    if (els.listModeNote) els.listModeNote.textContent = copy.list;
    if (els.filterCity) els.filterCity.placeholder = copy.placeholder;
    const explore = $("#explore");
    if (explore) explore.classList.toggle("mode-coming", coming);
    if (els.nearMeBtn) {
      const on = !!nearMeCenter;
      els.nearMeBtn.classList.toggle("is-active", on);
      els.nearMeBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    syncSortControl();
  }

  function setMapMode(mode) {
    if (mode !== "leaving" && mode !== "coming") return;
    if (mode === mapMode) return;
    mapMode = mode;
    activeSwapId = null;
    syncModeControls();
    refreshViews();
    if (nearMeCenter) zoomToMiles(nearMeCenter.lat, nearMeCenter.lng);
    else forceMapRefresh();
  }

  // ---------- Map ----------
  function initMap() {
    map = L.map("map", {
      zoomControl: true,
      scrollWheelZoom: true,
      // markercluster refuses to start if the map has no finite max zoom
      maxZoom: 18,
    }).setView([36.5, -105], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    markersLayer = createMarkersLayer().addTo(map);

    // Fix tiles when container becomes visible / resized.
    // Resize only recalculates size — refitting here would undo Near Me on phones.
    setTimeout(function () {
      forceMapRefresh();
    }, 200);
    window.addEventListener("resize", function () {
      if (map) map.invalidateSize();
    });
  }

  function createMarkersLayer() {
    if (typeof L.markerClusterGroup === "function") {
      return L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 12,
        maxClusterRadius: function (zoom) {
          if (zoom <= 5) return 64;
          if (zoom <= 8) return 50;
          return 36;
        },
        spiderfyDistanceMultiplier: 1.6,
        spiderLegPolylineOptions: { weight: 1.5, color: "#003087", opacity: 0.75 },
        chunkedLoading: true,
        removeOutsideVisibleBounds: false,
        iconCreateFunction: function (cluster) {
          var count = cluster.getChildCount();
          var sizeClass = "marker-cluster-small";
          var iconSize = 40;
          if (count >= 50) {
            sizeClass = "marker-cluster-large";
            iconSize = 52;
          } else if (count >= 10) {
            sizeClass = "marker-cluster-medium";
            iconSize = 46;
          }
          return L.divIcon({
            html: "<div><span>" + count + "</span></div>",
            className: "marker-cluster " + sizeClass,
            iconSize: L.point(iconSize, iconSize),
          });
        },
      });
    }
    console.warn("[PostSwap] Leaflet.markercluster missing — pins will not group");
    return L.layerGroup();
  }

  function createMarkerIcon(highlight) {
    return L.divIcon({
      className: "swap-marker",
      html: `<div class="marker-pin${highlight ? " highlight" : ""}"></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -36],
    });
  }

  function shareUrlFor(s) {
    return `https://post-swap.com/swap/${s.id}`;
  }

  function buildShareText(s) {
    const yrs = formatSeniority(s.seniority);
    return (
      `Check out this USPS route swap! Current: ${s.current} → Desired: ${s.desired}. ` +
      `${s.craft}, ${yrs} seniority. Link: ${shareUrlFor(s)}`
    );
  }

  function shareTruckIcon() {
    return `<svg class="share-truck-icon" viewBox="0 0 40 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="8" width="26" height="14" rx="2.5" fill="#FFFFFF" stroke="#003087" stroke-width="1.8"/>
      <path d="M28 12h6c1.5 0 2.5 1 2.5 2.5V22H28V12z" fill="#FFFFFF" stroke="#003087" stroke-width="1.6"/>
      <rect x="4" y="14" width="22" height="2.2" fill="#003087"/>
      <rect x="4" y="16.5" width="22" height="1.2" fill="#B22234"/>
      <circle cx="10" cy="23" r="2.8" fill="#1a2744"/>
      <circle cx="24" cy="23" r="2.8" fill="#1a2744"/>
      <rect x="12" y="2" width="6" height="5" rx="1" fill="#003087"/>
      <rect x="19" y="3" width="7" height="4" rx="1" fill="#B22234"/>
    </svg>`;
  }

  function shareButtonHtml(s) {
    return `<button type="button" class="btn btn-share" data-share-id="${s.id}">
      ${shareTruckIcon()}
      <span>Share</span>
    </button>`;
  }

  function popupMaxWidth() {
    if (!map) return 280;
    var w = map.getSize().x || 320;
    return Math.max(200, Math.min(300, w - 48));
  }

  function popupHtml(s) {
    const pin = activePin(s);
    const headline =
      mapMode === "coming"
        ? "Coming to " + (s.desired || "an open location")
        : "Leaving from " + (s.current || "an open location");
    const weak = pin.quality !== "city";
    const verified = s.privacyLabel || "Verified Carrier";
    return `
      <div class="popup-card">
        <h4>${escapeHtml(headline)}</h4>
        <div class="popup-meta">
          <div><strong>Current location:</strong> ${escapeHtml(s.current || "Not listed")}</div>
          <div><strong>Desired location:</strong> ${escapeHtml(s.desired || "Not listed")}</div>
          <div><strong>Craft:</strong> ${escapeHtml(s.craft || "")}</div>
          <div><strong>Seniority:</strong> ${formatSeniority(s.seniority)}</div>
          ${s.swapType ? `<div><strong>Swap type:</strong> ${escapeHtml(s.swapType)}</div>` : ""}
          <div><span class="popup-verified">${escapeHtml(verified)}</span></div>
        </div>
        ${
          weak
            ? `<div class="popup-approx">Pin is approximate. City: ${escapeHtml(pin.label || s.current || s.desired || "Unknown")}</div>`
            : ""
        }
        ${s.notes ? `<div class="popup-note">“${escapeHtml(s.notes)}”</div>` : ""}
        <div class="popup-actions">
          <button type="button" class="btn btn-primary" ${
            userOwnsSwap(s)
              ? `data-view-listing="${s.id}"`
              : `data-dm-id="${s.id}"`
          }>
            ${
              userOwnsSwap(s)
                ? "View listing"
                : user
                  ? "Send DM"
                  : "Sign up to DM"
            }
          </button>
          ${shareButtonHtml(s)}
          ${userOwnsSwap(s) ? `<button type="button" class="link-btn swap-manage" data-view-listing="${s.id}">Manage</button>` : ""}
        </div>
        <p class="share-nudge">${
          user
            ? "Send to a buddy who might want this route!"
            : "Browsing is free — sign up to message this carrier."
        }</p>
      </div>
    `;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function refreshMap(filtered) {
    if (!map || !markersLayer) return;
    markersLayer.clearLayers();
    markerById.clear();

    const placed = spreadPins(
      filtered
        .map(function (s) {
          var pin = activePin(s);
          return { id: s.id, lat: pin.lat, lng: pin.lng };
        })
        .filter(function (pin) {
          return isFinite(pin.lat) && isFinite(pin.lng);
        })
    );

    filtered.forEach((s) => {
      const pin = activePin(s);
      if (!isFinite(pin.lat) || !isFinite(pin.lng)) return;
      const spot = placed.get(String(s.id)) || pin;
      const marker = L.marker([spot.lat, spot.lng], {
        icon: createMarkerIcon(idEq(s.id, activeSwapId)),
        title: `${s.current} → ${s.desired}`,
      });
      marker.bindPopup(popupHtml(s), {
        maxWidth: popupMaxWidth(),
        minWidth: 200,
        autoPan: true,
        autoPanPadding: [28, 28],
        keepInView: true,
        className: "swap-popup",
      });
      marker.on("click", () => {
        setActiveSwap(s.id, { fromMap: true });
        // Open the popup even when this swap’s card is still on a later page.
        marker.openPopup();
      });
      marker.on("popupopen", (e) => {
        const root = e.popup && e.popup.getElement ? e.popup.getElement() : null;
        if (!root) return;
        const btn = root.querySelector(`[data-dm-id="${s.id}"]`);
        if (btn) {
          btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            openDm(s);
          });
        }
        root.querySelectorAll("[data-view-listing]").forEach(function (viewBtn) {
          viewBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            openMySwaps(s.id);
          });
        });
        const shareBtn = root.querySelector(`[data-share-id="${s.id}"]`);
        if (shareBtn) {
          shareBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            openShare(s);
          });
        }
      });
      marker.addTo(markersLayer);
      markerById.set(s.id, marker);
    });
  }

  function setActiveSwap(id, { fromMap = false, scrollList = true } = {}) {
    activeSwapId = id;
    // Update list card styles
    $$(".swap-card").forEach((card) => {
      card.classList.toggle("active", idEq(card.dataset.id, id));
    });
    // Update marker icons
    markerById.forEach((marker, mid) => {
      marker.setIcon(createMarkerIcon(idEq(mid, id)));
    });
    if (scrollList && !fromMap) {
      const card = document.querySelector(`.swap-card[data-id="${CSS.escape ? CSS.escape(String(id)) : String(id)}"]`);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (!fromMap) {
      const marker = markerById.get(id) || markerById.get(String(id));
      if (marker && map) {
        const openIt = function () {
          marker.openPopup();
        };
        if (markersLayer && typeof markersLayer.zoomToShowLayer === "function") {
          markersLayer.zoomToShowLayer(marker, openIt);
        } else {
          map.panTo(marker.getLatLng(), { animate: true });
          openIt();
        }
      }
    }
  }

  // ---------- List ----------
  function renderList(filtered) {
    var visible = windowedSwaps(filtered);
    var total = filtered.length;
    els.listCount.textContent = nearMeCenter
      ? `${total} near you`
      : `${total} open`;

    var more = els.loadMore;
    if (!total) {
      const craftLabel = els.filterCraft && els.filterCraft.value ? " in this craft" : "";
      const emptyTitle = nearMeCenter ? "No swaps near you" : "No swaps match your filters";
      const emptyBody = nearMeCenter
        ? mapMode === "coming"
          ? "Nobody" + craftLabel + " wants to move within about 150 miles. Try Leaving from, or search a city."
          : "Nobody" + craftLabel + " is leaving from within about 150 miles. Try Coming to, or search a city."
        : "Try another city or craft — or post yours so others can find you.";
      els.swapList.innerHTML = `
        <div class="empty-state">
          <strong>${emptyTitle}</strong>
          <p>${emptyBody}</p>
        </div>
      `;
      if (more) more.hidden = true;
      return visible;
    }

    els.swapList.innerHTML = visible
      .map((s) => {
        const isMine = userOwnsSwap(s);
        return `
        <article class="swap-card${idEq(s.id, activeSwapId) ? " active" : ""}${isMine ? " mine" : ""}${s.justAdded ? " just-added" : ""}" data-id="${s.id}" tabindex="0">
          <div class="swap-card-top">
            <div class="swap-route">
              <span class="${mapMode === "leaving" ? "loc-focus" : ""}">${escapeHtml(s.current)}</span>
              <span class="arrow">→</span>
              <span class="${mapMode === "coming" ? "loc-focus" : ""}">${escapeHtml(s.desired)}</span>
            </div>
            <span class="swap-badge ${badgeClass(s.swapType)}">${escapeHtml(s.swapType)}</span>
          </div>
          <div class="swap-focus">${
            mapMode === "coming"
              ? "Coming to " + escapeHtml(s.desired || "an open location")
              : "Leaving from " + escapeHtml(s.current || "an open location")
          }</div>
          <div class="swap-meta">
            <span>${escapeHtml(s.craft)}</span>
            <span>${formatSeniority(s.seniority)} seniority</span>
          </div>
          <div class="swap-privacy">${isMine ? "Your listing • visible to carriers" : escapeHtml(s.privacyLabel)}</div>
          <div class="swap-card-actions">
            ${isMine ? `<button type="button" class="link-btn swap-manage" data-view-listing="${s.id}">Manage</button>` : ""}
            <button type="button" class="btn btn-primary" ${
              isMine ? `data-view-listing="${s.id}"` : `data-dm-id="${s.id}"`
            }>
              ${
                isMine
                  ? "View listing"
                  : user
                    ? "I'm Interested → DM"
                    : "Sign up to participate"
              }
            </button>
            ${shareButtonHtml(s)}
          </div>
          <p class="share-nudge">${
            user
              ? "Send to a buddy who might want this route!"
              : "Map browsing is public — create a free account to DM or post."
          }</p>
        </article>
      `;
      })
      .join("");

    if (more) {
      var left = total - visible.length;
      more.hidden = left <= 0;
      more.textContent = left > 0 ? "Load more (" + left + " left)" : "Load more";
    }

    // Clear justAdded flags after paint
    filtered.forEach((s) => {
      if (s.justAdded) delete s.justAdded;
    });
    return visible;
  }

  function refreshViews() {
    syncModeControls();
    const filtered = getFilteredSwaps();
    renderList(filtered);
    refreshMap(filtered);
    // Keep map sized correctly after list/filter updates
    if (swapsLoaded && map) {
      setTimeout(function () {
        try {
          map.invalidateSize({ animate: false });
        } catch (_) { /* ignore */ }
      }, 0);
    }
    clearFabFromLoadMore();
  }

  /** Hide Quick Post while it sits on top of Load more, so the button can be tapped. */
  function clearFabFromLoadMore() {
    var fab = document.getElementById("fab-quick-post");
    var more = document.getElementById("swap-load-more");
    if (!fab || !more) return;
    var narrow = window.matchMedia("(max-width: 700px)").matches;
    if (!narrow || more.hidden) {
      fab.classList.remove("fab-yield");
      return;
    }
    var a = more.getBoundingClientRect();
    var b = fab.getBoundingClientRect();
    var overlap =
      a.width > 0 &&
      a.height > 0 &&
      a.bottom > b.top + 2 &&
      a.top < b.bottom - 2 &&
      a.right > b.left + 2 &&
      a.left < b.right - 2;
    fab.classList.toggle("fab-yield", overlap);
  }

  function swapIdFromLocation() {
    var path = window.location.pathname || "";
    try {
      path = decodeURIComponent(path);
    } catch (_) { /* keep the raw path */ }
    var match = path.match(/\/swap\/([^/]+)\/?$/i);
    return match ? match[1] : "";
  }

  function queueLinkedSwap() {
    if (linkedSwapHandled || !swapIdFromLocation()) return;
    // Wait until the map’s fit passes finish, then open the shared swap.
    setTimeout(openLinkedSwap, 900);
  }

  function openLinkedSwap() {
    if (linkedSwapHandled) return;
    var id = swapIdFromLocation();
    if (!id) return;
    linkedSwapHandled = true;
    var explore = document.getElementById("explore");
    if (explore && explore.scrollIntoView) {
      explore.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    var swap = null;
    for (var i = 0; i < swaps.length; i++) {
      if (idEq(swaps[i].id, id)) {
        swap = swaps[i];
        break;
      }
    }
    if (!swap || !swapIsPublic(swap)) {
      showToast("That swap is no longer open", "Showing the swaps that are still open.");
      return;
    }
    var filtered = getFilteredSwaps();
    for (var j = 0; j < filtered.length; j++) {
      if (idEq(filtered[j].id, swap.id) && j >= listShown) {
        listShown = j + 1;
        break;
      }
    }
    activeSwapId = swap.id;
    refreshViews();
    setActiveSwap(swap.id, { fromMap: false, scrollList: true });
  }

  // ---------- Near Me ----------
  /** Fit the map to about a 150-mile radius. Not street level, not the whole country. */
  function zoomToMiles(lat, lng) {
    if (!map || !isFinite(lat) || !isFinite(lng)) return;
    var diameterMeters = NEAR_ME_MILES * 1609.344 * 2;
    var bounds = L.latLng(lat, lng).toBounds(diameterMeters);
    map.fitBounds(bounds, { padding: [28, 28], animate: true, maxZoom: 8 });
  }

  function clearNearMe(silent) {
    nearMeCenter = null;
    syncModeControls();
    refreshViews();
    forceMapRefresh();
    if (!silent) {
      showToast("Near Me off", "Showing swaps across the country again.");
    }
  }

  function nearMe() {
    if (nearMeCenter) {
      clearNearMe(false);
      return;
    }
    if (!navigator.geolocation) {
      showToast("Location unavailable", "Search a city instead — this browser can’t share location.");
      return;
    }
    if (els.nearMeBtn) els.nearMeBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        if (els.nearMeBtn) els.nearMeBtn.disabled = false;
        nearMeCenter = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        if (els.filterCity) els.filterCity.value = "";
        syncModeControls();
        refreshViews();
        zoomToMiles(nearMeCenter.lat, nearMeCenter.lng);
        var count = getFilteredSwaps().length;
        var where =
          mapMode === "coming"
            ? "want to move near you"
            : "are leaving from near you";
        showToast(
          "Near Me",
          count
            ? count + " " + where + " (about 150 miles)."
            : "No one " + where + " within about 150 miles."
        );
      },
      function () {
        if (els.nearMeBtn) els.nearMeBtn.disabled = false;
        showToast("Location blocked", "Allow location to use Near Me, or search a city instead.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
    );
  }

  // ---------- Modals ----------
  const allModals = () => [
    els.modalPost,
    els.modalDm,
    els.modalLogin,
    els.modalRegister,
    els.modalMySwaps,
    els.modalInbox,
    els.modalShare,
    els.modalFeedback,
    els.modalProfile,
  ];

  // ---------- Give Feedback (Google Form + postal rating) ----------
  // Replace baseUrl with your live form link (Share → Copy link / Get pre-filled link).
  // Prefill entry IDs: open the form → ⋮ → Get pre-filled link → fill sample answers → copy URL.
  const FEEDBACK_GOOGLE_FORM = {
    // Live PostSwap feedback form
    baseUrl:
      "https://docs.google.com/forms/d/e/1FAIpQLSeQwhM00HZLzVn7uoop-b_d5Q_4mJSxxUy-oDbUkyWdoN7K7w/viewform",
    // Optional: entry.XXXXXXXX from a pre-filled link
    entryRating: "", // e.g. "entry.123456789"
    entryRatingLabel: "", // optional second field for "Express Overnight" text
    entryNotes: "", // e.g. "entry.987654321"
  };

  function getSelectedPostalRating() {
    const input = document.querySelector('input[name="postal-rating"]:checked');
    if (!input) {
      return { value: "3", label: "Standard Delivery" };
    }
    return {
      value: input.value,
      label: input.getAttribute("data-label") || input.value,
    };
  }

  function updateFeedbackSelectedLabel() {
    if (!els.feedbackSelected) return;
    const r = getSelectedPostalRating();
    els.feedbackSelected.innerHTML =
      "Selected: <strong>" +
      escapeHtml(r.label) +
      "</strong> (" +
      escapeHtml(r.value) +
      "/5)";
  }

  function buildFeedbackFormUrl() {
    const r = getSelectedPostalRating();
    const note = (els.feedbackNote && els.feedbackNote.value.trim()) || "";
    const ratingLine = r.value + " — " + r.label;
    let url = FEEDBACK_GOOGLE_FORM.baseUrl;

    // Prefer prefill params when entry IDs are configured
    const params = new URLSearchParams();
    params.set("usp", "pp_url");
    if (FEEDBACK_GOOGLE_FORM.entryRating) {
      params.set(FEEDBACK_GOOGLE_FORM.entryRating, ratingLine);
    }
    if (FEEDBACK_GOOGLE_FORM.entryRatingLabel) {
      params.set(FEEDBACK_GOOGLE_FORM.entryRatingLabel, r.label);
    }
    if (FEEDBACK_GOOGLE_FORM.entryNotes && note) {
      params.set(FEEDBACK_GOOGLE_FORM.entryNotes, note);
    }

    // If no entry IDs, still open the form; append hint in fragment for the user
    const hasEntries =
      FEEDBACK_GOOGLE_FORM.entryRating || FEEDBACK_GOOGLE_FORM.entryNotes;
    if (hasEntries) {
      const joiner = url.indexOf("?") >= 0 ? "&" : "?";
      url = url + joiner + params.toString();
    }

    return { url: url, rating: r, note: note, ratingLine: ratingLine };
  }

  function openFeedback() {
    closeMobileMenu();
    if (els.feedbackNote) els.feedbackNote.value = "";
    const defaultRadio = document.querySelector(
      'input[name="postal-rating"][value="3"]'
    );
    if (defaultRadio) defaultRadio.checked = true;
    updateFeedbackSelectedLabel();
    openModal(els.modalFeedback);
  }

  function submitFeedbackToGoogleForm() {
    const built = buildFeedbackFormUrl();
    console.log("[PostSwap] Opening feedback form", built);

    // Copy rating summary so user can paste if prefill isn't configured
    const clipboardText =
      "PostSwap feedback\nPostal rating: " +
      built.ratingLine +
      (built.note ? "\n\nNotes:\n" + built.note : "");

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clipboardText).catch(function () {});
    }

    const isPlaceholder =
      !FEEDBACK_GOOGLE_FORM.baseUrl ||
      FEEDBACK_GOOGLE_FORM.baseUrl.indexOf("1FAIpQLSfPostSwapCarrierFeedback") !==
        -1;

    if (isPlaceholder) {
      showToast(
        "Rating copied!",
        "Set FEEDBACK_GOOGLE_FORM.baseUrl in app.js to your live Google Form link. Rating: " +
          built.ratingLine
      );
      console.warn(
        "[PostSwap] FEEDBACK_GOOGLE_FORM.baseUrl is still a placeholder. Paste your real form URL in app.js."
      );
      // Still try open in case they already replaced it partially
    } else {
      showToast("Opening form", "Your postal rating was copied — paste if needed.");
    }

    window.open(built.url, "_blank", "noopener,noreferrer");
  }

  // ---------- My Messages inbox ----------
  let inboxThreads = [];
  let activeInboxThreadKey = null;
  let pendingInboxThreadKey = null;
  let pendingInboxSwapId = null;
  let currentDmThreadKey = null;
  const MESSAGE_POLL_MS = 18000;
  let messagePollTimer = null;
  let messagePollInFlight = false;

  function currentIdentityKeys() {
    if (!user) return [];
    if (db() && typeof db().userIdentityKeys === "function") return db().userIdentityKeys(user);
    return [user.id, user.email, user.name, user.username].filter(Boolean);
  }

  function currentIdentitySet() {
    const set = Object.create(null);
    currentIdentityKeys().forEach(function (k) {
      if (k == null || k === "") return;
      set[String(k).toLowerCase()] = true;
    });
    return set;
  }

  function identityHas(set, value) {
    if (value == null || value === "") return false;
    return !!set[String(value).toLowerCase()];
  }

  function isSelfAddress(addressId) {
    if (!user || addressId == null || addressId === "") return false;
    const set = Object.create(null);
    [user.id, user.user_id, user.email, user.name, user.username].forEach(function (k) {
      if (k == null || k === "") return;
      set[String(k).toLowerCase()] = true;
    });
    return !!set[String(addressId).toLowerCase()];
  }

  function userOwnsSwap(swap) {
    if (!user || !swap) return false;
    const set = Object.create(null);
    [user.id, user.user_id, user.email, user.name, user.username].forEach(function (k) {
      if (k == null || k === "") return;
      set[String(k).toLowerCase()] = true;
    });
    if (user.name) {
      const first = String(user.name).split(/\s+/)[0];
      const state = user.state || "";
      if (state) set[(first + " • " + state).toLowerCase()] = true;
      set[(first + " • US").toLowerCase()] = true;
    }
    return identityHas(set, swap.ownerId) || identityHas(set, swap.username);
  }

  function displayNameFor(raw) {
    if (db() && typeof db().displayNameFor === "function") {
      return db().displayNameFor(raw, profileIndex);
    }
    const s = String(raw || "").trim();
    if (!s || /^verified carrier$/i.test(s)) return "Carrier";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "Carrier";
    if (s.indexOf("@") !== -1) {
      const local = s.split("@")[0].replace(/[._]+/g, " ").trim();
      return local || s;
    }
    return s;
  }

  /** Name for the other person or a message sender. Profile first, then from_user. */
  function partyName(raw, swap) {
    const direct = displayNameFor(raw);
    if (direct && direct !== "Carrier") return direct;
    if (swap && raw && (idEq(raw, swap.ownerId) || idEq(raw, swap.username))) {
      const viaUsername = displayNameFor(swap.username);
      if (viaUsername && viaUsername !== "Carrier") return viaUsername;
      const viaOwner = displayNameFor(swap.ownerId);
      if (viaOwner && viaOwner !== "Carrier" && !idEq(viaOwner, raw)) return viaOwner;
    }
    return direct || "Carrier";
  }

  function messageSenderLabel(message, swap) {
    const info = threadInfoFor(message, swap);
    if (info.fromMe) return "You";
    return partyName(message && message.senderId, swap);
  }

  function swapTitle(swap, swapId) {
    if (swap && (swap.current || swap.desired)) {
      return (swap.current || "?") + " → " + (swap.desired || "?");
    }
    if (db() && typeof db().looksLikeRawId === "function" && db().looksLikeRawId(swapId)) {
      return "Swap conversation";
    }
    if (swapId == null || swapId === "") return "Swap conversation";
    return "Swap #" + swapId;
  }

  function threadInfoFor(message, swap) {
    if (db() && typeof db().conversationKey === "function") {
      return db().conversationKey(message, user, swap || null, profileIndex);
    }
    return {
      key: String(message && message.swapId) + "::unknown",
      otherRaw: "",
      addressId: "",
      fromMe: false,
    };
  }

  async function ensureProfileIndex(force) {
    if (!force && profileIndex && profileIndexAt && Date.now() - profileIndexAt < 60000) {
      return profileIndex;
    }
    let profiles = [];
    if (useSupabase && db() && typeof db().fetchAllProfiles === "function") {
      try {
        profiles = await db().fetchAllProfiles();
      } catch (err) {
        console.warn("[PostSwap] profile index failed", err);
      }
    }
    const list = (profiles || []).slice();
    if (user) list.unshift(user);
    if (db() && typeof db().indexProfiles === "function") {
      profileIndex = db().indexProfiles(list);
    } else if (!profileIndex) {
      profileIndex = new Map();
    }
    profileIndexAt = Date.now();
    return profileIndex;
  }

  function isFacebookInAppBrowser() {
    const ua = String((navigator && navigator.userAgent) || "");
    return /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram|MessengerForiOS|Orca/i.test(ua);
  }

  function inboxIsCompact() {
    const narrow = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
    return !!narrow || isFacebookInAppBrowser();
  }

  function syncInboxMode() {
    if (!els.modalInbox) return;
    const compact = inboxIsCompact();
    els.modalInbox.classList.toggle("inbox-compact", compact);
    if (!compact) {
      els.modalInbox.classList.remove("inbox-thread-open");
    } else if (activeInboxThreadKey && els.inboxThreadPanel && !els.inboxThreadPanel.hidden) {
      els.modalInbox.classList.add("inbox-thread-open");
    }
  }

  function syncChatModalHeight() {
    const compact = inboxIsCompact();
    [els.modalInbox, els.modalDm].forEach(function (modal) {
      if (!modal) return;
      if (!compact || !window.visualViewport || !window.visualViewport.height) {
        modal.style.height = "";
        modal.style.maxHeight = "";
        return;
      }
      const px = Math.max(280, Math.min(560, Math.round(window.visualViewport.height - 16)));
      modal.style.height = px + "px";
      modal.style.maxHeight = px + "px";
    });
  }

  function messagingModalOpen() {
    return (els.modalInbox && !els.modalInbox.hidden) || (els.modalDm && !els.modalDm.hidden);
  }

  function startMessagePoll() {
    if (messagePollTimer) return;
    messagePollTimer = setInterval(pollMessages, MESSAGE_POLL_MS);
  }

  function stopMessagePoll() {
    if (messagePollTimer) clearInterval(messagePollTimer);
    messagePollTimer = null;
  }

  async function pollMessages() {
    if (!messagingModalOpen() || !user) {
      stopMessagePoll();
      return;
    }
    if (messagePollInFlight) return;
    messagePollInFlight = true;
    try {
      if (els.modalInbox && !els.modalInbox.hidden) {
        await loadInboxThreads({ silent: true });
      }
      if (els.modalDm && !els.modalDm.hidden && currentDmSwap) {
        await refreshOpenDm();
      }
    } catch (err) {
      console.warn("[PostSwap] message poll failed", err);
    } finally {
      messagePollInFlight = false;
    }
  }

  function formatInboxTime(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) {
        return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      }
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    } catch (_) {
      return "";
    }
  }

  function showInboxError(msg) {
    if (!els.inboxSendError) return;
    els.inboxSendError.hidden = false;
    if (els.inboxSendErrorText) els.inboxSendErrorText.textContent = msg;
  }

  function clearInboxError() {
    if (!els.inboxSendError) return;
    els.inboxSendError.hidden = true;
    if (els.inboxSendErrorText) els.inboxSendErrorText.textContent = "";
  }

  function showDmError(msg) {
    if (!els.dmSendError) return;
    els.dmSendError.hidden = false;
    if (els.dmSendErrorText) els.dmSendErrorText.textContent = msg;
  }

  function clearDmError() {
    if (!els.dmSendError) return;
    els.dmSendError.hidden = true;
    if (els.dmSendErrorText) els.dmSendErrorText.textContent = "";
  }

  function friendlySendError(err) {
    if (!err) return "Couldn’t send that message.";
    if (err.isNetwork) return "Network error. Check your connection and retry.";
    if (err.status === 401 || err.status === 403) {
      return "The server blocked this message. Retry in a moment.";
    }
    return err.message || "Couldn’t send that message.";
  }

  function filterHistory(messages, swap, addressId, threadKey) {
    if (!addressId && !threadKey) return messages || [];
    return (messages || []).filter(function (m) {
      const info = threadInfoFor(m, swap);
      if (threadKey && info.key === threadKey) return true;
      if (addressId && (idEq(info.addressId, addressId) || idEq(info.otherRaw, addressId))) return true;
      return false;
    });
  }

  async function loadThreadHistory(swap, addressId, threadKey) {
    const canLoad =
      useSupabase &&
      db() &&
      swap &&
      swap.id != null &&
      !String(swap.id).startsWith("local-") &&
      typeof db().fetchMessages === "function" &&
      user;
    if (!canLoad) return [];
    const history = await db().fetchMessages(swap.id, user);
    return filterHistory(history, swap, addressId, threadKey);
  }

  function rememberAddress(bucket, info) {
    if (!info.addressId) return;
    const looks = db() && typeof db().looksLikeRawId === "function" ? db().looksLikeRawId : function () { return false; };
    if (!bucket.addressId || (looks(bucket.addressId) && !looks(info.addressId))) {
      bucket.addressId = info.addressId;
    }
    if (info.otherRaw) bucket.otherRaw = info.otherRaw;
  }

  function markThreadMessagesRead(messages) {
    let changed = false;
    (messages || []).forEach(function (m) {
      if (!m || m.id == null) return;
      const nid = "dm-" + String(m.id);
      if (!mailReadIds.has(nid)) {
        mailReadIds.add(nid);
        changed = true;
      }
    });
    if (!changed) return;
    saveMailReadIds();
    mailItems = mailItems.map(function (n) {
      return mailReadIds.has(String(n.id)) ? Object.assign({}, n, { unread: false }) : n;
    });
    renderMailbox();
  }

  async function deliverMessage(swap, addressId, text) {
    if (!user) throw new Error("Sign in to send a message.");
    if (!useSupabase || !db() || typeof db().sendMessage !== "function") {
      throw new Error("Messaging isn’t available right now.");
    }
    if (!swap || swap.id == null || String(swap.id).startsWith("local-")) {
      throw new Error("This swap isn’t saved on the server yet, so the message can’t be delivered.");
    }
    if (!addressId) throw new Error("There’s no recipient on this conversation yet.");
    if (isSelfAddress(addressId)) {
      throw new Error("Pick the other carrier’s conversation before replying.");
    }
    const saved = await db().sendMessage({
      swapId: swap.id,
      senderId: user.id,
      toUser: addressId,
      body: text,
      identityKeys: currentIdentityKeys(),
    });
    if (typeof db().notifyNewDm === "function") {
      try {
        const notify = await db().notifyNewDm({
          swap: swap,
          messageBody: text,
          fromUser: user,
          recipientId: addressId,
        });
        if (notify && notify.queued > 0) {
          showToast(
            "Email notification queued",
            notify.to
              ? "DM alert queued for " + notify.to
              : "They’ll be emailed if notifications are on."
          );
        }
      } catch (notifyErr) {
        console.warn("[PostSwap] email notify failed", notifyErr);
      }
    }
    refreshMailboxFromDb();
    return saved;
  }

  function pendingThreadKey() {
    if (pendingInboxThreadKey) {
      const found = inboxThreads.find(function (t) {
        return t.key === pendingInboxThreadKey;
      });
      if (found) {
        pendingInboxThreadKey = null;
        pendingInboxSwapId = null;
        return found.key;
      }
    }
    if (pendingInboxSwapId && !pendingInboxThreadKey) {
      const found = inboxThreads.find(function (t) {
        return idEq(t.swapId, pendingInboxSwapId);
      });
      if (found) {
        pendingInboxSwapId = null;
        return found.key;
      }
    }
    return null;
  }

  async function loadInboxThreads(opts) {
    opts = opts || {};
    const silent = !!opts.silent;
    if (!els.inboxThreads) return;

    if (!user) {
      els.inboxThreads.innerHTML = `
        <div class="mailbox-empty">
          <p><strong>Sign in required</strong><br />Log in to see only your DMs.</p>
        </div>
      `;
      els.inboxStatus.textContent = "Not signed in";
      inboxThreads = [];
      activeInboxThreadKey = null;
      showInboxThreadEmpty();
      return;
    }

    if (!silent) {
      els.inboxStatus.textContent = "Loading your messages…";
      els.inboxThreads.innerHTML = `
        <div class="inbox-loading">
          <span class="loading-spinner loading-spinner-sm" aria-hidden="true"></span>
          Fetching your DMs…
        </div>
      `;
    }

    if (!useSupabase || !db() || typeof db().fetchMessagesForUser !== "function") {
      els.inboxThreads.innerHTML = `
        <div class="mailbox-empty">
          <p><strong>Inbox unavailable</strong><br />Supabase messages helper not loaded.</p>
        </div>
      `;
      els.inboxStatus.textContent = "Offline";
      return;
    }

    try {
      await ensureProfileIndex(false);
      const myMsgs = await db().fetchMessagesForUser(user, 300);
      const mySet = currentIdentitySet();
      const relevant = (myMsgs || []).filter(function (m) {
        return identityHas(mySet, m.senderId) || identityHas(mySet, m.toUser);
      });

      const byKey = new Map();
      relevant.forEach(function (m) {
        const swap = findSwapById(m.swapId);
        const info = threadInfoFor(m, swap);
        if (!byKey.has(info.key)) {
          byKey.set(info.key, {
            key: info.key,
            swapId: m.swapId,
            swap: swap,
            messages: [],
            addressId: "",
            otherRaw: "",
          });
        }
        const bucket = byKey.get(info.key);
        bucket.messages.push(m);
        if (!bucket.swap && swap) bucket.swap = swap;
        rememberAddress(bucket, info);
      });

      inboxThreads = Array.from(byKey.values())
        .map(function (bucket) {
          const chronological = bucket.messages.slice().sort(function (a, b) {
            return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
          });
          const last = chronological[chronological.length - 1];
          const lastInfo = last ? threadInfoFor(last, bucket.swap) : { fromMe: true };
          const peer = partyName(bucket.otherRaw || bucket.addressId, bucket.swap);
          return {
            key: bucket.key,
            swapId: bucket.swapId,
            swap: bucket.swap,
            messages: chronological,
            addressId: bucket.addressId,
            otherRaw: bucket.otherRaw,
            peerName: peer,
            lastAt: last && last.createdAt,
            preview: (last && last.body) || "",
            count: chronological.length,
            unread: !!(last && !lastInfo.fromMe && !mailReadIds.has("dm-" + String(last.id))),
          };
        })
        .sort(function (a, b) {
          return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
        });

      renderInboxThreadList();
      els.inboxStatus.textContent =
        inboxThreads.length === 0
          ? "No messages yet"
          : inboxThreads.length + " conversation" + (inboxThreads.length === 1 ? "" : "s");

      const wanted = pendingThreadKey();
      const next = wanted || opts.keepKey || activeInboxThreadKey;
      if (next && inboxThreads.some(function (t) { return t.key === next; })) {
        selectInboxThread(next, { reveal: !!wanted || !!opts.reveal });
      } else if (!silent) {
        pendingInboxThreadKey = null;
        pendingInboxSwapId = null;
        activeInboxThreadKey = null;
        showInboxThreadEmpty();
      }
    } catch (err) {
      console.error("[PostSwap] loadInboxThreads failed", err);
      if (silent && inboxThreads.length) {
        els.inboxStatus.textContent = "Couldn’t refresh";
        return;
      }
      els.inboxThreads.innerHTML = `
        <div class="mailbox-empty">
          <p><strong>Couldn’t load inbox</strong><br />${escapeHtml(err.message || "Supabase error")}</p>
        </div>
      `;
      els.inboxStatus.textContent = "Error loading";
    }
  }

  function renderInboxThreadList() {
    if (!els.inboxThreads) return;
    if (!inboxThreads.length) {
      els.inboxThreads.innerHTML = `
        <div class="mailbox-empty">
          <div class="mailbox-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg>
          </div>
          <p><strong>No DMs yet</strong><br />Start a chat from any swap with “I’m Interested → DM”.</p>
        </div>
      `;
      return;
    }

    els.inboxThreads.innerHTML = inboxThreads
      .map(function (t) {
        const title = swapTitle(t.swap, t.swapId);
        const active = t.key === activeInboxThreadKey ? " active" : "";
        const unread = t.unread ? " unread" : "";
        const peer = t.peerName || "Carrier";
        return `
        <button type="button" class="inbox-thread-item${active}${unread}" data-inbox-thread="${escapeHtml(t.key)}" role="listitem">
          <div class="inbox-thread-item-top">
            <span class="inbox-thread-route">${t.unread ? '<span class="inbox-unread-dot" aria-hidden="true"></span>' : ""}${escapeHtml(peer)}</span>
            <span class="inbox-thread-time">${escapeHtml(formatInboxTime(t.lastAt))}</span>
          </div>
          <div class="inbox-thread-item-meta">
            <span>${escapeHtml(title)}</span>
            <span class="inbox-thread-count">${t.count} msg${t.count === 1 ? "" : "s"}</span>
          </div>
          <p class="inbox-thread-preview">${escapeHtml(t.preview)}</p>
        </button>
      `;
      })
      .join("");
  }

  function showInboxThreadEmpty() {
    if (els.inboxEmptyThread) els.inboxEmptyThread.hidden = false;
    if (els.inboxThreadPanel) els.inboxThreadPanel.hidden = true;
    if (els.modalInbox) els.modalInbox.classList.remove("inbox-thread-open");
  }

  function revealInboxThread() {
    const panel = els.inboxThreadPanel;
    if (panel && panel.scrollIntoView) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      try {
        panel.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      } catch (_) {
        try { panel.scrollIntoView(true); } catch (_2) { /* ignore */ }
      }
    }
    if (els.inboxThreadMessages) {
      els.inboxThreadMessages.scrollTop = els.inboxThreadMessages.scrollHeight;
    }
  }

  function selectInboxThread(threadKey, opts) {
    opts = opts || {};
    activeInboxThreadKey = threadKey;
    const thread = inboxThreads.find(function (t) { return t.key === threadKey; });

    if (!thread) {
      renderInboxThreadList();
      showInboxThreadEmpty();
      return;
    }

    markThreadMessagesRead(thread.messages);
    thread.unread = false;
    renderInboxThreadList();

    const box = els.inboxThreadMessages;
    const prevScroll = box ? box.scrollTop : 0;
    const stick = !box || (box.scrollHeight - box.scrollTop - box.clientHeight < 90);

    if (els.inboxEmptyThread) els.inboxEmptyThread.hidden = true;
    if (els.inboxThreadPanel) els.inboxThreadPanel.hidden = false;
    syncInboxMode();
    if (inboxIsCompact() && els.modalInbox) els.modalInbox.classList.add("inbox-thread-open");

    if (els.inboxThreadTitle) els.inboxThreadTitle.textContent = thread.peerName || "Carrier";
    if (els.inboxThreadSub) {
      const route = swapTitle(thread.swap, thread.swapId);
      const craft = thread.swap && thread.swap.craft ? thread.swap.craft + " · " : "";
      els.inboxThreadSub.textContent = craft + route + " · " + thread.count + " message" + (thread.count === 1 ? "" : "s");
    }

    if (els.inboxThreadMessages) {
      if (!thread.messages.length) {
        els.inboxThreadMessages.innerHTML = '<div class="inbox-msg-empty">No messages yet.</div>';
      } else {
        els.inboxThreadMessages.innerHTML = thread.messages
          .map(function (m) {
            const who = threadInfoFor(m, thread.swap).fromMe ? "me" : "them";
            const label = messageSenderLabel(m, thread.swap);
            return `
          <div class="inbox-msg ${who}">
            <div class="inbox-msg-meta">
              <span>${escapeHtml(label)}</span>
              <span>${escapeHtml(formatInboxTime(m.createdAt))}</span>
            </div>
            <div class="inbox-msg-body">${escapeHtml(m.body)}</div>
          </div>
        `;
          })
          .join("");
      }
      if (opts.reveal || stick) {
        els.inboxThreadMessages.scrollTop = els.inboxThreadMessages.scrollHeight;
      } else {
        els.inboxThreadMessages.scrollTop = prevScroll;
      }
    }

    if (opts.reveal) {
      revealInboxThread();
      syncChatModalHeight();
      if (els.inboxReplyInput) els.inboxReplyInput.focus();
    }
  }

  function inboxBackToList() {
    if (els.modalInbox) els.modalInbox.classList.remove("inbox-thread-open");
    if (els.inboxThreads && els.inboxThreads.scrollIntoView) {
      try { els.inboxThreads.scrollIntoView({ block: "nearest" }); } catch (_) { /* ignore */ }
    }
  }

  async function sendInboxReply(e) {
    if (e) e.preventDefault();
    if (!requireAuth("Sign up free to send DMs to other carriers.")) return;
    const thread = inboxThreads.find(function (t) { return t.key === activeInboxThreadKey; });
    const text = els.inboxReplyInput ? els.inboxReplyInput.value.trim() : "";
    if (!thread) return;
    if (!text) {
      showInboxError("Type a message, then send or retry.");
      return;
    }
    clearInboxError();
    const swap = thread.swap || findSwapById(thread.swapId) || {
      id: thread.swapId,
      current: "",
      desired: "",
    };
    setButtonLoading(els.inboxReplySend, true);
    try {
      const saved = await deliverMessage(swap, thread.addressId, text);
      if (els.inboxReplyInput) els.inboxReplyInput.value = "";
      await loadInboxThreads({ silent: true, keepKey: thread.key, reveal: false });
      const still = inboxThreads.find(function (t) { return t.key === thread.key; });
      if (
        still &&
        saved &&
        saved.id != null &&
        !still.messages.some(function (m) { return idEq(m.id, saved.id); })
      ) {
        still.messages.push({
          id: saved.id,
          swapId: saved.swapId || swap.id,
          senderId: saved.senderId || user.id,
          toUser: saved.toUser || thread.addressId,
          body: saved.body || text,
          createdAt: saved.createdAt || new Date().toISOString(),
        });
        still.count = still.messages.length;
        still.preview = saved.body || text;
        still.lastAt = saved.createdAt || still.lastAt;
      }
      if (still) selectInboxThread(still.key, { reveal: false });
      if (els.inboxThreadMessages) {
        els.inboxThreadMessages.scrollTop = els.inboxThreadMessages.scrollHeight;
      }
    } catch (err) {
      console.error("[PostSwap] inbox reply failed", err);
      showInboxError(friendlySendError(err));
    } finally {
      setButtonLoading(els.inboxReplySend, false);
    }
  }

  async function openInbox(opts) {
    opts = opts || {};
    if (
      !requireAuth(
        "Sign up free to open My Messages — only your DMs, private to you."
      )
    ) {
      return;
    }
    if (opts.threadKey) pendingInboxThreadKey = String(opts.threadKey);
    if (opts.swapId) pendingInboxSwapId = String(opts.swapId);
    setMailboxOpen(false);
    closeMobileMenu();
    syncInboxMode();
    openModal(els.modalInbox);
    syncChatModalHeight();
    startMessagePoll();
    await loadInboxThreads({ reveal: !!(opts.threadKey || opts.swapId) });
  }


  let shareSwap = null;
  let shareMode = "swap"; // "swap" | "site"
  const SITE_URL = "https://post-swap.com";
  const SITE_SHARE_TEXT =
    "Hey — check out PostSwap, a free site for USPS carriers to find mutual route/station transfers. " +
    "Keep your seniority and benefits. Built by carriers, for carriers.\n\n" +
    SITE_URL;

  function setShareStatus(msg) {
    if (els.shareStatus) els.shareStatus.textContent = msg || "";
  }

  function getSharePayload() {
    if (shareMode === "site" || !shareSwap) {
      return {
        message: SITE_SHARE_TEXT,
        link: SITE_URL,
        subject: "PostSwap — free mutual transfers for USPS carriers",
        groupText:
          "🚚 Carrier buddy share:\n\n" +
          SITE_SHARE_TEXT +
          "\n\nMutual swaps help everyone keep seniority & benefits — pass it along!",
      };
    }
    return {
      message: buildShareText(shareSwap),
      link: shareUrlFor(shareSwap),
      subject: `USPS route swap: ${shareSwap.current} → ${shareSwap.desired}`,
      groupText:
        `🚚 Carrier group share:\n\n${buildShareText(shareSwap)}\n\n` +
        `Mutual swaps help everyone keep seniority & benefits — pass it along!`,
    };
  }

  function configureShareModal(mode) {
    shareMode = mode;
    const title = $("#share-title");
    const sub = $("#share-subtitle");
    const hint = $("#share-hint-text");
    if (mode === "site") {
      if (title) title.textContent = "Share PostSwap with a carrier buddy";
      if (sub) sub.textContent = "Send the site link — free mutual transfers for USPS carriers.";
      if (hint) {
        hint.textContent =
          "Paste into a text, group chat, or break-room board. Link goes to post-swap.com.";
      }
      if (els.shareMessage) els.shareMessage.value = SITE_SHARE_TEXT;
    } else {
      if (title) title.textContent = "Share this swap";
      if (sub) sub.textContent = "Send to a buddy who might want this route!";
      if (hint) {
        hint.textContent =
          "Paste into a text, carrier group chat, or union thread — mutual swaps help everyone keep seniority & benefits.";
      }
    }
    setShareStatus("");
  }

  function openShare(swap) {
    shareSwap = swap;
    configureShareModal("swap");
    if (els.shareMessage) {
      els.shareMessage.value = buildShareText(swap);
    }
    openModal(els.modalShare);
  }

  function openShareSite() {
    shareSwap = null;
    configureShareModal("site");
    closeMobileMenu();
    openModal(els.modalShare);

    // Native share sheet when available (mobile)
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      navigator
        .share({
          title: "PostSwap",
          text: SITE_SHARE_TEXT,
          url: SITE_URL,
        })
        .then(() => {
          setShareStatus("Shared via your device — thanks for spreading the word!");
        })
        .catch(() => {
          /* user cancelled — modal stays open for copy options */
        });
    }
  }

  async function copyText(text, successMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setShareStatus(successMsg);
      showToast("Copied!", successMsg);
    } catch (_) {
      setShareStatus("Couldn’t copy automatically — select the text above and copy.");
    }
  }

  function openModal(modal) {
    closeAllModals(false);
    els.overlay.hidden = false;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    const focusable = firstFocusable(modal);
    if (focusable) setTimeout(() => focusable.focus(), 50);
  }

  function firstFocusable(root) {
    const nodes = root.querySelectorAll("input, select, textarea, button:not(.modal-close)");
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.disabled || el.closest("[hidden]")) continue;
      return el;
    }
    return null;
  }

  function closeAllModals(hideOverlay = true) {
    allModals().forEach((m) => {
      if (m) m.hidden = true;
    });
    stopMessagePoll();
    if (els.modalInbox) els.modalInbox.classList.remove("inbox-thread-open");
    [els.modalInbox, els.modalDm].forEach(function (modal) {
      if (!modal) return;
      modal.style.height = "";
      modal.style.maxHeight = "";
    });
    if (hideOverlay) {
      els.overlay.hidden = true;
      document.body.classList.remove("modal-open");
    }
  }

  /**
   * Gate participate actions (post, DM, inbox). Map browsing stays public.
   * @returns {boolean} true if logged in
   */
  function requireAuth(detail) {
    if (user) return true;
    showToast(
      "Sign up to participate",
      detail ||
        "Create a free account to post swaps, message carriers, and use My Messages. Browsing the map stays public."
    );
    openRegister();
    return false;
  }

  function updateGuestParticipateBanner() {
    const banner = $("#guest-participate-banner");
    if (!banner) return;
    banner.hidden = !!user;
    banner.setAttribute("aria-hidden", user ? "true" : "false");
  }

  function openPostModal() {
    if (
      !requireAuth(
        "Sign up free to post a swap and find mutual matches. Anyone can still browse the map."
      )
    ) {
      return;
    }
    const wasEditing = !!editingSwapId;
    if (wasEditing && els.formPost) {
      els.formPost.reset();
      const permanent = els.formPost.querySelector('input[name="swapType"][value="Permanent"]');
      if (permanent) permanent.checked = true;
    }
    editingSwapId = null;
    allowDuplicatePost = false;
    hideDuplicateWarning();
    hideLocationError();
    setPostMode("new");
    const craftSelect = $("#post-craft");
    if (wasEditing || !craftSelect || !craftSelect.value) prefillPostCraft();
    syncDesiredMode();
    openModal(els.modalPost);
  }

  function openLogin() {
    openModal(els.modalLogin);
  }

  function openRegister() {
    openModal(els.modalRegister);
  }

  function openMySwaps(focusId) {
    if (
      !requireAuth("Sign up free to manage your posted swaps.")
    ) {
      return;
    }
    const mine = swaps.filter(function (s) {
      return userOwnsSwap(s);
    });
    if (!mine.length) {
      els.mySwapsBody.innerHTML = `
        <div class="my-swaps-empty">
          <p><strong>No swaps yet</strong></p>
          <p style="margin:0.75rem 0 1.25rem">Post your first swap — it only takes a minute.</p>
          <button type="button" class="btn btn-primary" data-action="open-post">Post a Swap</button>
        </div>
      `;
    } else {
      els.mySwapsBody.innerHTML = mine
        .map(function (s) {
          const current = focusId != null && idEq(s.id, focusId);
          const open = swapIsPublic(s);
          const status = swapStatusLabel(s);
          return `
        <div class="my-swap-item${current ? " is-current" : ""}${open ? "" : " is-closed"}" data-my-swap="${escapeHtml(String(s.id))}">
          <p class="my-swap-status">${escapeHtml(status)}</p>
          <h4>${escapeHtml(s.current)} → ${escapeHtml(s.desired)}</h4>
          <p>${escapeHtml(s.craft)} · ${formatSeniority(s.seniority)} · ${escapeHtml(s.swapType)}</p>
          ${s.notes ? `<p style="margin-top:0.4rem;font-style:italic">“${escapeHtml(s.notes)}”</p>` : ""}
          <p style="margin-top:0.45rem">${open ? "On the public map. Replies are in My Messages." : "Hidden from the public map. Still saved here."}</p>
          <div class="my-swap-actions">
            <button type="button" class="btn btn-primary btn-sm" data-swap-edit="${escapeHtml(String(s.id))}">Edit</button>
            ${open ? `<button type="button" class="btn btn-outline btn-sm" data-swap-close="${escapeHtml(String(s.id))}">Close / Mark as swapped</button>` : ""}
            <button type="button" class="btn btn-ghost btn-sm" data-swap-delete="${escapeHtml(String(s.id))}">Delete</button>
          </div>
        </div>
      `;
        })
        .join("");
    }
    openModal(els.modalMySwaps);
    if (focusId != null && els.mySwapsBody) {
      const sel = '[data-my-swap="' + (CSS.escape ? CSS.escape(String(focusId)) : String(focusId)) + '"]';
      const node = els.mySwapsBody.querySelector(sel);
      if (node && node.scrollIntoView) {
        setTimeout(function () {
          node.scrollIntoView({ block: "nearest" });
        }, 60);
      }
    }
  }

  // ---------- DM ----------
  function appendChatMessage(who, text, time) {
    const empty = els.chatBody && els.chatBody.querySelector(".chat-empty");
    if (empty) empty.remove();
    const msg = document.createElement("div");
    msg.className = `chat-msg ${who}`;
    const label = who === "me" ? "You" : (els.dmTitle ? els.dmTitle.textContent : "") || "Carrier";
    msg.innerHTML =
      '<span class="msg-who">' + escapeHtml(label) + "</span>" +
      escapeHtml(text) +
      '<span class="msg-time">' + (time || timeNow()) + "</span>";
    els.chatBody.appendChild(msg);
    els.chatBody.scrollTop = els.chatBody.scrollHeight;
  }

  function formatMsgTime(iso) {
    if (!iso) return timeNow();
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (_) {
      return timeNow();
    }
  }

  function renderDmHistory(history, stickToBottom) {
    if (!els.chatBody) return;
    if (!history || !history.length) {
      els.chatBody.innerHTML = '<div class="chat-empty">No messages yet.</div>';
      return;
    }
    const prev = els.chatBody.scrollTop;
    els.chatBody.innerHTML = history
      .map(function (m) {
        const info = threadInfoFor(m, currentDmSwap);
        const who = info.fromMe ? "me" : "them";
        const label = messageSenderLabel(m, currentDmSwap);
        return (
          '<div class="chat-msg ' + who + '">' +
          '<span class="msg-who">' + escapeHtml(label) + "</span>" +
          escapeHtml(m.body) +
          '<span class="msg-time">' +
          escapeHtml(formatMsgTime(m.createdAt)) +
          "</span></div>"
        );
      })
      .join("");
    if (stickToBottom !== false) {
      els.chatBody.scrollTop = els.chatBody.scrollHeight;
    } else {
      els.chatBody.scrollTop = prev;
    }
  }

  async function refreshOpenDm() {
    if (!currentDmSwap || !els.modalDm || els.modalDm.hidden || !user) return;
    const nearBottom = !els.chatBody ||
      (els.chatBody.scrollHeight - els.chatBody.scrollTop - els.chatBody.clientHeight < 90);
    const history = await loadThreadHistory(currentDmSwap, currentDmAddressId, currentDmThreadKey);
    const ids = history.map(function (m) { return String(m.id); });
    const sig = ids.join(",");
    if (sig === currentDmSig) return;
    const known = currentDmSig ? currentDmSig.split(",").filter(Boolean) : [];
    const missing = known.filter(function (id) { return ids.indexOf(id) === -1; });
    if (missing.length) return;
    currentDmSig = sig;
    renderDmHistory(history, nearBottom);
  }

  function applyDmHeading(swap, addressId, peerName) {
    const hinted = String(peerName || "").trim();
    const hintedOk = hinted && hinted !== "Carrier" && !/^verified carrier$/i.test(hinted);
    const resolved = partyName(addressId, swap);
    const label = hintedOk ? hinted : (addressId ? (resolved || "Carrier") : "Conversation");
    if (els.dmTitle) els.dmTitle.textContent = label;
    if (els.dmSubtitle) els.dmSubtitle.textContent = swapTitle(swap, swap && swap.id);
    if (els.dmAvatar) {
      const letters = initials(label || "C");
      els.dmAvatar.textContent = letters || "C";
    }
  }

  function openInboxFullChat() {
    if (!activeInboxThreadKey) return;
    const thread = inboxThreads.find(function (t) { return t.key === activeInboxThreadKey; });
    if (!thread) return;
    const swap = thread.swap || findSwapById(thread.swapId) || {
      id: thread.swapId,
      current: "",
      desired: "",
      craft: "Letter Carrier",
      seniority: 0,
      swapType: "Permanent",
      privacyLabel: "",
      region: "United States",
      notes: "",
    };
    openDm(swap, {
      addressId: thread.addressId || thread.otherRaw || "",
      threadKey: thread.key,
      peerName: thread.peerName,
    });
  }

  async function openDm(swap, opts) {
    opts = opts || {};
    if (
      !requireAuth(
        "Sign up free to message carriers about swaps. Browsing open listings stays public."
      )
    ) {
      return;
    }
    if (!swap) return;

    currentDmSwap = swap;
    currentDmThreadKey = opts.threadKey || null;
    if (opts.addressId) {
      currentDmAddressId = opts.addressId;
    } else if (opts.threadKey) {
      currentDmAddressId = null;
    } else {
      const raw = swap.ownerId || swap.username || "";
      const synthetic = {
        swapId: swap.id,
        senderId: user ? user.id : "",
        toUser: raw,
        body: "",
      };
      const info = threadInfoFor(synthetic, swap);
      const candidate = info.addressId || raw || "";
      if (candidate && !isSelfAddress(candidate)) {
        currentDmAddressId = candidate;
        if (!currentDmThreadKey) currentDmThreadKey = info.key;
      } else {
        currentDmAddressId = null;
      }
    }

    applyDmHeading(swap, currentDmAddressId, opts.peerName);

    if (els.chatBody) els.chatBody.innerHTML = '<div class="chat-empty">Loading conversation…</div>';
    if (els.dmInput) els.dmInput.value = "";
    clearDmError();
    openModal(els.modalDm);
    syncChatModalHeight();
    startMessagePoll();

    try {
      await ensureProfileIndex(false);
      if (!els.modalDm || els.modalDm.hidden || currentDmSwap !== swap) return;
      applyDmHeading(swap, currentDmAddressId, opts.peerName);
      let history = await loadThreadHistory(swap, currentDmAddressId, currentDmThreadKey);
      let mixed = false;
      if (!currentDmAddressId && history.length) {
        const parties = [];
        history.forEach(function (m) {
          const info = threadInfoFor(m, swap);
          if (!info || !info.addressId || isSelfAddress(info.addressId)) return;
          if (!parties.some(function (p) { return p.key === info.key; })) parties.push(info);
        });
        if (parties.length === 1) {
          currentDmAddressId = parties[0].addressId;
          currentDmThreadKey = parties[0].key;
          history = filterHistory(history, swap, currentDmAddressId, currentDmThreadKey);
          applyDmHeading(swap, currentDmAddressId, partyName(parties[0].otherRaw || parties[0].addressId, swap));
        } else if (parties.length > 1) {
          mixed = true;
        }
      }
      if (mixed) {
        currentDmSig = "";
        els.chatBody.innerHTML = '<div class="chat-empty">Each carrier has their own conversation. Open My Messages and choose one to reply.</div>';
      } else {
        currentDmSig = history.map(function (m) { return String(m.id); }).join(",");
        renderDmHistory(history, true);
      }
    } catch (err) {
      console.warn("Could not load messages:", err);
      currentDmSig = "";
      els.chatBody.innerHTML = '<div class="chat-empty">Couldn’t load this conversation.</div>';
    }

    setTimeout(function () {
      if (els.chatBody) els.chatBody.scrollTop = els.chatBody.scrollHeight;
      if (els.dmInput) els.dmInput.focus();
    }, 80);
  }

  async function sendDm(e) {
    e.preventDefault();
    if (!requireAuth("Sign up free to send DMs to other carriers.")) return;
    const text = els.dmInput.value.trim();
    if (!currentDmSwap) return;
    if (!text) {
      showDmError("Type a message, then send or retry.");
      return;
    }
    clearDmError();
    if (!currentDmAddressId) {
      showDmError("Open the carrier’s conversation in My Messages before replying.");
      return;
    }

    const sendBtn = els.formDm && els.formDm.querySelector('button[type="submit"]');
    setButtonLoading(sendBtn, true);
    try {
      const saved = await deliverMessage(currentDmSwap, currentDmAddressId, text);
      els.dmInput.value = "";
      appendChatMessage("me", (saved && saved.body) || text, formatMsgTime(saved && saved.createdAt));
      if (saved && saved.id != null) {
        currentDmSig = currentDmSig
          ? currentDmSig + "," + String(saved.id)
          : String(saved.id);
      }
      try {
        await refreshOpenDm();
      } catch (refreshErr) {
        console.warn("[PostSwap] refresh after send failed", refreshErr);
      }
    } catch (err) {
      console.error("[PostSwap] sendDm failed", err);
      showDmError(friendlySendError(err));
    } finally {
      setButtonLoading(sendBtn, false);
    }
  }


  function swapIsPublic(swap) {
    const status = swap && swap.status ? String(swap.status).toLowerCase() : "open";
    return status === "open";
  }

  function swapStatusLabel(swap) {
    const status = swap && swap.status ? String(swap.status).toLowerCase() : "open";
    if (status === "closed") return "Closed";
    if (status === "archived") return "Archived";
    return "Open";
  }

  function normPlace(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[.#]/g, "")
      .replace(/,/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function placeParts(value) {
    const bits = String(value || "")
      .split(",")
      .map(function (part) { return part.trim(); })
      .filter(Boolean);
    return {
      full: normPlace(value),
      city: normPlace(bits[0] || value),
      state: bits[1] ? normPlace(bits[1]) : "",
    };
  }

  function sameCurrentPlace(a, b) {
    const left = normPlace(a);
    return !!left && left === normPlace(b);
  }

  function similarDesiredPlace(a, b) {
    const left = placeParts(a);
    const right = placeParts(b);
    if (!left.full || !right.full) return false;
    if (left.full === right.full) return true;
    if (left.city && left.city === right.city && left.city.length >= 3) {
      if (!left.state || !right.state || left.state === right.state) return true;
    }
    const shorter = left.full.length <= right.full.length ? left.full : right.full;
    const longer = left.full.length > right.full.length ? left.full : right.full;
    return shorter.length >= 4 && longer.indexOf(shorter) !== -1;
  }

  function findOpenDuplicate(current, desired, ignoreId) {
    return swaps.find(function (swap) {
      if (!userOwnsSwap(swap) || !swapIsPublic(swap)) return false;
      if (ignoreId != null && idEq(swap.id, ignoreId)) return false;
      return sameCurrentPlace(swap.current, current) && similarDesiredPlace(swap.desired, desired);
    }) || null;
  }

  function ownerCanWrite(swap) {
    return !!(user && user.id && swap && idEq(swap.ownerId, user.id));
  }

  function swapWriteError(err) {
    const msg = (err && err.message) || "Couldn’t update that swap.";
    if (/status/i.test(msg) && /column|schema|PGRST/i.test(msg)) {
      return "Add a status column on public.swaps (open, closed, or archived), then try again.";
    }
    return String(msg).slice(0, 160);
  }

  function hideDuplicateWarning() {
    duplicateSwapId = null;
    const box = $("#swap-duplicate");
    if (box) box.hidden = true;
  }

  function showDuplicateWarning(swap) {
    duplicateSwapId = swap.id;
    const box = $("#swap-duplicate");
    const text = $("#swap-duplicate-text");
    if (text) {
      text.textContent = "You already have an open swap from " + swap.current + " to " + swap.desired + ".";
    }
    if (box) box.hidden = false;
  }

  function setPostMode(mode) {
    const title = $("#post-title");
    const sub = $("#post-sub");
    const label = document.querySelector("#post-submit-btn .btn-label");
    if (mode === "edit") {
      if (title) title.textContent = "Edit your swap";
      if (sub) sub.textContent = "Save to update this listing. Closing it hides it from the public map.";
      if (label) label.textContent = "Save changes";
    } else {
      if (title) title.textContent = "Post Your Swap";
      if (sub) sub.textContent = "Mutual swaps let everyone keep seniority and benefits!";
      if (label) label.textContent = "Post My Swap";
    }
  }

  function refreshPublicSwaps() {
    refreshViews();
    forceMapRefresh();
  }

  function replaceSwap(next) {
    const merged = withPinCoords(next);
    const idx = swaps.findIndex(function (s) { return idEq(s.id, merged.id); });
    if (idx >= 0) swaps[idx] = merged;
    else swaps.unshift(merged);
    refreshPublicSwaps();
    return merged;
  }

  function startEditSwap(id) {
    const swap = findSwapById(id);
    if (!swap || !userOwnsSwap(swap)) return;
    if (!ownerCanWrite(swap)) {
      showToast("Can’t edit this listing", "It isn’t tied to your account id.");
      return;
    }
    editingSwapId = swap.id;
    allowDuplicatePost = false;
    hideDuplicateWarning();
    hideLocationError();
    if (els.formPost) els.formPost.reset();
    fillPlaceFromSwap(swap);
    $("#post-craft").value = swap.craft || "";
    $("#post-seniority").value = swap.seniority != null ? String(swap.seniority) : "";
    $("#post-notes").value = swap.notes || "";
    const radio = els.formPost.querySelector(
      'input[name="swapType"][value="' + (swap.swapType || "Permanent") + '"]'
    );
    if (radio) radio.checked = true;
    setPostMode("edit");
    openModal(els.modalPost);
  }

  async function closeOwnSwap(id, opts) {
    opts = opts || {};
    const swap = findSwapById(id);
    if (!swap || !userOwnsSwap(swap)) return;
    if (!ownerCanWrite(swap)) {
      showToast("Can’t close this listing", "It isn’t tied to your account id.");
      return;
    }
    try {
      let next = Object.assign({}, swap, { status: "closed" });
      if (useSupabase && db() && typeof db().updateSwap === "function" && !String(swap.id).startsWith("local-")) {
        next = await db().updateSwap(swap.id, { status: "closed" }, user.id);
        next = Object.assign({}, swap, next, { status: "closed" });
      }
      replaceSwap(next);
      if (opts.keepComposer) {
        hideDuplicateWarning();
        showToast("Existing listing closed", "It’s off the public map. You can post this one if you still want it.");
        return;
      }
      openMySwaps(next.id);
      showToast("Listing closed", "It’s hidden from the public map and still in My Swaps.");
    } catch (err) {
      console.error("[PostSwap] close swap failed", err);
      showToast("Couldn’t close listing", swapWriteError(err));
    }
  }

  async function deleteOwnSwap(id) {
    const swap = findSwapById(id);
    if (!swap || !userOwnsSwap(swap)) return;
    if (!ownerCanWrite(swap)) {
      showToast("Can’t delete this listing", "It isn’t tied to your account id.");
      return;
    }
    const ok = window.confirm(
      "Delete this swap permanently? Closing it keeps the listing in My Swaps and only removes it from the public map."
    );
    if (!ok) return;
    try {
      if (useSupabase && db() && typeof db().deleteSwap === "function" && !String(swap.id).startsWith("local-")) {
        await db().deleteSwap(swap.id, user.id);
      }
      swaps = swaps.filter(function (s) { return !idEq(s.id, swap.id); });
      if (idEq(activeSwapId, swap.id)) activeSwapId = null;
      refreshPublicSwaps();
      openMySwaps();
      showToast("Swap deleted", "That listing is gone.");
    } catch (err) {
      console.error("[PostSwap] delete swap failed", err);
      showToast("Couldn’t delete listing", swapWriteError(err));
    }
  }

  function hideLocationError() {
    const el = $("#post-location-error");
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }

  function showLocationError(message) {
    const el = $("#post-location-error");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
  }

  function prefillPostCraft() {
    const sel = $("#post-craft");
    if (!sel || !user || !user.craft) return;
    const want = String(user.craft).trim();
    const match = Array.prototype.some.call(sel.options, function (opt) {
      return opt.value === want || opt.text === want;
    });
    if (match) sel.value = want;
  }

  function fillStateSelect(select) {
    if (!select || select.dataset.filled === "1") return;
    const g = window.PostSwapGeocode;
    const codes = g && typeof g.stateOptions === "function" ? g.stateOptions() : [];
    codes.forEach(function (code) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = code;
      select.appendChild(opt);
    });
    select.dataset.filled = "1";
  }

  function selectedDesiredMode() {
    const el = document.querySelector('input[name="desiredMode"]:checked');
    return el ? el.value : "city";
  }

  function syncDesiredMode() {
    const mode = selectedDesiredMode();
    const city = $("#desired-city-fields");
    const region = $("#desired-region-fields");
    const note = $("#desired-anywhere-note");
    if (city) city.hidden = mode !== "city";
    if (region) region.hidden = mode !== "region";
    if (note) note.hidden = mode !== "anywhere";
  }

  function cleanZip(value) {
    const zip = String(value || "").trim();
    if (!zip) return { ok: true, zip: "" };
    if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
      return { ok: false, message: "ZIP must be 5 digits, or leave it blank." };
    }
    return { ok: true, zip: zip };
  }

  function setDesiredMode(mode) {
    const radio = document.querySelector('input[name="desiredMode"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    syncDesiredMode();
  }

  function fillPlaceFromSwap(swap) {
    const g = window.PostSwapGeocode;
    const currentCity = $("#post-current-city");
    const currentState = $("#post-current-state");
    const currentZip = $("#post-current-zip");
    if (swap.currentCity && swap.currentState && currentCity && currentState) {
      currentCity.value = swap.currentCity;
      currentState.value = swap.currentState;
      if (currentZip) currentZip.value = swap.currentZip || "";
    } else if (g && typeof g.parseLocation === "function") {
      const parsed = g.parseLocation(swap.current);
      if (parsed && parsed.ok && parsed.kind === "city" && currentCity && currentState) {
        currentCity.value = parsed.city;
        currentState.value = parsed.state;
        if (currentZip) currentZip.value = parsed.zip || swap.currentZip || "";
      }
    }
    const desired = String(swap.desired || "");
    if (swap.desiredMode === "anywhere" || (!swap.desiredCity && /^anywhere$/i.test(desired))) {
      setDesiredMode("anywhere");
      return;
    }
    if (
      swap.desiredMode === "region" ||
      (!swap.desiredCity && swap.desiredState && /^anywhere in /i.test(desired))
    ) {
      setDesiredMode("region");
      const region = $("#post-desired-region");
      if (region) region.value = swap.desiredState || "";
      return;
    }
    if (swap.desiredCity && swap.desiredState) {
      setDesiredMode("city");
      const city = $("#post-desired-city");
      const state = $("#post-desired-state");
      const zip = $("#post-desired-zip");
      if (city) city.value = swap.desiredCity;
      if (state) state.value = swap.desiredState;
      if (zip) zip.value = swap.desiredZip || "";
      return;
    }
    if (g && typeof g.parseLocation === "function") {
      const parsed = g.parseLocation(desired);
      if (parsed && parsed.ok && parsed.kind === "anywhere") {
        setDesiredMode("anywhere");
        return;
      }
      if (parsed && parsed.ok && parsed.kind === "region") {
        setDesiredMode("region");
        const region = $("#post-desired-region");
        if (region) region.value = parsed.state;
        return;
      }
      if (parsed && parsed.ok && parsed.kind === "city") {
        setDesiredMode("city");
        const city = $("#post-desired-city");
        const state = $("#post-desired-state");
        const zip = $("#post-desired-zip");
        if (city) city.value = parsed.city;
        if (state) state.value = parsed.state;
        if (zip) zip.value = parsed.zip || "";
      }
    }
    syncDesiredMode();
  }

  function readPostPlaces() {
    const g = window.PostSwapGeocode;
    if (!g || typeof g.lookupCity !== "function") {
      return { ok: false, message: "City list didn’t load. Refresh the page and try again." };
    }
    const currentCity = ($("#post-current-city") && $("#post-current-city").value.trim()) || "";
    const currentState = ($("#post-current-state") && $("#post-current-state").value) || "";
    const currentZip = cleanZip($("#post-current-zip") && $("#post-current-zip").value);
    if (!currentZip.ok) return currentZip;
    if (!currentCity || !currentState) {
      return { ok: false, message: "Enter a city and state for where you are now." };
    }
    const currentHit = g.lookupCity(currentCity, currentState);
    if (!currentHit) {
      return {
        ok: false,
        message: "We couldn’t place that current city. Choose a city from the suggestions, or check the state.",
      };
    }
    const mode = selectedDesiredMode();
    let desired = "";
    let desiredCity = null;
    let desiredState = null;
    let desiredZip = null;
    let desiredLat = null;
    let desiredLng = null;
    let desiredQuality = "";
    if (mode === "anywhere") {
      desired = "Anywhere";
      desiredQuality = "anywhere";
    } else if (mode === "region") {
      desiredState = ($("#post-desired-region") && $("#post-desired-region").value) || "";
      if (!desiredState) {
        return { ok: false, message: "Choose a state for Anywhere in a state, or switch back to a city." };
      }
      const centroid = g.stateCentroid(desiredState);
      if (!centroid) return { ok: false, message: "Choose a US state for Anywhere in a state." };
      desired = centroid.label;
      desiredState = centroid.state;
      desiredLat = centroid.lat;
      desiredLng = centroid.lng;
      desiredQuality = "region";
    } else {
      const desiredCityRaw = ($("#post-desired-city") && $("#post-desired-city").value.trim()) || "";
      const desiredStateRaw = ($("#post-desired-state") && $("#post-desired-state").value) || "";
      const zip = cleanZip($("#post-desired-zip") && $("#post-desired-zip").value);
      if (!zip.ok) return zip;
      if (!desiredCityRaw || !desiredStateRaw) {
        return {
          ok: false,
          message: "Enter a desired city and state, or choose Anywhere / Anywhere in a state.",
        };
      }
      const desiredHit = g.lookupCity(desiredCityRaw, desiredStateRaw);
      if (!desiredHit) {
        return {
          ok: false,
          message: "We couldn’t place that desired city. Pick a clearer city, or choose Anywhere / Anywhere in a state.",
        };
      }
      desired = desiredHit.label;
      desiredCity = desiredHit.city;
      desiredState = desiredHit.state;
      desiredZip = zip.zip || null;
      desiredLat = desiredHit.lat;
      desiredLng = desiredHit.lng;
      desiredQuality = "city";
    }
    return {
      ok: true,
      current: currentHit.label,
      desired: desired,
      fields: {
        current: currentHit.label,
        desired: desired,
        currentCity: currentHit.city,
        currentState: currentHit.state,
        currentZip: currentZip.zip || null,
        desiredCity: desiredCity,
        desiredState: desiredState,
        desiredZip: desiredZip,
        desiredMode: mode,
        lat: currentHit.lat,
        lng: currentHit.lng,
        desiredLat: desiredLat,
        desiredLng: desiredLng,
        desiredQuality: desiredQuality,
        currentQuality: "city",
      },
    };
  }

  function bindCitySuggest(inputId, listId, stateId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    const state = document.getElementById(stateId);
    if (!input || !list) return;
    function hide() {
      list.hidden = true;
      list.innerHTML = "";
    }
    function show() {
      const g = window.PostSwapGeocode;
      const st = state ? state.value : "";
      const query = input.value.trim();
      if (!g || typeof g.suggestCities !== "function" || !st || query.length < 1) {
        hide();
        return;
      }
      const hits = g.suggestCities(query, st, 8);
      if (!hits.length) {
        hide();
        return;
      }
      list.innerHTML = hits
        .map(function (hit) {
          return (
            '<li><button type="button" data-city="' +
            escapeHtml(hit.city) +
            '">' +
            escapeHtml(hit.label) +
            "</button></li>"
          );
        })
        .join("");
      list.hidden = false;
    }
    input.addEventListener("input", function () {
      allowDuplicatePost = false;
      hideDuplicateWarning();
      hideLocationError();
      show();
    });
    input.addEventListener("focus", show);
    list.addEventListener("mousedown", function (e) {
      const btn = e.target.closest("button[data-city]");
      if (!btn) return;
      e.preventDefault();
      input.value = btn.getAttribute("data-city") || "";
      hide();
      allowDuplicatePost = false;
      hideDuplicateWarning();
    });
    input.addEventListener("blur", function () {
      setTimeout(hide, 160);
    });
    if (state) {
      state.addEventListener("change", function () {
        allowDuplicatePost = false;
        hideDuplicateWarning();
        hideLocationError();
        if (document.activeElement === input) show();
      });
    }
  }

  // ---------- Post swap ----------
  async function handlePost(e) {
    e.preventDefault();
    console.log("[PostSwap] handlePost: form submit");
    if (
      !requireAuth("Sign up free to post a swap. Guests can still browse the map.")
    ) {
      return;
    }

    const place = readPostPlaces();
    const craft = $("#post-craft").value;
    const seniority = parseFloat($("#post-seniority").value);
    const swapType =
      (els.formPost.querySelector('input[name="swapType"]:checked') || {}).value || "Permanent";
    const notes = $("#post-notes").value.trim();

    if (!place.ok) {
      console.warn("[PostSwap] handlePost: location rejected", place.message);
      showLocationError(place.message);
      showToast("Check the location", place.message);
      return;
    }
    hideLocationError();
    const current = place.current;
    const desired = place.desired;

    if (!craft || Number.isNaN(seniority)) {
      console.warn("[PostSwap] handlePost: validation failed", {
        current,
        desired,
        craft,
        seniority,
      });
      showToast("Missing fields", "Choose a craft and years of seniority.");
      return;
    }

    if (editingSwapId) {
      await saveEditedSwap(Object.assign({ craft: craft, seniority: seniority, swapType: swapType, notes: notes }, place.fields));
      return;
    }

    if (!allowDuplicatePost) {
      const duplicate = findOpenDuplicate(current, desired, null);
      if (duplicate) {
        showDuplicateWarning(duplicate);
        return;
      }
    }
    allowDuplicatePost = false;
    hideDuplicateWarning();

    const submitBtn = $("#post-submit-btn");
    setButtonLoading(submitBtn, true);

    const region = regionFromLocation(current);
    const draft = Object.assign({}, place.fields, {
      current,
      desired,
      craft,
      seniority,
      swapType,
      notes: notes || "Looking for a good mutual match.",
      region,
      privacyLabel: `Verified Carrier • ${region}`,
      ownerId: user ? user.id : "guest",
      status: "open",
      justAdded: true,
    });

    console.log("[PostSwap] handlePost: draft swap", draft, {
      useSupabase,
      hasDb: !!db(),
      userId: user && user.id,
    });

    let newSwap = draft;
    let savedRemote = false;
    let postError = null;

    if (useSupabase && db()) {
      try {
        const payload = {
          ...draft,
          username: user
            ? user.name.split(" ")[0] + " • " + (user.state || "US")
            : null,
        };
        console.log("[PostSwap] handlePost: calling PostSwapDB.createSwap…");
        const saved = await db().createSwap(payload);
        console.log("[PostSwap] handlePost: createSwap returned", saved);
        if (saved && saved.id != null) {
          newSwap = { ...saved, justAdded: true, swapType: draft.swapType };
          savedRemote = true;
        } else {
          postError = new Error("createSwap returned empty result");
          console.error("[PostSwap] handlePost:", postError, saved);
          newSwap = { ...draft, id: "local-" + Date.now() };
        }
      } catch (err) {
        postError = err;
        console.error("[PostSwap] handlePost: Supabase INSERT failed", {
          message: err && err.message,
          status: err && err.status,
          data: err && err.data,
          stack: err && err.stack,
          error: err,
        });
        const detail =
          (err && err.message) ||
          "Check browser console for [PostSwapDB] logs. RLS may block anon INSERT.";
        showToast("Cloud save failed", detail.slice(0, 140));
        newSwap = { ...draft, id: "local-" + Date.now() };
      }
    } else {
      console.warn("[PostSwap] handlePost: Supabase unavailable — local-only post", {
        useSupabase,
        PostSwapDB: typeof window.PostSwapDB,
      });
      newSwap = { ...draft, id: "local-" + Date.now() };
    }

    newSwap = withPinCoords(newSwap);
    swaps.unshift(newSwap);
    setButtonLoading(submitBtn, false);
    closeAllModals();
    els.formPost.reset();
    syncDesiredMode();
    hideLocationError();
    const permanent = els.formPost.querySelector('input[name="swapType"][value="Permanent"]');
    if (permanent) permanent.checked = true;

    els.filterCity.value = "";
    els.filterCraft.value = "";
    nearMeCenter = null;
    refreshViews();
    activeSwapId = newSwap.id;
    setActiveSwap(newSwap.id);

    if (map) {
      var postedPin = activePin(newSwap);
      if (!isFinite(postedPin.lat) || !isFinite(postedPin.lng)) {
        postedPin = { lat: newSwap.currentLat, lng: newSwap.currentLng };
      }
      if (isFinite(postedPin.lat) && isFinite(postedPin.lng)) {
        map.flyTo([postedPin.lat, postedPin.lng], 8, { duration: 1 });
      }
    }

    console.log("[PostSwap] handlePost: done", {
      savedRemote,
      id: newSwap.id,
      postError: postError && postError.message,
    });

    showToast(
      savedRemote ? "Swap posted to cloud!" : "Swap posted!",
      newSwap.locationColumnsMissing
        ? "The listing is saved. Add the location columns in Supabase so city, state, and coordinates are stored too."
        : user
          ? `You're live, ${user.name.split(" ")[0]}. Check My Swaps anytime.`
          : "Your request is on the map. Login to manage it under My Swaps."
    );

    // Email carriers: same home state AND exact craft match only
    if (
      savedRemote &&
      useSupabase &&
      db() &&
      typeof db().notifyMatchingSwap === "function"
    ) {
      try {
        const matchNotify = await db().notifyMatchingSwap({
          swap: newSwap,
          excludeUserId: user ? user.id : null,
        });
        console.log("[PostSwap] handlePost: matching-swap emails (state+craft)", matchNotify);
        if (matchNotify && matchNotify.queued > 0) {
          showToast(
            "Match emails queued",
            `${matchNotify.queued} ${newSwap.craft || "carrier"}${
              matchNotify.queued === 1 ? "" : "s"
            } in matching states notified.`
          );
        }
      } catch (notifyErr) {
        console.warn("[PostSwap] handlePost: matching-swap notify failed", notifyErr);
      }
    }

    $("#explore").scrollIntoView({ behavior: "smooth" });
  }

  async function saveEditedSwap(fields) {
    const existing = findSwapById(editingSwapId);
    const submitBtn = $("#post-submit-btn");
    if (!existing || !ownerCanWrite(existing)) {
      showToast("Can’t edit this listing", "It isn’t tied to your account id.");
      return;
    }
    setButtonLoading(submitBtn, true);
    const notes = fields.notes || "";
    try {
      let next = Object.assign({}, existing, fields, { notes: notes, justAdded: false });
      if (useSupabase && db() && typeof db().updateSwap === "function" && !String(existing.id).startsWith("local-")) {
        const saved = await db().updateSwap(existing.id, {
          current: fields.current,
          desired: fields.desired,
          currentCity: fields.currentCity,
          currentState: fields.currentState,
          currentZip: fields.currentZip,
          desiredCity: fields.desiredCity,
          desiredState: fields.desiredState,
          desiredZip: fields.desiredZip,
          desiredMode: fields.desiredMode,
          desiredLat: fields.desiredLat,
          desiredLng: fields.desiredLng,
          desiredQuality: fields.desiredQuality,
          currentQuality: fields.currentQuality,
          lat: fields.lat,
          lng: fields.lng,
          craft: fields.craft,
          seniority: fields.seniority,
          notes: notes,
          swapType: fields.swapType,
        }, user.id);
        next = Object.assign({}, existing, saved, {
          swapType: fields.swapType,
          status: (saved && saved.status) || existing.status || "open",
          notes: notes,
        });
      }
      const savedId = next.id;
      editingSwapId = null;
      allowDuplicatePost = false;
      replaceSwap(next);
      setButtonLoading(submitBtn, false);
      if (els.formPost) els.formPost.reset();
      openMySwaps(savedId);
      showToast(
        "Swap updated",
        next.locationColumnsMissing
          ? "Details saved. Add the location columns in Supabase so city and coordinates are stored too."
          : "The public map shows the new details if this listing is still open."
      );
    } catch (err) {
      console.error("[PostSwap] edit swap failed", err);
      setButtonLoading(submitBtn, false);
      showToast("Couldn’t save changes", swapWriteError(err));
    }
  }

  // ---------- Event wiring ----------
  function onAction(action, e) {
    switch (action) {
      case "open-post":
        e.preventDefault();
        closeMobileMenu();
        openPostModal();
        break;
      case "open-login":
        e.preventDefault();
        closeMobileMenu();
        openLogin();
        break;
      case "open-register":
        e.preventDefault();
        closeMobileMenu();
        openRegister();
        break;
      case "close-modal":
        closeAllModals();
        break;
      case "logout":
        e.preventDefault();
        closeMobileMenu();
        closeAllModals();
        setLoggedOut();
        break;
      case "show-my-swaps":
        e.preventDefault();
        closeMobileMenu();
        openMySwaps();
        break;
      case "open-profile":
        e.preventDefault();
        closeMobileMenu();
        openProfile();
        break;
      case "open-inbox":
        e.preventDefault();
        closeMobileMenu();
        openInbox();
        break;
      case "open-share-site":
        e.preventDefault();
        closeMobileMenu();
        openShareSite();
        break;
      case "open-feedback":
        e.preventDefault();
        closeMobileMenu();
        openFeedback();
        break;
      default:
        break;
    }
  }

  function closeMobileMenu() {
    els.mobileMenu.hidden = true;
    els.hamburger.setAttribute("aria-expanded", "false");
  }

  function bindEvents() {
    // Mailbox controls
    if (els.mailboxBtn) {
      els.mailboxBtn.addEventListener("click", toggleMailbox);
    }
    if (els.mailboxClose) {
      els.mailboxClose.addEventListener("click", (e) => {
        e.stopPropagation();
        setMailboxOpen(false);
      });
    }
    if (els.mailboxMarkAll) {
      els.mailboxMarkAll.addEventListener("click", (e) => {
        e.stopPropagation();
        markAllMailRead();
      });
    }
    const openInboxBtn = $("#mailbox-open-inbox");
    if (openInboxBtn) {
      openInboxBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openInbox();
      });
    }
    if (els.inboxRefresh) {
      els.inboxRefresh.addEventListener("click", function () {
        loadInboxThreads({ reveal: false });
      });
    }
    if (els.inboxBack) {
      els.inboxBack.addEventListener("click", function () {
        inboxBackToList();
      });
    }
    if (els.inboxThreads) {
      els.inboxThreads.addEventListener("click", function (e) {
        const item = e.target.closest("[data-inbox-thread]");
        if (!item) return;
        selectInboxThread(item.getAttribute("data-inbox-thread"), { reveal: true });
      });
    }
    if (els.formInboxReply) {
      els.formInboxReply.addEventListener("submit", sendInboxReply);
    }
    if (els.inboxReplyInput) {
      els.inboxReplyInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendInboxReply(e);
        }
      });
    }
    if (els.inboxSendRetry) {
      els.inboxSendRetry.addEventListener("click", function () {
        sendInboxReply();
      });
    }
    if (els.dmSendRetry) {
      els.dmSendRetry.addEventListener("click", function () {
        if (els.formDm) els.formDm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      });
    }
    if (els.modalInbox) {
      els.modalInbox.addEventListener("click", function (e) {
        const btn = e.target.closest("#inbox-open-dm");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        openInboxFullChat();
      });
    }
    if (els.mailboxList) {
      els.mailboxList.addEventListener("click", (e) => {
        const item = e.target.closest("[data-mail-id]");
        if (!item) return;
        e.stopPropagation();
        onMailboxItemClick(item.getAttribute("data-mail-id"));
      });
    }
    document.addEventListener("click", (e) => {
      if (!els.mailbox || els.mailboxPanel?.hidden) return;
      if (!els.mailbox.contains(e.target)) setMailboxOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.mailboxPanel && !els.mailboxPanel.hidden) {
        setMailboxOpen(false);
      }
    });

    // Delegated data-action clicks
    document.addEventListener("click", (e) => {
      const actionEl = e.target.closest("[data-action]");
      if (actionEl) {
        onAction(actionEl.getAttribute("data-action"), e);
        return;
      }

      const viewBtn = e.target.closest("[data-view-listing]");
      if (viewBtn && !viewBtn.closest(".leaflet-popup-content")) {
        e.preventDefault();
        e.stopPropagation();
        openMySwaps(viewBtn.getAttribute("data-view-listing"));
        return;
      }

      // DM buttons in list
      const dmBtn = e.target.closest("[data-dm-id]");
      if (dmBtn && !dmBtn.closest(".leaflet-popup-content")) {
        e.preventDefault();
        e.stopPropagation();
        const id = dmBtn.getAttribute("data-dm-id");
        const swap = findSwapById(id);
        if (swap) openDm(swap);
        return;
      }

      // Share buttons in list
      const shareBtn = e.target.closest("[data-share-id]");
      if (shareBtn && !shareBtn.closest(".leaflet-popup-content")) {
        e.preventDefault();
        e.stopPropagation();
        const id = shareBtn.getAttribute("data-share-id");
        const swap = findSwapById(id);
        if (swap) openShare(swap);
        return;
      }

      // Card click
      const card = e.target.closest(".swap-card");
      if (card && els.swapList.contains(card)) {
        if (e.target.closest("button")) return;
        setActiveSwap(card.dataset.id);
      }
    });

    // Feedback modal
    document.querySelectorAll('input[name="postal-rating"]').forEach(function (radio) {
      radio.addEventListener("change", updateFeedbackSelectedLabel);
    });
    if (els.feedbackOpenForm) {
      els.feedbackOpenForm.addEventListener("click", submitFeedbackToGoogleForm);
    }

    // Share modal actions (site or individual swap)
    if (els.shareCopyMsg) {
      els.shareCopyMsg.addEventListener("click", () => {
        const p = getSharePayload();
        copyText(p.message, "Message copied — paste into a text or group chat.");
      });
    }
    if (els.shareCopyLink) {
      els.shareCopyLink.addEventListener("click", () => {
        const p = getSharePayload();
        copyText(p.link, "Link copied to clipboard.");
      });
    }
    if (els.shareEmail) {
      els.shareEmail.addEventListener("click", () => {
        const p = getSharePayload();
        copyText(p.message, "Message copied · opening email…");
        window.location.href =
          `mailto:?subject=${encodeURIComponent(p.subject)}&body=${encodeURIComponent(p.message)}`;
      });
    }
    if (els.shareGroup) {
      els.shareGroup.addEventListener("click", () => {
        const p = getSharePayload();
        copyText(p.groupText, "Group-chat text copied — paste into your carrier group.");
      });
    }

    // Keyboard on cards
    els.swapList.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const card = e.target.closest(".swap-card");
        if (card) {
          e.preventDefault();
          setActiveSwap(card.dataset.id);
        }
      }
    });

    els.overlay.addEventListener("click", () => closeAllModals());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllModals();
    });

    els.hamburger.addEventListener("click", () => {
      const open = els.mobileMenu.hidden;
      els.mobileMenu.hidden = !open;
      els.hamburger.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Mobile nav links close menu
    $$(".mobile-link").forEach((link) => {
      link.addEventListener("click", () => closeMobileMenu());
    });

    function openTransferRules() {
      var box = document.getElementById("transfer-rules");
      if (box) box.open = true;
    }
    $$('a[href="#regulations"]').forEach(function (link) {
      link.addEventListener("click", openTransferRules);
    });
    if (location.hash === "#regulations") openTransferRules();
    window.addEventListener("hashchange", function () {
      if (location.hash === "#regulations") openTransferRules();
    });

    // Navbar scroll state
    const onScroll = () => {
      els.navbar.classList.toggle("scrolled", window.scrollY > 8);
      clearFabFromLoadMore();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", clearFabFromLoadMore);
    onScroll();

    // Filters
    els.filterCity.addEventListener("input", () => {
      activeSwapId = null;
      // A city search replaces Near Me so the two don't fight.
      var hadNear = !!nearMeCenter;
      if ((els.filterCity.value || "").trim() && nearMeCenter) {
        nearMeCenter = null;
      }
      refreshViews();
      if (hadNear && !nearMeCenter) forceMapRefresh();
    });
    if (els.swapSort) {
      els.swapSort.addEventListener("change", function () {
        if (els.swapSort.value === "closest" && !nearMeCenter) {
          els.swapSort.value = "newest";
        }
        activeSwapId = null;
        listQueryKey = "";
        refreshViews();
      });
    }
    if (els.loadMore) {
      els.loadMore.addEventListener("click", function () {
        listShown += LIST_PAGE;
        refreshViews();
      });
    }
    els.filterCraft.addEventListener("change", () => {
      activeSwapId = null;
      refreshViews();
    });
    els.nearMeBtn.addEventListener("click", nearMe);
    if (els.modeLeaving) {
      els.modeLeaving.addEventListener("click", function () {
        setMapMode("leaving");
      });
    }
    if (els.modeComing) {
      els.modeComing.addEventListener("click", function () {
        setMapMode("coming");
      });
    }

    // Forms
    els.formPost.addEventListener("submit", handlePost);
    ["post-current-state", "post-desired-state", "post-desired-region"].forEach(function (id) {
      fillStateSelect(document.getElementById(id));
    });
    bindCitySuggest("post-current-city", "post-current-suggest", "post-current-state");
    bindCitySuggest("post-desired-city", "post-desired-suggest", "post-desired-state");
    document.querySelectorAll('input[name="desiredMode"]').forEach(function (radio) {
      radio.addEventListener("change", function () {
        allowDuplicatePost = false;
        hideDuplicateWarning();
        hideLocationError();
        syncDesiredMode();
      });
    });
    ["post-current-state", "post-desired-state", "post-desired-region", "post-current-zip", "post-desired-zip"].forEach(function (id) {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("input", function () {
        allowDuplicatePost = false;
        hideDuplicateWarning();
        hideLocationError();
      });
      input.addEventListener("change", function () {
        allowDuplicatePost = false;
        hideDuplicateWarning();
        hideLocationError();
      });
    });
    const dupEdit = $("#swap-duplicate-edit");
    const dupClose = $("#swap-duplicate-close");
    const dupAnyway = $("#swap-duplicate-anyway");
    if (dupEdit) {
      dupEdit.addEventListener("click", function () {
        if (duplicateSwapId != null) startEditSwap(duplicateSwapId);
      });
    }
    if (dupClose) {
      dupClose.addEventListener("click", function () {
        if (duplicateSwapId != null) closeOwnSwap(duplicateSwapId, { keepComposer: true });
      });
    }
    if (dupAnyway) {
      dupAnyway.addEventListener("click", function () {
        allowDuplicatePost = true;
        if (els.formPost) els.formPost.requestSubmit();
      });
    }
    if (els.mySwapsBody) {
      els.mySwapsBody.addEventListener("click", function (e) {
        const editBtn = e.target.closest("[data-swap-edit]");
        const closeBtn = e.target.closest("[data-swap-close]");
        const deleteBtn = e.target.closest("[data-swap-delete]");
        if (!editBtn && !closeBtn && !deleteBtn) return;
        e.preventDefault();
        e.stopPropagation();
        if (editBtn) startEditSwap(editBtn.getAttribute("data-swap-edit"));
        else if (closeBtn) closeOwnSwap(closeBtn.getAttribute("data-swap-close"));
        else deleteOwnSwap(deleteBtn.getAttribute("data-swap-delete"));
      });
    }
    els.formDm.addEventListener("submit", sendDm);
    window.addEventListener("resize", function () {
      syncInboxMode();
      if (messagingModalOpen()) syncChatModalHeight();
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () {
        if (messagingModalOpen()) syncChatModalHeight();
      });
    }
    if (els.formProfile) {
      els.formProfile.addEventListener("submit", saveProfile);
    }

    // Notification UI live sync
    [
      els.notifyEmailEnabled,
      els.notifyInterest,
      els.notifyState,
      els.notifyDm,
      els.profileEmail,
    ].forEach((el) => {
      if (!el) return;
      el.addEventListener("change", syncNotifyUi);
      el.addEventListener("input", syncNotifyUi);
    });

    els.useLocationBtn.addEventListener("click", () => {
      const geo = navigator.geolocation;
      if (!geo || typeof geo.getCurrentPosition !== "function") {
        showToast("Location unavailable", "This browser can’t share a location. Enter a city and state.");
        return;
      }
      els.useLocationBtn.disabled = true;
      geo.getCurrentPosition(
        function (pos) {
          els.useLocationBtn.disabled = false;
          const g = window.PostSwapGeocode;
          const hit =
            g && typeof g.nearestCity === "function"
              ? g.nearestCity(pos.coords.latitude, pos.coords.longitude, 40)
              : null;
          if (!hit) {
            showToast("No city match", "No listed city is close enough. Enter the city and state yourself.");
            return;
          }
          const city = $("#post-current-city");
          const state = $("#post-current-state");
          if (city) city.value = hit.city;
          if (state) state.value = hit.state;
          hideLocationError();
          showToast("Location set", hit.city + ", " + hit.state + ". Change it if that’s the wrong office.");
        },
        function () {
          els.useLocationBtn.disabled = false;
          showToast("Location blocked", "Allow location access, or enter a city and state.");
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    });

    els.demoLoginBtn.addEventListener("click", demoLogin);

    els.formLogin.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#login-email").value.trim();
      const submitBtn = els.formLogin.querySelector('button[type="submit"]');
      setButtonLoading(submitBtn, true);

      let profile = null;
      if (useSupabase && db()) {
        try {
          profile = await db().fetchProfileByEmail(email);
        } catch (err) {
          console.warn("Profile lookup failed:", err);
        }
      }

      if (profile) {
        setLoggedIn(
          {
            ...profile,
            notifications: profile.notifications || { ...DEFAULT_NOTIFICATIONS },
          },
          { skipRemote: true }
        );
      } else {
        const namePart = email.split("@")[0] || "Carrier";
        const pretty = namePart
          .replace(/[._]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        setLoggedIn({
          id: newUserId(),
          name: pretty,
          email,
          craft: "Letter Carrier",
          station: "Local Station",
          state: "NV",
          initials: initials(pretty),
          notifications: { ...DEFAULT_NOTIFICATIONS },
        });
      }
      setButtonLoading(submitBtn, false);
      closeAllModals();
    });

    els.formRegister.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("#reg-name").value.trim();
      const email = $("#reg-email").value.trim();
      const submitBtn = els.formRegister.querySelector('button[type="submit"]');
      setButtonLoading(submitBtn, true);

      setLoggedIn({
        id: newUserId(),
        name,
        email,
        craft: $("#reg-craft").value,
        station: $("#reg-station").value.trim(),
        state: "NV",
        initials: initials(name),
        employeeId: ($("#reg-eid") && $("#reg-eid").value.trim()) || "",
        notifications: { ...DEFAULT_NOTIFICATIONS },
      });
      setButtonLoading(submitBtn, false);
      closeAllModals();
      showToast(
        "Account created",
        `Profile saved${useSupabase ? " to Supabase" : ""}. Email alerts enabled for ${email}.`
      );
    });

  }

  // ---------- Hero truck video (Grok LLV clip) ----------
  function initHeroDrive() {
    const video = document.getElementById("truck-drive-video");
    if (!video) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      video.removeAttribute("autoplay");
      video.pause();
      return;
    }

    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");

    const tryPlay = () => {
      const p = video.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          /* Autoplay may be blocked until a user gesture; retry on first interaction */
          const unlock = () => {
            video.play().catch(() => {});
            document.removeEventListener("pointerdown", unlock);
            document.removeEventListener("keydown", unlock);
          };
          document.addEventListener("pointerdown", unlock, { once: true });
          document.addEventListener("keydown", unlock, { once: true });
        });
      }
    };

    if (video.readyState >= 2) tryPlay();
    else video.addEventListener("canplay", tryPlay, { once: true });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) video.pause();
      else tryPlay();
    });
  }

  // ---------- Init ----------
  async function init() {
    // Ensure global is still attached when the app boots
    if (typeof window !== "undefined" && window.PostSwapDB) {
      window.PostSwapDB = window.PostSwapDB;
      if (typeof window.PostSwapDB.testAnonInserts === "function") {
        console.log("PostSwapDB ready");
      }
    }

    initMap();
    bindEvents();
    updateMobileAuth();
    restoreSession();
    updateGuestParticipateBanner();
    renderMailbox();
    refreshViews(); // empty state until load finishes
    initHeroDrive();
    await loadSwapsFromSupabase();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
