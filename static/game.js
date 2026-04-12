const state = window.VALODLE_STATE || {};
const mode = state.mode || "classic";
const apiBase = `/api/${mode}`;

const guessForm = document.getElementById("guessForm");
const guessInput = document.getElementById("guessInput");
const guessList = document.getElementById("guessList");
const messageBox = document.getElementById("messageBox");
const attemptsLeft = document.getElementById("attemptsLeft");
const streakCount = document.getElementById("streakCount");
const statusPill = document.getElementById("statusPill");
const newGameBtn = document.getElementById("newGameBtn");
const continueBtn = document.getElementById("continueBtn");
const backBtn = document.getElementById("backBtn");
const revealCard = document.getElementById("revealCard");
const revealTitle = document.getElementById("revealTitle");
const revealImage = document.getElementById("revealImage");
const revealDetails = document.getElementById("revealDetails");
const suggestionList = document.getElementById("suggestionList");
const clueCard = document.getElementById("clueCard");
const feedbackLegend = document.querySelector(".feedback-legend");
const skillIconCenter = document.getElementById("skillIconCenter");
const bonusBox = document.getElementById("bonusBox");
const bonusKeybindGrid = document.getElementById("bonusKeybindGrid");
const bonusMessage = document.getElementById("bonusMessage");

const agentOptions = state.agent_options || [];

let currentSuggestions = [];
let guessedNames = new Set();
let roundStatus = state.status || "playing";
let bonusStatus = (state.bonus && state.bonus.status) || "off";
let activeSkillHints = Array.isArray(state.active_hints) ? state.active_hints : [];
let guessCount = Array.isArray(state.guesses) ? state.guesses.length : 0;

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSkillHints() {
  if (mode !== "skill-icon") {
    return;
  }

  const hints = state.hints || {};
  const roundFinished = roundStatus === "won" || roundStatus === "lost";
  const typeUnlocked = bonusStatus === "solved" || roundStatus === "lost";
  const functionHint = String(hints.function || "").trim();
  const skillName = String(hints.skill_name || "").trim();
  const typeHint = String(hints.skill_type || "").trim();

  const nameRemaining = 2 - guessCount;
  const typeRemaining = 4 - guessCount;

  const functionValue = functionHint
    ? functionHint
    : "not set";

  const nameValue = skillName
    ? (!roundFinished && nameRemaining > 0
      ? `unlocks in ${nameRemaining} attempt${nameRemaining === 1 ? "" : "s"}`
      : skillName)
    : "not set";

  const typeValue = typeHint
    ? (!typeUnlocked
      ? "unlocks after bonus answer"
      : (!roundFinished && typeRemaining > 0
      ? `unlocks in ${typeRemaining} attempt${typeRemaining === 1 ? "" : "s"}`
      : typeHint))
    : "not set";

  const items = `
    <li><strong>Function:</strong> ${escapeHtml(functionValue)}</li>
    <li><strong>Name:</strong> ${escapeHtml(nameValue)}</li>
    <li><strong>Type:</strong> ${escapeHtml(typeValue)}</li>
  `;

  clueCard.innerHTML = `
    <p class="clue-label">Hints</p>
    <ul class="hint-list">${items}</ul>
  `;
}

function renderVoiceHints() {
  if (mode !== "voice-line") {
    return;
  }

  const hints = state.hints || {};
  const roundFinished = roundStatus === "won" || roundStatus === "lost";
  const castHint = String(hints.cast_hint || "").trim();
  const audioUrl = String(hints.audio_url || "").trim();
  const castRemaining = 2 - guessCount;
  const audioRemaining = 4 - guessCount;

  const castValue = castHint
    ? (!roundFinished && castRemaining > 0
      ? `unlocks in ${castRemaining} attempt${castRemaining === 1 ? "" : "s"}`
      : castHint)
    : "not set";

  let audioValueHtml = "not set";
  if (audioUrl) {
    if (!roundFinished && audioRemaining > 0) {
      audioValueHtml = `unlocks in ${audioRemaining} attempt${audioRemaining === 1 ? "" : "s"}`;
    } else {
      audioValueHtml = `<audio controls preload="none" src="${escapeHtml(audioUrl)}"></audio>`;
    }
  }

  clueCard.innerHTML = `
    <p class="clue-label">Hints</p>
    <ul class="hint-list">
      <li><strong>Cast:</strong> ${escapeHtml(castValue)}</li>
      <li><strong>Audio:</strong> ${audioValueHtml}</li>
    </ul>
  `;
}

