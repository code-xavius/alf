const form = document.getElementById("auth-form");
const errorBox = document.getElementById("error");
const title = document.getElementById("title");
const hint = document.getElementById("hint");
const submitButton = document.getElementById("submit");
const toggleButton = document.getElementById("toggle-signup");
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");

let mode = "login";
let pendingLoads = 0;

function startLoading(message) {
  pendingLoads += 1;
  loadingText.textContent = message;
  loading.classList.remove("hidden");
}

function stopLoading() {
  pendingLoads = Math.max(0, pendingLoads - 1);
  if (pendingLoads === 0) loading.classList.add("hidden");
}

function setMode(nextMode) {
  mode = nextMode;
  const isLogin = mode === "login";
  title.textContent = isLogin ? "Connexion" : "Créer un compte";
  submitButton.textContent = isLogin ? "Se connecter" : "Créer mon compte";
  toggleButton.textContent = isLogin ? "Créer un compte" : "J'ai déjà un compte";
  document.getElementById("password").autocomplete = isLogin
    ? "current-password"
    : "new-password";
}

toggleButton.addEventListener("click", () => {
  setMode(mode === "login" ? "signup" : "login");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.classList.add("hidden");
  submitButton.disabled = true;
  toggleButton.disabled = true;
  startLoading(mode === "signup" ? "Création du compte…" : "Connexion…");

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    if (mode === "signup") {
      const result = await ALF.signup(email, password);
      if (result.needsConfirmation) {
        ALF.toast("Vérifiez votre boîte mail pour confirmer le compte.");
        return;
      }
    } else {
      await ALF.login(email, password);
    }
    window.location.href = "dashboard.html";
  } catch (error) {
    ALF.showError(errorBox, error);
  } finally {
    submitButton.disabled = false;
    toggleButton.disabled = false;
    stopLoading();
  }
});

let configLoading = false;
const configTimer = window.setTimeout(() => {
  configLoading = true;
  startLoading("Démarrage du serveur…");
}, 400);

ALF.getConfig()
  .then((config) => {
    if (config.dev_mode) {
      document.getElementById("dev-note").classList.remove("hidden");
      hint.textContent = "Mode développement : cliquez sur Se connecter pour entrer.";
    }
  })
  .catch((error) => ALF.showError(errorBox, error))
  .finally(() => {
    window.clearTimeout(configTimer);
    if (configLoading) {
      configLoading = false;
      stopLoading();
    }
  });
