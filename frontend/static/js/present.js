const KIND_LABEL = {
  wordcloud: "Nuage de mots",
  poll: "Vote",
  quiz: "Quiz",
  video: "Quiz vidéo",
};

let session = null;
let currentActivityId = null;
let participantCount = 0;
let socket = null;
let stopped = false;
let reconnectTimer = null;

const occurrencesByActivity = {};
const resultsByActivity = {};

let renderTimer = null;
let ytPlayer = null;
let ytApiPromise = null;
let videoFrame = null;

function empty(text) {
  return ALF.el("div", { class: "stage-empty" }, text);
}

function button(label, onClick, solid = false, disabled = false) {
  return ALF.el(
    "button",
    {
      class: `btn small${solid ? " solid" : ""}`,
      type: "button",
      disabled: disabled ? "disabled" : undefined,
      onclick: onClick,
    },
    label,
  );
}

function activeActivity() {
  return (
    session.activities.find((activity) => activity.id === currentActivityId) ||
    session.activities[0] ||
    null
  );
}

function questionIndex(activity) {
  const total = activity.questions.length;
  if (!total) return 0;
  const raw = Number(activity.state?.current_question ?? 0);
  return Math.min(Math.max(raw, 0), total - 1);
}

function stageHead(activity) {
  return ALF.el(
    "div",
    { class: "stage-head" },
    ALF.el(
      "div",
      { class: "row" },
      ALF.el("span", { class: "badge" }, KIND_LABEL[activity.kind] || activity.kind),
      ALF.el("h2", { style: "margin: 0" }, activity.title),
    ),
    ALF.el("span", { class: "small muted" }, `${participantCount} participant(s)`),
  );
}

function optionsBars(question, results, revealed) {
  const total = results?.total || 0;
  const wrapper = ALF.el("div", { class: "vote-options" });

  question.options.forEach((option, index) => {
    const count = results?.counts?.[index] || 0;
    const percent = total ? Math.round((count / total) * 100) : 0;
    const correct = revealed && question.correct_index === index;

    wrapper.append(
      ALF.el(
        "div",
        { class: `vote-option${correct ? " correct" : ""}` },
        ALF.el("span", {}, option),
        ALF.el("span", { class: "count" }, `${count} · ${percent}%`),
      ),
    );
  });

  return wrapper;
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(renderStage, 120);
}

function renderStage() {
  const stage = document.getElementById("stage");
  const activity = activeActivity();

  if (!activity) {
    destroyYouTube();
    ALF.clear(stage);
    stage.append(
      empty(
        session.activities.length
          ? "Sélectionnez une activité."
          : "Aucune activité. Configurez-en une dans le tableau de bord.",
      ),
    );
    return;
  }

  if (activity.kind === "video") {
    renderVideo(activity, stage);
    return;
  }

  destroyYouTube();
  ALF.clear(stage);

  if (activity.kind === "wordcloud") {
    renderWordcloud(activity, stage);
  } else {
    renderQuestion(activity, stage);
  }
}

function renderWordcloud(activity, stage) {
  stage.append(stageHead(activity));
  const cloud = ALF.el("div", { id: "cloud" });
  stage.append(cloud);

  const occurrences = occurrencesByActivity[activity.id];
  if (!occurrences) {
    cloud.append(empty("Chargement des mots…"));
    return;
  }

  const entries = Object.entries(occurrences)
    .map(([text, count]) => ({
      text,
      count,
      size: 18 + Math.min(count, 20) * 5,
    }))
    .sort((a, b) => b.count - a.count);

  if (entries.length === 0) {
    cloud.append(empty("En attente des premiers mots…"));
    return;
  }

  if (!window.d3 || !window.d3.layout || !window.d3.layout.cloud) {
    const fallback = ALF.el("div", { class: "fallback-cloud" });
    entries.forEach((entry) => {
      fallback.append(
        ALF.el(
          "span",
          { style: `font-size:${Math.min(entry.size, 64)}px; margin:6px; display:inline-block` },
          entry.text,
        ),
      );
    });
    cloud.append(fallback);
    return;
  }

  const width = cloud.clientWidth || 900;
  const height = cloud.clientHeight || 520;

  d3.layout
    .cloud()
    .size([width, height])
    .words(entries)
    .padding(7)
    .rotate(0)
    .font("Courier New")
    .fontSize((entry) => entry.size)
    .on("end", draw)
    .start();

  function draw(words) {
    d3.select(cloud).selectAll("*").remove();
    const svg = d3
      .select(cloud)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    const group = svg
      .append("g")
      .attr("transform", `translate(${width / 2},${height / 2})`);

    group
      .selectAll("text")
      .data(words)
      .enter()
      .append("text")
      .style("font-family", "Courier New, monospace")
      .style("font-size", (entry) => `${entry.size}px`)
      .style("font-weight", (entry) => (entry.count > 2 ? "bold" : "normal"))
      .style("fill", "#000")
      .attr("text-anchor", "middle")
      .attr("transform", (entry) => `translate(${entry.x},${entry.y})`)
      .text((entry) => entry.text);
  }
}

