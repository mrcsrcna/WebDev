"use strict";

/* ==========================================================================
   GRIDLINE — UI logic
   Data:   drivers.json (profiles, images, fallback stats)
   Live:   live.js      (season stats from the Jolpica F1 API)
   ========================================================================== */

const TRANSITION_MS = 350;
const LOADER_MIN_MS = 1100;          // let the start-lights play out
const PHOTO_LABELS = ["Car", "Driver", "Helmet"];

let allDrivers = [];
let activeDriver = 0;
let activePhoto = 0;
let isAnimating = false;

let filterTeam = "ALL";
let sortMode = "grid";               // "grid" | "points"
let liveData = null;                 // latest payload from live.js
let liveStatus = "connecting";

const $ = (id) => document.getElementById(id);

const loader = $("loader");
const bgGlow = $("bg-glow");
const photoStrip = $("photo-strip");
const centerShowcase = $("center-showcase");
const centerImg = $("center-img");
const centerMedia = $("center-media");
const rightPanel = $("right-panel");
const otherGrid = $("other-grid");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */
function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function displayStat(value) {
  return value === null || value === undefined || value === ""
    ? "—"
    : escHtml(value);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, "0");

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function applyAccent(hex) {
  const color = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#E10600";
  const [r, g, b] = hexToRgb(color);
  const root = document.documentElement.style;

  root.setProperty("--accent", color);
  root.setProperty("--accent-glow", `rgba(${r},${g},${b},.3)`);
  root.setProperty("--accent-glow-strong", `rgba(${r},${g},${b},.55)`);

  bgGlow.style.background = `
    radial-gradient(ellipse at 38% 45%,
      rgba(${r},${g},${b},.15) 0%, transparent 55%),
    radial-gradient(ellipse at 72% 35%,
      rgba(${r},${g},${b},.07) 0%, transparent 50%)
  `;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = "#07090c";
}

function flash(el) {
  if (!el || reducedMotion) return;
  el.classList.remove("flash");
  void el.offsetWidth;             // restart the animation
  el.classList.add("flash");
}

/* Live value first, then the fallback value from drivers.json */
function statOf(driver, key) {
  const live = driver.live?.[key];
  if (live !== null && live !== undefined) return live;
  return driver.stats?.[key] ?? null;
}

function pointsOf(driver) {
  return statOf(driver, "points");
}

function positionOf(driver) {
  return statOf(driver, "position");
}

function leaderPoints() {
  return allDrivers.reduce((max, d) => Math.max(max, Number(pointsOf(d)) || 0), 0);
}

function teammateOf(driver) {
  return allDrivers.find((d) => d.team === driver.team && d.id !== driver.id) || null;
}

/* Animated number: counts from the previous value (or `from`) to the new one */
function setStat(id, value, { from = null, prefix = "" } = {}) {
  const el = $(id);

  if (value === null || value === undefined || value === "") {
    cancelAnimationFrame(el._raf);
    el.textContent = "—";
    delete el.dataset.val;
    return;
  }

  const end = Number(value);
  const start = from !== null
    ? from
    : el.dataset.val !== undefined ? Number(el.dataset.val) : 0;

  el.dataset.val = end;
  cancelAnimationFrame(el._raf);

  if (reducedMotion || start === end) {
    el.textContent = `${prefix}${end}`;
    return;
  }

  const t0 = performance.now();
  const duration = 650;

  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);

    el.textContent = p < 1
      ? `${prefix}${Math.round(start + (end - start) * eased)}`
      : `${prefix}${end}`;

    if (p < 1) el._raf = requestAnimationFrame(step);
  };

  el._raf = requestAnimationFrame(step);
}

/* --------------------------------------------------------------------------
   Images — every photo lives inside the same landscape .media frame
   -------------------------------------------------------------------------- */
function imageSources(driver, order) {
  return order
    .map((i) => ({
      src: driver.images[i],
      focus: driver.focus?.[i] || ""
    }))
    .filter((item) => item.src);
}

/* Loads the first source that works; otherwise shows the "photo pending"
   placeholder (which prints the file name you need to add). */
