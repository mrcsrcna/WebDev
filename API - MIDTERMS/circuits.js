"use strict";
/* THE CIRCUITS: one entry per 2026 race, data in circuits.json.
   Track outlines are schematic, not survey-accurate. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let list = [], active = 0;

  function smooth(str) {
    const p = str.split(" ").map((s) => s.split(",").map(Number)), n = p.length;
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n], e = p[(i + 2) % n];
      d += `C${(b[0] + (c[0] - a[0]) / 6).toFixed(1)},${(b[1] + (c[1] - a[1]) / 6).toFixed(1)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(1)},${(c[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c[0]},${c[1]}`;
    }
    return d + "Z";
  }

  function raceTag(c) {
    const re = new RegExp(c.match, "i");
    const hit = (r) => r && re.test(`${r.circuit} ${r.locality}`);
    if (typeof liveData !== "undefined" && liveData) {
      if (hit(liveData.next)) return "NEXT";
      if (hit(liveData.last)) return "LAST";
    }
    return "";
  }

  function renderNav() {
    $("circuit-nav").innerHTML = list.map((c, i) => {
      const t = raceTag(c);
      return `<button type="button" class="cn-item${i === active ? " active" : ""}" data-i="${i}" aria-pressed="${i === active}">
        <span class="cn-round">R${String(c.round).padStart(2, "0")}</span>
        <span class="cn-name">${esc(c.flag)} ${esc(c.country)}</span>
        ${t ? `<span class="cn-tag">${t}</span>` : ""}</button>`;
    }).join("");
  }

  function stat(label, val, unit = "") {
    return `<div class="cs-stat"><span>${label}</span><strong>${val}${unit ? `<small>${unit}</small>` : ""}</strong></div>`;
  }

  function renderDetail() {
    const c = list[active], d = smooth(c.pts);
    const dist = (c.laps * c.km).toFixed(3);
    const t = raceTag(c);
    $("circuit-detail").innerHTML = `
      <header class="cd-head">
        <span class="cd-flag">${esc(c.flag)}</span>
        <div><p class="mini-label">ROUND ${c.round}${t ? ` · ${t} RACE` : ""}</p><h3>${esc(c.name)}</h3></div>
      </header>
      <div class="cd-body">
        <svg class="cd-map" viewBox="0 0 100 100" role="img" aria-label="Schematic outline of ${esc(c.name)}">
          <path d="${d}" class="trk-base" />
          <path d="${d}" class="trk s1" pathLength="100" stroke-dasharray="33.3 66.7" stroke-dashoffset="0" />
          <path d="${d}" class="trk s2" pathLength="100" stroke-dasharray="33.3 66.7" stroke-dashoffset="-33.3" />
          <path d="${d}" class="trk s3" pathLength="100" stroke-dasharray="33.4 66.6" stroke-dashoffset="-66.6" />
          <circle class="sf" cx="${c.pts.split(" ")[0].split(",")[0]}" cy="${c.pts.split(" ")[0].split(",")[1]}" r="2.2" />
        </svg>
        <div class="cd-stats">
          ${stat("First Grand Prix", c.first)}
          ${stat("Number of laps", c.laps)}
          ${stat("Circuit length", c.km.toFixed(3), "km")}
          ${stat("Race distance", dist, "km")}
          <div class="cs-stat cs-wide"><span>Lap record</span><strong>${c.record ? esc(c.record) : "To be set"}</strong>
          <em>${c.record ? `${esc(c.holder)}, ${c.year}` : "New for 2026"}</em></div>
          <p class="cd-key"><i class="s1"></i>Sector 1 <i class="s2"></i>Sector 2 <i class="s3"></i>Sector 3</p>
        </div>
      </div>`;
  }

  function select(i) {
    active = (i + list.length) % list.length;
    renderNav(); renderDetail();
    $("circuit-nav").querySelector(".active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  async function init() {
    const sec = $("circuits");
    if (!sec) return;
    try {
      list = (await (await fetch("circuits.json")).json()).circuits;
      const now = list.findIndex((c) => raceTag(c) === "NEXT");
      active = now > -1 ? now : 0;
      renderNav(); renderDetail();
      $("circuit-nav").addEventListener("click", (e) => {
        const b = e.target.closest(".cn-item");
        if (b) select(Number(b.dataset.i));
      });
      $("circuit-prev").addEventListener("click", () => select(active - 1));
      $("circuit-next").addEventListener("click", () => select(active + 1));
      setInterval(renderNav, 5000); // pick up live next/last race tags
    } catch (e) {
      console.warn("circuits.json failed", e);
      sec.hidden = true;
    }
  }
  init();
})();