function setMessage(text, tone = "info") {
  messageBox.textContent = text;
  messageBox.dataset.tone = tone;
}

function setStatus(status) {
  roundStatus = status;
  statusPill.className = `status-pill ${status}`;
  statusPill.textContent = status === "won" ? "Won" : status === "lost" ? "Lost" : "Playing";
}

function setRoundControls(status) {
  const finished = status === "won" || status === "lost";
  guessInput.disabled = finished;
  guessForm.querySelector("button[type='submit']").disabled = finished;
  continueBtn.classList.toggle("hidden", !finished);
}

function renderClue(clue) {
  if (!clue) {
    clueCard.innerHTML = "";
    if (skillIconCenter) {
      skillIconCenter.classList.add("hidden");
      skillIconCenter.innerHTML = "";
    }
    return;
  }

  if (clue.type === "image") {
    if (skillIconCenter) {
      skillIconCenter.innerHTML = `
        <p class="clue-label">Skill Icon</p>
        <img class="skill-icon-main" src="${clue.image_url}" alt="Skill clue" />
      `;
      skillIconCenter.classList.remove("hidden");
    }
    renderSkillHints();
    return;
  }

  if (clue.type === "voice") {
    if (skillIconCenter) {
      const textBlock = clue.voice_text ? `<blockquote class="voice-line-main">${escapeHtml(clue.voice_text)}</blockquote>` : "";
      skillIconCenter.innerHTML = `
        <p class="clue-label">Voice Line</p>
        ${textBlock}
      `;
      skillIconCenter.classList.remove("hidden");
    }
    renderVoiceHints();
    return;
  }

  if (skillIconCenter) {
    skillIconCenter.classList.add("hidden");
    skillIconCenter.innerHTML = "";
  }

  clueCard.innerHTML = `
    <p class="clue-label">Classic</p>
    <p class="clue-text">${clue.body}</p>
  `;
}

function renderBonus(status) {
  if (mode !== "skill-icon" || roundStatus !== "won") {
    bonusBox.classList.add("hidden");
    bonusStatus = "off";
    return;
  }

  bonusBox.classList.remove("hidden");
  bonusStatus = status || bonusStatus || "pending";

  const options = (state.bonus && state.bonus.options) || ["C", "Q", "E", "X"];
  bonusKeybindGrid.innerHTML = options
    .map((keybind) => `<button type="button" class="ghost-button keybind-btn" data-keybind="${keybind}">${keybind}</button>`)
    .join("");

  const buttons = bonusKeybindGrid.querySelectorAll("button");

  if (bonusStatus === "solved") {
    buttons.forEach((button) => {
      button.disabled = true;
    });
    bonusMessage.textContent = "Bonus solved. Nice read.";
    bonusMessage.dataset.tone = "match";
  } else {
    buttons.forEach((button) => {
      button.disabled = false;
    });
    bonusMessage.textContent = "";
    bonusMessage.dataset.tone = "";
  }
}

function handleBonusAnswer(keybind) {
  if (mode !== "skill-icon") {
    return;
  }

  const normalized = String(keybind || "").trim().toUpperCase();
  if (!normalized) {
    return;
  }

  submitBonus({ target: { dataset: { keybind: normalized } } });
}

function renderReveal(agent) {
  if (!agent) {
    revealCard.classList.add("empty");
    revealCard.classList.remove("has-agent");
    revealCard.classList.remove("loss-reveal");
    revealTitle.textContent = "The agent will appear here when you win or lose.";
    revealImage.removeAttribute("src");
    revealDetails.innerHTML = "";
    return;
  }

  revealCard.classList.remove("empty");
  revealCard.classList.add("has-agent");
  revealCard.classList.toggle("loss-reveal", roundStatus === "lost");
  revealTitle.textContent = `The agent was ${agent.name}`;
  revealImage.src = agent.image_url;
  revealImage.alt = agent.name;
  revealDetails.innerHTML = `
    <div><strong>Role:</strong> ${agent.role}</div>
    <div><strong>Nationality:</strong> ${agent.nationality}</div>
    <div><strong>Color palette:</strong> ${agent.color_palette}</div>
  `;
}