function bindMedia(media, sources) {
  const img = media.querySelector("img");
  let n = 0;

  const useNext = () => {
    if (n >= sources.length) {
      media.classList.add("is-missing");
      media.dataset.file = sources[0]?.src || "no image set";
      img.removeAttribute("src");
      return;
    }

    const { src, focus } = sources[n++];

    if (focus) media.style.setProperty("--focus", focus);
    else media.style.removeProperty("--focus");

    img.src = src;
  };

  img.onload = () => media.classList.remove("is-missing");
  img.onerror = useNext;

  media.classList.remove("is-missing");
  useNext();
}

function setImage(img, src, alt) {
  const media = img.closest(".media");
  img.alt = alt;

  if (!src) {
    media.classList.add("is-missing");
    media.dataset.file = "no image set";
    img.removeAttribute("src");
    return;
  }

  const driver = allDrivers[activeDriver];
  const focus = driver?.focus?.[activePhoto] || "";

  bindMedia(media, [{ src, focus }]);
}

function renderPhotos(driver) {
  photoStrip.innerHTML = driver.images.map((src, i) => `
    <button
      class="photo-thumb${i === activePhoto ? " active" : ""}"
      data-pi="${i}"
      type="button"
      aria-label="${escHtml(PHOTO_LABELS[i])} view of ${escHtml(driver.name)}"
      title="${escHtml(PHOTO_LABELS[i])}">
      <span class="media">
        <img alt="${escHtml(PHOTO_LABELS[i])}" loading="lazy" draggable="false">
      </span>
    </button>
  `).join("");

  photoStrip.querySelectorAll(".photo-thumb").forEach((button) => {
    const i = Number(button.dataset.pi);
    bindMedia(button.querySelector(".media"), imageSources(driver, [i]));

    button.addEventListener("click", () => switchPhoto(i));
  });
}

function showPhoto() {
  const driver = allDrivers[activeDriver];

  setImage(
    centerImg,
    driver.images[activePhoto],
    `${driver.name} — ${PHOTO_LABELS[activePhoto]}`
  );

  $("image-category").textContent =
    `${PHOTO_LABELS[activePhoto]} VIEW`.toUpperCase();

  photoStrip.querySelectorAll(".photo-thumb").forEach((button, i) => {
    button.classList.toggle("active", i === activePhoto);
  });
}

function switchPhoto(index) {
  const driver = allDrivers[activeDriver];

  if (!driver || index === activePhoto || isAnimating) return;
  if (!driver.images[index]) return;

  activePhoto = index;
  centerShowcase.classList.add("fading");

  window.setTimeout(() => {
    showPhoto();
    centerShowcase.classList.remove("fading");
  }, reducedMotion ? 0 : TRANSITION_MS);
}

function cyclePhoto(direction = 1) {
  const count = PHOTO_LABELS.length;
  switchPhoto((activePhoto + direction + count) % count);
}

/* --------------------------------------------------------------------------
   Right panel: profile + stats
   -------------------------------------------------------------------------- */
function isClassified(status) {
  return status === "Finished" || /^\+\d+ Laps?$/.test(status || "");
}

function renderLastRace(driver) {
  const race = liveData?.lastRace;
  const result = driver.live?.last;

  if (!race || !result) {
    $("stat-last-label").textContent = "LATEST RACE";
    $("stat-last").textContent = "—";
    $("stat-last-sub").textContent = race ? "Did not take part" : "Awaiting result";
    return;
  }

  const short = race.name.replace(/ Grand Prix$/i, " GP");
  const finished = isClassified(result.status);
  const grid = result.grid > 0 ? `Grid P${result.grid}` : "Pit-lane start";

  $("stat-last-label").textContent = `R${race.round} · ${short}`.toUpperCase();
  $("stat-last").textContent = finished ? `P${result.position}` : "DNF";
  $("stat-last-sub").textContent = finished
    ? `${grid} · +${result.points} pts`
    : `${result.status} · ${grid}`;
}

function renderGap(driver) {
  const pts = Number(pointsOf(driver));
  const leader = leaderPoints();
  const el = $("stat-gap");

  if (!Number.isFinite(pts) || leader === 0) {
    el.textContent = "Season total";
  } else if (pts === leader) {
    el.textContent = "Championship leader";
  } else {
    el.textContent = `−${leader - pts} to leader`;
  }
}

