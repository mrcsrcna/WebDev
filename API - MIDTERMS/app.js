"use strict";

const TRANSITION_MS = 350;
const LOADER_MIN_MS = 1100;
const PHOTO_LABELS = ["Car", "Driver", "Helmet"];

let allDrivers = [];
let activeDriver = 0;
let activePhoto = 0;
let isAnimating = false;

let filterTeam = "ALL";
let sortMode = "grid"; // "grid" | "points"

let currentPage = 1;
const DRIVERS_PER_PAGE = 8;

const $ = (id) => document.getElementById(id);

const loader = $("loader");
const bgGlow = $("bg-glow");
const photoStrip = $("photo-strip");
const centerShowcase = $("center-showcase");
const centerImg = $("center-img");
const centerMedia = $("center-media");
const rightPanel = $("right-panel");
const otherGrid = $("other-grid");

const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

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

/* Stats come straight from drivers.json */
function statOf(driver, key) {
  return driver.stats?.[key] ?? null;
}

function pointsOf(driver) {
  return statOf(driver, "points");
}

function positionOf(driver) {
  return statOf(driver, "position");
}

function leaderPoints() {
  return allDrivers.reduce(
    (max, d) => Math.max(max, Number(pointsOf(d)) || 0),
    0,
  );
}

function teammateOf(driver) {
  return (
    allDrivers.find((d) => d.team === driver.team && d.id !== driver.id) || null
  );
}

function setStat(id, value, { from = null, prefix = "" } = {}) {
  const el = $(id);

  if (value === null || value === undefined || value === "") {
    cancelAnimationFrame(el._raf);
    el.textContent = "—";
    delete el.dataset.val;
    return;
  }

  const end = Number(value);
  const start =
    from !== null
      ? from
      : el.dataset.val !== undefined
        ? Number(el.dataset.val)
        : 0;

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

    el.textContent =
      p < 1
        ? `${prefix}${Math.round(start + (end - start) * eased)}`
        : `${prefix}${end}`;

    if (p < 1) el._raf = requestAnimationFrame(step);
  };

  el._raf = requestAnimationFrame(step);
}

function imageSources(driver, order) {
  return order
    .map((i) => ({
      src: driver.images[i],
      focus: driver.focus?.[i] || "",
    }))
    .filter((item) => item.src);
}

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
  photoStrip.innerHTML = driver.images
    .map(
      (src, i) => `
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
  `,
    )
    .join("");

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
    `${driver.name} — ${PHOTO_LABELS[activePhoto]}`,
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

  window.setTimeout(
    () => {
      showPhoto();
      centerShowcase.classList.remove("fading");
    },
    reducedMotion ? 0 : TRANSITION_MS,
  );
}

function cyclePhoto(direction = 1) {
  const count = PHOTO_LABELS.length;
  switchPhoto((activePhoto + direction + count) % count);
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
  $("battle-me-bar").style.width =
    `${total === 0 ? 50 : (mine / total) * 100}%`;
}

