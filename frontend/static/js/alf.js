/* Shared client helpers: config, API calls, auth, WebSocket, small DOM utils. */
const ALF = (() => {
  const config = window.ALF_CONFIG || {};
  const API_BASE = String(config.apiBase || "").replace(/\/$/, "");
  const WS_BASE = API_BASE
    ? API_BASE.replace(/^http/, "ws")
    : window.location.origin.replace(/^http/, "ws");

  const DEV_KEY = "alf_dev";
  const DEVICE_KEY = "alf_device_id";
  const PARTICIPANT_PREFIX = "alf_participant_";
  const ANSWERS_PREFIX = "alf_answers_";
  const THEME_KEY = "alf_theme";

  const CAT_RUNNER_SVG = `
    <svg viewBox="0 0 80 48" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M18 20c-7 0-12 4-15 10 4-2 8-2 11 0 2-4 6-6 11-6Z"/>
      <ellipse cx="38" cy="28" rx="22" ry="11" fill="currentColor"/>
      <circle cx="61" cy="21" r="10" fill="currentColor"/>
      <path fill="currentColor" d="m53 14-2-9 8 5Zm10-3 5-7 2 9Z"/>
      <path fill="currentColor" d="m49 32-2 12 8-9Zm-15 3-2 11 7-9Zm-15-3-5 11 10-8Z"/>
      <circle cx="65" cy="19" r="1.6" fill="#fff"/>
    </svg>`;

  const SUN_ICON = `
    <svg class="icon theme-icon theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>`;

  const MOON_ICON = `
    <svg class="icon theme-icon theme-icon-moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>
    </svg>`;

  let appConfig = null;
  let supabase = null;

  function apiUrl(path) {
    return `${API_BASE}/api${path}`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Impossible de charger ${src}`));
      document.head.append(script);
    });
  }

  async function getConfig() {
    if (appConfig) return appConfig;

    const response = await fetch(apiUrl("/config"));
    if (!response.ok) throw new Error("Configuration indisponible.");
    appConfig = await response.json();

    if (!appConfig.dev_mode) {
      if (!appConfig.supabase_url || !appConfig.supabase_anon_key) {
        throw new Error("Supabase n'est pas configuré côté serveur.");
      }
      await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
      supabase = window.supabase.createClient(
        appConfig.supabase_url,
        appConfig.supabase_anon_key,
      );
    }
    return appConfig;
  }

  async function token() {
    const settings = await getConfig();
    if (settings.dev_mode) {
      return localStorage.getItem(DEV_KEY) ? "dev" : null;
    }
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function api(path, options = {}) {
    const { method = "GET", body, auth = true } = options;
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";

    if (auth) {
      const value = await token();
      if (value) headers.Authorization = `Bearer ${value}`;
    }

    const response = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 && auth) {
      clearAuth();
      window.location.href = "login.html";
      throw new Error("Authentification requise.");
    }

    if (!response.ok) {
      let message = `Erreur ${response.status}`;
      try {
        const data = await response.json();
        if (typeof data.detail === "string") message = data.detail;
        else if (Array.isArray(data.detail)) {
          message = data.detail.map((entry) => entry.msg).join(", ");
        }
      } catch {
        /* keep the default message */
      }
      throw new Error(message);
    }

    if (response.status === 204) return null;
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
  }

  async function download(path, filename) {
    const value = await token();
    const headers = {};
    if (value) headers.Authorization = `Bearer ${value}`;
    const response = await fetch(apiUrl(path), { headers });
    if (!response.ok) throw new Error(`Erreur ${response.status}`);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function login(email, password) {
    const settings = await getConfig();
    if (settings.dev_mode) {
      localStorage.setItem(DEV_KEY, "1");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }

  async function signup(email, password) {
    const settings = await getConfig();
    if (settings.dev_mode) {
      localStorage.setItem(DEV_KEY, "1");
      return { needsConfirmation: false };
    }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    return { needsConfirmation: !data.session };
  }

  async function logout() {
    const settings = await getConfig().catch(() => null);
    if (settings && !settings.dev_mode && supabase) {
      await supabase.auth.signOut();
    }
    clearAuth();
    window.location.href = "index.html";
  }

  function clearAuth() {
    localStorage.removeItem(DEV_KEY);
  }

  async function requireAuth() {
    const value = await token();
    if (!value) {
      window.location.href = "login.html";
      throw new Error("Authentification requise.");
    }
  }

  async function connect(code, onMessage) {
    let settings = null;
    try {
      settings = await getConfig();
    } catch {
      /* fall back to the backend WebSocket */
    }
    const base = String(settings?.realtime_url || WS_BASE)
      .replace(/\/$/, "")
      .replace(/^http/, "ws");
    const socket = new WebSocket(`${base}/ws/${encodeURIComponent(code.toUpperCase())}`);
    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        /* ignore malformed messages */
      }
    };
    return socket;
  }

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function getParticipant(code) {
    try {
      return JSON.parse(localStorage.getItem(`${PARTICIPANT_PREFIX}${code.toUpperCase()}`) || "null");
    } catch {
      return null;
    }
  }

  function setParticipant(code, participant) {
    localStorage.setItem(`${PARTICIPANT_PREFIX}${code.toUpperCase()}`, JSON.stringify(participant));
  }

  function getAnswers(code) {
    try {
      return JSON.parse(localStorage.getItem(`${ANSWERS_PREFIX}${code.toUpperCase()}`) || "{}");
    } catch {
      return {};
    }
  }

  function setAnswers(code, answers) {
    localStorage.setItem(`${ANSWERS_PREFIX}${code.toUpperCase()}`, JSON.stringify(answers));
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2), value);
      } else if (key === "dataset") Object.assign(node.dataset, value);
      else node.setAttribute(key, value);
    }

    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function toast(message, timeout = 2600) {
    const node = el("div", { class: "toast" }, message);
    document.body.append(node);
    window.setTimeout(() => node.remove(), timeout);
  }

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  }

  function formatDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  function showError(target, error) {
    target.textContent = error instanceof Error ? error.message : String(error);
    target.classList.remove("hidden");
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  }

  function updateThemeButtons() {
    const dark = currentTheme() === "dark";
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      button.setAttribute(
        "aria-label",
        dark ? "Activer le mode clair" : "Activer le mode sombre",
      );
      button.setAttribute("aria-pressed", String(dark));
      button.title = dark ? "Mode clair" : "Mode sombre";
    });
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
    updateThemeButtons();
  }

  function setupThemeToggle() {
    const host =
      document.querySelector(".topbar nav") ||
      document.querySelector(".topbar .row") ||
      document.querySelector(".topbar");
    if (!host || host.querySelector(".theme-toggle")) return;

    const button = el("button", {
      class: "btn icon-link theme-toggle",
      type: "button",
      "aria-label": "Activer le mode sombre",
      title: "Mode sombre",
    });
    button.innerHTML = `${SUN_ICON}${MOON_ICON}`;
    button.addEventListener("click", () => {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
    host.append(button);
    updateThemeButtons();
  }

  function setupCatRunner() {
    if (document.body.classList.contains("embed-mode")) return;
    if (document.querySelector(".cat-runner")) return;

    const runner = el("div", { class: "cat-runner", "aria-hidden": "true" });
    runner.append(el("div", { class: "cat-runner-cat", html: CAT_RUNNER_SVG }));
    document.body.append(runner);
    document.body.classList.add("has-cat-runner");
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  onReady(() => {
    setupThemeToggle();
    setupCatRunner();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_KEY) return;
    const theme = event.newValue === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    updateThemeButtons();
  });

  return {
    API_BASE,
    WS_BASE,
    api,
    download,
    login,
    signup,
    logout,
    token,
    getConfig,
    requireAuth,
    connect,
    getDeviceId,
    getParticipant,
    setParticipant,
    getAnswers,
    setAnswers,
    el,
    clear,
    toast,
    escapeHtml,
    formatDate,
    showError,
  };
})();