function renderFeedbackChip(item) {
  const chip = document.createElement("div");
  chip.className = `feedback-chip ${item.status}`;
  chip.innerHTML = `
    <span>${item.label}</span>
    <strong>${item.guess}</strong>
  `;
  return chip;
}

function renderGuess(entry) {
  guessedNames.add(entry.guess.toLowerCase());

  const row = document.createElement("article");
  row.className = "guess-row";
  if (mode === "skill-icon" || mode === "voice-line") {
    row.classList.add("guess-row-skill", entry.is_correct ? "match" : "miss");
    row.innerHTML = `
      <div class="guess-header guess-header-compact">
        <img src="${entry.image_url}" alt="${entry.guess}" />
        <strong>${entry.guess}</strong>
      </div>
    `;
    guessList.prepend(row);
    return;
  }

  row.innerHTML = `
    <div class="guess-header">
      <img src="${entry.image_url}" alt="${entry.guess}" />
      <strong>${entry.guess}</strong>
    </div>
  `;

  const grid = document.createElement("div");
  grid.className = "feedback-grid";
  entry.feedback.forEach((item) => grid.appendChild(renderFeedbackChip(item)));

  row.appendChild(grid);
  guessList.prepend(row);
}

async function submitGuess(event) {
  event.preventDefault();
  const guess = guessInput.value.trim();

  if (!guess) {
    setMessage("Type an agent name first.", "miss");
    return;
  }

  const response = await fetch(`${apiBase}/guess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guess }),
  });

  const data = await response.json();
  if (!response.ok) {
    setMessage(data.message || "That guess could not be processed.", "miss");
    return;
  }

  attemptsLeft.textContent = data.attempts_left;
  streakCount.textContent = data.streak;
  renderGuess(data.guess);
  guessCount += 1;
  if (mode === "skill-icon") {
    activeSkillHints = Array.isArray(data.active_hints) ? data.active_hints : [];
    renderSkillHints();
  } else if (mode === "voice-line") {
    activeSkillHints = Array.isArray(data.active_hints) ? data.active_hints : [];
    renderVoiceHints();
  }
  guessInput.value = "";
  renderSuggestions("");

  if (data.status === "won") {
    setStatus("won");
    setRoundControls("won");
    renderReveal(data.reveal_agent);
    if (mode === "skill-icon") {
      renderSkillHints();
    } else if (mode === "voice-line") {
      renderVoiceHints();
    }
    renderBonus(data.bonus_status || "pending");
    setMessage("Correct. Press Enter or Continue for next round.", "match");
    return;
  }

  if (data.status === "lost") {
    setStatus("lost");
    setRoundControls("lost");
    renderReveal(data.reveal_agent);
    if (mode === "skill-icon") {
      renderSkillHints();
    } else if (mode === "voice-line") {
      renderVoiceHints();
    }
    renderBonus("off");
    setMessage("Out of attempts. Press Enter or Continue.", "miss");
    return;
  }

  setRoundControls("playing");
  setMessage(`Good guess. ${data.attempts_left} attempts remain.`, "partial");
}

async function submitBonus(event) {
  const keybind = String(event?.target?.dataset?.keybind || "").trim().toUpperCase();
  if (mode !== "skill-icon" || !keybind) {
    return;
  }

  const response = await fetch("/api/skill-icon/bonus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bonus: keybind }),
  });
  const data = await response.json();

  if (!response.ok) {
    bonusMessage.textContent = data.message || "Bonus check failed.";
    bonusMessage.dataset.tone = "miss";
    return;
  }

  if (data.correct) {
    bonusMessage.textContent = `Correct. ${keybind} is the right keybind.`;
    bonusMessage.dataset.tone = "match";
    bonusStatus = "solved";
    renderBonus("solved");
    renderSkillHints();
  } else {
    bonusMessage.textContent = `Not ${keybind}. Try again.`;
    bonusMessage.dataset.tone = "miss";
  }
}

function resetRoundUI(data, text) {
  guessList.innerHTML = "";
  guessedNames = new Set();
  guessCount = 0;
  attemptsLeft.textContent = data.attempts_left;
  streakCount.textContent = data.streak;
  setStatus(data.status);
  setRoundControls(data.status);
  renderReveal(null);
  state.clue = data.clue || state.clue || {};
  state.hints = data.hints || state.hints || {};
  state.bonus = data.bonus || state.bonus || { enabled: false, status: "off", options: ["C", "Q", "E", "X"] };
  renderClue(state.clue);
  renderBonus("off");
  activeSkillHints = Array.isArray(data.active_hints) ? data.active_hints : [];
  if (mode === "skill-icon") {
    renderSkillHints();
  } else if (mode === "voice-line") {
    renderVoiceHints();
  }
  setMessage(text, "info");
  renderSuggestions("");
  guessInput.focus();
}

async function startNewGame() {
  const response = await fetch(`${apiBase}/new-game`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) {
    setMessage(data.message || "Could not restart game.", "miss");
    return;
  }
  resetRoundUI(data, "Game restarted.");
}

async function continueRound() {
  const response = await fetch(`${apiBase}/next-round`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) {
    setMessage(data.message || "Could not continue.", "miss");
    return;
  }
  resetRoundUI(data, "Next round ready.");
}

function renderSuggestions(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized || guessInput.disabled) {
    currentSuggestions = [];
    suggestionList.innerHTML = "";
    suggestionList.classList.add("hidden");
    return;
  }

  const matches = agentOptions
    .filter((agent) => {
      const n = agent.name.toLowerCase();
      return n.startsWith(normalized) && !guessedNames.has(n);
    })
    .slice(0, 8);

  currentSuggestions = matches;
  if (matches.length === 0) {
    suggestionList.innerHTML = "";
    suggestionList.classList.add("hidden");
    return;
  }

  suggestionList.innerHTML = matches
    .map(
      (agent) => `
        <button type="button" class="suggestion-item" data-name="${agent.name}">
          <img src="${agent.image_url}" alt="${agent.name}" />
          <span class="suggestion-name">${agent.name}</span>
        </button>
      `
    )
    .join("");

  suggestionList.classList.remove("hidden");
}

function seedState() {
  guessedNames = new Set();
  if (feedbackLegend) {
    feedbackLegend.classList.toggle("hidden", mode === "skill-icon" || mode === "voice-line");
  }
  attemptsLeft.textContent = state.attempts_left ?? 5;
  streakCount.textContent = state.streak ?? 0;
  setStatus(state.status || "playing");
  setRoundControls(state.status || "playing");
  renderClue(state.clue);
  renderBonus(state.bonus ? state.bonus.status : "off");
  activeSkillHints = Array.isArray(state.active_hints) ? state.active_hints : [];
  if (mode === "skill-icon") {
    renderSkillHints();
  } else if (mode === "voice-line") {
    renderVoiceHints();
  }

  if (Array.isArray(state.guesses)) {
    guessCount = state.guesses.length;
    state.guesses.forEach(renderGuess);
  }

  renderReveal(state.reveal_agent || null);
  renderSuggestions(guessInput.value || "");
}

guessForm.addEventListener("submit", submitGuess);
newGameBtn.addEventListener("click", startNewGame);
continueBtn.addEventListener("click", continueRound);
if (bonusKeybindGrid) {
  bonusKeybindGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".keybind-btn");
    if (!button || button.disabled) {
      return;
    }
    submitBonus({ target: button });
  });
}

if (backBtn) {
  backBtn.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/";
    }
  });
}

guessInput.addEventListener("input", (event) => {
  renderSuggestions(event.target.value);
});

guessInput.addEventListener("focus", () => {
  renderSuggestions(guessInput.value);
});

suggestionList.addEventListener("click", (event) => {
  const button = event.target.closest(".suggestion-item");
  if (!button) {
    return;
  }

  guessInput.value = button.dataset.name || "";
  renderSuggestions("");
  guessInput.focus();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".guess-input-wrap")) {
    renderSuggestions("");
  }
});

document.addEventListener("keydown", (event) => {
  const bonusReady = mode === "skill-icon" && roundStatus === "won" && bonusStatus !== "solved";
  if (bonusReady) {
    const keybind = String(event.key || "").trim().toUpperCase();
    if (["C", "Q", "E", "X"].includes(keybind)) {
      event.preventDefault();
      handleBonusAnswer(keybind);
      return;
    }
  }

  if (event.key !== "Enter") {
    return;
  }

  const finished = roundStatus === "won" || roundStatus === "lost";
  if (!finished) {
    return;
  }

  event.preventDefault();
  continueRound();
});

seedState();