function renderTeammate(driver) {
  const card = $("teammate-card");
  const mate = teammateOf(driver);
  const mine = Number(pointsOf(driver));
  const theirs = mate ? Number(pointsOf(mate)) : NaN;

  if (!mate || !Number.isFinite(mine) || !Number.isFinite(theirs)) {
    card.hidden = true;
    return;
  }

  card.hidden = false;

  const side = (d, pts) =>
    `<b>${escHtml(pts)}</b><small>${escHtml(d.code || d.name.split(" ").pop())}</small>`;

  $("battle-me").innerHTML = side(driver, mine);
  $("battle-mate").innerHTML = side(mate, theirs);
  $("battle-mate").setAttribute("aria-label", `View ${mate.name}`);
  $("battle-mate").title = `View ${mate.name}`;
  $("battle-mate").dataset.id = mate.id;

  const total = mine + theirs;
  $("battle-me-bar").style.width = `${total === 0 ? 50 : (mine / total) * 100}%`;
}

function renderStatsChip() {
  const chip = $("stats-live-chip");
  chip.classList.remove("is-fallback", "is-cached");

  if (liveStatus === "live" || liveStatus === "syncing" && liveData) {
    chip.textContent = liveData?.round ? `LIVE · R${liveData.round}` : "LIVE";
  } else if (liveData) {
    chip.textContent = "CACHED";
    chip.classList.add("is-cached");
  } else {
    chip.textContent = "SNAPSHOT";
    chip.classList.add("is-fallback");
  }
}

function renderStats(driver, { fromZero = false, changed = null } = {}) {
  const from = fromZero ? 0 : null;

  const pos = positionOf(driver);
  setStat("stat-position", pos, {
    from: pos === null ? null : Number(pos),   // rank never counts up from 0
    prefix: "P"
  });
  setStat("stat-points", pointsOf(driver), { from });
  setStat("stat-wins", statOf(driver, "wins"), { from });
  setStat("stat-podiums", statOf(driver, "podiums"), { from });
  setStat("stat-poles", statOf(driver, "poles"), { from });

  $("stats-season").textContent = driver.season || "2026";

  renderGap(driver);
  renderLastRace(driver);
  renderTeammate(driver);
  renderStatsChip();

  $("stats-note").textContent = driver.live
    ? `Live data from the Jolpica F1 API · after Round ${liveData?.round ?? "—"}. Updates automatically.`
    : driver.stats_note || "Statistics are editable in drivers.json.";

  if (changed) {
    const map = {
      position: "stat-position",
      points: "stat-points",
      wins: "stat-wins",
      podiums: "stat-podiums",
      poles: "stat-poles"
    };

    Object.entries(map).forEach(([key, id]) => {
      if (changed.includes(key)) flash($(id).closest(".stat-card"));
    });
  }
}

function renderDriver() {
  const driver = allDrivers[activeDriver];
  if (!driver) return;

  applyAccent(driver.accent_color);

  showPhoto();

  $("driver-number").textContent = `#${driver.number ?? "—"}`;
  $("car-caption").textContent = driver.car || "2026 F1 Car";

  $("team-name").textContent = driver.team || "TEAM";
  $("driver-name").textContent = driver.name;
  $("driver-meta").textContent =
    `${driver.nationality || "Nationality unavailable"} · #${driver.number ?? "—"}`;

  $("driver-bio").textContent =
    driver.bio || "Driver profile information coming soon.";

  const social = $("driver-social");
  const validLink = /^https?:\/\//i.test(driver.profile_url || "");

  social.href = validLink ? driver.profile_url : "#";
  social.style.display = validLink ? "inline-flex" : "none";

  renderPhotos(driver);
  renderStats(driver, { fromZero: true });
  updateCounter();
  markActive();
}

/* --------------------------------------------------------------------------
   Lineup ("Explore the grid"): filter, sort, cards
   -------------------------------------------------------------------------- */
function visibleDrivers() {
  const list = allDrivers.filter(
    (d) => filterTeam === "ALL" || d.team === filterTeam
  );

  if (sortMode === "points") {
    list.sort((a, b) => {
      const pa = Number(pointsOf(a));
      const pb = Number(pointsOf(b));
      const va = Number.isFinite(pa) ? pa : -1;
      const vb = Number.isFinite(pb) ? pb : -1;
      return vb - va || allDrivers.indexOf(a) - allDrivers.indexOf(b);
    });
  }

  return list;
}

