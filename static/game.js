const state = window.VALODLE_STATE || {};
const mode = state.mode || "classic";
const variant = state.variant || "endless";
const isDailyMode = variant === "daily";
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
const rankCard = document.getElementById("rankCard");
const rankIcon = document.getElementById("rankIcon");
const rankName = document.getElementById("rankName");
const rankRR = document.getElementById("rankRR");
const rankUpOverlay = document.getElementById("rankUpOverlay");
const rankUpIcon = document.getElementById("rankUpIcon");
const rankUpName = document.getElementById("rankUpName");
const rankUpKicker = document.getElementById("rankUpKicker");
const openLeaderboardBtn = document.getElementById("openLeaderboardBtn");
const dailySubmitOverlay = document.getElementById("dailySubmitOverlay");
const dailySubmitShare = document.getElementById("dailySubmitShare");
const copyShareBtn = document.getElementById("copyShareBtn");
const dailyNameInput = document.getElementById("dailyNameInput");
const submitDailyBtn = document.getElementById("submitDailyBtn");
const skipDailyBtn = document.getElementById("skipDailyBtn");
const dailySubmitMessage = document.getElementById("dailySubmitMessage");
const dailyBoardOverlay = document.getElementById("dailyBoardOverlay");
const dailyBoardShare = document.getElementById("dailyBoardShare");
const dailyLeaderboard = document.getElementById("dailyLeaderboard");
const closeBoardBtn = document.getElementById("closeBoardBtn");

const agentOptions = state.agent_options || [];

let currentSuggestions = [];
let guessedNames = new Set();
let roundStatus = state.status || "playing";
let bonusStatus = (state.bonus && state.bonus.status) || "off";
let activeSkillHints = Array.isArray(state.active_hints) ? state.active_hints : [];
let guessCount = Array.isArray(state.guesses) ? state.guesses.length : 0;
let currentRankIndex = state.rank && Number.isFinite(state.rank.index) ? state.rank.index : 0;
let rankUpTimeoutId = null;
let dailySubmitted = Boolean(state.daily_submitted);
let dailyPromptShown = false;

