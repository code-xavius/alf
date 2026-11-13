const KIND_LABEL = {
  wordcloud: "Nuage de mots",
  poll: "Vote",
  quiz: "Quiz",
  video: "Quiz vidéo",
};

const code = new URLSearchParams(window.location.search).get("code");

let activity = null;
let participant = null;
let answers = {};
let occurrences = null;
let socket = null;
let reconnectTimer = null;
let stopped = false;
let excluded = false;

const joinView = document.getElementById("join-view");
const activityView = document.getElementById("activity-view");
const waiting = document.getElementById("waiting");
const errorBox = document.getElementById("error");
const content = document.getElementById("activity-content");

function empty(text) {
  return ALF.el("div", { class: "card muted" }, text);
}

function questionIndex() {
  const total = activity.questions.length;
  if (!total) return 0;
  const raw = Number(activity.state?.current_question ?? 0);
  return Math.min(Math.max(raw, 0), total - 1);
}

async function loadPublicWords() {
  if (occurrences) return;
  try {
    const words = await ALF.api(`/activities/${activity.id}/words/public`, { auth: false });
    occurrences = {};
    for (const word of words) {
      occurrences[word.text] = (occurrences[word.text] || 0) + 1;
    }
  } catch {
    occurrences = {};
  }
}

function updateWordList() {
  const target = document.getElementById("word-list");
  if (!target) return;
  ALF.clear(target);

  const entries = Object.keys(occurrences || {}).slice(0, 40);

  if (entries.length === 0) {
    target.append(ALF.el("p", { class: "muted small" }, "Aucun mot pour l'instant."));
    return;
  }

  for (const text of entries) {
    target.append(ALF.el("span", { class: "word-chip" }, text));
  }
}

function renderWordcloud() {
  const form = ALF.el(
    "form",
    { class: "card" },
    ALF.el(
      "div",
      { class: "field" },
      ALF.el("label", { for: "word-input" }, "Votre mot"),
      ALF.el("input", { id: "word-input", maxlength: "80", required: "required" }),
    ),
    ALF.el("button", { class: "btn solid", type: "submit" }, "Envoyer"),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("word-input");
    const text = input.value.trim();
    if (!text) return;
    try {
      await ALF.api(`/activities/${activity.id}/words`, {
        method: "POST",
        auth: false,
        body: { text, participant_id: participant.id },
      });
      input.value = "";
    } catch (error) {
      if (error.message.includes("exclu")) {
        excluded = true;
        await render();
      } else {
        ALF.toast(error.message);
      }
    }
  });

  content.append(form);
  content.append(ALF.el("div", { class: "card" }, ALF.el("div", { id: "word-list" })));
  updateWordList();
}

function renderQuestion() {
  if (activity.questions.length === 0) {
    content.append(empty("Aucune question pour l'instant."));
    return;
  }

  const state = activity.state || {};
  if (activity.kind === "video" && !state.question_open) {
    content.append(empty("Regardez la vidéo. La question s'affichera au bon moment."));
    return;
  }

  const index = questionIndex();
  const question = activity.questions[index];
  const answered = answers[question.id];
  const locked = question.kind === "mcq" && state.revealed;

  content.append(
    ALF.el(
      "div",
      { class: "small muted" },
      `Question ${index + 1} / ${activity.questions.length}`,
    ),
  );
  content.append(ALF.el("h2", {}, question.prompt));

  if (answered) {
    content.append(
      ALF.el(
        "p",
        { class: "muted" },
        locked
          ? "Réponse enregistrée."
          : "Réponse enregistrée. Vous pouvez encore la modifier.",
      ),
    );
  }

  const choices = ALF.el("div", {});
  question.options.forEach((option, optionIndex) => {
    const chosen = answered && answered.value === optionIndex;
    const correct =
      state.revealed &&
      question.correct_index !== null &&
      question.correct_index !== undefined &&
      question.correct_index === optionIndex;

    choices.append(
      ALF.el(
        "button",
        {
          class: `btn choice${chosen ? " solid" : ""}${correct ? " correct-choice" : ""}`,
          type: "button",
          disabled: locked ? "disabled" : undefined,
          onclick: () => submitAnswer(question, optionIndex),
        },
        option,
      ),
    );
  });
  content.append(choices);

  if (
    state.revealed &&
    question.correct_index !== null &&
    question.correct_index !== undefined
  ) {
    let feedback = "";
    if (answered) {
      feedback = answered.is_correct ? " Bonne réponse." : " Réponse incorrecte.";
    }
    content.append(
      ALF.el(
        "div",
        { class: "card" },
        `Bonne réponse : ${question.options[question.correct_index]}.${feedback}`,
      ),
    );
  }
}

