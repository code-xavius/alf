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
const questionKindField = document.getElementById("question-kind-field");
const questionKindSelect = document.getElementById("question-kind");
const correctField = document.getElementById("correct-field");
const presentationControls = document.getElementById("presentation-controls");
const controlProgress = document.getElementById("control-progress");
const controlQuestion = document.getElementById("control-question");
const controlPrev = document.getElementById("control-prev");
const controlNext = document.getElementById("control-next");
const controlReveal = document.getElementById("control-reveal");
const controlQuestionOpen = document.getElementById("control-question-open");
const embedModal = document.getElementById("embed-modal");

let activity = null;

function participantUrl() {
  const url = new URL("play.html", window.location.href);
  url.search = `?code=${activity.code}`;
  return url.toString();
}

function embedUrl() {
  const url = new URL("present.html", window.location.href);
  url.search = `?code=${activity.code}&embed=1`;
  return url.toString();
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function embedSnippet() {
  const src = embedUrl().replaceAll("&", "&amp;");
  return `<iframe src="${src}" width="960" height="540" style="border:0" allowfullscreen title="${escapeAttribute(activity.title)}"></iframe>`;
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
  document.getElementById("embed-code").value = embedSnippet();
  document.getElementById("embed-preview").href = embedUrl();

  const isWordcloud = activity.kind === "wordcloud";
  const isPoll = activity.kind === "poll";
  questionCard.classList.toggle("hidden", isWordcloud);
  wordcloudCard.classList.toggle("hidden", !isWordcloud);
  questionsSection.classList.toggle("hidden", isWordcloud);
  questionKindField.classList.toggle("hidden", isPoll);
  questionKindSelect.value = isPoll ? "poll" : "mcq";
  updateCorrectField();
  renderPresentationControls();

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
          question.kind === "mcq" ? "QCM" : "Question avec choix",
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

function updateCorrectField() {
  const kind = activity.kind === "poll" ? "poll" : questionKindSelect.value;
  correctField.classList.toggle("hidden", kind === "poll");
}

function questionIndex() {
  const total = activity.questions.length;
  if (!total) return 0;
  const raw = Number(activity.state?.current_question ?? 0);
  return Math.min(Math.max(raw, 0), total - 1);
}

function currentQuestion() {
  return activity.questions[questionIndex()] || null;
}

function renderPresentationControls() {
  const isWordcloud = activity.kind === "wordcloud";
  presentationControls.classList.toggle("hidden", isWordcloud);
  if (isWordcloud) return;

  const total = activity.questions.length;
  const index = questionIndex();
  const question = currentQuestion();
  const state = activity.state || {};
  const isVideo = activity.kind === "video";
  const isMcq = question?.kind === "mcq";
  const revealVisible = isMcq && (!isVideo || !!state.question_open);

  controlProgress.textContent = total
    ? `Question ${index + 1} / ${total}`
    : "Aucune question";
  controlQuestion.textContent = question
    ? question.prompt
    : "Ajoutez une question pour commencer.";
  controlPrev.disabled = !total || index === 0;
  controlNext.disabled = !total || index >= total - 1;
  controlReveal.classList.toggle("hidden", !revealVisible);
  controlReveal.disabled = !revealVisible;
  controlReveal.textContent = state.revealed
    ? "Cacher la réponse"
    : "Révéler la réponse";
  controlQuestionOpen.classList.toggle("hidden", !isVideo);
  controlQuestionOpen.disabled = !question;
  controlQuestionOpen.textContent = state.question_open
    ? "Fermer la question"
    : "Ouvrir la question";
}

async function patchPresentationState(patch) {
  const previous = activity.state;
  const state = { ...(activity.state || {}), ...patch };
  activity.state = state;
  renderPresentationControls();

  try {
    const updated = await ALF.api(`/activities/${activity.id}`, {
      method: "PATCH",
      body: { state },
    });
    activity.state = updated.state;
    renderPresentationControls();
  } catch (error) {
    activity.state = previous;
    renderPresentationControls();
    ALF.toast(error.message);
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

async function copyEmbedCode() {
  const code = embedSnippet();
  try {
    await navigator.clipboard.writeText(code);
    ALF.toast("Code iframe copié.");
  } catch {
    window.prompt("Code iframe :", code);
  }
}

document.getElementById("copy-embed").addEventListener("click", copyEmbedCode);

document.getElementById("embed-open").addEventListener("click", () => {
  if (!activity) return;
  document.getElementById("embed-code").value = embedSnippet();
  document.getElementById("embed-preview").href = embedUrl();
  if (!embedModal.open) embedModal.showModal();
});

document.getElementById("close-embed").addEventListener("click", () => {
  embedModal.close();
});

embedModal.addEventListener("click", (event) => {
  if (event.target === embedModal) embedModal.close();
});

controlPrev.addEventListener("click", () => {
  const index = questionIndex();
  if (index <= 0) return;
  patchPresentationState({ current_question: index - 1, revealed: false });
});

controlNext.addEventListener("click", () => {
  const index = questionIndex();
  if (index >= activity.questions.length - 1) return;
  patchPresentationState({ current_question: index + 1, revealed: false });
});

controlReveal.addEventListener("click", () => {
  patchPresentationState({ revealed: !activity.state?.revealed });
});

controlQuestionOpen.addEventListener("click", () => {
  patchPresentationState({ question_open: !activity.state?.question_open });
});

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
  const questionKind = activity.kind === "poll" ? "poll" : questionKindSelect.value;

  const body = {
    prompt,
    kind: questionKind,
    options,
    time_limit: timeLimit ? Number(timeLimit) : null,
  };

  if (questionKind === "mcq") {
    body.correct_index = Number(correct) || 0;
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

questionKindSelect.addEventListener("change", updateCorrectField);

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
