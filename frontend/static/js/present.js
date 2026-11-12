const KIND_LABEL = {
  wordcloud: "Nuage de mots",
  poll: "Vote",
  quiz: "Quiz",
  video: "Quiz vidéo",
};

let activity = null;
let participantCount = 0;
let results = null;
let occurrences = null;
let socket = null;
let stopped = false;
let reconnectTimer = null;

let renderTimer = null;
let ytPlayer = null;
let ytApiPromise = null;
let videoFrame = null;

let participants = [];

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

function questionIndex() {
  const total = activity.questions.length;
  if (!total) return 0;
  const raw = Number(activity.state?.current_question ?? 0);
  return Math.min(Math.max(raw, 0), total - 1);
}

function stageHead() {
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

function optionsBars(question, result, revealed) {
  const total = result?.total || 0;
  const wrapper = ALF.el("div", { class: "vote-options" });

  question.options.forEach((option, index) => {
    const count = result?.counts?.[index] || 0;
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
  updateParticipantCount();
  const stage = document.getElementById("stage");
  if (!activity) {
    destroyYouTube();
    ALF.clear(stage);
    stage.append(empty("Activité introuvable."));
    return;
  }

  if (activity.kind === "video") {
    renderVideo(stage);
    return;
  }

  destroyYouTube();
  ALF.clear(stage);

  if (activity.kind === "wordcloud") {
    renderWordcloud(stage);
  } else {
    renderQuestion(stage);
  }
}

function renderWordcloud(stage) {
  stage.append(stageHead());
  const cloud = ALF.el("div", { id: "cloud" });
  stage.append(cloud);

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

function renderQuestion(stage) {
  stage.append(stageHead());

  if (activity.questions.length === 0) {
    stage.append(empty("Aucune question pour cette activité."));
    return;
  }

  const index = questionIndex();
  const question = activity.questions[index];
  const state = activity.state || {};
  const result = results?.questions.find((entry) => entry.id === question.id);

  stage.append(
    ALF.el(
      "div",
      { class: "small muted" },
      `Question ${index + 1} / ${activity.questions.length}`,
    ),
  );
  stage.append(ALF.el("div", { class: "big-question" }, question.prompt));
  stage.append(optionsBars(question, result, !!state.revealed));

  const controls = ALF.el("div", { class: "controls" });
  controls.append(
    button(
      "Précédent",
      () => patchState({ current_question: index - 1, revealed: false }),
      false,
      index === 0,
    ),
  );
  controls.append(
    button(
      "Suivant",
      () => patchState({ current_question: index + 1, revealed: false }),
      false,
      index >= activity.questions.length - 1,
    ),
  );
  if (question.kind === "mcq") {
    controls.append(
      button(state.revealed ? "Cacher la réponse" : "Révéler", () =>
        patchState({ revealed: !state.revealed }),
      ),
    );
  }
  stage.append(controls);
}

function renderVideo(stage) {
  const videoId = activity.config?.video_id;
  if (!videoId) {
    destroyYouTube();
    ALF.clear(stage);
    stage.append(stageHead(), empty("Vidéo non configurée."));
    return;
  }

  const needsRebuild =
    !videoFrame || videoFrame.activityId !== activity.id || videoFrame.videoId !== videoId;

  if (needsRebuild) {
    destroyYouTube();
    ALF.clear(stage);
    stage.append(stageHead());

    const wrapper = ALF.el("div", { class: "video-wrap" });
    const playerDiv = ALF.el("div", { class: "yt", id: "yt-player" });
    const overlay = ALF.el("div", { class: "video-question hidden" });
    wrapper.append(playerDiv, overlay);

    const controls = ALF.el("div", { class: "controls" });
    stage.append(wrapper, controls);

    videoFrame = { activityId: activity.id, videoId, overlay, controls };
    createYouTube(videoId, playerDiv);
  }

  updateVideoUI();
}

function updateVideoUI() {
  if (!videoFrame) return;
  const state = activity.state || {};
  const index = questionIndex();
  const question = activity.questions[index];
  const open = !!state.question_open && !!question;

  ALF.clear(videoFrame.overlay);
  videoFrame.overlay.classList.toggle("hidden", !open);

  if (open) {
    const result = results?.questions.find((entry) => entry.id === question.id);
    videoFrame.overlay.append(
      ALF.el(
        "div",
        { class: "small muted" },
        `Question ${index + 1} / ${activity.questions.length}`,
      ),
      ALF.el("div", { class: "big-question" }, question.prompt),
      optionsBars(question, result, !!state.revealed),
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
        () => openVideoQuestion(questionIndexValue),
        open && questionIndexValue === index,
      ),
    );
  });

  if (open) {
    videoFrame.controls.append(
      button("Fermer la question", () => patchState({ question_open: false })),
    );
    if (question.kind === "mcq") {
      videoFrame.controls.append(
        button(state.revealed ? "Cacher la réponse" : "Révéler", () =>
          patchState({ revealed: !state.revealed }),
        ),
      );
    }
  }
}

function openVideoQuestion(index) {
  const question = activity.questions[index];
  if (question && ytPlayer && question.video_ts !== null && question.video_ts !== undefined) {
    try {
      ytPlayer.seekTo(question.video_ts, true);
      ytPlayer.pauseVideo();
    } catch {
      /* the player may not be ready yet */
    }
  }
  patchState({ current_question: index, question_open: true, revealed: false });
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

async function patchState(patch) {
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

async function refreshResults(render = true) {
  if (!activity || activity.kind === "wordcloud") return;
  try {
    results = await ALF.api(`/activities/${activity.id}/results`);
  } catch {
    results = { activity_id: activity.id, kind: activity.kind, questions: [], words: [] };
  }
  if (render) scheduleRender();
}

async function loadWords() {
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

function questionSignature() {
  return activity ? activity.questions.map((question) => question.id).join(",") : "";
}

async function handleMessage(message) {
  switch (message.type) {
    case "participant_joined":
      participantCount = message.participant_count ?? participantCount;
      renderStage();
      if (participantsOpen()) await loadParticipants();
      break;
    case "participant_banned":
    case "participant_unbanned":
      if (participantsOpen()) await loadParticipants();
      break;
    case "activity_updated": {
      const previousSignature = questionSignature();
      activity = message.activity;
      participantCount = activity.participant_count ?? participantCount;
      document.getElementById("activity-title").textContent = activity.title;
      document.getElementById("activity-code").textContent = activity.code;
      if (activity.kind !== "wordcloud" && questionSignature() !== previousSignature) {
        results = null;
        await refreshResults(false);
      }
      renderStage();
      break;
    }
    case "word_added":
      if (occurrences) {
        occurrences[message.text] = (occurrences[message.text] || 0) + 1;
        scheduleRender();
      }
      break;
    case "response_added":
      await refreshResults(false);
      scheduleRender();
      break;
    case "activity_deleted":
      stopped = true;
      ALF.toast("L'activité a été supprimée.");
      window.setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 1200);
      break;
    default:
      break;
  }
}

function updateParticipantCount() {
  document.getElementById("participant-count").textContent = String(participantCount);
}

function renderParticipants() {
  const target = document.getElementById("participants-list");
  ALF.clear(target);

  if (participants.length === 0) {
    target.append(ALF.el("p", { class: "muted small" }, "Aucun participant."));
    return;
  }

  for (const participant of participants) {
    const banned = participant.banned;
    const meta = [
      participant.ip || "IP inconnue",
      participant.user_agent || "navigateur inconnu",
      banned
        ? `exclu jusqu'à ${ALF.formatDate(participant.banned_until)}`
        : `arrivé le ${ALF.formatDate(participant.created_at)}`,
    ].join(" · ");

    target.append(
      ALF.el(
        "article",
        { class: "participant" },
        ALF.el(
          "div",
          { class: "participant-head" },
          ALF.el("strong", {}, participant.nickname),
          banned
            ? button("Réactiver", () => setBan(participant, 0))
            : button("Exclure", () => setBan(participant, banMinutes())),
        ),
        ALF.el("div", { class: "participant-meta" }, meta),
      ),
    );
  }
}

async function loadParticipants() {
  try {
    participants = await ALF.api(`/activities/${activity.id}/participants`);
    renderParticipants();
  } catch (error) {
    ALF.toast(error.message);
  }
}

function banMinutes() {
  return Number(document.getElementById("ban-minutes").value) || 10;
}

async function setBan(participant, minutes) {
  try {
    await ALF.api(`/activities/${activity.id}/participants/${participant.id}/ban`, {
      method: "POST",
      body: { minutes },
    });
    await loadParticipants();
    ALF.toast(
      minutes > 0
        ? `${participant.nickname} exclu ${minutes} min.`
        : `${participant.nickname} réactivé.`,
    );
  } catch (error) {
    ALF.toast(error.message);
  }
}

function participantsOpen() {
  return !document.getElementById("participants-panel").classList.contains("hidden");
}

function connectSocket() {
  if (stopped || !activity) return;
  socket = ALF.connect(activity.code, handleMessage);
  socket.onclose = () => {
    if (!stopped) reconnectTimer = window.setTimeout(connectSocket, 2000);
  };
}

function joinUrl() {
  const url = new URL("play.html", window.location.href);
  url.search = `?code=${activity.code}`;
  return url.toString();
}

function renderQr() {
  const url = joinUrl();
  document.getElementById("join-url").textContent = url;
  const target = document.getElementById("qrcode");
  ALF.clear(target);

  if (typeof qrcode !== "function") {
    target.append(ALF.el("p", { class: "small muted" }, url));
    return;
  }

  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  target.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
}

document.getElementById("participants-toggle").addEventListener("click", async () => {
  const panel = document.getElementById("participants-panel");
  const hidden = panel.classList.toggle("hidden");
  document.getElementById("participants-toggle").textContent = hidden ? "Afficher" : "Masquer";
  if (!hidden) await loadParticipants();
});

document.getElementById("participants-refresh").addEventListener("click", loadParticipants);

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
    if (!code) throw new Error("Code d'activité manquant.");

    activity = await ALF.api(`/activities/code/${code}`, { auth: false });
    participantCount = activity.participant_count || 0;

    document.getElementById("activity-title").textContent = activity.title;
    document.getElementById("activity-code").textContent = activity.code;
    document.getElementById("config-link").href = `activity.html?id=${activity.id}`;

    if (activity.kind === "wordcloud") {
      await loadWords();
    } else {
      await refreshResults(false);
    }

    renderQr();
    renderStage();
    connectSocket();

    window.addEventListener("resize", scheduleRender);
  } catch (error) {
    ALF.toast(error.message);
  }
})();
