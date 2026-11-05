"use strict";

/*
 * GRIDLINE live data layer
 * ------------------------
 * Talks to the free Jolpica F1 API (the maintained successor to Ergast):
 *   https://api.jolpi.ca/ergast/f1/
 * No API key required. Public rate limit is ~4 req/s burst, 200 req/hour, so:
 *   - every poll only asks for the standings (1 request)
 *   - the heavier calls (podiums, poles, last race, next race) are repeated
 *     only when a new round shows up in the standings, or the next race has
 *     started
 *   - the last good response is cached in localStorage
 *
 * Exposes window.GridlineLive.
 */
(function () {
  const BASE = "https://api.jolpi.ca/ergast/f1";
  const CACHE_KEY = "gridline.live.v1";
  const TIMEOUT_MS = 10000;
  const RACE_WINDOW_MS = 3 * 60 * 60 * 1000; // treat a race as "on" for 3h

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getJson(path, attempt = 0) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${BASE}${path}`, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });

      if (res.status === 429 && attempt < 2) {
        await sleep(1500 * (attempt + 1));
        return getJson(path, attempt + 1);
      }

      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      const json = await res.json();
      return json.MRData;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------- endpoints ---------- */

  async function fetchStandings() {
    const mr = await getJson("/current/driverStandings.json?limit=100");
    const list = mr?.StandingsTable?.StandingsLists?.[0];
    if (!list) return null;

    return {
      season: Number(list.season),
      round: Number(list.round),
      standings: (list.DriverStandings || []).map((s) => ({
        driverId: s.Driver?.driverId,
        code: s.Driver?.code || null,
        position: Number(s.position),
        points: Number(s.points),
        wins: Number(s.wins),
      })),
    };
  }

  // Count how many times each driver finished P1/P2/P3 (podiums) in races.
  async function fetchPodiums() {
    const pages = await Promise.all(
      [1, 2, 3].map((p) => getJson(`/current/results/${p}.json?limit=100`)),
    );

    const counts = {};
    pages.forEach((mr) =>
      (mr?.RaceTable?.Races || []).forEach((race) =>
        (race.Results || []).forEach((r) => {
          const id = r.Driver?.driverId;
          if (id) counts[id] = (counts[id] || 0) + 1;
        }),
      ),
    );
    return counts;
  }

  // Qualifying P1 per driver.
  async function fetchPoles() {
    const mr = await getJson("/current/qualifying/1.json?limit=100");
    const counts = {};

    (mr?.RaceTable?.Races || []).forEach((race) =>
      (race.QualifyingResults || []).forEach((q) => {
        const id = q.Driver?.driverId;
        if (id) counts[id] = (counts[id] || 0) + 1;
      }),
    );
    return counts;
  }

  function raceMeta(race) {
    return {
      round: Number(race.round),
      raceName: race.raceName,
      circuit: race.Circuit?.circuitName || "",
      locality: race.Circuit?.Location?.locality || "",
      country: race.Circuit?.Location?.country || "",
      // Jolpica gives UTC date + time ("Z"); time can be missing for old data
      startsAt: race.date
        ? `${race.date}T${race.time || "12:00:00Z"}`
        : null,
    };
  }

  async function fetchLastRace() {
    const mr = await getJson("/current/last/results.json?limit=30");
    const race = mr?.RaceTable?.Races?.[0];
    if (!race) return null;

    return {
      ...raceMeta(race),
      results: (race.Results || []).map((r) => ({
        position: r.positionText || r.position,
        driverId: r.Driver?.driverId,
        code: r.Driver?.code || null,
        name: `${r.Driver?.givenName || ""} ${r.Driver?.familyName || ""}`.trim(),
        team: r.Constructor?.name || "",
        grid: Number(r.grid),
        time: r.Time?.time || r.status || "",
        points: Number(r.points),
        fastest: r.FastestLap?.rank === "1",
      })),
    };
  }

  const SESSION_KEYS = [
    ["FirstPractice", "FP1"],
    ["SecondPractice", "FP2"],
    ["ThirdPractice", "FP3"],
    ["SprintQualifying", "SPRINT QUALI"],
    ["SprintShootout", "SPRINT QUALI"],
    ["Sprint", "SPRINT"],
    ["Qualifying", "QUALIFYING"],
  ];

  async function fetchNextRace() {
    const mr = await getJson("/current/next.json");
    const race = mr?.RaceTable?.Races?.[0];
    if (!race) return null;

    const sessions = SESSION_KEYS.filter(([key]) => race[key]?.date).map(
      ([key, label]) => ({
        label,
        startsAt: `${race[key].date}T${race[key].time || "12:00:00Z"}`,
      }),
    );

    sessions.push({ label: "RACE", startsAt: raceMeta(race).startsAt });
    sessions.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

    return { ...raceMeta(race), sessions };
  }

  /* ---------- cache ---------- */

  function readCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      return raw && raw.standings ? raw : null;
    } catch {
      return null;
    }
  }

  function writeCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      /* storage full / blocked: not fatal */
    }
  }

  /* ---------- public refresh ---------- */

  const settled = (p, fallback) => p.catch((e) => {
    console.warn("[GridlineLive]", e.message);
    return fallback;
  });

  /**
   * Fetch fresh data. Pass the previous result so cheap polls can reuse the
   * heavy parts. Throws if even the standings call fails.
   */
  async function refresh(prev = null) {
    const base = await fetchStandings();

    if (!base) {
      // season hasn't produced standings yet
      throw new Error("No standings published yet");
    }

    const newRound = !prev || prev.round !== base.round;
    const nextStarted =
      prev?.next?.startsAt &&
      Date.now() > new Date(prev.next.startsAt).getTime() + RACE_WINDOW_MS;

    const deep = newRound || nextStarted || !prev?.podiums || !prev?.poles;

    let { podiums = null, poles = null, last = null, next = null } = prev || {};

    if (deep) {
      [podiums, poles, last, next] = await Promise.all([
        settled(fetchPodiums(), prev?.podiums ?? null),
        settled(fetchPoles(), prev?.poles ?? null),
        settled(fetchLastRace(), prev?.last ?? null),
        settled(fetchNextRace(), null),
      ]);
    }

    const data = {
      season: base.season,
      round: base.round,
      standings: base.standings,
      podiums,
      poles,
      last,
      next,
      fetchedAt: Date.now(),
    };

    writeCache(data);
    return data;
  }

  window.GridlineLive = { refresh, readCache };
})();
