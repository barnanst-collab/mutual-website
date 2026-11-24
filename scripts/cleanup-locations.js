/* PostSwap one-time location cleanup.
   Not loaded by the website. Does not delete or hide swaps.

   Dry-run (default) prints what it would change and writes a report.
   --apply writes only the rows it can fix with confidence.

   PowerShell:
     $env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
     node scripts/cleanup-locations.js
     node scripts/cleanup-locations.js --apply

   The key must be the service_role key from Supabase Project Settings → API.
   Do not use the anon key. Do not commit the key. The script refuses to run
   without SUPABASE_SERVICE_ROLE_KEY, and it refuses a token whose role is anon.

   Optional: $env:SUPABASE_URL = "https://<project>.supabase.co"

   Before --apply, run only the location ALTER block in supabase-schema.sql
   (current_city, current_state, current_zip, desired_city, desired_state,
   desired_zip, lat, lng). Do not run the whole schema file.

   Rows it cannot parse stay unchanged and are listed in
   scripts/location-cleanup-report.json.
*/

"use strict";

const fs = require("fs");
const path = require("path");

require(path.join(__dirname, "..", "geocode.js"));

const geo = global.PostSwapGeocode;
const DEFAULT_URL = "https://olfystbcngdcevtndkdq.supabase.co";
const REPORT_PATH = path.join(__dirname, "location-cleanup-report.json");

function jwtRole(token) {
  const part = String(token || "").split(".")[1] || "";
  if (!part) return "";
  const pad = part.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const json = JSON.parse(Buffer.from(pad, "base64").toString("utf8"));
    return json && json.role ? String(json.role) : "";
  } catch (_) {
    return "";
  }
}

