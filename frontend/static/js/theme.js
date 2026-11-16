(() => {
  const KEY = "alf_theme";
  let theme = "light";
  try {
    theme = localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    theme = "light";
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
