const KIND_LABEL = {
  wordcloud: "Nuage de mots",
  poll: "Vote",
  quiz: "Quiz",
};

const list = document.getElementById("activities");
const errorBox = document.getElementById("error");
const createForm = document.getElementById("create-form");
const kindSelect = document.getElementById("activity-kind");

let activities = [];

function statusLabel(status) {
  return { open: "ouverte", closed: "fermée" }[status] || status;
}

function participantUrl(code) {
  const url = new URL("play.html", window.location.href);
  url.search = `?code=${code}`;
  return url.toString();
}

function embedUrl(code) {
  const url = new URL("present.html", window.location.href);
  url.search = `?code=${code}&embed=1`;
  return url.toString();
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function embedSnippet(activity) {
  const src = embedUrl(activity.code).replaceAll("&", "&amp;");
  return `<iframe src="${src}" width="960" height="540" style="border:0" allowfullscreen title="${escapeAttribute(activity.title)}"></iframe>`;
}

function renderActivities() {
  ALF.clear(list);

  if (activities.length === 0) {
    list.append(ALF.el("div", { class: "card muted" }, "Aucune activité pour le moment."));
    return;
  }

  for (const activity of activities) {
    list.append(
      ALF.el(
        "article",
        { class: "item" },
        ALF.el(
          "div",
          { class: "item-head" },
          ALF.el(
            "div",
            {},
            ALF.el(
              "div",
              { class: "row" },
              ALF.el("span", { class: "badge" }, KIND_LABEL[activity.kind] || activity.kind),
              ALF.el("strong", {}, activity.title),
            ),
            ALF.el(
              "div",
              { class: "row small muted" },
              ALF.el("span", { class: "badge" }, activity.code),
              ALF.el("span", {}, statusLabel(activity.status)),
              ALF.el("span", {}, `${activity.participant_count} participant(s)`),
              ALF.el("span", {}, ALF.formatDate(activity.created_at)),
            ),
          ),
          ALF.el(
            "div",
            { class: "row" },
            ALF.el(
              "a",
              { class: "btn small", href: `activity.html?id=${activity.id}` },
              "Configurer",
            ),
            ALF.el(
              "a",
              {
                class: "btn small solid",
                href: `present.html?code=${activity.code}`,
                target: "_blank",
                rel: "noopener",
              },
              "Présenter",
            ),
            ALF.el(
              "button",
              {
                class: "btn small",
                type: "button",
                onclick: () => copyLink(activity),
              },
              "Lien participant",
            ),
            ALF.el(
              "button",
              {
                class: "btn small",
                type: "button",
                onclick: () => openEmbed(activity),
              },
              "Intégrer",
            ),
            ALF.el(
              "button",
              {
                class: "btn small",
                type: "button",
                onclick: () => removeActivity(activity),
              },
              "Supprimer",
            ),
          ),
        ),
      ),
    );
  }
}

async function loadActivities() {
  activities = await ALF.api("/activities");
  renderActivities();
}

async function copyLink(activity) {
  const url = participantUrl(activity.code);
  try {
    await navigator.clipboard.writeText(url);
    ALF.toast("Lien participant copié.");
  } catch {
    window.prompt("Lien participant :", url);
  }
}

function openEmbed(activity) {
  document.getElementById("embed-code").value = embedSnippet(activity);
  document.getElementById("embed-preview").href = embedUrl(activity.code);
  const modal = document.getElementById("embed-modal");
  if (!modal.open) modal.showModal();
}

async function copyEmbedCode() {
  const code = document.getElementById("embed-code").value;
  try {
    await navigator.clipboard.writeText(code);
    ALF.toast("Code iframe copié.");
  } catch {
    window.prompt("Code iframe :", code);
  }
}

async function removeActivity(activity) {
  if (!window.confirm(`Supprimer l'activité « ${activity.title} » ?`)) return;
  try {
    await ALF.api(`/activities/${activity.id}`, { method: "DELETE" });
    await loadActivities();
    ALF.toast("Activité supprimée.");
  } catch (error) {
    ALF.toast(error.message);
  }
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.classList.add("hidden");

  const kind = kindSelect.value;
  const title = document.getElementById("activity-title").value.trim();
  if (!title) return;

  const body = { kind, title, config: {} };

  try {
    const activity = await ALF.api("/activities", { method: "POST", body });
    window.location.href = `activity.html?id=${activity.id}`;
  } catch (error) {
    ALF.showError(errorBox, error);
  }
});

document.getElementById("copy-embed").addEventListener("click", copyEmbedCode);

document.getElementById("close-embed").addEventListener("click", () => {
  document.getElementById("embed-modal").close();
});

document.getElementById("embed-modal").addEventListener("click", (event) => {
  if (event.target === document.getElementById("embed-modal")) {
    event.target.close();
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
    await loadActivities();
  } catch (error) {
    ALF.showError(errorBox, error);
  }
})();