function renderQuestion(activity, stage) {
  stage.append(stageHead(activity));

  if (activity.questions.length === 0) {
    stage.append(empty("Aucune question pour cette activité."));
    return;
  }

  const index = questionIndex(activity);
  const question = activity.questions[index];
  const state = activity.state || {};
  const results = resultsByActivity[activity.id]?.questions.find(
    (entry) => entry.id === question.id,
  );

  stage.append(
    ALF.el(
      "div",
      { class: "small muted" },
      `Question ${index + 1} / ${activity.questions.length}`,
    ),
  );
  stage.append(ALF.el("div", { class: "big-question" }, question.prompt));
  stage.append(optionsBars(question, results, !!state.revealed));

  const controls = ALF.el("div", { class: "controls" });
  controls.append(
    button(
      "Précédent",
      () => patchState(activity, { current_question: index - 1, revealed: false }),
      false,
      index === 0,
    ),
  );
  controls.append(
    button(
      "Suivant",
      () => patchState(activity, { current_question: index + 1, revealed: false }),
      false,
      index >= activity.questions.length - 1,
    ),
  );
  if (question.kind === "mcq") {
    controls.append(
      button(
        state.revealed ? "Cacher la réponse" : "Révéler",
        () => patchState(activity, { revealed: !state.revealed }),
      ),
    );
  }
  stage.append(controls);
}

function renderVideo(activity, stage) {
  const videoId = activity.config?.video_id;
  if (!videoId) {
    destroyYouTube();
    ALF.clear(stage);
    stage.append(stageHead(activity), empty("Vidéo non configurée."));
    return;
  }

  const needsRebuild =
    !videoFrame ||
    videoFrame.activityId !== activity.id ||
    videoFrame.videoId !== videoId;

  if (needsRebuild) {
    destroyYouTube();
    ALF.clear(stage);
    stage.append(stageHead(activity));

    const wrapper = ALF.el("div", { class: "video-wrap" });
    const playerDiv = ALF.el("div", { class: "yt", id: "yt-player" });
    const overlay = ALF.el("div", { class: "video-question hidden" });
    wrapper.append(playerDiv, overlay);

    const controls = ALF.el("div", { class: "controls" });
    stage.append(wrapper, controls);

    videoFrame = { activityId: activity.id, videoId, overlay, controls };
    createYouTube(videoId, playerDiv);
  }

  updateVideoUI(activity);
}

function updateVideoUI(activity) {
  if (!videoFrame) return;
  const state = activity.state || {};
  const index = questionIndex(activity);
  const question = activity.questions[index];
  const open = !!state.question_open && !!question;

  ALF.clear(videoFrame.overlay);
  videoFrame.overlay.classList.toggle("hidden", !open);

  if (open) {
    const results = resultsByActivity[activity.id]?.questions.find(
      (entry) => entry.id === question.id,
    );
    videoFrame.overlay.append(
      ALF.el(
        "div",
        { class: "small muted" },
        `Question ${index + 1} / ${activity.questions.length}`,
      ),
      ALF.el("div", { class: "big-question" }, question.prompt),
      optionsBars(question, results, !!state.revealed),
    );
  }

  ALF.clear(videoFrame.controls);
  videoFrame.controls.append(
    button("Lire", () => ytPlayer?.playVideo()),
    button("Pause", () => ytPlayer?.pauseVideo()),
  );

  activity.questions.forEach((entry, questionIndexValue) => {
    const label = `Q${questionIndexValue + 1}${
      entry.video_ts !== null && entry.video_ts !== undefined ? ` · ${entry.video_ts}s` : ""
    }`;
    videoFrame.controls.append(
      button(
        label,
        () => openVideoQuestion(activity, questionIndexValue),
        open && questionIndexValue === index,
      ),
    );
  });

  if (open) {
    videoFrame.controls.append(
      button("Fermer la question", () => patchState(activity, { question_open: false })),
    );
    if (question.kind === "mcq") {
      videoFrame.controls.append(
        button(state.revealed ? "Cacher la réponse" : "Révéler", () =>
          patchState(activity, { revealed: !state.revealed }),
        ),
      );
    }
  }
}

