document.addEventListener("DOMContentLoaded", () => {
  const root = document.documentElement;
  const themeToggle = document.getElementById("themeToggle");
  const themeIcon = document.getElementById("themeIcon");

  function setTheme(theme) {
    root.setAttribute("data-theme", theme);
    const isDark = theme === "dark";
    if (themeIcon) themeIcon.className = isDark ? "bi bi-sun" : "bi bi-moon";
    if (themeToggle) {
      themeToggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
    }
    try {
      localStorage.setItem("submission-theme", theme);
    } catch (_) {
      // Theme still works when browser storage is unavailable.
    }
  }

  let savedTheme = "light";
  try {
    savedTheme = localStorage.getItem("submission-theme") || "light";
  } catch (_) {}
  setTheme(savedTheme === "dark" ? "dark" : "light");

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
  }

  const year = new Date().getFullYear();
  ["currentYear", "footerYear"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.textContent = year;
  });

  const navCollapse = document.getElementById("portfolioNav");
  document.querySelectorAll("#portfolioNav .nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.bootstrap && navCollapse && navCollapse.classList.contains("show")) {
        window.bootstrap.Collapse.getOrCreateInstance(navCollapse).hide();
      }
    });
  });

  const search = document.getElementById("submissionSearch");
  const filterButtons = document.querySelectorAll("[data-filter]");
  const items = Array.from(document.querySelectorAll(".submission-item"));
  const emptyState = document.getElementById("emptyState");
  let activeFilter = "all";

  function filterSubmissions() {
    const query = (search?.value || "").trim().toLowerCase();
    let visibleCount = 0;

    items.forEach((item) => {
      const category = item.dataset.category || "";
      const searchableText = `${item.dataset.search || ""} ${item.textContent || ""}`.toLowerCase();
      const matchesCategory = activeFilter === "all" || category === activeFilter;
      const matchesSearch = !query || searchableText.includes(query);
      const visible = matchesCategory && matchesSearch;
      item.classList.toggle("d-none", !visible);
      if (visible) visibleCount += 1;
    });

    if (emptyState) emptyState.classList.toggle("d-none", visibleCount > 0);
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "all";
      filterButtons.forEach((candidate) => {
        const selected = candidate === button;
        candidate.classList.toggle("active", selected);
        candidate.setAttribute("aria-pressed", String(selected));
      });
      filterSubmissions();
    });
  });

  if (search) search.addEventListener("input", filterSubmissions);

  document.querySelectorAll("[data-placeholder-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (link.getAttribute("href") === "#") {
        event.preventDefault();
        alert("Replace this placeholder with the live URL for your submission.");
      }
    });
  });
});