function eqFilter(col, val) {
  const v = String(val);
  if (/[\s,():."']/.test(v)) {
    return col + '=eq."' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return col + "=eq." + encodeURIComponent(v);
}

function sameValue(prev, next) {
  if (typeof next === "number") {
    if (prev == null || prev === "") return false;
    return Math.abs(Number(prev) - next) <= 0.0001;
  }
  const left = prev == null ? "" : String(prev);
  const right = next == null ? "" : String(next);
  return left === right;
}

function assignIfChanged(patch, row, column, value) {
  if (!sameValue(row[column], value)) patch[column] = value;
}

async function lookupZip(zip, cache) {
  if (cache.has(zip)) return cache.get(zip);
  let hit = null;
  try {
    const res = await fetch("https://api.zippopotam.us/us/" + encodeURIComponent(zip));
    if (res.ok) {
      const data = await res.json();
      const places = Array.isArray(data.places) ? data.places : [];
      if (places.length) {
        const city = String(places[0]["place name"] || "").trim();
        const state = String(places[0]["state abbreviation"] || "").trim().toUpperCase();
        const lat = Number(places[0].latitude);
        const lng = Number(places[0].longitude);
        const agreed = places.every(function (place) {
          return (
            String(place["place name"] || "").trim().toLowerCase() === city.toLowerCase() &&
            String(place["state abbreviation"] || "").trim().toUpperCase() === state
          );
        });
        if (agreed && city && state && isFinite(lat) && isFinite(lng)) {
          const listed = geo.lookupCity(city, state);
          hit = listed
            ? {
                city: listed.city,
                state: listed.state,
                lat: listed.lat,
                lng: listed.lng,
                label: listed.label,
              }
            : { city: city, state: state, lat: lat, lng: lng, label: city + ", " + state };
        }
      }
    }
  } catch (_) {
    hit = null;
  }
  cache.set(zip, hit);
  return hit;
}

async function resolveSide(text, cache) {
  const parsed = geo.parseLocation(text);
  if (parsed.kind === "zip") {
    const zipHit = await lookupZip(parsed.zip, cache);
    if (!zipHit) {
      return { ok: false, reason: "zip-unresolved", zip: parsed.zip };
    }
    return {
      ok: true,
      kind: "city",
      city: zipHit.city,
      state: zipHit.state,
      zip: parsed.zip,
      label: zipHit.label,
      lat: zipHit.lat,
      lng: zipHit.lng,
    };
  }
  if (!parsed.ok) return { ok: false, reason: parsed.reason || parsed.kind || "unparsed" };
  return parsed;
}

async function planRow(row, cache) {
  const patch = {};
  const flags = [];
  const current = await resolveSide(row.current_location, cache);
  if (current.ok && current.kind === "city") {
    assignIfChanged(patch, row, "current_city", current.city);
    assignIfChanged(patch, row, "current_state", current.state);
    if (current.zip) assignIfChanged(patch, row, "current_zip", current.zip);
    assignIfChanged(patch, row, "current_location", current.label);
    assignIfChanged(patch, row, "lat", current.lat);
    assignIfChanged(patch, row, "lng", current.lng);
  } else {
    flags.push({
      side: "current",
      reason: current.reason || current.kind || "unparsed",
      text: row.current_location || "",
    });
  }

  const desired = await resolveSide(row.desired_location, cache);
  if (desired.ok && desired.kind === "city") {
    assignIfChanged(patch, row, "desired_city", desired.city);
    assignIfChanged(patch, row, "desired_state", desired.state);
    if (desired.zip) assignIfChanged(patch, row, "desired_zip", desired.zip);
    assignIfChanged(patch, row, "desired_location", desired.label);
  } else if (desired.ok && (desired.kind === "anywhere" || desired.kind === "region")) {
    assignIfChanged(patch, row, "desired_city", null);
    assignIfChanged(patch, row, "desired_state", desired.state || null);
    assignIfChanged(patch, row, "desired_zip", null);
    assignIfChanged(patch, row, "desired_location", desired.label);
  } else {
    flags.push({
      side: "desired",
      reason: desired.reason || desired.kind || "unparsed",
      text: row.desired_location || "",
    });
  }

  return { id: row.id, patch: patch, flags: flags };
}

function authHeaders(key) {
  return {
    apikey: key,
    Authorization: "Bearer " + key,
  };
}

async function fetchAllSwaps(base, key) {
  const rows = [];
  const page = 1000;
  let start = 0;
  for (;;) {
    const res = await fetch(base + "/rest/v1/swaps?select=*&order=id.asc", {
      headers: Object.assign(authHeaders(key), {
        Range: start + "-" + (start + page - 1),
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error("Could not read swaps (" + res.status + "). " + text.slice(0, 240));
    }
    const batch = text ? JSON.parse(text) : [];
    if (!Array.isArray(batch)) throw new Error("Unexpected swaps response.");
    rows.push.apply(rows, batch);
    if (batch.length < page) break;
    start += page;
  }
  return rows;
}

async function columnsReady(base, key) {
  const res = await fetch(base + "/rest/v1/swaps?select=current_city,lat&limit=1", {
    headers: authHeaders(key),
  });
  return res.ok;
}

async function applyPatch(base, key, id, patch) {
  const res = await fetch(base + "/rest/v1/swaps?" + eqFilter("id", id), {
    method: "PATCH",
    headers: Object.assign(authHeaders(key), {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Update failed for id " + id + " (" + res.status + "). " + text.slice(0, 240));
  }
}

async function main() {
  const apply = process.argv.indexOf("--apply") !== -1;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const base = (process.env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/, "");
  if (!key.trim()) {
    console.error("Refusing to run. Set SUPABASE_SERVICE_ROLE_KEY to the service role key.");
    console.error("Dry-run is the default. Add --apply only after you have read the report.");
    process.exit(1);
  }
  const role = jwtRole(key.trim());
  if (role !== "service_role") {
    console.error("Refusing to run. That token’s role is " + (role || "unknown") + ", not service_role.");
    process.exit(1);
  }
  if (!geo || typeof geo.parseLocation !== "function") {
    console.error("City list failed to load from geocode.js.");
    process.exit(1);
  }
  const missing = geo.missingCityStates();
  if (missing.length) {
    console.error("City list is missing a home state for: " + missing.join(", "));
    process.exit(1);
  }

  console.log(apply ? "Applying confident location fixes." : "Dry-run. No rows will be changed.");
  if (apply) {
    const ready = await columnsReady(base, key.trim());
    if (!ready) {
      console.error("Refusing to write. The location columns are not on public.swaps yet.");
      console.error("Run only the location ALTER block in supabase-schema.sql, then try --apply again.");
      process.exit(1);
    }
  }
  const swaps = await fetchAllSwaps(base, key.trim());
  const cache = new Map();
  const report = {
    mode: apply ? "apply" : "dry-run",
    scanned: swaps.length,
    updated: [],
    unchanged: 0,
    flagged: [],
    errors: [],
  };

  for (let i = 0; i < swaps.length; i++) {
    const row = swaps[i];
    const plan = await planRow(row, cache);
    const keys = Object.keys(plan.patch);
    if (!keys.length && !plan.flags.length) {
      report.unchanged += 1;
      continue;
    }
    if (plan.flags.length) {
      report.flagged.push({ id: plan.id, flags: plan.flags, partial: keys });
    }
    if (!keys.length) continue;
    if (!apply) {
      report.updated.push({ id: plan.id, patch: plan.patch, applied: false });
      continue;
    }
    try {
      await applyPatch(base, key.trim(), plan.id, plan.patch);
      report.updated.push({ id: plan.id, patch: plan.patch, applied: true });
    } catch (err) {
      report.errors.push({ id: plan.id, message: err && err.message ? err.message : String(err) });
    }
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log("Scanned: " + report.scanned);
  console.log((apply ? "Updated: " : "Would update: ") + report.updated.length);
  console.log("Already clean: " + report.unchanged);
  console.log("Flagged (left in place): " + report.flagged.length);
  console.log("Errors: " + report.errors.length);
  console.log("Report: " + REPORT_PATH);
  if (!apply) console.log("Nothing was written. Re-run with --apply to save the confident fixes.");
  if (report.errors.length) process.exit(1);
}

if (require.main === module) {
  main().catch(function (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { planRow, jwtRole };
