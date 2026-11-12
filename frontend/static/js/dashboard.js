const list = document.getElementById("sessions");
const errorBox = document.getElementById("error");
const createForm = document.getElementById("create-form");

let sessions = [];

function statusLabel(status) {
  return { draft: "brouillon", live: "en direct", closed: "terminée" }[status] || status;
}

function renderSessions() {
  ALF.clear(list);

  if (sessions.length === 0) {
    list.append(ALF.el("div", { class: "card muted" }, "Aucune session pour le moment."));
    return;
  }

  for (const session of sessions) {
    const item = ALF.el(
      "article",
      { class: "item" },
      ALF.el(
        "div",
        { class: "item-head" },
        ALF.el(
          "div",
          {},
          ALF.el("strong", {}, session.title),
          ALF.el(
            "div",
            { class: "row small muted" },
            ALF.el("span", { class: "badge" }, session.code),
            ALF.el("span", {}, statusLabel(session.status)),
            ALF.el("span", {}, ALF.formatDate(session.created_at)),
          ),
        ),
        ALF.el(
          "div",
          { class: "row" },
          ALF.el(
            "a",
            { class: "btn small", href: `session.html?id=${session.id}` },
            "Configurer",
          ),
          ALF.el(
            "a",
            { class: "btn small solid", href: `present.html?code=${session.code}` },
            "Présenter",
          ),
          ALF.el(
            "button",
            {
              class: "btn small",
              type: "button",
              onclick: () => removeSession(session),
            },
            "Supprimer",
          ),
        ),
      ),
    );
    list.append(item);
  }
}

async function loadSessions() {
  sessions = await ALF.api("/sessions");
  renderSessions();
}

async function removeSession(session) {
  if (!window.confirm(`Supprimer la session « ${session.title} » ?`)) return;
  try {
    await ALF.api(`/sessions/${session.id}`, { method: "DELETE" });
    await loadSessions();
    ALF.toast("Session supprimée.");
  } catch (error) {
    ALF.toast(error.message);
  }
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.classList.add("hidden");
  const title = document.getElementById("session-title").value.trim();
  if (!title) return;

  try {
    const session = await ALF.api("/sessions", {
      method: "POST",
      body: { title },
    });
    window.location.href = `session.html?id=${session.id}`;
  } catch (error) {
    ALF.showError(errorBox, error);
  }
});

document.getElementById("logout").addEventListener("click", () => ALF.logout());

(async () => {
  try {
    await ALF.requireAuth();
    const config = await ALF.getConfig();
    document.getElementById("user-label").textContent = config.dev_mode
      ? "mode développement"
      : "";
    await loadSessions();
  } catch (error) {
    ALF.showError(errorBox, error);
  }
})();