function buildFilters() {
  const teams = [];
  allDrivers.forEach((d) => {
    if (!teams.find((t) => t.name === d.team)) {
      teams.push({ name: d.team, color: d.accent_color });
    }
  });

  const chips = [{ name: "ALL", color: "#ffffff" }, ...teams];

  $("team-filters").innerHTML = chips.map((t) => `
    <button type="button"
            class="chip${t.name === filterTeam ? " active" : ""}"
            data-team="${escHtml(t.name)}">
      <i></i>${escHtml(t.name)}
    </button>
  `).join("");

  $("team-filters").querySelectorAll(".chip").forEach((chip, i) => {
    chip.style.setProperty("--team", chips[i].color);
  });
}

function renderOtherDrivers({ animate = true } = {}) {
  const list = visibleDrivers();

  $("driver-count").textContent = list.length === allDrivers.length
    ? `${allDrivers.length} DRIVERS`
    : `${list.length} OF ${allDrivers.length} DRIVERS`;

  otherGrid.classList.toggle("no-anim", !animate);

  if (!list.length) {
    otherGrid.innerHTML = `<p class="grid-empty">No drivers match this filter.</p>`;
    return;
  }

  otherGrid.innerHTML = list.map((driver, n) => {
    const pos = positionOf(driver);
    const pts = pointsOf(driver);

    return `
      <button
        class="other-thumb${driver.id === allDrivers[activeDriver]?.id ? " active" : ""}"
        type="button"
        data-id="${escHtml(driver.id)}"
        style="--i:${n}"
        aria-label="View ${escHtml(driver.name)}"
        title="${escHtml(driver.name)}">

        <span class="media thumb-media">
          <img alt="${escHtml(driver.name)}" loading="lazy" draggable="false">
          ${pos ? `<span class="thumb-pos">P${escHtml(pos)}</span>` : ""}
          <span class="thumb-num">${escHtml(driver.number ?? "")}</span>
        </span>

        <span class="thumb-info">
          <span class="thumb-team">${escHtml(driver.team)}</span>
          <span class="thumb-name">${escHtml(driver.name)}</span>
          <span class="thumb-points">${displayStat(pts)} PTS</span>
        </span>
      </button>
    `;
  }).join("");

  otherGrid.querySelectorAll(".other-thumb").forEach((button) => {
    const driver = allDrivers.find((d) => d.id === button.dataset.id);

    // helmet shot first (as before), then the other two, then the placeholder
    bindMedia(button.querySelector(".media"), imageSources(driver, [2, 0, 1]));
    button.style.setProperty("--team", driver.accent_color || "#e10600");

    button.addEventListener("click", () => switchDriver(indexOfId(driver.id), true));
  });

  attachTilt(otherGrid.querySelectorAll(".other-thumb"));
}

function indexOfId(id) {
  return allDrivers.findIndex((d) => d.id === id);
}

/* Highlight the active driver everywhere (cards, ticker, counter) */
function markActive() {
  const id = allDrivers[activeDriver]?.id;

  otherGrid.querySelectorAll(".other-thumb").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });

  document.querySelectorAll(".ticker-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

function updateCounter() {
  const id = allDrivers[activeDriver]?.id;
  let list = visibleDrivers();
  let idx = list.findIndex((d) => d.id === id);

  if (idx === -1) {
    list = allDrivers;
    idx = activeDriver;
  }

  $("frame-counter").textContent = `${pad2(idx + 1)} / ${pad2(list.length)}`;
}

async function switchDriver(index, fromLineup = false) {
  if (isAnimating || index === activeDriver) return;
  if (index < 0 || index >= allDrivers.length) return;

  isAnimating = true;

  const clicked = otherGrid.querySelector(`[data-id="${allDrivers[index].id}"]`);
  if (clicked) clicked.classList.add("loading");

  centerShowcase.classList.add("fading");
  rightPanel.classList.add("fading");

  // From the lineup, bring the showcase back into view
  if (fromLineup) {
    const top = $("showcase").getBoundingClientRect().top;
    if (top < 0) {
      $("showcase").scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start"
      });
    }
  }

  await sleep(reducedMotion ? 0 : TRANSITION_MS);

  activeDriver = index;
  activePhoto = 0;

  renderDriver();

  if (clicked) clicked.classList.remove("loading");

  centerShowcase.classList.remove("fading");
  rightPanel.classList.remove("fading");

  isAnimating = false;
}

function stepDriver(direction) {
  const list = visibleDrivers();
  if (!list.length) return;

  const id = allDrivers[activeDriver].id;
  const idx = list.findIndex((d) => d.id === id);
  const next = list[(idx + direction + list.length) % list.length];

  switchDriver(indexOfId(next.id));
}

