const KIND_LABEL = {
  wordcloud: "Nuage de mots",
  poll: "Vote",
  quiz: "Quiz",
  video: "Quiz vidéo",
};

const code = new URLSearchParams(window.location.search).get("code");
const wordsByActivity = {};

let session = null;
let participant = null;
let answers = {};
let socket = null;
let reconnectTimer = null;

const joinView = document.getElementById("join-view");
const activityView = document.getElementById("activity-view");
const waiting = document.getElementById("waiting");
const errorBox = document.getElementById("error");
const content = document.getElementById("activity-content");

function empty(text) {
  return ALF.el("div", { class: "card muted" }, text);
}

function currentActivity() {
  return (
    session.activities.find((activity) => activity.id === session.current_activity_id) || null
  );
}

function questionIndex(activity) {
  const total = activity.questions.length;
  if (!total) return 0;
  const raw = Number(activity.state?.current_question ?? 0);
  return Math.min(Math.max(raw, 0), total - 1);
}

async function loadPublicWords(activity) {
  if (wordsByActivity[activity.id]) return;
  try {
    const words = await ALF.api(`/activities/${activity.id}/words/public`, { auth: false });
    const occurrences = {};
    for (const word of words) {
      occurrences[word.text] = (occurrences[word.text] || 0) + 1;
    }
    wordsByActivity[activity.id] = occurrences;
  } catch {
    wordsByActivity[activity.id] = {};
  }
}

function updateWordList(activity) {
  const target = document.getElementById("word-list");
  if (!target) return;
  ALF.clear(target);

  const occurrences = wordsByActivity[activity.id] || {};
  const entries = Object.entries(occurrences).sort((a, b) => b[1] - a[1]).slice(0, 40);

  if (entries.length === 0) {
    target.append(ALF.el("p", { class: "muted small" }, "Aucun mot pour l'instant."));
    return;
  }

  for (const [text, count] of entries) {
    target.append(
      ALF.el(
        "span",
        { class: "word-chip", style: `font-size:${Math.min(14 + count * 4, 40)}px` },
        text,
      ),
    );
  }
}

function renderWordcloud(activity) {
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
      ALF.toast(error.message);
    }
  });

  content.append(form);
  content.append(
    ALF.el("div", { class: "card" }, ALF.el("div", { id: "word-list" })),
  );
  updateWordList(activity);
}

function renderQuestion(activity) {
  if (activity.questions.length === 0) {
    content.append(empty("Aucune question pour l'instant."));
    return;
  }

  const state = activity.state || {};
  if (activity.kind === "video" && !state.question_open) {
    content.append(empty("Regardez la vidéo. La question s'affichera au bon moment."));
    return;
  }

  const index = questionIndex(activity);
  const question = activity.questions[index];
  const answered = answers[question.id];

  content.append(
    ALF.el(
      "div",
      { class: "small muted" },
      `Question ${index + 1} / ${activity.questions.length}`,
    ),
  );
  content.append(ALF.el("h2", {}, question.prompt));

  if (answered) {
    content.append(ALF.el("p", { class: "muted" }, "Réponse enregistrée."));
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
          disabled: answered ? "disabled" : undefined,
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
  if (answers[question.id]) return;
  try {
    const result = await ALF.api(`/questions/${question.id}/responses`, {
      method: "POST",
      auth: false,
      body: { participant_id: participant.id, value },
    });

    if (result.recorded) {
      answers[question.id] = { value, is_correct: result.is_correct };
      ALF.setAnswers(code, answers);
      await render();
    } else {
      ALF.toast("Vous avez déjà répondu.");
    }
  } catch (error) {
    ALF.toast(error.message);
  }
}

async function render() {
  document.getElementById("session-title").textContent = session.title;
  document.getElementById("session-code").textContent = session.code;

  if (!participant) {
    joinView.classList.remove("hidden");
    activityView.classList.add("hidden");
    waiting.classList.add("hidden");
    document.getElementById("join-title").textContent = session.title;
    return;
  }

  joinView.classList.add("hidden");
  activityView.classList.remove("hidden");
  document.getElementById("nickname-label").textContent = participant.nickname;

  const activity = currentActivity();
  ALF.clear(content);

  if (!activity) {
    activityView.classList.add("hidden");
    waiting.classList.remove("hidden");
    return;
  }

  waiting.classList.add("hidden");
  activityView.classList.remove("hidden");
  document.getElementById("activity-kind").textContent =
    KIND_LABEL[activity.kind] || activity.kind;
  document.getElementById("activity-title").textContent = activity.title;

  if (activity.kind === "wordcloud") {
    await loadPublicWords(activity);
    renderWordcloud(activity);
  } else {
    renderQuestion(activity);
  }
}

async function refetchSession() {
  session = await ALF.api(`/sessions/code/${code}`, { auth: false });
  await render();
}

async function handleMessage(message) {
  switch (message.type) {
    case "session_updated":
      session.status = message.status;
      session.title = message.title;
      if (message.current_activity_id) {
        session.current_activity_id = message.current_activity_id;
      }
      await render();
      break;
    case "activity_updated": {
      const activity = session.activities.find((entry) => entry.id === message.activity_id);
      if (activity) {
        activity.title = message.title;
        activity.config = message.config;
        activity.state = message.state;
        activity.position = message.position;
      }
      await render();
      break;
    }
    case "activity_created":
    case "activity_deleted":
    case "questions_updated":
      await refetchSession();
      break;
    case "word_added": {
      if (message.activity_id !== session.current_activity_id) break;
      const occurrences = wordsByActivity[message.activity_id] || {};
      occurrences[message.text] = (occurrences[message.text] || 0) + 1;
      wordsByActivity[message.activity_id] = occurrences;
      const activity = currentActivity();
      if (activity) updateWordList(activity);
      break;
    }
    default:
      break;
  }
}

function connectSocket() {
  socket = ALF.connect(session.code, handleMessage);
  socket.onclose = () => {
    reconnectTimer = window.setTimeout(connectSocket, 2000);
  };
}

document.getElementById("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.getElementById("join-error");
  error.classList.add("hidden");

  const nickname = document.getElementById("nickname").value.trim();
  if (!nickname) return;

  try {
    participant = await ALF.api(`/sessions/code/${code}/join`, {
      method: "POST",
      auth: false,
      body: { nickname },
    });
    ALF.setParticipant(code, participant);
    await render();
  } catch (joinError) {
    ALF.showError(error, joinError);
  }
});

(async () => {
  try {
    if (!code) throw new Error("Code de session manquant.");
    session = await ALF.api(`/sessions/code/${code}`, { auth: false });
    participant = ALF.getParticipant(code);
    answers = ALF.getAnswers(code);
    if (session.status === "closed") {
      ALF.toast("Cette session est terminée.");
    }
    await render();
    connectSocket();
  } catch (error) {
    ALF.showError(errorBox, error);
  }
})();