function renderStats(driver, { fromZero = false } = {}) {
  const from = fromZero ? 0 : null;

  const pos = positionOf(driver);
  setStat("stat-position", pos, {
    from: pos === null ? null : Number(pos), // rank never counts up from 0
    prefix: "P",
  });
  setStat("stat-points", pointsOf(driver), { from });
  setStat("stat-wins", statOf(driver, "wins"), { from });
  setStat("stat-podiums", statOf(driver, "podiums"), { from });
  setStat("stat-poles", statOf(driver, "poles"), { from });

  $("stats-season").textContent = driver.season || "2026";

  renderGap(driver);
  renderTeammate(driver);
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

function visibleDrivers() {
  const list = allDrivers.filter(
    (d) => filterTeam === "ALL" || d.team === filterTeam,
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

  $("team-filters").innerHTML = chips
    .map(
      (t) => `
    <button type="button"
            class="chip${t.name === filterTeam ? " active" : ""}"
            data-team="${escHtml(t.name)}">
      <i></i>${escHtml(t.name)}
    </button>
  `,
    )
    .join("");

  $("team-filters")
    .querySelectorAll(".chip")
    .forEach((chip, i) => {
      chip.style.setProperty("--team", chips[i].color);
    });
}

function renderOtherDrivers({ animate = true } = {}) {
  const list = visibleDrivers();
  const totalPages = Math.max(1, Math.ceil(list.length / DRIVERS_PER_PAGE));

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIdx = (currentPage - 1) * DRIVERS_PER_PAGE;
  const pageList = list.slice(startIdx, startIdx + DRIVERS_PER_PAGE);

  if (list.length > 0) {
    const rangeStart = startIdx + 1;
    const rangeEnd = startIdx + pageList.length;
    $("driver-count").textContent =
      list.length === allDrivers.length
        ? `${rangeStart}–${rangeEnd} OF ${allDrivers.length} DRIVERS`
        : `${rangeStart}–${rangeEnd} OF ${list.length} DRIVERS`;
  } else {
    $("driver-count").textContent = "0 DRIVERS";
  }

  updatePagination(totalPages);

  otherGrid.classList.toggle("no-anim", !animate);

  if (!pageList.length) {
    otherGrid.innerHTML = `<p class="grid-empty">No drivers match this filter.</p>`;
    return;
  }

  otherGrid.innerHTML = pageList
    .map((driver, n) => {
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
    })
    .join("");

  otherGrid.querySelectorAll(".other-thumb").forEach((button) => {
    const driver = allDrivers.find((d) => d.id === button.dataset.id);

    // helmet shot first (as before), then the other two, then the placeholder
    bindMedia(button.querySelector(".media"), imageSources(driver, [2, 0, 1]));
    button.style.setProperty("--team", driver.accent_color || "#e10600");

    button.addEventListener("click", () =>
      switchDriver(indexOfId(driver.id), true),
    );
  });

  attachTilt(otherGrid.querySelectorAll(".other-thumb"));
}

function updatePagination(totalPages) {
  const el = $("page-indicator");
  if (el) el.textContent = `${pad2(currentPage)} / ${pad2(totalPages)}`;

  const pagination = $("grid-pagination");
  if (pagination) pagination.hidden = totalPages <= 1;
}

function prevPage() {
  const list = visibleDrivers();
  const totalPages = Math.max(1, Math.ceil(list.length / DRIVERS_PER_PAGE));
  currentPage -= 1;
  if (currentPage < 1) currentPage = totalPages;
  renderOtherDrivers();
  updateCounter();
}

function nextPage() {
  const list = visibleDrivers();
  const totalPages = Math.max(1, Math.ceil(list.length / DRIVERS_PER_PAGE));
  currentPage += 1;
  if (currentPage > totalPages) currentPage = 1;
  renderOtherDrivers();
  updateCounter();
}

function indexOfId(id) {
  return allDrivers.findIndex((d) => d.id === id);
}

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

  const clicked = otherGrid.querySelector(
    `[data-id="${allDrivers[index].id}"]`,
  );
  if (clicked) clicked.classList.add("loading");

  centerShowcase.classList.add("fading");
  rightPanel.classList.add("fading");

  if (fromLineup) {
    const top = $("showcase").getBoundingClientRect().top;
    if (top < 0) {
      $("showcase").scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
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

function renderTicker() {
  const ranked = allDrivers
    .filter((d) => positionOf(d) !== null)
    .sort((a, b) => Number(positionOf(a)) - Number(positionOf(b)));

  const wrap = $("ticker-wrap");

  if (!ranked.length) {
    wrap.hidden = true;
    return;
  }

  const items = (hidden) =>
    ranked
      .map(
        (d) => `
    <button type="button" class="ticker-item" data-id="${escHtml(d.id)}"
            ${hidden ? 'tabindex="-1" aria-hidden="true"' : ""}>
      <span class="t-pos">P${escHtml(positionOf(d))}</span>
      <span class="t-bar" data-color="${escHtml(d.accent_color)}"></span>
      <span>${escHtml(d.code || d.name.split(" ").pop().toUpperCase())}</span>
      <span class="t-pts">${displayStat(pointsOf(d))}</span>
    </button>
  `,
      )
      .join("");

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

function attachTilt(elements) {
  if (reducedMotion) return;

  elements.forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;

      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;

      el.style.transform = `perspective(700px) translateY(-4px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg)`;
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
    centerMedia.style.setProperty(
      "--px",
      `${(-((e.clientX - r.left) / r.width - 0.5) * 16).toFixed(1)}px`,
    );
    centerMedia.style.setProperty(
      "--py",
      `${(-((e.clientY - r.top) / r.height - 0.5) * 10).toFixed(1)}px`,
    );
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

  $("battle-mate").addEventListener("click", (e) => {
    const id = e.currentTarget.dataset.id;
    if (id) switchDriver(indexOfId(id));
  });

  $("team-filters").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;

    filterTeam = chip.dataset.team;
    currentPage = 1;

    $("team-filters")
      .querySelectorAll(".chip")
      .forEach((c) => {
        c.classList.toggle("active", c === chip);
      });

    renderOtherDrivers();
    updateCounter();
  });

  document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      sortMode = btn.dataset.sort;
      currentPage = 1;

      document.querySelectorAll(".sort-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });

      renderOtherDrivers();
      updateCounter();
    });
  });

  $("prev-page").addEventListener("click", (e) => {
    e.preventDefault();
    prevPage();
  });

  $("next-page").addEventListener("click", (e) => {
    e.preventDefault();
    nextPage();
  });

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
    }
  });
}