/* --------------------------------------------------------------------------
   Ticker (championship order)
   -------------------------------------------------------------------------- */
function renderTicker() {
  const ranked = allDrivers
    .filter((d) => positionOf(d) !== null)
    .sort((a, b) => Number(positionOf(a)) - Number(positionOf(b)));

  const wrap = $("ticker-wrap");

  if (!ranked.length) {
    wrap.hidden = true;
    return;
  }

  const items = (hidden) => ranked.map((d) => `
    <button type="button" class="ticker-item" data-id="${escHtml(d.id)}"
            ${hidden ? 'tabindex="-1" aria-hidden="true"' : ""}>
      <span class="t-pos">P${escHtml(positionOf(d))}</span>
      <span class="t-bar" data-color="${escHtml(d.accent_color)}"></span>
      <span>${escHtml(d.code || d.name.split(" ").pop().toUpperCase())}</span>
      <span class="t-pts">${displayStat(pointsOf(d))}</span>
    </button>
  `).join("");

  const track = $("ticker-track");
  track.innerHTML = items(false) + items(true);
  track.style.animationDuration = `${Math.max(30, ranked.length * 3.4)}s`;

  track.querySelectorAll(".ticker-item").forEach((el) => {
    const bar = el.querySelector(".t-bar");
    el.style.setProperty("--team", bar.dataset.color || "#e10600");

    el.addEventListener("click", () => {
      switchDriver(indexOfId(el.dataset.id));
    });
  });

  wrap.hidden = false;
  markActive();
}

/* --------------------------------------------------------------------------
   Live data: merge, status, countdown, toasts
   -------------------------------------------------------------------------- */
function toast(title, message) {
  const stack = $("toast-stack");
  const el = document.createElement("div");

  el.className = "toast";
  el.innerHTML = `<b>${escHtml(title)}</b>${escHtml(message)}`;
  stack.appendChild(el);

  window.setTimeout(() => {
    el.classList.add("out");
    window.setTimeout(() => el.remove(), 320);
  }, 7000);

  while (stack.children.length > 3) stack.firstChild.remove();
}

function applyLive(data, meta = {}) {
  const hadLive = allDrivers.some((d) => d.live);
  const previousRound = liveData?.round;
  const changedByDriver = new Map();
  const gains = [];

  liveData = data;

  allDrivers.forEach((driver) => {
    const id = driver.api_id || driver.id;
    const s = data.standings?.[id];
    const prev = driver.live;

    driver.live = s
      ? {
          position: s.position,
          points: s.points,
          wins: s.wins,
          podiums: data.podiums ? data.podiums[id] ?? 0 : null,
          poles: data.poles ? data.poles[id] ?? 0 : null,
          last: data.lastRace?.results?.[id] || null
        }
      : null;

    if (prev && driver.live) {
      const diff = ["position", "points", "wins", "podiums", "poles"]
        .filter((k) => prev[k] !== driver.live[k]);

      if (diff.length) changedByDriver.set(driver.id, diff);

      const gained = driver.live.points - prev.points;
      if (gained > 0) gains.push({ driver, gained });
    }
  });

  // Rebuild what depends on the numbers
  renderTicker();

  const needsGrid = sortMode === "points" || !hadLive || changedByDriver.size > 0;
  if (needsGrid) renderOtherDrivers({ animate: false });

  const active = allDrivers[activeDriver];
  if (active) {
    renderStats(active, {
      changed: changedByDriver.get(active.id) || null
    });
  }

  updateCounter();
  renderSeasonBar();
  renderRaceBlock();

  // Highlight cards that moved
  changedByDriver.forEach((_, id) => {
    flash(otherGrid.querySelector(`[data-id="${id}"]`));
  });

  // Announce genuinely new results (not the first paint, not an unchanged poll)
  if (hadLive && meta.changed && changedByDriver.size) {
    gains.sort((a, b) => b.gained - a.gained);

    const top = gains
      .slice(0, 3)
      .map((g) => `${g.driver.code || g.driver.name} +${g.gained}`)
      .join(" · ");

    const round = data.round !== previousRound ? `Round ${data.round} is in. ` : "";
    toast("LIVE UPDATE", `${round}${top || "Standings updated"}`);
  }
}