function formatDailyCountdown(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function getDailyCompleteMessage(outcome) {
  const countdown = formatDailyCountdown(state.daily_seconds_remaining);
  if (outcome === "won") {
    return `Correct. Daily solved. Next daily puzzle in ${countdown}.`;
  }
  return `Out of attempts. Daily complete. Next daily puzzle in ${countdown}.`;
}

function getModeLabel() {
  if (mode === "skill-icon") {
    return "Skill Icon";
  }
  if (mode === "voice-line") {
    return "Voice Line";
  }
  return "Classic";
}

function buildDailyShareText() {
  const solved = roundStatus === "won";
  const attemptsUsed = Math.max(1, guessCount || (Array.isArray(state.guesses) ? state.guesses.length : 0));
  const result = solved ? `${attemptsUsed}/5` : "X/5";
  return `VALODLE Daily ${getModeLabel()} ${result}`;
}

function renderDailyLeaderboard(entries) {
  if (!dailyLeaderboard) {
    return;
  }

  const safeEntries = Array.isArray(entries) ? entries : [];
  if (safeEntries.length === 0) {
    dailyLeaderboard.innerHTML = "<li>No scores yet. Be the first.</li>";
    return;
  }

  dailyLeaderboard.innerHTML = safeEntries
    .map((entry) => {
      const name = escapeHtml(entry.name || "Player");
      const result = entry.solved ? `${entry.attempts}/5` : "X/5";
      return `<li><span>${name}</span><strong>${result}</strong></li>`;
    })
    .join("");
}

async function refreshDailyLeaderboard() {
  if (!isDailyMode) {
    return;
  }

  const response = await fetch(withVariant(`${apiBase}/daily-leaderboard`));
  const data = await response.json();
  if (!response.ok) {
    return;
  }
  renderDailyLeaderboard(data.entries || []);
}

function setDailyLeaderboardButtonVisibility() {
  if (!openLeaderboardBtn) {
    return;
  }
  if (!isDailyMode) {
    openLeaderboardBtn.classList.add("hidden");
    return;
  }
  openLeaderboardBtn.classList.remove("hidden");
}

function openDailySubmitModal() {
  if (!dailySubmitOverlay) {
    return;
  }

  if (dailySubmitShare) {
    dailySubmitShare.textContent = buildDailyShareText();
  }
  if (dailySubmitMessage) {
    dailySubmitMessage.textContent = "";
  }
  dailySubmitOverlay.classList.remove("hidden");
  if (dailyNameInput) {
    dailyNameInput.focus();
  }
}

function closeDailySubmitModal() {
  if (dailySubmitOverlay) {
    dailySubmitOverlay.classList.add("hidden");
  }
}

function openDailyBoardModal() {
  if (dailyBoardShare) {
    dailyBoardShare.textContent = buildDailyShareText();
  }
  if (dailyBoardOverlay) {
    dailyBoardOverlay.classList.remove("hidden");
  }
}

function closeDailyBoardModal() {
  if (dailyBoardOverlay) {
    dailyBoardOverlay.classList.add("hidden");
  }
}

async function showDailyBoardModal() {
  await refreshDailyLeaderboard();
  openDailyBoardModal();
}

function updateDailySubmitButtonState() {
  if (submitDailyBtn) {
    submitDailyBtn.disabled = dailySubmitted;
    submitDailyBtn.textContent = dailySubmitted ? "Submitted" : "Submit";
  }
}

async function submitDailyScore() {
  if (!isDailyMode || !submitDailyBtn || submitDailyBtn.disabled) {
    return;
  }

  const name = String(dailyNameInput && dailyNameInput.value ? dailyNameInput.value : "").trim();
  if (!name) {
    if (dailySubmitMessage) {
      dailySubmitMessage.textContent = "Enter a display name first.";
    }
    return;
  }

  const response = await fetch(withVariant(`${apiBase}/daily-submit`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json();

  if (!response.ok) {
    if (dailySubmitMessage) {
      dailySubmitMessage.textContent = data.message || "Could not submit score.";
    }
    if (data.entries) {
      renderDailyLeaderboard(data.entries);
    }
    await showDailyBoardModal();
    return;
  }

  dailySubmitted = true;
  if (dailySubmitMessage) {
    dailySubmitMessage.textContent = data.message || "Submitted.";
  }
  if (data.entries) {
    renderDailyLeaderboard(data.entries);
  }
  updateDailySubmitButtonState();
  closeDailySubmitModal();
  openDailyBoardModal();
}

async function copyDailyResult() {
  const text = buildDailyShareText();
  try {
    await navigator.clipboard.writeText(text);
    if (dailySubmitMessage) {
      dailySubmitMessage.textContent = "Result copied to clipboard.";
    }
  } catch {
    if (dailySubmitMessage) {
      dailySubmitMessage.textContent = text;
    }
  }
}

async function onDailyRoundComplete() {
  if (!isDailyMode || dailyPromptShown) {
    return;
  }

  dailyPromptShown = true;
  setDailyLeaderboardButtonVisibility();

  if (dailySubmitted) {
    await showDailyBoardModal();
    return;
  }

  openDailySubmitModal();
}

function withVariant(url) {
  return isDailyMode ? `${url}?variant=daily` : url;
}

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
  continueBtn.classList.toggle("hidden", !finished || isDailyMode);
  newGameBtn.classList.toggle("hidden", isDailyMode);
  setDailyLeaderboardButtonVisibility();
}

function renderRank(rank) {
  if (isDailyMode || !rank || !rankCard) {
    if (rankCard) {
      rankCard.classList.add("hidden");
    }
    return;
  }

  rankCard.classList.remove("hidden");
  rankName.textContent = rank.name || "Unranked";
  rankRR.textContent = `${Number(rank.rr || 0)} RR`;
  if (rank.icon_url) {
    rankIcon.src = rank.icon_url;
    rankIcon.alt = `${rank.name || "Unranked"} rank icon`;
  } else {
    rankIcon.removeAttribute("src");
    rankIcon.alt = "Rank icon";
  }

  if (Number.isFinite(rank.index)) {
    currentRankIndex = rank.index;
  }
}

function showRankChangeAnimation(rank, type = "up") {
  if (!rankUpOverlay || !rankUpIcon || !rankUpName || !rank) {
    return;
  }

  const normalizedType = type === "down" ? "down" : "up";
  rankUpOverlay.classList.toggle("demote", normalizedType === "down");
  if (rankUpKicker) {
    rankUpKicker.textContent = normalizedType === "down" ? "Demoted" : "Rank Up!";
  }

  rankUpName.textContent = rank.name || "Rank Up";
  if (rank.icon_url) {
    rankUpIcon.src = rank.icon_url;
    rankUpIcon.alt = `${rank.name || "Rank"} icon`;
  } else {
    rankUpIcon.removeAttribute("src");
    rankUpIcon.alt = "Rank icon";
  }

  rankUpOverlay.classList.remove("hidden");
  if (rankUpTimeoutId) {
    clearTimeout(rankUpTimeoutId);
  }
  rankUpTimeoutId = setTimeout(() => {
    rankUpOverlay.classList.add("hidden");
    rankUpTimeoutId = null;
  }, 1800);
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
      const revealStage = Math.min(guessCount, 4);
      skillIconCenter.innerHTML = `
        <p class="clue-label">Skill Icon</p>
        <img class="skill-icon-main" data-reveal="${revealStage}" src="${clue.image_url}" alt="Skill clue" />
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

function resolveGuessInput(rawValue) {
  const typed = String(rawValue || "").trim();
  if (!typed) {
    return "";
  }

  const normalized = typed.toLowerCase();
  const exact = agentOptions.find((agent) => agent.name.toLowerCase() === normalized && !guessedNames.has(agent.name.toLowerCase()));
  if (exact) {
    return exact.name;
  }

  const firstMatch = agentOptions.find((agent) => {
    const name = agent.name.toLowerCase();
    return name.startsWith(normalized) && !guessedNames.has(name);
  });
  if (firstMatch) {
    return firstMatch.name;
  }

  const firstSuggestion = currentSuggestions[0];
  if (firstSuggestion) {
    return firstSuggestion.name;
  }

  return typed;
}

async function submitGuess(event) {
  event.preventDefault();
  const guess = resolveGuessInput(guessInput.value);

  if (!guess) {
    setMessage("Type an agent name first.", "miss");
    return;
  }

  if (guessedNames.has(guess.toLowerCase())) {
    setMessage("You already guessed that agent this round.", "miss");
    return;
  }

  const response = await fetch(withVariant(`${apiBase}/guess`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guess }),
  });

  const data = await response.json();
  if (!response.ok) {
    setMessage(data.message || "That guess could not be processed.", "miss");
    return;
  }

  const previousRankIndex = currentRankIndex;

  attemptsLeft.textContent = data.attempts_left;
  streakCount.textContent = data.streak;
  if (data.rank) {
    renderRank(data.rank);
  }
  renderGuess(data.guess);
  guessCount += 1;
  if (mode === "skill-icon") {
    activeSkillHints = Array.isArray(data.active_hints) ? data.active_hints : [];
      renderClue(state.clue);
    renderSkillHints();
  } else if (mode === "voice-line") {
    activeSkillHints = Array.isArray(data.active_hints) ? data.active_hints : [];
    renderVoiceHints();
  }
  guessInput.value = "";
  renderSuggestions("");

  if (data.status === "won") {
    if (mode === "skill-icon") {
      guessCount = 4;
      renderClue(state.clue);
    }
    setStatus("won");
    setRoundControls("won");
    renderReveal(data.reveal_agent);
    if (mode === "skill-icon") {
      renderSkillHints();
    } else if (mode === "voice-line") {
      renderVoiceHints();
    }
    renderBonus(data.bonus_status || "pending");
    if (isDailyMode) {
      setMessage(getDailyCompleteMessage("won"), "match");
      await onDailyRoundComplete();
    } else {
      const rankDelta = Number(data.rank && data.rank.delta ? data.rank.delta : 0);
      const deltaText = rankDelta > 0 ? ` +${rankDelta} RR.` : "";
      const rankedUp = data.rank && Number.isFinite(data.rank.index) && data.rank.index > previousRankIndex;
      const rankUpText = rankedUp ? ` Rank up: ${data.rank.name}.` : "";
      if (rankedUp) {
        showRankChangeAnimation(data.rank, "up");
      }
      setMessage(`Correct.${deltaText} Press Enter or Continue for next round.${rankUpText}`, "match");
    }
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
    if (isDailyMode) {
      setMessage(getDailyCompleteMessage("lost"), "miss");
      await onDailyRoundComplete();
    } else {
      const rankDelta = Number(data.rank && data.rank.delta ? data.rank.delta : 0);
      const deltaText = rankDelta < 0 ? ` ${rankDelta} RR.` : "";
      const demoted = data.rank && Number.isFinite(data.rank.index) && data.rank.index < previousRankIndex;
      const demotedText = demoted ? ` Demoted: ${data.rank.name}.` : "";
      if (demoted) {
        showRankChangeAnimation(data.rank, "down");
      }
      setMessage(`Out of attempts.${deltaText} Press Enter or Continue.${demotedText}`, "miss");
    }
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

  const response = await fetch(withVariant("/api/skill-icon/bonus"), {
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
  dailySubmitted = Boolean(data.daily_submitted || false);
  dailyPromptShown = false;
  attemptsLeft.textContent = data.attempts_left;
  streakCount.textContent = data.streak;
  setStatus(data.status);
  setRoundControls(data.status);
  renderReveal(null);
  state.clue = data.clue || state.clue || {};
  state.hints = data.hints || state.hints || {};
  state.bonus = data.bonus || state.bonus || { enabled: false, status: "off", options: ["C", "Q", "E", "X"] };
  if (data.rank) {
    state.rank = data.rank;
    renderRank(data.rank);
  }
  renderClue(state.clue);
  renderBonus("off");
  activeSkillHints = Array.isArray(data.active_hints) ? data.active_hints : [];
  if (mode === "skill-icon") {
    renderSkillHints();
  } else if (mode === "voice-line") {
    renderVoiceHints();
  }
  setMessage(text, "info");
  if (dailySubmitMessage) {
    dailySubmitMessage.textContent = "";
  }
  updateDailySubmitButtonState();
  closeDailySubmitModal();
  closeDailyBoardModal();
  renderSuggestions("");
  guessInput.focus();
}

async function startNewGame() {
  const response = await fetch(withVariant(`${apiBase}/new-game`), { method: "POST" });
  const data = await response.json();
  if (!response.ok) {
    setMessage(data.message || "Could not restart game.", "miss");
    return;
  }
  resetRoundUI(data, "Game restarted.");
}

async function continueRound() {
  const response = await fetch(withVariant(`${apiBase}/next-round`), { method: "POST" });
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
  renderRank(state.rank || null);
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
  if (isDailyMode && (state.status === "won" || state.status === "lost")) {
    setMessage(getDailyCompleteMessage(state.status), state.status === "won" ? "match" : "miss");
  }
  updateDailySubmitButtonState();
  setDailyLeaderboardButtonVisibility();
  if (isDailyMode) {
    refreshDailyLeaderboard();
  }
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

if (submitDailyBtn) {
  submitDailyBtn.addEventListener("click", submitDailyScore);
}

if (copyShareBtn) {
  copyShareBtn.addEventListener("click", copyDailyResult);
}

if (skipDailyBtn) {
  skipDailyBtn.addEventListener("click", async () => {
    closeDailySubmitModal();
    await showDailyBoardModal();
  });
}

if (openLeaderboardBtn) {
  openLeaderboardBtn.addEventListener("click", showDailyBoardModal);
}

if (closeBoardBtn) {
  closeBoardBtn.addEventListener("click", closeDailyBoardModal);
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
  if (!finished || isDailyMode) {
    return;
  }

  event.preventDefault();
  continueRound();
});

seedState();
