const params = new URLSearchParams(window.location.search);
const sessionId = params.get("id");

const KIND_LABEL = {
  wordcloud: "Nuage de mots",
  poll: "Vote",
  quiz: "Quiz",
  video: "Quiz vidéo",
};
const QUESTION_KIND = { poll: "poll", quiz: "mcq", video: "mcq" };

const activitiesContainer = document.getElementById("activities");
const errorBox = document.getElementById("error");
const pageTitle = document.getElementById("title");
const codeBadge = document.getElementById("code");

let session = null;

function field(labelText, input) {
  return ALF.el("div", { class: "field" }, ALF.el("label", {}, labelText), input);
}

function youtubeId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
    return parsed.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function participantUrl() {
  const url = new URL("play.html", window.location.href);
  url.search = `?code=${session.code}`;
  return url.toString();
}

async function loadSession() {
  session = await ALF.api(`/sessions/${sessionId}`);
  render();
}

function render() {
  pageTitle.textContent = session.title;
  codeBadge.textContent = session.code;
  document.getElementById("session-title").value = session.title;
  document.getElementById("session-status").value = session.status;
  document.getElementById("present-link").href = `present.html?code=${session.code}`;
  renderActivities();
}

function renderActivities() {
  ALF.clear(activitiesContainer);

  if (session.activities.length === 0) {
    activitiesContainer.append(
      ALF.el("div", { class: "card muted" }, "Aucune activité. Ajoutez-en une ci-dessus."),
    );
    return;
  }

  for (const activity of session.activities) {
    activitiesContainer.append(activityCard(activity));
  }
}

function activityCard(activity) {
  const resultsBox = ALF.el("div", { class: "results hidden" });

  const card = ALF.el(
    "article",
    { class: "item" },
    ALF.el(
      "div",
      { class: "item-head" },
      ALF.el(
        "div",
        { class: "row" },
        ALF.el("span", { class: "badge" }, KIND_LABEL[activity.kind] || activity.kind),
        ALF.el("strong", {}, activity.title),
      ),
      ALF.el(
        "div",
        { class: "row" },
        ALF.el(
          "button",
          { class: "btn small solid", type: "button", onclick: () => broadcast(activity) },
          "Diffuser",
        ),
        ALF.el(
          "button",
          { class: "btn small", type: "button", onclick: () => toggleResults(activity, resultsBox) },
          "Résultats",
        ),
        ALF.el(
          "button",
          { class: "btn small", type: "button", onclick: () => exportCsv(activity) },
          "Export CSV",
        ),
        ALF.el(
          "button",
          { class: "btn small", type: "button", onclick: () => deleteActivity(activity) },
          "Supprimer",
        ),
      ),
    ),
  );

  if (activity.kind === "wordcloud") {
    card.append(
      ALF.el(
        "p",
        { class: "muted small" },
        "Les participants envoient des mots ; le nuage s'affiche en direct.",
      ),
    );
  } else {
    card.append(renderQuestions(activity));
    card.append(questionForm(activity));
  }

  card.append(resultsBox);
  return card;
}

function renderQuestions(activity) {
  const wrapper = ALF.el("div", {});

  if (activity.questions.length === 0) {
    wrapper.append(ALF.el("p", { class: "muted small" }, "Aucune question pour l'instant."));
    return wrapper;
  }

  for (const question of activity.questions) {
    const options = ALF.el(
      "ol",
      {},
      ...question.options.map((option, index) =>
        ALF.el(
          "li",
          { class: question.correct_index === index ? "correct" : "" },
          option,
          question.correct_index === index ? " ✓" : "",
        ),
      ),
    );

    wrapper.append(
      ALF.el(
        "div",
        { class: "question" },
        ALF.el(
          "div",
          { class: "row between" },
          ALF.el("strong", {}, question.prompt),
          ALF.el(
            "button",
            { class: "btn small", type: "button", onclick: () => deleteQuestion(question) },
            "Supprimer",
          ),
        ),
        ALF.el(
          "div",
          { class: "small muted" },
          question.kind === "mcq" ? "QCM" : "Vote",
          question.video_ts !== null && question.video_ts !== undefined
            ? ` · ${question.video_ts}s`
            : "",
          question.time_limit ? ` · ${question.time_limit}s max` : "",
        ),
        options,
      ),
    );
  }
  return wrapper;
}