async function submitAnswer(question, value) {
  const previous = answers[question.id];
  try {
    const result = await ALF.api(`/questions/${question.id}/responses`, {
      method: "POST",
      auth: false,
      body: { participant_id: participant.id, value },
    });

    if (result.recorded) {
      answers[question.id] = { value, is_correct: result.is_correct };
      ALF.setAnswers(code, answers);
      if (previous && previous.value !== value) ALF.toast("Réponse modifiée.");
      await render();
    }
  } catch (error) {
    if (error.message.includes("exclu")) {
      excluded = true;
      await render();
    } else {
      ALF.toast(error.message);
    }
  }
}

async function render() {
  document.getElementById("activity-title").textContent = activity.title;
  document.getElementById("activity-code").textContent = activity.code;

  if (excluded) {
    joinView.classList.add("hidden");
    activityView.classList.add("hidden");
    waiting.classList.remove("hidden");
    waiting.textContent = "Vous avez été temporairement exclu de cette activité.";
    return;
  }

  if (!participant) {
    joinView.classList.remove("hidden");
    activityView.classList.add("hidden");
    waiting.classList.add("hidden");
    document.getElementById("join-title").textContent = activity.title;
    return;
  }

  joinView.classList.add("hidden");
  document.getElementById("nickname-label").textContent = participant.nickname;

  if (activity.status === "closed") {
    activityView.classList.add("hidden");
    waiting.classList.remove("hidden");
    waiting.textContent = "Cette activité est terminée.";
    return;
  }

  waiting.classList.add("hidden");
  activityView.classList.remove("hidden");
  document.getElementById("activity-kind").textContent =
    KIND_LABEL[activity.kind] || activity.kind;
  document.getElementById("activity-title-label").textContent = activity.title;

  ALF.clear(content);

  if (activity.kind === "wordcloud") {
    await loadPublicWords();
    renderWordcloud();
  } else {
    renderQuestion();
  }
}

async function handleMessage(message) {
  switch (message.type) {
    case "activity_updated":
      activity = message.activity;
      await render();
      break;
    case "word_added":
      if (occurrences) {
        occurrences[message.text] = (occurrences[message.text] || 0) + 1;
        updateWordList();
      }
      break;
    case "participant_banned":
      if (participant && message.participant_id === participant.id) {
        excluded = true;
        await render();
      }
      break;
    case "participant_unbanned":
      if (participant && message.participant_id === participant.id) {
        excluded = false;
        await render();
      }
      break;
    case "activity_deleted":
      stopped = true;
      ALF.toast("L'activité a été supprimée.");
      window.setTimeout(() => {
        window.location.href = "index.html";
      }, 1200);
      break;
    default:
      break;
  }
}

function connectSocket() {
  if (stopped) return;
  socket = ALF.connect(code, handleMessage);
  socket.onclose = () => {
    if (!stopped) reconnectTimer = window.setTimeout(connectSocket, 2000);
  };
}

document.getElementById("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("join-error");
  error.classList.add("hidden");

  const nickname = document.getElementById("nickname").value.trim();
  if (!nickname) return;

  try {
    participant = await ALF.api(`/activities/code/${code}/join`, {
      method: "POST",
      auth: false,
      body: { nickname, device_id: ALF.getDeviceId() },
    });
    ALF.setParticipant(code, participant);
    await render();
  } catch (joinError) {
    if (joinError.message.includes("exclu")) {
      excluded = true;
      await render();
    } else {
      ALF.showError(error, joinError);
    }
  }
});

(async () => {
  try {
    if (!code) throw new Error("Code d'activité manquant.");
    activity = await ALF.api(`/activities/code/${code}`, { auth: false });
    participant = ALF.getParticipant(code);
    answers = ALF.getAnswers(code);
    await render();
    connectSocket();
  } catch (error) {
    ALF.showError(errorBox, error);
  }
})();