function formatClock(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function onLiveStatus(status, data) {
  liveStatus = status;

  const pill = $("live-pill");
  const text = $("live-pill-text");
  const refresh = $("live-refresh");

  pill.classList.remove("is-syncing", "is-offline", "is-cached");
  refresh.classList.toggle("spinning", status === "syncing");

  const labels = {
    connecting: ["CONNECTING", "is-syncing"],
    syncing: ["SYNCING", "is-syncing"],
    live: ["LIVE", ""],
    cached: ["CACHED", "is-cached"],
    offline: ["OFFLINE", "is-offline"],
    error: ["NO LIVE DATA", "is-offline"]
  };

  const [label, cls] = labels[status] || labels.connecting;
  text.textContent = label;
  if (cls) pill.classList.add(cls);

  if (status === "error") {
    $("live-updated").textContent = "Showing built-in snapshot";
  }

  renderStatsChip();
  tickClock();

  if (data && status === "live") renderSeasonBar();
}

function renderSeasonBar() {
  if (!liveData) return;

  const { round, totalRounds } = liveData;

  $("live-round").textContent = totalRounds
    ? `ROUND ${round} / ${totalRounds}`
    : `ROUND ${round}`;

  $("season-progress-text").textContent = totalRounds
    ? `${round} of ${totalRounds} races`
    : `${round} races`;

  $("season-progress-bar").style.width = totalRounds
    ? `${Math.min(100, (round / totalRounds) * 100)}%`
    : "0";
}

/* Next race / lights-out elapsed */
function raceState(now = Date.now()) {
  const schedule = liveData?.schedule || [];
  const RACE_LENGTH = 3 * 60 * 60 * 1000;

  const racing = schedule.find((r) => {
    const start = new Date(r.start).getTime();
    return now >= start && now < start + RACE_LENGTH;
  });

  if (racing) return { type: "racing", race: racing };

  const next = schedule.find((r) => new Date(r.start).getTime() > now);
  if (next) return { type: "next", race: next };

  return { type: schedule.length ? "done" : "none" };
}

function renderRaceBlock() {
  const state = raceState();
  const label = $("next-race-label");
  const name = $("next-race-name");

  $("next-race-countdown").classList.toggle("is-racing", state.type === "racing");

  if (state.type === "racing") {
    label.textContent = "LIGHTS OUT · ELAPSED";
    name.textContent = state.race.name;
  } else if (state.type === "next") {
    label.textContent = `NEXT RACE · ROUND ${state.race.round}`;
    name.textContent = state.race.name;
    name.title = new Date(state.race.start).toLocaleString([], {
      dateStyle: "full",
      timeStyle: "short"
    });
  } else if (state.type === "done") {
    label.textContent = "SEASON";
    name.textContent = "Season complete";
  } else {
    label.textContent = "NEXT RACE";
    name.textContent = "Schedule unavailable";
  }
}

function tickClock() {
  const now = Date.now();
  const state = raceState(now);
  const countdown = $("next-race-countdown");

  let ms = null;
  if (state.type === "next") ms = new Date(state.race.start).getTime() - now;
  if (state.type === "racing") ms = now - new Date(state.race.start).getTime();

  const units = { d: "--", h: "--", m: "--", s: "--" };

  if (ms !== null) {
    const total = Math.floor(ms / 1000);
    units.d = pad2(total / 86400);
    units.h = pad2((total % 86400) / 3600);
    units.m = pad2((total % 3600) / 60);
    units.s = pad2(total % 60);
  }

  Object.entries(units).forEach(([unit, value]) => {
    const el = countdown.querySelector(`[data-unit="${unit}"]`);
    if (el && el.textContent !== value) el.textContent = value;
  });

  // Roll over automatically at lights-out / chequered flag
  if (liveData && state.type !== tickClock.last) {
    tickClock.last = state.type;
    renderRaceBlock();
  }

  // "Updated 12s ago"
  if (liveData?.fetchedAt && liveStatus !== "error") {
    const secs = Math.max(0, Math.round((now - liveData.fetchedAt) / 1000));
    const ago = secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
    const prefix = liveStatus === "offline" ? "Offline · last sync" : "Updated";
    $("live-updated").textContent = `${prefix} ${ago} · ${formatClock(liveData.fetchedAt)}`;
  }
}

/* --------------------------------------------------------------------------
   Interaction: tilt / parallax, swipe, keyboard, filters
   -------------------------------------------------------------------------- */
function attachTilt(elements) {
  if (reducedMotion) return;

  elements.forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;

      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;

      el.style.transform =
        `perspective(700px) translateY(-4px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg)`;
    });

    el.addEventListener("pointerleave", () => {
      el.style.transform = "";
    });
  });
}