function openVideoQuestion(activity, index) {
  const question = activity.questions[index];
  if (question && ytPlayer && question.video_ts !== null && question.video_ts !== undefined) {
    try {
      ytPlayer.seekTo(question.video_ts, true);
      ytPlayer.pauseVideo();
    } catch {
      /* the player may not be ready yet */
    }
  }
  patchState(activity, {
    current_question: index,
    question_open: true,
    revealed: false,
  });
}

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.append(script);
  });
  return ytApiPromise;
}

async function createYouTube(videoId, container) {
  await loadYouTubeApi();
  if (!container.isConnected) return;
  ytPlayer = new window.YT.Player(container, {
    videoId,
    playerVars: { rel: 0, modestbranding: 1 },
    events: {},
  });
}

function destroyYouTube() {
  if (ytPlayer && typeof ytPlayer.destroy === "function") {
    try {
      ytPlayer.destroy();
    } catch {
      /* ignore */
    }
  }
  ytPlayer = null;
  videoFrame = null;
}

async function patchState(activity, patch) {
  const state = { ...(activity.state || {}), ...patch };
  activity.state = state;
  renderStage();

  try {
    await ALF.api(`/activities/${activity.id}`, {
      method: "PATCH",
      body: { state },
    });
  } catch (error) {
    ALF.toast(error.message);
  }
}

async function refreshResults(activity, render = true) {
  if (!activity) return;
  try {
    resultsByActivity[activity.id] = await ALF.api(`/activities/${activity.id}/results`);
  } catch {
    resultsByActivity[activity.id] = {
      activity_id: activity.id,
      kind: activity.kind,
      questions: [],
      words: [],
    };
  }
  if (render) scheduleRender();
}

async function ensureActivityData() {
  const activity = activeActivity();
  if (!activity) return;

  if (activity.kind === "wordcloud") {
    if (!occurrencesByActivity[activity.id]) {
      try {
        const words = await ALF.api(`/activities/${activity.id}/words/public`, {
          auth: false,
        });
        const occurrences = {};
        for (const word of words) {
          occurrences[word.text] = (occurrences[word.text] || 0) + 1;
        }
        occurrencesByActivity[activity.id] = occurrences;
      } catch {
        occurrencesByActivity[activity.id] = {};
      }
    }
    return;
  }

  if (!resultsByActivity[activity.id]) {
    await refreshResults(activity, false);
  }
}

function renderActivityNav() {
  const nav = document.getElementById("activity-nav");
  ALF.clear(nav);

  if (session.activities.length === 0) {
    nav.append(ALF.el("p", { class: "muted small" }, "Aucune activité."));
    return;
  }

  for (const activity of session.activities) {
    nav.append(
      ALF.el(
        "button",
        {
          class: `btn small${activity.id === currentActivityId ? " solid" : ""}`,
          type: "button",
          title: activity.title,
          onclick: () => selectActivity(activity),
        },
        `${KIND_LABEL[activity.kind] || activity.kind} — ${activity.title}`,
      ),
    );
  }
}

async function selectActivity(activity) {
  currentActivityId = activity.id;
  session.current_activity_id = activity.id;
  renderActivityNav();
  renderStage();

  await ensureActivityData();
  renderStage();

  try {
    await ALF.api(`/sessions/${session.id}`, {
      method: "PATCH",
      body: { current_activity_id: activity.id, status: "live" },
    });
  } catch (error) {
    ALF.toast(error.message);
  }
}

async function refetchSession() {
  const fresh = await ALF.api(`/sessions/code/${session.code}`, { auth: false });
  const previousId = currentActivityId;
  session = fresh;
  participantCount = fresh.participant_count || 0;
  currentActivityId = session.activities.some((activity) => activity.id === previousId)
    ? previousId
    : session.current_activity_id || session.activities[0]?.id || null;

  document.getElementById("session-title").textContent = session.title;
  updateParticipantCount();
  renderActivityNav();
  await ensureActivityData();
  renderStage();
}

