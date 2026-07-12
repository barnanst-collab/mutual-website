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

  // City geocode hints for map pins when posting (not seed swap data)
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
    "albuquerque": { lat: 35.0844, lng: -106.6504 },
    "salt lake": { lat: 40.7608, lng: -111.891 },
  };

  // ---------- State ----------
  let swaps = [];
  let map = null;
  let markersLayer = null;
  let markerById = new Map();
  let activeSwapId = null;
  let currentDmSwap = null;
  let user = null; // full profile + notification prefs
  let useSupabase = typeof window.PostSwapDB !== "undefined";
  let swapsLoaded = false;

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
        return { ok: false, source: "none", count: 0 };
      }
      const remote = await db().fetchSwaps();
      swaps = Array.isArray(remote) ? remote : [];
      swapsLoaded = true;
      refreshViews();
      console.log("[PostSwap] loaded swaps from Supabase:", swaps.length);
      return { ok: true, source: "supabase", count: swaps.length };
    } catch (err) {
      console.error("[PostSwap] Supabase fetch failed — empty swaps list", err);
      swaps = [];
      swapsLoaded = true;
      refreshViews();
      showToast(
        "Couldn’t load swaps",
        "Check Supabase connection. The list is empty until data loads or you post a swap."
      );
      return { ok: false, error: err, count: 0 };
    } finally {
      setExploreLoading(false);
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
    swapList: $("#swap-list"),
    listCount: $("#list-count"),
    overlay: $("#modal-overlay"),
    modalPost: $("#modal-post"),
    modalDm: $("#modal-dm"),
    modalLogin: $("#modal-login"),
    modalRegister: $("#modal-register"),
    modalMySwaps: $("#modal-my-swaps"),
    modalInbox: $("#modal-inbox"),
    modalShare: $("#modal-share"),
    modalProfile: $("#modal-profile"),
    inboxThreads: $("#inbox-threads"),
    inboxStatus: $("#inbox-status"),
    inboxEmptyThread: $("#inbox-empty-thread"),
    inboxThreadPanel: $("#inbox-thread-panel"),
    inboxThreadTitle: $("#inbox-thread-title"),
    inboxThreadSub: $("#inbox-thread-sub"),
    inboxThreadMessages: $("#inbox-thread-messages"),
    inboxOpenDm: $("#inbox-open-dm"),
    inboxRefresh: $("#inbox-refresh"),
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

  function geocodeCurrent(cityStr) {
    const lower = cityStr.toLowerCase();
    for (const [key, coords] of Object.entries(CITY_COORDS)) {
      if (lower.includes(key)) {
        return {
          lat: coords.lat + (Math.random() - 0.5) * 0.08,
          lng: coords.lng + (Math.random() - 0.5) * 0.08,
        };
      }
    }
    // Default: scatter near Southwest
    return {
      lat: 34.5 + (Math.random() - 0.5) * 4,
      lng: -112 + (Math.random() - 0.5) * 6,
    };
  }

  function regionFromLocation(loc) {
    const l = loc.toLowerCase();
    if (/nv|az|nm|las vegas|phoenix|tucson|henderson|mesa/.test(l)) return "Southwest Region";
    if (/ca|san diego|los angeles/.test(l)) return "Pacific Region";
    if (/co|ut|denver|salt lake/.test(l)) return "Mountain West";
    if (/tx|dallas|houston/.test(l)) return "South Central";
    if (/il|chicago|mi|oh|wi/.test(l)) return "Great Lakes";
    if (/ga|fl|nc|sc|atlanta/.test(l)) return "Southeast Region";
    return "United States";
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

  // ---------- In-app mailbox notifications ----------
  const NOTIF_STORAGE_KEY = "postswap_mailbox";

  const DEFAULT_MAIL = [
    {
      id: "n1",
      type: "dm",
      text: "New message from Verified Carrier in Phoenix",
      time: "12 min ago",
      unread: true,
    },
    {
      id: "n2",
      type: "interest",
      text: "3 carriers interested in your North Las Vegas swap",
      time: "1 hr ago",
      unread: true,
    },
    {
      id: "n3",
      type: "nearby",
      text: "New swap posted near you in Tucson",
      time: "3 hr ago",
      unread: true,
    },
  ];

  let mailItems = loadMailItems();

  function loadMailItems() {
    try {
      const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (_) { /* ignore */ }
    return DEFAULT_MAIL.map((n) => ({ ...n }));
  }

  function saveMailItems() {
    try {
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(mailItems));
    } catch (_) { /* ignore */ }
  }

  function unreadCount() {
    return mailItems.filter((n) => n.unread).length;
  }

  function iconSvg(type) {
    if (type === "dm") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
    }
    if (type === "interest") {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
  }

  function renderMailbox() {
    if (!els.mailbox || !els.mailboxList) return;

    const count = unreadCount();
    els.mailbox.classList.toggle("has-unread", count > 0);
    els.mailbox.classList.remove("level-1", "level-2", "level-3");
    if (count > 0) {
      const level = Math.min(3, count);
      els.mailbox.classList.add(`level-${level}`);
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
        count > 0 ? `Notifications, ${count} unread` : "Notifications"
      );
    }

    if (els.mailboxMarkAll) {
      els.mailboxMarkAll.disabled = count === 0;
    }

    if (!mailItems.length) {
      els.mailboxList.innerHTML = `
        <div class="mailbox-empty">
          <div class="mailbox-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg>
          </div>
          <p><strong>Mailbox is empty</strong><br/>You're all caught up — no new carrier updates.</p>
        </div>
      `;
      return;
    }

    els.mailboxList.innerHTML = mailItems
      .map(
        (n) => `
      <button type="button" class="mailbox-item${n.unread ? " unread" : ""}" data-mail-id="${n.id}" role="menuitem">
        <span class="mailbox-dot" aria-hidden="true"></span>
        <span class="mailbox-item-icon ${escapeHtml(n.type)}" aria-hidden="true">${iconSvg(n.type)}</span>
        <span class="mailbox-item-body">
          <p>${escapeHtml(n.text)}</p>
          <span class="mailbox-item-meta">${escapeHtml(n.time)}${n.unread ? " · New" : ""}</span>
        </span>
      </button>
    `
      )
      .join("");
  }

  function setMailboxOpen(open) {
    if (!els.mailboxPanel || !els.mailboxBtn) return;
    els.mailboxPanel.hidden = !open;
    els.mailboxBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function toggleMailbox(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!user) {
      openLogin();
      showToast("Sign in first", "Log in to check your mailbox.");
      return;
    }
    const open = els.mailboxPanel.hidden;
    setMailboxOpen(open);
    if (open) closeMobileMenu();
  }

  function markAllMailRead() {
    mailItems = mailItems.map((n) => ({ ...n, unread: false }));
    saveMailItems();
    renderMailbox();
    showToast("Mailbox cleared", "All notifications marked as read.");
  }

  function markOneMailRead(id) {
    mailItems = mailItems.map((n) =>
      n.id === id ? { ...n, unread: false } : n
    );
    saveMailItems();
    renderMailbox();
  }

  function resetDemoMail() {
    mailItems = DEFAULT_MAIL.map((n) => ({ ...n }));
    saveMailItems();
    renderMailbox();
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
    renderMailbox();

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
    showToast("Signed out", "Come back anytime — posting stays free.");
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
    // Refresh sample mail so the mailbox looks full again for demos
    if (!localStorage.getItem(NOTIF_STORAGE_KEY) || unreadCount() === 0) {
      resetDemoMail();
    }
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

  /** Demo helper: show what an email alert would look like */
  function simulateEmailAlert(type, detail) {
    if (!user?.notifications?.emailEnabled) return;
    const n = user.notifications;
    const map = {
      interest: n.onInterest,
      state: n.onStateSwap,
      dm: n.onDm,
    };
    if (!map[type]) return;

    const titles = {
      interest: "Interest in your swap",
      state: "New swap in your state",
      dm: "New DM message",
    };
    showToast(
      `Email → ${user.email}`,
      `${titles[type]}: ${detail}`
    );
  }

  // ---------- Filtering ----------
  function getFilteredSwaps() {
    const city = (els.filterCity.value || "").trim().toLowerCase();
    const craft = els.filterCraft.value;

    return swaps.filter((s) => {
      if (craft && s.craft !== craft) return false;
      if (city) {
        const hay = `${s.current} ${s.desired} ${s.region} ${s.notes}`.toLowerCase();
        if (!hay.includes(city)) return false;
      }
      return true;
    });
  }

  // ---------- Map ----------
  function initMap() {
    map = L.map("map", {
      zoomControl: true,
      scrollWheelZoom: true,
    }).setView([36.5, -105], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);

    // Fix tiles when container becomes visible / resized
    setTimeout(() => map.invalidateSize(), 200);
    window.addEventListener("resize", () => map && map.invalidateSize());
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
    return `https://postswap.app/swap/${s.id}`;
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

  function popupHtml(s) {
    return `
      <div class="popup-card">
        <h4>${escapeHtml(s.current)} → ${escapeHtml(s.desired)}</h4>
        <div class="popup-meta">
          <div><strong>Craft:</strong> ${escapeHtml(s.craft)}</div>
          <div><strong>Seniority:</strong> ${formatSeniority(s.seniority)}</div>
          <div><strong>Type:</strong> ${escapeHtml(s.swapType)}</div>
        </div>
        ${s.notes ? `<div class="popup-note">“${escapeHtml(s.notes)}”</div>` : ""}
        <div class="popup-actions">
          <button type="button" class="btn btn-primary" data-dm-id="${s.id}">Send DM</button>
          ${shareButtonHtml(s)}
        </div>
        <p class="share-nudge">Send to a buddy who might want this route!</p>
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

    filtered.forEach((s) => {
      const marker = L.marker([s.lat, s.lng], {
        icon: createMarkerIcon(idEq(s.id, activeSwapId)),
        title: `${s.current} → ${s.desired}`,
      });
      marker.bindPopup(popupHtml(s), { maxWidth: 300 });
      marker.on("click", () => {
        setActiveSwap(s.id, { fromMap: true });
      });
      marker.on("popupopen", () => {
        const root = document.querySelector(`.leaflet-popup-content`);
        if (!root) return;
        const btn = root.querySelector(`[data-dm-id="${s.id}"]`);
        if (btn) {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openDm(s);
          });
        }
        const shareBtn = root.querySelector(`[data-share-id="${s.id}"]`);
        if (shareBtn) {
          shareBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
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
        map.panTo(marker.getLatLng(), { animate: true });
        marker.openPopup();
      }
    }
  }

  // ---------- List ----------
  function renderList(filtered) {
    els.listCount.textContent = `${filtered.length} open`;

    if (!filtered.length) {
      els.swapList.innerHTML = `
        <div class="empty-state">
          <strong>No swaps match your filters</strong>
          <p>Try another city or craft — or post yours so others can find you.</p>
        </div>
      `;
      return;
    }

    els.swapList.innerHTML = filtered
      .map((s) => {
        const isMine = user && idEq(s.ownerId, user.id);
        return `
        <article class="swap-card${idEq(s.id, activeSwapId) ? " active" : ""}${isMine ? " mine" : ""}${s.justAdded ? " just-added" : ""}" data-id="${s.id}" tabindex="0">
          <div class="swap-card-top">
            <div class="swap-route">
              ${escapeHtml(s.current)} <span class="arrow">→</span> ${escapeHtml(s.desired)}
            </div>
            <span class="swap-badge ${badgeClass(s.swapType)}">${escapeHtml(s.swapType)}</span>
          </div>
          <div class="swap-meta">
            <span>${escapeHtml(s.craft)}</span>
            <span>${formatSeniority(s.seniority)} seniority</span>
          </div>
          <div class="swap-privacy">${isMine ? "Your listing • visible to carriers" : escapeHtml(s.privacyLabel)}</div>
          <div class="swap-card-actions">
            <button type="button" class="btn btn-primary" data-dm-id="${s.id}">
              ${isMine ? "View listing" : "I'm Interested → DM"}
            </button>
            ${shareButtonHtml(s)}
          </div>
          <p class="share-nudge">Send to a buddy who might want this route!</p>
        </article>
      `;
      })
      .join("");

    // Clear justAdded flags after paint
    filtered.forEach((s) => {
      if (s.justAdded) delete s.justAdded;
    });
  }

  function refreshViews() {
    const filtered = getFilteredSwaps();
    renderList(filtered);
    refreshMap(filtered);
  }

  // ---------- Near Me ----------
  function nearMe() {
    // Demo: center on Southwest (Las Vegas / Phoenix corridor)
    if (map) {
      map.flyTo([35.5, -113.5], 6, { duration: 1.2 });
    }
    els.filterCity.value = "";
    // Soft highlight of SW swaps by not filtering city; toast instead
    showToast("Near Me", "Centered on the Southwest — Las Vegas & Phoenix corridor.");
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
    els.modalProfile,
  ];

  // ---------- My Messages inbox ----------
  let inboxThreads = []; // { swapId, swap, messages, lastAt, preview }
  let activeInboxSwapId = null;

  function swapLabel(s) {
    if (!s) return "Unknown swap";
    return `${s.current || "?"} → ${s.desired || "?"}`;
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
    } catch {
      return "";
    }
  }

  async function loadInboxThreads() {
    if (!els.inboxThreads) return;
    els.inboxStatus.textContent = "Loading messages…";
    els.inboxThreads.innerHTML = `
      <div class="inbox-loading">
        <span class="loading-spinner loading-spinner-sm" aria-hidden="true"></span>
        Fetching DMs…
      </div>
    `;

    if (!useSupabase || !db() || typeof db().fetchAllMessages !== "function") {
      els.inboxThreads.innerHTML = `
        <div class="mailbox-empty">
          <p><strong>Inbox unavailable</strong><br />Supabase messages helper not loaded.</p>
        </div>
      `;
      els.inboxStatus.textContent = "Offline";
      return;
    }

    try {
      const allMsgs = await db().fetchAllMessages(250);
      const myId = user ? String(user.id) : "";

      // Keep messages related to this user (sent, received, or on their swaps)
      const mySwapIds = new Set(
        swaps.filter((s) => idEq(s.ownerId, myId)).map((s) => String(s.id))
      );
      const relevant = allMsgs.filter((m) => {
        const sid = String(m.swapId);
        return (
          idEq(m.senderId, myId) ||
          idEq(m.toUser, myId) ||
          mySwapIds.has(sid) ||
          // Demo: include threads on known map swaps so inbox isn't empty for new accounts
          swaps.some((s) => idEq(s.id, m.swapId))
        );
      });

      // Group by swapId (messages already desc — reverse per thread for chronological)
      const bySwap = new Map();
      relevant.forEach((m) => {
        const key = String(m.swapId);
        if (!bySwap.has(key)) bySwap.set(key, []);
        bySwap.get(key).push(m);
      });

      inboxThreads = Array.from(bySwap.entries())
        .map(([swapId, messages]) => {
          const chronological = [...messages].sort((a, b) => {
            return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
          });
          const last = chronological[chronological.length - 1];
          const swap = findSwapById(swapId) || null;
          return {
            swapId,
            swap,
            messages: chronological,
            lastAt: last && last.createdAt,
            preview: (last && last.body) || "",
            count: chronological.length,
          };
        })
        .sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));

      renderInboxThreadList();
      els.inboxStatus.textContent =
        inboxThreads.length === 0
          ? "No messages yet"
          : `${inboxThreads.length} conversation${inboxThreads.length === 1 ? "" : "s"}`;

      // Keep selected thread if still present
      if (activeInboxSwapId && bySwap.has(String(activeInboxSwapId))) {
        selectInboxThread(activeInboxSwapId);
      } else {
        activeInboxSwapId = null;
        showInboxThreadEmpty();
      }
    } catch (err) {
      console.error("[PostSwap] loadInboxThreads failed", err);
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
      .map((t) => {
        const title = t.swap ? swapLabel(t.swap) : `Swap #${escapeHtml(String(t.swapId))}`;
        const craft = t.swap ? escapeHtml(t.swap.craft || "") : "";
        const active = idEq(t.swapId, activeInboxSwapId) ? " active" : "";
        return `
        <button type="button" class="inbox-thread-item${active}" data-inbox-swap="${escapeHtml(String(t.swapId))}" role="listitem">
          <div class="inbox-thread-item-top">
            <span class="inbox-thread-route">${escapeHtml(title)}</span>
            <span class="inbox-thread-time">${escapeHtml(formatInboxTime(t.lastAt))}</span>
          </div>
          <div class="inbox-thread-item-meta">
            ${craft ? `<span>${craft}</span>` : ""}
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
  }

  function selectInboxThread(swapId) {
    activeInboxSwapId = swapId;
    const thread = inboxThreads.find((t) => idEq(t.swapId, swapId));
    renderInboxThreadList();

    if (!thread) {
      showInboxThreadEmpty();
      return;
    }

    if (els.inboxEmptyThread) els.inboxEmptyThread.hidden = true;
    if (els.inboxThreadPanel) els.inboxThreadPanel.hidden = false;

    const title = thread.swap ? swapLabel(thread.swap) : `Swap #${swapId}`;
    if (els.inboxThreadTitle) els.inboxThreadTitle.textContent = title;
    if (els.inboxThreadSub) {
      els.inboxThreadSub.textContent = thread.swap
        ? `${thread.swap.craft || "Carrier"} · ${thread.count} messages`
        : `${thread.count} messages`;
    }

    const myId = user ? user.id : "guest";
    if (els.inboxThreadMessages) {
      els.inboxThreadMessages.innerHTML = thread.messages
        .map((m) => {
          const who = idEq(m.senderId, myId) ? "me" : "them";
          const label = who === "me" ? "You" : m.senderId || "Carrier";
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
      els.inboxThreadMessages.scrollTop = els.inboxThreadMessages.scrollHeight;
    }
  }

  async function openInbox() {
    if (!user) {
      openLogin();
      showToast("Sign in first", "Log in to open My Messages.");
      return;
    }
    setMailboxOpen(false);
    closeMobileMenu();
    openModal(els.modalInbox);
    await loadInboxThreads();
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
    // Focus first input
    const focusable = modal.querySelector("input, select, textarea, button:not(.modal-close)");
    if (focusable) setTimeout(() => focusable.focus(), 50);
  }

  function closeAllModals(hideOverlay = true) {
    allModals().forEach((m) => {
      if (m) m.hidden = true;
    });
    if (hideOverlay) {
      els.overlay.hidden = true;
      document.body.classList.remove("modal-open");
    }
  }

  function openPostModal() {
    openModal(els.modalPost);
  }

  function openLogin() {
    openModal(els.modalLogin);
  }

  function openRegister() {
    openModal(els.modalRegister);
  }

  function openMySwaps() {
    if (!user) {
      openLogin();
      showToast("Sign in first", "Log in to see and manage your posted swaps.");
      return;
    }
    const mine = swaps.filter((s) => idEq(s.ownerId, user.id));
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
        .map(
          (s) => `
        <div class="my-swap-item">
          <h4>${escapeHtml(s.current)} → ${escapeHtml(s.desired)}</h4>
          <p>${escapeHtml(s.craft)} · ${formatSeniority(s.seniority)} · ${escapeHtml(s.swapType)}</p>
          ${s.notes ? `<p style="margin-top:0.4rem;font-style:italic">“${escapeHtml(s.notes)}”</p>` : ""}
        </div>
      `
        )
        .join("");
    }
    openModal(els.modalMySwaps);
  }

  // ---------- DM ----------
  function appendChatMessage(who, text, time) {
    const msg = document.createElement("div");
    msg.className = `chat-msg ${who}`;
    msg.innerHTML = `${escapeHtml(text)}<span class="msg-time">${time || timeNow()}</span>`;
    els.chatBody.appendChild(msg);
    els.chatBody.scrollTop = els.chatBody.scrollHeight;
  }

  function formatMsgTime(iso) {
    if (!iso) return timeNow();
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return timeNow();
    }
  }

  async function openDm(swap) {
    if (user && idEq(swap.ownerId, user.id)) {
      showToast("That's your swap", "Other carriers will message you when they're interested.");
      return;
    }

    currentDmSwap = swap;
    const parts = (swap.privacyLabel || "").split("•").map((p) => p.trim());
    els.dmTitle.textContent = parts[0] || "Verified Carrier";
    els.dmSubtitle.textContent = parts[1] || swap.region || "";
    els.dmAvatar.textContent = "VC";

    els.chatBody.innerHTML = `
      <div class="chat-msg them" style="opacity:0.75">
        Loading conversation…
        <span class="msg-time"></span>
      </div>
    `;
    els.dmInput.value = `Hi — I'm interested in a mutual swap (${swap.desired} ↔ ${swap.current}). Would you be open to chatting about timelines and eReassign?`;
    openModal(els.modalDm);

    let history = [];
    // Remote swaps use numeric Supabase ids (or UUIDs if upgraded)
    const canLoadRemote =
      useSupabase &&
      db() &&
      swap.id != null &&
      !String(swap.id).startsWith("local-");

    if (canLoadRemote) {
      try {
        history = await db().fetchMessages(swap.id);
      } catch (err) {
        console.warn("Could not load messages:", err);
      }
    }

    if (history.length) {
      const myId = user ? user.id : "guest";
      els.chatBody.innerHTML = history
        .map((m) => {
          const who = idEq(m.senderId, myId) ? "me" : "them";
          return `<div class="chat-msg ${who}">${escapeHtml(m.body)}<span class="msg-time">${formatMsgTime(m.createdAt)}</span></div>`;
        })
        .join("");
    } else {
      const starters = [
        `Hi! Thanks for reaching out about the ${swap.current} → ${swap.desired} swap. Happy to share more details.`,
        `I'm a ${swap.craft} with ${formatSeniority(swap.seniority)} seniority. Looking for ${String(swap.swapType || "permanent").toLowerCase()} mutual if the fit is right.`,
      ];
      els.chatBody.innerHTML = starters
        .map(
          (text) =>
            `<div class="chat-msg them">${escapeHtml(text)}<span class="msg-time">${timeNow()}</span></div>`
        )
        .join("");
    }

    setTimeout(() => {
      els.chatBody.scrollTop = els.chatBody.scrollHeight;
      els.dmInput.focus();
      els.dmInput.select();
    }, 80);
  }

  async function sendDm(e) {
    e.preventDefault();
    const text = els.dmInput.value.trim();
    if (!text || !currentDmSwap) return;

    const sendBtn = els.formDm && els.formDm.querySelector('button[type="submit"]');
    setButtonLoading(sendBtn, true);

    appendChatMessage("me", text);
    els.dmInput.value = "";

    const canSaveRemote =
      useSupabase &&
      db() &&
      currentDmSwap.id != null &&
      !String(currentDmSwap.id).startsWith("local-");

    if (canSaveRemote) {
      try {
        console.log("[PostSwap] sendDm: saving to Supabase…", {
          swapId: currentDmSwap.id,
          senderId: user ? user.id : "guest",
        });
        const savedMsg = await db().sendMessage({
          swapId: currentDmSwap.id,
          senderId: user ? user.id : "guest",
          toUser: currentDmSwap.ownerId || currentDmSwap.username || null,
          body: text,
        });
        console.log("[PostSwap] sendDm: saved", savedMsg);

        // Email notification → swap owner (profiles + email_queue)
        if (typeof db().notifyNewDm === "function") {
          try {
            const notify = await db().notifyNewDm({
              swap: currentDmSwap,
              messageBody: text,
              fromUser: user || { id: "guest", name: "A verified carrier" },
            });
            console.log("[PostSwap] sendDm: email notify", notify);
            if (notify && notify.queued > 0) {
              showToast(
                "Email notification queued",
                notify.to
                  ? `DM alert queued for ${notify.to}`
                  : "Owner will be emailed if notifications are on."
              );
            }
          } catch (notifyErr) {
            console.warn("[PostSwap] sendDm: email notify failed", notifyErr);
          }
        }
      } catch (err) {
        console.error("[PostSwap] sendDm: Supabase INSERT failed", {
          message: err && err.message,
          status: err && err.status,
          data: err && err.data,
          error: err,
        });
        showToast(
          "Message sent locally",
          (err && err.message) || "Couldn’t sync to Supabase — check RLS on messages table."
        );
      }
    } else {
      console.log("[PostSwap] sendDm: local-only (no remote swap id)", {
        swapId: currentDmSwap && currentDmSwap.id,
      });
    }

    setButtonLoading(sendBtn, false);

    // Light auto-reply for demo feel when no remote thread yet
    if (!canSaveRemote) {
      setTimeout(() => {
        if (els.modalDm.hidden) return;
        const replies = [
          "Sounds good — I'm free after my route most weekdays. What's your craft and seniority?",
          "Great! Mutual swaps are the way to keep benefits. Want to compare notes on stations next?",
          "Appreciate the message. Happy to walk through details when you're ready.",
        ];
        appendChatMessage("them", replies[Math.floor(Math.random() * replies.length)]);
      }, 900 + Math.random() * 600);
    }
  }

  // ---------- Post swap ----------
  async function handlePost(e) {
    e.preventDefault();
    console.log("[PostSwap] handlePost: form submit");

    const current = $("#post-current").value.trim();
    const desired = $("#post-desired").value.trim();
    const craft = $("#post-craft").value;
    const seniority = parseFloat($("#post-seniority").value);
    const swapType =
      (els.formPost.querySelector('input[name="swapType"]:checked') || {}).value || "Permanent";
    const notes = $("#post-notes").value.trim();

    if (!current || !desired || !craft || Number.isNaN(seniority)) {
      console.warn("[PostSwap] handlePost: validation failed", {
        current,
        desired,
        craft,
        seniority,
      });
      showToast("Missing fields", "Fill in current/desired location, craft, and seniority.");
      return;
    }

    const submitBtn = $("#post-submit-btn");
    setButtonLoading(submitBtn, true);

    const coords = geocodeCurrent(current);
    const region = regionFromLocation(current);
    const draft = {
      current,
      desired,
      craft,
      seniority,
      swapType,
      notes: notes || "Looking for a good mutual match.",
      lat: coords.lat,
      lng: coords.lng,
      region,
      privacyLabel: `Verified Carrier • ${region}`,
      ownerId: user ? user.id : "guest",
      justAdded: true,
    };

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

    swaps.unshift(newSwap);
    setButtonLoading(submitBtn, false);
    closeAllModals();
    els.formPost.reset();
    const permanent = els.formPost.querySelector('input[name="swapType"][value="Permanent"]');
    if (permanent) permanent.checked = true;

    els.filterCity.value = "";
    els.filterCraft.value = "";
    refreshViews();
    activeSwapId = newSwap.id;
    setActiveSwap(newSwap.id);

    if (map) {
      map.flyTo([newSwap.lat, newSwap.lng], 10, { duration: 1 });
    }

    console.log("[PostSwap] handlePost: done", {
      savedRemote,
      id: newSwap.id,
      postError: postError && postError.message,
    });

    showToast(
      savedRemote ? "Swap posted to cloud!" : "Swap posted!",
      user
        ? `You're live, ${user.name.split(" ")[0]}. Check My Swaps anytime.`
        : "Your request is on the map. Login to manage it under My Swaps."
    );

    // Email carriers whose home state matches this listing
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
        console.log("[PostSwap] handlePost: matching-swap emails", matchNotify);
        if (matchNotify && matchNotify.queued > 0) {
          showToast(
            "Match emails queued",
            `${matchNotify.queued} carrier${matchNotify.queued === 1 ? "" : "s"} notified about this area.`
          );
        }
      } catch (notifyErr) {
        console.warn("[PostSwap] handlePost: matching-swap notify failed", notifyErr);
      }
    }

    $("#explore").scrollIntoView({ behavior: "smooth" });
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
      els.inboxRefresh.addEventListener("click", () => loadInboxThreads());
    }
    if (els.inboxThreads) {
      els.inboxThreads.addEventListener("click", (e) => {
        const item = e.target.closest("[data-inbox-swap]");
        if (!item) return;
        selectInboxThread(item.getAttribute("data-inbox-swap"));
      });
    }
    if (els.inboxOpenDm) {
      els.inboxOpenDm.addEventListener("click", () => {
        if (!activeInboxSwapId) return;
        const thread = inboxThreads.find((t) => idEq(t.swapId, activeInboxSwapId));
        const swap =
          (thread && thread.swap) ||
          findSwapById(activeInboxSwapId) || {
            id: activeInboxSwapId,
            current: "Unknown",
            desired: "Unknown",
            craft: "Letter Carrier",
            seniority: 0,
            swapType: "Permanent",
            privacyLabel: "Verified Carrier",
            region: "United States",
            notes: "",
          };
        // If user owns the swap, still allow viewing via DM modal blocked — open read-only via inbox already
        if (user && idEq(swap.ownerId, user.id)) {
          showToast("Your listing", "This is your swap’s thread — reply when carriers message you here.");
          return;
        }
        openDm(swap);
      });
    }
    if (els.mailboxList) {
      els.mailboxList.addEventListener("click", (e) => {
        const item = e.target.closest("[data-mail-id]");
        if (!item) return;
        e.stopPropagation();
        markOneMailRead(item.getAttribute("data-mail-id"));
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

    // Navbar scroll state
    const onScroll = () => {
      els.navbar.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // Filters
    els.filterCity.addEventListener("input", () => {
      activeSwapId = null;
      refreshViews();
    });
    els.filterCraft.addEventListener("change", () => {
      activeSwapId = null;
      refreshViews();
    });
    els.nearMeBtn.addEventListener("click", nearMe);

    // Forms
    els.formPost.addEventListener("submit", handlePost);
    els.formDm.addEventListener("submit", sendDm);
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
      $("#post-current").value = "North Las Vegas, NV";
      showToast("Location set", "Using North Las Vegas, NV for this demo.");
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

    // Demo interest: when clicking I'm Interested on a card, if user has a posted swap
    // and interest emails on, simulate "someone interested" when they message about matching
    document.addEventListener("click", (e) => {
      const dmBtn = e.target.closest("[data-dm-id]");
      if (!dmBtn || !user) return;
      const id = dmBtn.getAttribute("data-dm-id");
      const swap = findSwapById(id);
      if (!swap) return;
      if (idEq(swap.ownerId, user.id)) return;
      if (user.notifications?.emailEnabled && user.notifications.onInterest) {
        const mine = swaps.some((s) => idEq(s.ownerId, user.id));
        if (mine) {
          setTimeout(() => {
            simulateEmailAlert(
              "interest",
              "A verified carrier viewed your listing and may reach out"
            );
          }, 400);
        }
      }
    }, true);
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
