const params = new URLSearchParams(window.location.search);
const activityId = params.get("id");

const KIND_LABEL = {
  wordcloud: "Nuage de mots",
  poll: "Vote",
  quiz: "Quiz",
  video: "Quiz vidéo",
};

const errorBox = document.getElementById("error");
const questionCard = document.getElementById("question-card");
const wordcloudCard = document.getElementById("wordcloud-card");
const questionsSection = document.getElementById("questions-section");
const questionsContainer = document.getElementById("questions");
const resultsBox = document.getElementById("results");
const participantUrlLabel = document.getElementById("participant-url");

let activity = null;

function participantUrl() {
  const url = new URL("play.html", window.location.href);
  url.search = `?code=${activity.code}`;
  return url.toString();
}

async function loadActivity() {
  activity = await ALF.api(`/activities/${activityId}`);
  render();
}

async function render() {
  document.title = `${activity.title} — alf`;
  document.getElementById("title").textContent = activity.title;
  document.getElementById("code").textContent = activity.code;
  document.getElementById("activity-title").value = activity.title;
  document.getElementById("activity-status").value = activity.status;
  document.getElementById("present-link").href = `present.html?code=${activity.code}`;
  participantUrlLabel.textContent = participantUrl();

  const isWordcloud = activity.kind === "wordcloud";
  questionCard.classList.toggle("hidden", isWordcloud);
  wordcloudCard.classList.toggle("hidden", !isWordcloud);
  questionsSection.classList.toggle("hidden", isWordcloud);
  document.getElementById("correct-field").classList.toggle("hidden", activity.kind === "poll");
  document.getElementById("video-field").classList.toggle("hidden", activity.kind !== "video");

  renderQuestions();
  await loadResults();
}

function renderQuestions() {
  ALF.clear(questionsContainer);

  if (activity.questions.length === 0) {
    questionsContainer.append(
      ALF.el("div", { class: "card muted" }, "Aucune question pour l'instant."),
    );
    return;
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

    questionsContainer.append(
      ALF.el(
        "article",
        { class: "item" },
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
}

async function loadResults() {
  try {
    const results = await ALF.api(`/activities/${activity.id}/results`);
    renderResults(results);
  } catch (error) {
    ALF.clear(resultsBox);
    resultsBox.append(ALF.el("p", { class: "error" }, error.message));
  }
}

function renderResults(results) {
  ALF.clear(resultsBox);

  if (activity.kind === "wordcloud") {
    if (results.words.length === 0) {
      resultsBox.append(ALF.el("p", { class: "muted small" }, "Aucun mot reçu."));
      return;
    }
    const rows = results.words.map((word) =>
      ALF.el("tr", {}, ALF.el("td", {}, word.text), ALF.el("td", {}, String(word.count))),
    );
    resultsBox.append(
      ALF.el(
        "table",
        {},
        ALF.el(
          "thead",
          {},
          ALF.el("tr", {}, ALF.el("th", {}, "Mot"), ALF.el("th", {}, "Occurrences")),
        ),
        ALF.el("tbody", {}, ...rows),
      ),
    );
    return;
  }

  if (results.questions.length === 0) {
    resultsBox.append(ALF.el("p", { class: "muted small" }, "Aucune question."));
    return;
  }

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
    resultsBox.append(
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

async function deleteQuestion(question) {
  if (!window.confirm("Supprimer cette question ?")) return;
  try {
    await ALF.api(`/questions/${question.id}`, { method: "DELETE" });
    await loadActivity();
  } catch (error) {
    ALF.toast(error.message);
  }
}

document.getElementById("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await ALF.api(`/activities/${activity.id}`, {
      method: "PATCH",
      body: {
        title: document.getElementById("activity-title").value.trim(),
        status: document.getElementById("activity-status").value,
      },
    });
    await loadActivity();
    ALF.toast("Réglages enregistrés.");
  } catch (error) {
    ALF.showError(errorBox, error);
  }
});

document.getElementById("question-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = document.getElementById("prompt").value.trim();
  const options = document
    .getElementById("options")
    .value.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const timeLimit = document.getElementById("time-limit").value;
  const correct = document.getElementById("correct").value;

  const body = {
    prompt,
    kind: activity.kind === "poll" ? "poll" : "mcq",
    options,
    time_limit: timeLimit ? Number(timeLimit) : null,
  };

  if (activity.kind !== "poll") {
    body.correct_index = Number(correct) || 0;
  }
  if (activity.kind === "video") {
    const videoTs = document.getElementById("video-ts").value;
    if (videoTs !== "") body.video_ts = Number(videoTs);
  }

  try {
    await ALF.api(`/activities/${activity.id}/questions`, { method: "POST", body });
    document.getElementById("prompt").value = "";
    document.getElementById("options").value = "";
    await loadActivity();
  } catch (error) {
    ALF.toast(error.message);
  }
});

document.getElementById("refresh-results").addEventListener("click", loadResults);

document.getElementById("copy-link").addEventListener("click", async () => {
  const url = participantUrl();
  try {
    await navigator.clipboard.writeText(url);
    ALF.toast("Lien participant copié.");
  } catch {
    window.prompt("Lien participant :", url);
  }
});

document.getElementById("export").addEventListener("click", async () => {
  try {
    await ALF.download(
      `/activities/${activity.id}/export.csv`,
      `alf-${activity.kind}-${activity.id.slice(0, 8)}.csv`,
    );
  } catch (error) {
    ALF.toast(error.message);
  }
});

document.getElementById("delete").addEventListener("click", async () => {
  if (!window.confirm(`Supprimer l'activité « ${activity.title} » ?`)) return;
  try {
    await ALF.api(`/activities/${activity.id}`, { method: "DELETE" });
    window.location.href = "dashboard.html";
  } catch (error) {
    ALF.toast(error.message);
  }
});

document.getElementById("logout").addEventListener("click", () => ALF.logout());

(async () => {
  try {
    await ALF.requireAuth();
    if (!activityId) throw new Error("Activité manquante.");
    await loadActivity();
  } catch (error) {
    ALF.showError(errorBox, error);
  }
})();