/* ------------------------------------------------------------------
   LIVE DATA (Jolpica F1 API via live.js)
   Snapshot in drivers.json is the fallback; live values replace it.
------------------------------------------------------------------- */

let liveCfg = { enabled: false, poll_seconds: 60 };
let liveData = null;
let liveSignature = "";
let liveTimer = null;
let liveBusy = false;
let countdownTimer = null;

function driverForLive(entry) {
  return (
    allDrivers.find((d) => d.api_id && d.api_id === entry.driverId) ||
    allDrivers.find((d) => d.code && d.code === entry.code) ||
    null
  );
}

function driverByResult(r) {
  return driverForLive(r) || null;
}

/* Merge live numbers into allDrivers. Returns true if anything changed. */
function applyLive(live) {
  const sig = JSON.stringify([
    live.season,
    live.round,
    live.standings,
    live.podiums,
    live.poles,
    live.last?.round,
    live.next?.round,
  ]);

  liveData = live;
  if (sig === liveSignature) return false;
  liveSignature = sig;

  live.standings.forEach((entry) => {
    const d = driverForLive(entry);
    if (!d) return;

    d.stats = {
      ...d.stats,
      position: entry.position,
      points: entry.points,
      wins: entry.wins,
      podiums: live.podiums ? (live.podiums[entry.driverId] ?? 0) : d.stats?.podiums ?? null,
      poles: live.poles ? (live.poles[entry.driverId] ?? 0) : d.stats?.poles ?? null,
    };
    d.season = live.season;
    d.stats_note = `Live data · after round ${live.round}`;
  });

  return true;
}

function fmtWhen(iso, opts) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBC";
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

