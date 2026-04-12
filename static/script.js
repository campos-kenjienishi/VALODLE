const state = window.VALODLE_STATE || {};
const agentOptions = state.agent_options || [];

const guessForm = document.getElementById("guessForm");
const guessInput = document.getElementById("guessInput");
const guessList = document.getElementById("guessList");
const messageBox = document.getElementById("messageBox");
const attemptsLeft = document.getElementById("attemptsLeft");
const streakCount = document.getElementById("streakCount");
const statusPill = document.getElementById("statusPill");
const newGameBtn = document.getElementById("newGameBtn");
const continueBtn = document.getElementById("continueBtn");
const revealCard = document.getElementById("revealCard");
const revealTitle = document.getElementById("revealTitle");
const revealImage = document.getElementById("revealImage");
const revealDetails = document.getElementById("revealDetails");
const suggestionList = document.getElementById("suggestionList");

let currentSuggestions = [];
let guessedNames = new Set();

function setMessage(text, tone = "info") {
  messageBox.textContent = text;
  messageBox.dataset.tone = tone;
}

function setStatus(status) {
  statusPill.className = `status-pill ${status}`;
  statusPill.textContent = status === "won" ? "Won" : status === "lost" ? "Lost" : "Playing";
}

function setRoundControls(status) {
  const finished = status === "won" || status === "lost";
  guessInput.disabled = finished;
  guessForm.querySelector("button[type='submit']").disabled = finished;
  continueBtn.classList.toggle("hidden", !finished);
}

function renderReveal(agent) {
  if (!agent) {
    revealCard.classList.add("empty");
    revealCard.classList.remove("has-agent");
    revealTitle.textContent = "The agent will appear here when you win or lose.";
    revealImage.removeAttribute("src");
    revealDetails.innerHTML = "";
    return;
  }

  revealCard.classList.remove("empty");
  revealCard.classList.add("has-agent");
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

  row.innerHTML = `
    <div class="guess-header">
      <img src="${entry.image_url}" alt="${entry.guess}" />
      <strong>${entry.guess}</strong>
    </div>
  `;

  const grid = document.createElement("div");
  grid.className = "feedback-grid";
  entry.feedback.forEach((item) => {
    grid.appendChild(renderFeedbackChip(item));
  });

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

  const response = await fetch("/api/guess", {
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
  guessInput.value = "";
  renderSuggestions("");

  if (data.status === "won") {
    setStatus("won");
    setRoundControls("won");
    setMessage(`Correct. ${data.guess.guess} was the agent. Press Enter or Continue for the next round.`, "match");
    renderReveal(data.reveal_agent);
    return;
  }

  if (data.status === "lost") {
    setStatus("lost");
    setRoundControls("lost");
    setMessage("Out of attempts. Press Enter or Continue for the next round.", "miss");
    renderReveal(data.reveal_agent);
    return;
  }

  setRoundControls("playing");
  setMessage(`Good guess. ${data.attempts_left} attempts remain.`, "partial");
}

async function startNewGame() {
  const response = await fetch("/api/new-game", { method: "POST" });
  const data = await response.json();

  if (!response.ok) {
    setMessage(data.message || "Could not start a new game.", "miss");
    return;
  }

  guessList.innerHTML = "";
  guessedNames = new Set();
  attemptsLeft.textContent = data.attempts_left;
  streakCount.textContent = data.streak;
  setStatus(data.status);
  setRoundControls(data.status);
  renderReveal(null);
  setMessage("Game restarted. Guess the next agent.", "info");
  renderSuggestions("");
  guessInput.focus();
}

async function continueRound() {
  const response = await fetch("/api/next-round", { method: "POST" });
  const data = await response.json();

  if (!response.ok) {
    setMessage(data.message || "Could not continue to the next round.", "miss");
    return;
  }

  guessList.innerHTML = "";
  guessedNames = new Set();
  attemptsLeft.textContent = data.attempts_left;
  streakCount.textContent = data.streak;
  setStatus(data.status);
  setRoundControls(data.status);
  renderReveal(null);
  setMessage("Next round ready. Keep the streak alive.", "info");
  renderSuggestions("");
  guessInput.focus();
}

function renderSuggestions(query) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    currentSuggestions = [];
    suggestionList.innerHTML = "";
    suggestionList.classList.add("hidden");
    return;
  }

  const matches = agentOptions
    .filter((agent) => {
      const normalizedName = agent.name.toLowerCase();
      return normalizedName.startsWith(normalized) && !guessedNames.has(normalizedName);
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
          <span>
            <span class="suggestion-name">${agent.name}</span>
          </span>
        </button>
      `
    )
    .join("");

  suggestionList.classList.remove("hidden");
}

function seedState() {
  guessedNames = new Set();
  attemptsLeft.textContent = state.attempts_left ?? 5;
  streakCount.textContent = state.streak ?? 0;
  setStatus(state.status || "playing");
  setRoundControls(state.status || "playing");
  renderSuggestions(guessInput.value || "");

  if (Array.isArray(state.guesses)) {
    state.guesses.forEach(renderGuess);
  }

  renderReveal(state.reveal_agent || null);
}

guessForm.addEventListener("submit", submitGuess);
newGameBtn.addEventListener("click", startNewGame);
continueBtn.addEventListener("click", continueRound);
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
  const status = statusPill.classList.contains("won") ? "won" : statusPill.classList.contains("lost") ? "lost" : "playing";
  if (event.key === "Enter" && (status === "won" || status === "lost")) {
    event.preventDefault();
    continueRound();
  }
});

guessInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    renderSuggestions("");
  }

  if (event.key === "Enter" && currentSuggestions.length > 0) {
    const exact = currentSuggestions.find(
      (agent) => agent.name.toLowerCase() === guessInput.value.trim().toLowerCase()
    );
    if (!exact) {
      guessInput.value = currentSuggestions[0].name;
      renderSuggestions("");
    }
  }
});

seedState();