function questionForm(activity) {
  const prompt = ALF.el("textarea", { rows: "2", required: "required" });
  prompt.placeholder = "Énoncé de la question";

  const options = ALF.el("textarea", { rows: "3", required: "required" });
  options.placeholder = "Une option par ligne";

  const correct = ALF.el("input", {
    type: "number",
    min: "0",
    value: "0",
    placeholder: "Index de la bonne réponse (0 = première)",
  });

  const timeLimit = ALF.el("input", {
    type: "number",
    min: "5",
    placeholder: "Temps limite en secondes (optionnel)",
  });

  const videoTs = ALF.el("input", {
    type: "number",
    min: "0",
    placeholder: "Timestamp vidéo en secondes",
  });

  const submit = ALF.el("button", { class: "btn small", type: "submit" }, "Ajouter la question");

  const form = ALF.el(
    "form",
    { class: "question" },
    field("Question", prompt),
    field("Options", options),
  );

  if (activity.kind !== "poll") {
    form.append(field("Bonne réponse", correct));
  }
  if (activity.kind === "video") {
    form.append(field("Timestamp vidéo", videoTs));
  }
  form.append(field("Temps limite (optionnel)", timeLimit));
  form.append(ALF.el("div", { class: "row" }, submit));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const body = {
        prompt: prompt.value.trim(),
        kind: QUESTION_KIND[activity.kind],
        options: options.value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        time_limit: timeLimit.value ? Number(timeLimit.value) : null,
      };
      if (activity.kind !== "poll") {
        body.correct_index = Number(correct.value) || 0;
      }
      if (activity.kind === "video" && videoTs.value !== "") {
        body.video_ts = Number(videoTs.value);
      }
      await ALF.api(`/activities/${activity.id}/questions`, { method: "POST", body });
      await loadSession();
    } catch (error) {
      ALF.toast(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  return form;
}

async function toggleResults(activity, box) {
  if (!box.classList.contains("hidden")) {
    box.classList.add("hidden");
    return;
  }

  try {
    const results = await ALF.api(`/activities/${activity.id}/results`);
    ALF.clear(box);

    if (activity.kind === "wordcloud") {
      if (results.words.length === 0) {
        box.append(ALF.el("p", { class: "muted small" }, "Aucun mot reçu."));
      } else {
        const rows = results.words.map((word) =>
          ALF.el("tr", {}, ALF.el("td", {}, word.text), ALF.el("td", {}, String(word.count))),
        );
        box.append(
          ALF.el(
            "table",
            {},
            ALF.el("thead", {}, ALF.el("tr", {}, ALF.el("th", {}, "Mot"), ALF.el("th", {}, "Occurrences"))),
            ALF.el("tbody", {}, ...rows),
          ),
        );
      }
    } else if (results.questions.length === 0) {
      box.append(ALF.el("p", { class: "muted small" }, "Aucune question."));
    } else {
      for (const question of results.questions) {
        const bars = ALF.el("div", { class: "bars" });
        question.options.forEach((option, index) => {
          const count = question.counts[index] || 0;
          const percent = question.total ? Math.round((count / question.total) * 100) : 0;
          const fill = ALF.el(
            "div",
            { class: "bar-fill", style: `width: ${Math.max(percent, 2)}%` },
            String(count),
          );
          bars.append(
            ALF.el(
              "div",
              { class: "bar" },
              fill,
              ALF.el(
                "div",
                { class: "bar-label" },
                ALF.el("span", {}, `${option}${question.correct_index === index ? " ✓" : ""}`),
                ALF.el("span", {}, `${percent}%`),
              ),
            ),
          );
        });
        box.append(
          ALF.el(
            "div",
            { class: "question" },
            ALF.el("strong", {}, question.prompt),
            ALF.el("div", { class: "small muted" }, `${question.total} réponse(s)`),
            bars,
          ),
        );
      }
    }
    box.classList.remove("hidden");
  } catch (error) {
    ALF.toast(error.message);
  }
}

async function broadcast(activity) {
  try {
    await ALF.api(`/sessions/${session.id}`, {
      method: "PATCH",
      body: { current_activity_id: activity.id, status: "live" },
    });
    window.location.href = `present.html?code=${session.code}`;
  } catch (error) {
    ALF.toast(error.message);
  }
}

async function exportCsv(activity) {
  try {
    await ALF.download(
      `/activities/${activity.id}/export.csv`,
      `alf-${activity.kind}-${activity.id.slice(0, 8)}.csv`,
    );
  } catch (error) {
    ALF.toast(error.message);
  }
}

async function deleteActivity(activity) {
  if (!window.confirm(`Supprimer l'activité « ${activity.title} » ?`)) return;
  try {
    await ALF.api(`/activities/${activity.id}`, { method: "DELETE" });
    await loadSession();
  } catch (error) {
    ALF.toast(error.message);
  }
}

async function deleteQuestion(question) {
  if (!window.confirm("Supprimer cette question ?")) return;
  try {
    await ALF.api(`/questions/${question.id}`, { method: "DELETE" });
    await loadSession();
  } catch (error) {
    ALF.toast(error.message);
  }
}

document.getElementById("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await ALF.api(`/sessions/${session.id}`, {
      method: "PATCH",
      body: {
        title: document.getElementById("session-title").value.trim(),
        status: document.getElementById("session-status").value,
      },
    });
    await loadSession();
    ALF.toast("Réglages enregistrés.");
  } catch (error) {
    ALF.showError(errorBox, error);
  }
});

const kindSelect = document.getElementById("kind");
const youtubeField = document.getElementById("youtube-field");
kindSelect.addEventListener("change", () => {
  youtubeField.classList.toggle("hidden", kindSelect.value !== "video");
});

document.getElementById("activity-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = kindSelect.value;
  const title = document.getElementById("activity-title").value.trim();
  const body = { kind, title, config: {} };

  if (kind === "video") {
    const url = document.getElementById("youtube-url").value.trim();
    const videoId = youtubeId(url);
    if (!videoId) {
      ALF.toast("Lien YouTube invalide.");
      return;
    }
    body.config = { youtube_url: url, video_id: videoId };
  }

  try {
    await ALF.api(`/sessions/${session.id}/activities`, { method: "POST", body });
    document.getElementById("activity-title").value = "";
    document.getElementById("youtube-url").value = "";
    await loadSession();
  } catch (error) {
    ALF.showError(errorBox, error);
  }
});

document.getElementById("copy-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(participantUrl());
    ALF.toast("Lien participant copié.");
  } catch {
    window.prompt("Lien participant :", participantUrl());
  }
});

document.getElementById("logout").addEventListener("click", () => ALF.logout());

(async () => {
  try {
    await ALF.requireAuth();
    if (!sessionId) throw new Error("Session manquante.");
    await loadSession();
  } catch (error) {
    ALF.showError(errorBox, error);
  }
})();