function bindEvents() {
  // Main frame: parallax + click/swipe to change photo
  const frame = document.querySelector(".center-frame");
  let startX = null;
  let swiped = false;

  frame.addEventListener("pointermove", (e) => {
    if (reducedMotion || e.pointerType !== "mouse") return;

    const r = frame.getBoundingClientRect();
    centerMedia.style.setProperty("--px", `${(-((e.clientX - r.left) / r.width - 0.5) * 16).toFixed(1)}px`);
    centerMedia.style.setProperty("--py", `${(-((e.clientY - r.top) / r.height - 0.5) * 10).toFixed(1)}px`);
  });

  frame.addEventListener("pointerleave", () => {
    centerMedia.style.setProperty("--px", "0px");
    centerMedia.style.setProperty("--py", "0px");
  });

  frame.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
    swiped = false;
  });

  frame.addEventListener("pointerup", (e) => {
    if (startX === null) return;

    const dx = e.clientX - startX;
    startX = null;

    if (Math.abs(dx) > 45) {
      swiped = true;
      cyclePhoto(dx < 0 ? 1 : -1);
    }
  });

  frame.addEventListener("click", () => {
    if (swiped) {
      swiped = false;
      return;
    }
    cyclePhoto(1);
  });

  $("prev-driver").addEventListener("click", (e) => {
    e.stopPropagation();
    stepDriver(-1);
  });

  $("next-driver").addEventListener("click", (e) => {
    e.stopPropagation();
    stepDriver(1);
  });

  // Teammate battle: jump to the teammate
  $("battle-mate").addEventListener("click", (e) => {
    const id = e.currentTarget.dataset.id;
    if (id) switchDriver(indexOfId(id));
  });

  // Team filters
  $("team-filters").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;

    filterTeam = chip.dataset.team;

    $("team-filters").querySelectorAll(".chip").forEach((c) => {
      c.classList.toggle("active", c === chip);
    });

    renderOtherDrivers();
    updateCounter();
  });

  // Sort toggle
  document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      sortMode = btn.dataset.sort;

      document.querySelectorAll(".sort-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });

      renderOtherDrivers();
      updateCounter();
    });
  });

  // Manual refresh
  $("live-refresh").addEventListener("click", () => GridlineLive.refresh());

  // Keyboard
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      stepDriver(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepDriver(-1);
    } else if (["1", "2", "3"].includes(e.key)) {
      switchPhoto(Number(e.key) - 1);
    } else if (e.key === "r" || e.key === "R") {
      GridlineLive.refresh();
    }
  });
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */
async function init() {
  try {
    const started = performance.now();
    const response = await fetch("drivers.json");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data.drivers) || data.drivers.length === 0) {
      throw new Error("No drivers found in drivers.json");
    }

    allDrivers = data.drivers.map((driver) => ({
      ...driver,
      live: null,
      images: [
        driver.images?.[0] || "",
        driver.images?.[1] || "",
        driver.images?.[2] || ""
      ]
    }));

    $("series-title").textContent = data.title || "GRIDLINE";

    buildFilters();
    bindEvents();
    renderDriver();
    renderOtherDrivers();
    renderTicker();

    const wait = LOADER_MIN_MS - (performance.now() - started);
    if (wait > 0 && !reducedMotion) await sleep(wait);

    loader.classList.add("gone");
    window.setTimeout(() => loader.remove(), 500);

    window.setInterval(tickClock, 1000);

    if (data.live?.enabled !== false) {
      GridlineLive.start({
        pollSeconds: data.live?.poll_seconds,
        onData: applyLive,
        onStatus: onLiveStatus
      });
    } else {
      onLiveStatus("error", null);
    }
  } catch (error) {
    console.error("Failed to load drivers.json:", error);

    loader.classList.add("error");
    loader.innerHTML = `
      <i class="bi bi-exclamation-triangle" style="font-size:2rem;color:#f44444"></i>
      <span>FAILED TO LOAD DRIVERS</span>
      <small>${escHtml(error.message)}<br>
        Open this project through a local server (e.g. VS Code “Live Server”),
        not by double-clicking index.html.</small>`;
  }
}

init();