function renderRaceCentre() {
  const next = $("next-race");
  const last = $("last-race");
  const live = liveData;

  /* ---- next race ---- */
  if (live?.next) {
    const n = live.next;
    next.innerHTML = `
      <p class="mini-label">NEXT RACE · ROUND ${escHtml(n.round)}</p>
      <h3 class="rc-title">${escHtml(n.raceName)}</h3>
      <p class="rc-sub">${escHtml(n.circuit)} · ${escHtml(n.locality)}, ${escHtml(n.country)}</p>
      <div class="rc-countdown" id="next-countdown" data-t="${escHtml(n.startsAt)}">—</div>
      <ul class="rc-sessions">
        ${(n.sessions || [])
          .map(
            (s) => `
          <li data-t="${escHtml(s.startsAt)}">
            <span>${escHtml(s.label)}</span>
            <time datetime="${escHtml(s.startsAt)}">${escHtml(
              fmtWhen(s.startsAt, {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
            )}</time>
          </li>`,
          )
          .join("")}
      </ul>`;
    tickCountdown();
  } else {
    next.innerHTML = `
      <p class="mini-label">NEXT RACE</p>
      <p class="rc-empty">${
        live ? "No upcoming race on the calendar." : "Waiting for live schedule…"
      }</p>`;
  }

  /* ---- last race ---- */
  if (live?.last?.results?.length) {
    const l = live.last;
    last.innerHTML = `
      <p class="mini-label">LAST RACE · ROUND ${escHtml(l.round)}</p>
      <h3 class="rc-title">${escHtml(l.raceName)}</h3>
      <p class="rc-sub">${escHtml(l.circuit)} · ${escHtml(
        fmtWhen(l.startsAt, { day: "numeric", month: "long", year: "numeric" }),
      )}</p>
      <ol class="rc-results">
        ${l.results
          .slice(0, 10)
          .map((r) => {
            const d = driverByResult(r);
            const moved = Number.isFinite(r.grid) && r.grid > 0 ? r.grid - Number(r.position) : 0;
            return `
          <li>
            <button type="button" class="rc-row" ${
              d ? `data-id="${escHtml(d.id)}"` : "disabled"
            } style="--team:${escHtml(d?.accent_color || "#e10600")}">
              <span class="rc-pos">${escHtml(r.position)}</span>
              <span class="rc-bar"></span>
              <span class="rc-name">${escHtml(r.name)}${
                r.fastest ? ' <i class="bi bi-stopwatch" title="Fastest lap"></i>' : ""
              }</span>
              <span class="rc-team">${escHtml(r.team)}</span>
              <span class="rc-time">${escHtml(r.time)}</span>
              <span class="rc-pts">+${escHtml(r.points)}</span>
            </button>
          </li>`;
          })
          .join("")}
      </ol>`;
  } else {
    last.innerHTML = `
      <p class="mini-label">LAST RACE</p>
      <p class="rc-empty">${
        live ? "No race results yet this season." : "Waiting for live results…"
      }</p>`;
  }
}

function tickCountdown() {
  const el = $("next-countdown");
  if (!el) return;

  const ms = new Date(el.dataset.t).getTime() - Date.now();

  if (!Number.isFinite(ms)) {
    el.textContent = "TBC";
  } else if (ms <= 0) {
    el.textContent = ms > -3 * 3600 * 1000 ? "LIGHTS OUT · RACE ON" : "AWAITING RESULT";
    el.classList.add("is-on");
  } else {
    const s = Math.floor(ms / 1000);
    const cell = (n, l) => `<span><b>${pad2(n)}</b><small>${l}</small></span>`;
    el.classList.remove("is-on");
    el.innerHTML =
      cell(Math.floor(s / 86400), "DAYS") +
      cell(Math.floor((s % 86400) / 3600), "HRS") +
      cell(Math.floor((s % 3600) / 60), "MIN") +
      cell(s % 60, "SEC");
  }

  // highlight the session that is currently next
  const items = [...document.querySelectorAll(".rc-sessions li")];
  const upcoming = items.find((li) => new Date(li.dataset.t) > Date.now());
  items.forEach((li) => {
    li.classList.toggle("past", new Date(li.dataset.t) <= Date.now());
    li.classList.toggle("is-next", li === upcoming);
  });
}

function setLiveStatus(state, text) {
  const el = $("live-status");
  el.dataset.state = state; // live | cached | offline | loading
  $("live-status-text").textContent = text;
}

function liveLabel(prefix) {
  const t = liveData?.fetchedAt
    ? fmtWhen(liveData.fetchedAt, { hour: "2-digit", minute: "2-digit" })
    : "";
  return `${prefix} · ROUND ${liveData?.round ?? "—"}${t ? ` · ${t}` : ""}`;
}

function repaintLive(first = false) {
  const active = allDrivers[activeDriver];
  if (!active) return;

  renderStats(active, { fromZero: false });
  buildFilters();
  renderOtherDrivers({ animate: false });
  renderTicker();
  updateCounter();
  renderRaceCentre();

  $("footer-round").textContent = `LIVE DATA · AFTER ROUND ${liveData.round}`;
  if (!first) markActive();
}

async function pollLive() {
  if (liveBusy || !window.GridlineLive) return;
  liveBusy = true;

  try {
    const fresh = await window.GridlineLive.refresh(liveData);
    const changed = applyLive(fresh);

    if (changed) repaintLive();
    setLiveStatus("live", liveLabel("LIVE"));
  } catch (error) {
    console.warn("Live data unavailable:", error);

    if (liveData) {
      setLiveStatus("cached", liveLabel("CACHED"));
    } else {
      setLiveStatus("offline", "OFFLINE · SEASON SNAPSHOT");
      renderRaceCentre();
    }
  } finally {
    liveBusy = false;
  }
}

function startLive(cfg) {
  liveCfg = { enabled: true, poll_seconds: 60, ...(cfg || {}) };
  if (!liveCfg.enabled || !window.GridlineLive) {
    $("race-centre").hidden = true;
    return;
  }

  // paint from cache first for an instant, non-blank Race Centre
  const cached = window.GridlineLive.readCache();
  if (cached) {
    applyLive(cached);
    repaintLive(true);
    setLiveStatus("cached", liveLabel("CACHED"));
  } else {
    setLiveStatus("loading", "CONNECTING");
    renderRaceCentre();
  }

  pollLive();

  const every = Math.max(30, Number(liveCfg.poll_seconds) || 60) * 1000;
  liveTimer = window.setInterval(() => {
    if (!document.hidden) pollLive();
  }, every);

  countdownTimer = window.setInterval(() => {
    if (!document.hidden) tickCountdown();
  }, 1000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      tickCountdown();
      pollLive();
    }
  });

  $("last-race").addEventListener("click", (e) => {
    const row = e.target.closest(".rc-row[data-id]");
    if (row) switchDriver(indexOfId(row.dataset.id), true);
  });
}

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
      images: [
        driver.images?.[0] || "",
        driver.images?.[1] || "",
        driver.images?.[2] || "",
      ],
    }));

    $("series-title").textContent = data.title || "GRIDLINE";

    // show cached live numbers on the very first paint (no snapshot flash)
    if (data.live?.enabled !== false && window.GridlineLive) {
      const cached = window.GridlineLive.readCache();
      if (cached) applyLive(cached);
    }

    buildFilters();
    bindEvents();
    renderDriver();
    renderOtherDrivers();
    renderTicker();

    startLive(data.live);

    const wait = LOADER_MIN_MS - (performance.now() - started);
    if (wait > 0 && !reducedMotion) await sleep(wait);

    loader.classList.add("gone");
    window.setTimeout(() => loader.remove(), 500);
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