"use strict";

/* ==========================================================================
   GRIDLINE — live season data layer
   Source: Jolpica F1 API (open Ergast-compatible data, CORS enabled)
   https://api.jolpi.ca/ergast/f1/current/...

   Strategy
   - Every POLL_SECONDS we make ONE cheap request (driver standings).
   - Only when the standings changed (new race result) do we run a full sync
     (podiums, poles, latest race, calendar) — 7 requests total.
   - The last good payload is cached in localStorage, so the page paints
     instantly and still works offline.
   ========================================================================== */

const GridlineLive = (() => {
  const API = "https://api.jolpi.ca/ergast/f1/current";
  const CACHE_KEY = "gridline.live.v2";
  const TIMEOUT_MS = 12000;
  const RACE_WINDOW_MS = 4 * 60 * 60 * 1000; // poll faster around race time

  let pollSeconds = 60;
  let onData = () => {};
  let onStatus = () => {};
  let timer = null;
  let running = false;
  let busy = false;
  let current = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ---------- tiny fetch helper with timeout + one retry on 429/5xx ---------- */
  async function getJSON(path, attempt = 0) {
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${API}${path}`, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" }
      });

      if ((res.status === 429 || res.status >= 500) && attempt < 1) {
        await sleep(1500);
        return getJSON(path, attempt + 1);
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = await res.json();
      return body.MRData;
    } finally {
      clearTimeout(kill);
    }
  }

  /* ---------- parsers ---------- */
  function parseStandings(md) {
    const list = md?.StandingsTable?.StandingsLists?.[0];
    if (!list) throw new Error("No standings available yet");

    const standings = {};
    (list.DriverStandings || []).forEach((row) => {
      standings[row.Driver.driverId] = {
        position: Number(row.position),
        points: Number(row.points),
        wins: Number(row.wins),
        number: row.Driver.permanentNumber || null,
        code: row.Driver.code || null,
        family: row.Driver.familyName || null
      };
    });

    return {
      season: Number(list.season),
      round: Number(list.round),
      standings
    };
  }

  function countFinishes(md, resultsKey) {
    const tally = {};
    (md?.RaceTable?.Races || []).forEach((race) => {
      const first = race[resultsKey]?.[0];
      const id = first?.Driver?.driverId;
      if (id) tally[id] = (tally[id] || 0) + 1;
    });
    return tally;
  }

  function mergeTallies(...tallies) {
    const total = {};
    tallies.forEach((tally) => {
      Object.entries(tally).forEach(([id, n]) => {
        total[id] = (total[id] || 0) + n;
      });
    });
    return total;
  }

  function parseLastRace(md) {
    const race = md?.RaceTable?.Races?.[0];
    if (!race) return null;

    const results = {};
    (race.Results || []).forEach((r) => {
      results[r.Driver.driverId] = {
        position: Number(r.position),
        grid: Number(r.grid),
        points: Number(r.points),
        status: r.status || ""
      };
    });

    return {
      round: Number(race.round),
      name: race.raceName,
      circuit: race.Circuit?.circuitName || "",
      date: race.date,
      results
    };
  }

  function parseSchedule(md) {
    return (md?.RaceTable?.Races || []).map((race) => ({
      round: Number(race.round),
      name: race.raceName,
      locality: race.Circuit?.Location?.locality || "",
      country: race.Circuit?.Location?.country || "",
      start: new Date(`${race.date}T${race.time || "13:00:00Z"}`).toISOString()
    }));
  }

  /* ---------- sync ---------- */
  function signature(standings) {
    return Object.entries(standings)
      .map(([id, s]) => `${id}:${s.points}`)
      .sort()
      .join("|");
  }

  async function fullSync(prefetchedStandings) {
    const prev = current || {};

    // Batch 1 (<= 4 requests keeps us inside the API's burst limit)
    const [standingsMd, scheduleRes, lastRes] = await Promise.allSettled([
      prefetchedStandings ? Promise.resolve(prefetchedStandings) : getJSON("/driverStandings.json"),
      getJSON(".json?limit=100"),
      getJSON("/last/results.json?limit=100")
    ]);

    if (standingsMd.status !== "fulfilled") throw standingsMd.reason;
    const base = parseStandings(standingsMd.value);

    await sleep(450);

    // Batch 2: podium finishes (P1/P2/P3) and pole positions
    const [p1, p2, p3, poles] = await Promise.allSettled([
      getJSON("/results/1.json?limit=100"),
      getJSON("/results/2.json?limit=100"),
      getJSON("/results/3.json?limit=100"),
      getJSON("/qualifying/1.json?limit=100")
    ]);

    const podiumsOk = [p1, p2, p3].every((r) => r.status === "fulfilled");

    const podiums = podiumsOk
      ? mergeTallies(
          countFinishes(p1.value, "Results"),
          countFinishes(p2.value, "Results"),
          countFinishes(p3.value, "Results")
        )
      : prev.podiums || null;

    const polesTally = poles.status === "fulfilled"
      ? countFinishes(poles.value, "QualifyingResults")
      : prev.poles || null;

    const schedule = scheduleRes.status === "fulfilled"
      ? parseSchedule(scheduleRes.value)
      : prev.schedule || [];

    const lastRace = lastRes.status === "fulfilled"
      ? parseLastRace(lastRes.value)
      : prev.lastRace || null;

    return {
      fetchedAt: Date.now(),
      season: base.season,
      round: base.round,
      totalRounds: schedule.length || prev.totalRounds || null,
      standings: base.standings,
      podiums,
      poles: polesTally,
      lastRace,
      schedule
    };
  }

  function save(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (_) { /* storage may be unavailable — fine */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  /* One poll cycle. force=true always runs the full sync (manual refresh). */
  async function poll(force = false) {
    if (busy) return;
    busy = true;
    onStatus("syncing", current);

    try {
      const standingsMd = await getJSON("/driverStandings.json");
      const parsed = parseStandings(standingsMd);

      const changed =
        force ||
        !current ||
        parsed.round !== current.round ||
        signature(parsed.standings) !== signature(current.standings);

      if (changed) {
        current = await fullSync(standingsMd);
        save(current);
        onData(current, { changed: true });
      } else {
        current = { ...current, fetchedAt: Date.now() };
        save(current);
        onData(current, { changed: false });
      }

      onStatus("live", current);
    } catch (error) {
      console.warn("Live sync failed:", error);
      onStatus(current ? "offline" : "error", current, error);
    } finally {
      busy = false;
    }
  }

  function nextDelay() {
    const now = Date.now();
    const raceNear = (current?.schedule || []).some((race) => {
      const start = new Date(race.start).getTime();
      return now >= start - 30 * 60 * 1000 && now <= start + RACE_WINDOW_MS;
    });
    return (raceNear ? Math.min(pollSeconds, 30) : pollSeconds) * 1000;
  }

  function loop() {
    clearTimeout(timer);
    if (!running) return;

    timer = setTimeout(async () => {
      if (!document.hidden) await poll(false);
      loop();
    }, nextDelay());
  }

  /* ---------- public API ---------- */
  return {
    start(options = {}) {
      onData = options.onData || onData;
      onStatus = options.onStatus || onStatus;
      pollSeconds = Math.max(15, Number(options.pollSeconds) || 60);

      running = true;

      current = load();
      if (current) {
        onData(current, { changed: false, cached: true });
        onStatus("cached", current);
      }

      poll(false).then(loop);

      // Catch up immediately when the tab becomes visible after a while.
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && running) {
          const age = Date.now() - (current?.fetchedAt || 0);
          if (age > 30000) poll(false).then(loop);
        }
      });
    },

    async refresh() {
      await poll(true);
      loop();
    },

    stop() {
      running = false;
      clearTimeout(timer);
    }
  };
})();