function applyActivityUpdate(message) {
  const activity = session.activities.find((entry) => entry.id === message.activity_id);
  if (!activity) return;
  activity.title = message.title;
  activity.config = message.config;
  activity.state = message.state;
  activity.position = message.position;
}

async function handleMessage(message) {
  switch (message.type) {
    case "participant_joined":
      participantCount = message.participant_count ?? participantCount;
      updateParticipantCount();
      renderStage();
      break;
    case "session_updated":
      session.status = message.status;
      session.title = message.title;
      document.getElementById("session-title").textContent = session.title;
      if (message.current_activity_id) {
        session.current_activity_id = message.current_activity_id;
        currentActivityId = message.current_activity_id;
      }
      renderActivityNav();
      await ensureActivityData();
      renderStage();
      break;
    case "activity_created":
    case "activity_deleted":
      await refetchSession();
      break;
    case "questions_updated":
      delete resultsByActivity[message.activity_id];
      await refetchSession();
      break;
    case "activity_updated":
      applyActivityUpdate(message);
      await ensureActivityData();
      renderStage();
      break;
    case "word_added":
      if (message.activity_id === currentActivityId) {
        const occurrences = occurrencesByActivity[message.activity_id] || {};
        occurrences[message.text] = (occurrences[message.text] || 0) + 1;
        occurrencesByActivity[message.activity_id] = occurrences;
        scheduleRender();
      }
      break;
    case "response_added":
      if (message.activity_id === currentActivityId) {
        await refreshResults(activeActivity(), false);
        scheduleRender();
      }
      break;
    default:
      break;
  }
}

function connectSocket() {
  if (stopped || !session) return;
  socket = ALF.connect(session.code, handleMessage);
  socket.onclose = () => {
    if (!stopped) reconnectTimer = window.setTimeout(connectSocket, 2000);
  };
}

function updateParticipantCount() {
  document.getElementById("participant-count").textContent = String(participantCount);
}

function joinUrl() {
  const url = new URL("play.html", window.location.href);
  url.search = `?code=${session.code}`;
  return url.toString();
}

function renderQr() {
  const url = joinUrl();
  document.getElementById("join-url").textContent = url;
  const canvas = document.getElementById("qrcode");
  if (window.QRCode) {
    window.QRCode.toCanvas(canvas, url, { width: 220, margin: 1 }, () => {});
  }
}

function setupTimer() {
  const display = document.getElementById("timer");
  const startButton = document.getElementById("timer-start");
  const resetButton = document.getElementById("timer-reset");
  const minutesInput = document.getElementById("timer-minutes");

  let remaining = 0;
  let interval = null;

  function paint() {
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    display.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function stop() {
    if (interval) window.clearInterval(interval);
    interval = null;
    startButton.textContent = "Démarrer";
  }

  startButton.addEventListener("click", () => {
    if (interval) {
      stop();
      return;
    }
    if (remaining <= 0) {
      remaining = Math.max(1, Number(minutesInput.value) || 5) * 60;
    }
    startButton.textContent = "Pause";
    interval = window.setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      paint();
      if (remaining === 0) {
        stop();
        ALF.toast("Temps écoulé.");
      }
    }, 1000);
  });

  resetButton.addEventListener("click", () => {
    stop();
    remaining = 0;
    paint();
  });

  paint();
}

document.getElementById("quit").addEventListener("click", () => {
  stopped = true;
  window.clearTimeout(reconnectTimer);
  if (socket) socket.close();
  window.location.href = "dashboard.html";
});

(async () => {
  try {
    await ALF.requireAuth();
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) throw new Error("Code de session manquant.");

    session = await ALF.api(`/sessions/code/${code}`, { auth: false });
    currentActivityId = session.current_activity_id || session.activities[0]?.id || null;
    participantCount = session.participant_count || 0;

    document.getElementById("session-title").textContent = session.title;
    document.getElementById("session-code").textContent = session.code;

    renderQr();
    updateParticipantCount();
    renderActivityNav();
    await ensureActivityData();
    renderStage();
    connectSocket();
    setupTimer();

    window.addEventListener("resize", scheduleRender);
  } catch (error) {
    ALF.toast(error.message);
  }
})();
