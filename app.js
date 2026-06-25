const defaultSchedule = [
  { type: "blind", minutes: 20, small: 25, big: 50, ante: 0 },
  { type: "blind", minutes: 20, small: 50, big: 100, ante: 0 },
  { type: "blind", minutes: 20, small: 100, big: 200, ante: 25 },
  { type: "blind", minutes: 20, small: 200, big: 400, ante: 50 },
  { type: "break", minutes: 10, small: 0, big: 0, ante: 0 },
  { type: "blind", minutes: 20, small: 400, big: 800, ante: 100 },
  { type: "blind", minutes: 20, small: 800, big: 1600, ante: 200 },
  { type: "blind", minutes: 20, small: 1600, big: 3200, ante: 400 },
  { type: "blind", minutes: 20, small: 3200, big: 6400, ante: 800 },
  { type: "blind", minutes: 20, small: 6400, big: 12800, ante: 1600 },
];

const els = {
  appShell: document.querySelector("#appShell"),
  levelLabel: document.querySelector("#levelLabel"),
  timeDisplay: document.querySelector("#timeDisplay"),
  statusText: document.querySelector("#statusText"),
  smallBlind: document.querySelector("#smallBlind"),
  bigBlind: document.querySelector("#bigBlind"),
  ante: document.querySelector("#ante"),
  nextLevel: document.querySelector("#nextLevel"),
  currentTime: document.querySelector("#currentTime"),
  elapsedTime: document.querySelector("#elapsedTime"),
  nextBreakTime: document.querySelector("#nextBreakTime"),
  progressBar: document.querySelector("#progressBar"),
  startPauseBtn: document.querySelector("#startPauseBtn"),
  startPauseIcon: document.querySelector("#startPauseIcon"),
  startPauseText: document.querySelector("#startPauseText"),
  prevBtn: document.querySelector("#prevBtn"),
  nextBtn: document.querySelector("#nextBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  scheduleList: document.querySelector("#scheduleList"),
  addLevelBtn: document.querySelector("#addLevelBtn"),
  addBreakBtn: document.querySelector("#addBreakBtn"),
  defaultMinutes: document.querySelector("#defaultMinutes"),
  applyMinutesBtn: document.querySelector("#applyMinutesBtn"),
  currentMinutes: document.querySelector("#currentMinutes"),
  currentSmall: document.querySelector("#currentSmall"),
  currentBig: document.querySelector("#currentBig"),
  currentAnte: document.querySelector("#currentAnte"),
  anteToggle: document.querySelector("#anteToggle"),
  autoBigToggle: document.querySelector("#autoBigToggle"),
  doubleCurrentBtn: document.querySelector("#doubleCurrentBtn"),
  applyCurrentBtn: document.querySelector("#applyCurrentBtn"),
  cascadeLevelsBtn: document.querySelector("#cascadeLevelsBtn"),
  editorHint: document.querySelector("#editorHint"),
  soundToggle: document.querySelector("#soundToggle"),
  toggleSettingsBtn: document.querySelector("#toggleSettingsBtn"),
  fullscreenBtn: document.querySelector("#fullscreenBtn"),
};

let schedule = loadSchedule();
let currentLevel = 0;
let remainingSeconds = getLevelSeconds(0);
let running = false;
let soundEnabled = true;
let anteEnabled = localStorage.getItem("pokerAnteEnabled") !== "false";
let lastTick = null;
let rafId = null;
let elapsedSeconds = 0;
let settingsClosedBeforeFullscreen = false;
let minuteAnnouncements = new Set();
let finalCountdownAnnounced = new Set();
let tournamentStartAnnounced = false;
let levelStartToneTimeout = null;
let audioContext = null;
let selectedVoice = null;
const levelStartSoundUrl = "assets/seatbelt-ding-dong.mp3?v=20260625-1637";
const levelStartAudio = document.createElement("audio");
levelStartAudio.preload = "auto";
levelStartAudio.src = levelStartSoundUrl;
levelStartAudio.volume = 1;
if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener?.("voiceschanged", selectEnglishVoice);
}

function loadSchedule() {
  try {
    const stored = JSON.parse(localStorage.getItem("pokerBlindSchedule") || "null");
    if (Array.isArray(stored) && stored.length) return stored.map(normalizeLevel);
  } catch {
    localStorage.removeItem("pokerBlindSchedule");
  }
  return defaultSchedule.map(normalizeLevel);
}

function saveSchedule() {
  localStorage.setItem("pokerBlindSchedule", JSON.stringify(schedule));
}

function normalizeLevel(level) {
  const type = level.type === "break" ? "break" : "blind";
  return {
    type,
    minutes: clampNumber(level.minutes, 1, 120, type === "break" ? 10 : 20),
    small: type === "break" ? 0 : clampNumber(level.small, 0, 99999999, 0),
    big: type === "break" ? 0 : clampNumber(level.big, 0, 99999999, 0),
    ante: type === "break" ? 0 : clampNumber(level.ante, 0, 99999999, 0),
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function getLevelSeconds(index) {
  return schedule[index].minutes * 60;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatLongTime(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatNumber(number) {
  return Number(number).toLocaleString("en-US");
}

function formatLevel(level) {
  if (!level) return "Final Level";
  if (level.type === "break") return `Break ${level.minutes} min`;
  return `${formatNumber(level.small)} / ${formatNumber(level.big)} / Ante ${formatNumber(getAnteValue(level.big, level.ante))}`;
}

function formatNextLevel(level) {
  if (!level) return "Final Level";
  if (level.type === "break") return `Next Break: ${level.minutes} min`;
  return `Next Level: ${formatNumber(level.small)} / ${formatNumber(level.big)} / Ante ${formatNumber(getAnteValue(level.big, level.ante))}`;
}

function getAnteValue(big, fallback = 0) {
  if (!anteEnabled) return 0;
  return clampNumber(Number(big) / 5, 0, 99999999, fallback);
}

function getSecondsUntilNextBreak() {
  if (schedule[currentLevel].type === "break") return remainingSeconds;

  let seconds = remainingSeconds;
  for (let index = currentLevel + 1; index < schedule.length; index += 1) {
    if (schedule[index].type === "break") return seconds;
    seconds += getLevelSeconds(index);
  }
  return null;
}

function updateAuxiliaryDisplays() {
  const now = new Date();
  els.currentTime.textContent = now.toLocaleTimeString("zh-TW", { hour12: false });
  els.elapsedTime.textContent = formatLongTime(elapsedSeconds);
  const nextBreakSeconds = getSecondsUntilNextBreak();
  els.nextBreakTime.textContent = nextBreakSeconds === null ? "--:--:--" : formatLongTime(nextBreakSeconds);
}

function render() {
  const level = schedule[currentLevel];
  const next = schedule[currentLevel + 1];
  const totalSeconds = getLevelSeconds(currentLevel);
  const progress = totalSeconds ? Math.max(0, Math.min(1, remainingSeconds / totalSeconds)) : 0;
  const isBreak = level.type === "break";

  els.levelLabel.textContent = isBreak ? `Break ${currentLevel + 1}` : `Level ${currentLevel + 1}`;
  els.timeDisplay.textContent = formatTime(remainingSeconds);
  els.statusText.textContent = running ? "Running" : "Ready";
  els.smallBlind.textContent = isBreak ? "Break" : formatNumber(level.small);
  els.bigBlind.textContent = isBreak ? "-" : formatNumber(level.big);
  els.ante.textContent = isBreak ? "-" : formatNumber(getAnteValue(level.big, level.ante));
  els.nextLevel.textContent = formatNextLevel(next);
  if (els.progressBar) els.progressBar.style.width = `${progress * 100}%`;
  els.startPauseBtn.classList.toggle("running", running);
  els.startPauseIcon.textContent = running ? "||" : ">";
  els.startPauseText.textContent = running ? "Pause" : "Start";
  syncCurrentEditor(level);
  renderSchedule();
  updateAuxiliaryDisplays();
}

function syncCurrentEditor(level) {
  if (document.activeElement?.closest?.(".current-editor")) return;
  const isBreak = level.type === "break";

  els.currentMinutes.value = level.minutes;
  els.currentSmall.value = level.small;
  els.currentBig.value = level.big;
  els.currentAnte.value = getAnteValue(level.big, level.ante);
  els.anteToggle.checked = anteEnabled;
  els.currentSmall.disabled = isBreak;
  els.currentBig.disabled = isBreak;
  els.currentAnte.disabled = isBreak || !anteEnabled;
  els.anteToggle.disabled = isBreak;
  els.autoBigToggle.disabled = isBreak;
  els.doubleCurrentBtn.disabled = isBreak;
  els.cascadeLevelsBtn.disabled = isBreak;
  els.editorHint.textContent = isBreak
    ? "Break levels only use minutes."
    : "Edit the current level, then apply it.";
}

function renderSchedule() {
  els.scheduleList.innerHTML = "";

  schedule.forEach((level, index) => {
    const isBreak = level.type === "break";
    const row = document.createElement("div");
    row.className = `schedule-row${index === currentLevel ? " active" : ""}${isBreak ? " break-row" : ""}`;
    row.dataset.index = index;
    row.innerHTML = `
      <span class="level-number">${index + 1}</span>
      <span class="type-pill">${isBreak ? "Break" : "Blind"}</span>
      <input type="number" min="1" max="120" data-field="minutes" aria-label="Level ${index + 1} minutes" value="${level.minutes}">
      <input type="number" min="0" data-field="small" aria-label="Level ${index + 1} small blind" value="${level.small}" ${isBreak ? "disabled" : ""}>
      <input type="number" min="0" data-field="big" aria-label="Level ${index + 1} big blind" value="${level.big}" ${isBreak ? "disabled" : ""}>
      <input type="number" min="0" data-field="ante" aria-label="Level ${index + 1} ante" value="${getAnteValue(level.big, level.ante)}" disabled>
      <button class="delete-level" type="button" aria-label="Delete level ${index + 1}">Delete</button>
    `;
    els.scheduleList.appendChild(row);
  });
}

function tick(timestamp) {
  if (!running) return;
  if (lastTick === null) lastTick = timestamp;

  const elapsed = (timestamp - lastTick) / 1000;
  lastTick = timestamp;
  remainingSeconds -= elapsed;
  elapsedSeconds += elapsed;
  handleVoiceAnnouncements();

  if (remainingSeconds <= 0) {
    advanceLevel();
  } else {
    render();
  }

  rafId = requestAnimationFrame(tick);
}

function startTimer() {
  if (running) return;
  running = true;
  lastTick = null;
  prepareAudio();
  if (currentLevel === 0 && elapsedSeconds === 0 && !tournamentStartAnnounced) {
    tournamentStartAnnounced = true;
    speakEnglish("Let's get started");
  }
  rafId = requestAnimationFrame(tick);
  render();
}

function pauseTimer() {
  running = false;
  lastTick = null;
  if (rafId) cancelAnimationFrame(rafId);
  clearLevelStartTone();
  render();
}

function advanceLevel() {
  if (currentLevel < schedule.length - 1) {
    currentLevel += 1;
    remainingSeconds = getLevelSeconds(currentLevel);
    resetLevelAnnouncements();
    render();
    queueLevelStartTone();
    return;
  }

  remainingSeconds = 0;
  playTone();
  pauseTimer();
  els.statusText.textContent = "Finished";
}

function retreatLevel() {
  currentLevel = Math.max(0, currentLevel - 1);
  remainingSeconds = getLevelSeconds(currentLevel);
  resetLevelAnnouncements();
  render();
}

function resetTimer() {
  pauseTimer();
  currentLevel = 0;
  remainingSeconds = getLevelSeconds(currentLevel);
  elapsedSeconds = 0;
  tournamentStartAnnounced = false;
  resetLevelAnnouncements();
  render();
}

function resetLevelAnnouncements() {
  minuteAnnouncements = new Set();
  finalCountdownAnnounced = new Set();
}

function syncCurrentDuration() {
  const maxSeconds = getLevelSeconds(currentLevel);
  remainingSeconds = Math.min(remainingSeconds, maxSeconds);
  if (remainingSeconds <= 0) remainingSeconds = maxSeconds;
}

function getCurrentEditorLevel() {
  const current = schedule[currentLevel];
  if (current.type === "break") {
    return normalizeLevel({ type: "break", minutes: els.currentMinutes.value });
  }

  const small = clampNumber(els.currentSmall.value, 0, 99999999, 0);
  const big = els.autoBigToggle.checked
    ? small * 2
    : clampNumber(els.currentBig.value, 0, 99999999, small * 2);
  const ante = getAnteValue(big, els.currentAnte.value);

  return normalizeLevel({
    type: "blind",
    minutes: els.currentMinutes.value,
    small,
    big,
    ante,
  });
}

function updateBigFromSmall() {
  if (els.currentSmall.disabled) return;
  if (!els.autoBigToggle.checked) {
    updateAnteFromBig();
    return;
  }
  const small = clampNumber(els.currentSmall.value, 0, 99999999, 0);
  els.currentBig.value = small * 2;
  updateAnteFromBig();
}

function updateAnteFromBig() {
  if (els.currentBig.disabled) return;
  anteEnabled = els.anteToggle.checked;
  localStorage.setItem("pokerAnteEnabled", String(anteEnabled));
  const big = clampNumber(els.currentBig.value, 0, 99999999, 0);
  els.currentAnte.value = getAnteValue(big, 0);
  els.currentAnte.disabled = !anteEnabled;
}

function applyCurrentLevel() {
  updateBigFromSmall();
  schedule[currentLevel] = getCurrentEditorLevel();
  remainingSeconds = getLevelSeconds(currentLevel);
  saveSchedule();
  render();
}

function findSeedBlind() {
  if (schedule[currentLevel]?.type === "blind") return schedule[currentLevel];

  for (let index = currentLevel - 1; index >= 0; index -= 1) {
    if (schedule[index].type === "blind") return schedule[index];
  }

  return { small: 25, big: 50, ante: 0, minutes: 20 };
}

function cascadeLevelsFromCurrent() {
  applyCurrentLevel();
  let seed = findSeedBlind();

  for (let index = currentLevel + 1; index < schedule.length; index += 1) {
    if (schedule[index].type === "break") continue;
    seed = normalizeLevel({
      type: "blind",
      minutes: seed.minutes,
      small: seed.small * 2,
      big: seed.big * 2,
      ante: getAnteValue(seed.big * 2, seed.ante),
    });
    schedule[index] = seed;
  }

  saveSchedule();
  render();
}

function getLastBlind() {
  for (let index = schedule.length - 1; index >= 0; index -= 1) {
    if (schedule[index].type === "blind") return schedule[index];
  }
  return { minutes: 20, small: 25, big: 50, ante: 0 };
}

function getAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function prepareAudio() {
  if (!soundEnabled) return;
  levelStartAudio.load();
  getAudioContext();
  selectEnglishVoice();
}

function playTone() {
  if (!soundEnabled) return;

  const audio = getAudioContext();
  if (!audio) return;
  const now = audio.currentTime;
  [440, 660, 880].forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.0001, now + index * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.18, now + index * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.15);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now + index * 0.18);
    oscillator.stop(now + index * 0.18 + 0.16);
  });
}

function playLevelStartTone() {
  if (!soundEnabled) return;

  levelStartAudio.pause();
  levelStartAudio.currentTime = 0;
  levelStartAudio.play().catch(playSyntheticLevelStartTone);
}

function playSyntheticLevelStartTone() {
  if (!soundEnabled) return;

  const audio = getAudioContext();
  if (!audio) return;
  const now = audio.currentTime;
  [880, 660].forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.0001, now + index * 0.28);
    gain.gain.exponentialRampToValueAtTime(0.2, now + index * 0.28 + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.28 + 0.22);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now + index * 0.28);
    oscillator.stop(now + index * 0.28 + 0.24);
  });
}

function queueLevelStartTone() {
  if (levelStartToneTimeout) window.clearTimeout(levelStartToneTimeout);
  levelStartToneTimeout = window.setTimeout(() => {
    levelStartToneTimeout = null;
    playLevelStartTone();
  }, 0);
}

function clearLevelStartTone() {
  if (!levelStartToneTimeout) return;
  window.clearTimeout(levelStartToneTimeout);
  levelStartToneTimeout = null;
}

function speakEnglish(text) {
  if (!soundEnabled || !("speechSynthesis" in window)) return;

  selectEnglishVoice();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.rate = 1.08;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function selectEnglishVoice() {
  if (!("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  selectedVoice =
    voices.find((voice) => voice.lang === "en-US" && voice.localService) ||
    voices.find((voice) => voice.lang?.startsWith("en")) ||
    selectedVoice;
}

function handleVoiceAnnouncements() {
  if (!soundEnabled || remainingSeconds <= 0) return;

  const secondsLeft = Math.ceil(remainingSeconds);
  const totalSeconds = getLevelSeconds(currentLevel);
  const minuteReminders = [
    { seconds: 600, text: "Ten minutes" },
    { seconds: 300, text: "Five minutes" },
    { seconds: 180, text: "Three minutes" },
    { seconds: 60, text: "One minute" },
  ];

  for (const reminder of minuteReminders) {
    if (
      totalSeconds > reminder.seconds &&
      secondsLeft <= reminder.seconds &&
      secondsLeft > 5 &&
      !minuteAnnouncements.has(reminder.seconds)
    ) {
      minuteAnnouncements.add(reminder.seconds);
      speakEnglish(reminder.text);
      return;
    }
  }

  if (secondsLeft <= 5 && secondsLeft >= 1 && !finalCountdownAnnounced.has(secondsLeft)) {
    finalCountdownAnnounced.add(secondsLeft);
    speakEnglish(String(secondsLeft));
  }
}

els.startPauseBtn.addEventListener("click", () => {
  running ? pauseTimer() : startTimer();
});

els.prevBtn.addEventListener("click", () => {
  pauseTimer();
  retreatLevel();
});

els.nextBtn.addEventListener("click", () => {
  pauseTimer();
  advanceLevel();
});

els.resetBtn.addEventListener("click", resetTimer);

els.addLevelBtn.addEventListener("click", () => {
  const lastBlind = getLastBlind();
  schedule.push({
    type: "blind",
    minutes: lastBlind.minutes,
    small: lastBlind.small * 2,
    big: lastBlind.big * 2,
    ante: getAnteValue(lastBlind.big * 2, lastBlind.ante),
  });
  saveSchedule();
  render();
});

els.addBreakBtn.addEventListener("click", () => {
  schedule.push({ type: "break", minutes: 10, small: 0, big: 0, ante: 0 });
  saveSchedule();
  render();
});

els.applyMinutesBtn.addEventListener("click", () => {
  const minutes = clampNumber(els.defaultMinutes.value, 1, 120, 20);
  schedule = schedule.map((level) => ({ ...level, minutes }));
  syncCurrentDuration();
  saveSchedule();
  render();
});

els.currentSmall.addEventListener("input", updateBigFromSmall);
els.currentBig.addEventListener("input", updateAnteFromBig);
els.autoBigToggle.addEventListener("change", updateBigFromSmall);
els.doubleCurrentBtn.addEventListener("click", updateBigFromSmall);
els.applyCurrentBtn.addEventListener("click", applyCurrentLevel);
els.cascadeLevelsBtn.addEventListener("click", cascadeLevelsFromCurrent);
els.anteToggle.addEventListener("change", () => {
  anteEnabled = els.anteToggle.checked;
  localStorage.setItem("pokerAnteEnabled", String(anteEnabled));
  updateAnteFromBig();
  schedule = schedule.map((level) => {
    if (level.type === "break") return level;
    return { ...level, ante: getAnteValue(level.big, level.ante) };
  });
  saveSchedule();
  render();
});

els.soundToggle.addEventListener("change", () => {
  soundEnabled = els.soundToggle.checked;
});

els.toggleSettingsBtn.addEventListener("click", () => {
  const closed = els.appShell.classList.toggle("settings-closed");
  els.appShell.classList.toggle("settings-open", !closed);
  els.toggleSettingsBtn.textContent = closed ? "Show Settings" : "Hide Settings";
});

document.addEventListener("fullscreenchange", () => {
  const fullscreen = Boolean(document.fullscreenElement);
  els.appShell.classList.toggle("fullscreen-display", fullscreen);
  els.appShell.classList.toggle("settings-closed", fullscreen || settingsClosedBeforeFullscreen);
  els.appShell.classList.toggle("settings-open", !fullscreen && !settingsClosedBeforeFullscreen);
  els.toggleSettingsBtn.textContent = fullscreen || settingsClosedBeforeFullscreen ? "Show Settings" : "Hide Settings";
  els.fullscreenBtn.textContent = fullscreen ? "Exit Fullscreen" : "Fullscreen";
});

els.fullscreenBtn.addEventListener("click", async () => {
  if (!document.fullscreenElement) {
    settingsClosedBeforeFullscreen = els.appShell.classList.contains("settings-closed");
    els.appShell.classList.add("fullscreen-display", "settings-closed");
    els.appShell.classList.remove("settings-open");
    await document.documentElement.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
});

els.scheduleList.addEventListener("change", (event) => {
  const input = event.target.closest("input");
  if (!input) return;

  const row = input.closest(".schedule-row");
  const index = Number(row.dataset.index);
  const field = input.dataset.field;
  const max = field === "minutes" ? 120 : 99999999;
  const min = field === "minutes" ? 1 : 0;

  schedule[index][field] = clampNumber(input.value, min, max, schedule[index][field]);
  if (field === "small") schedule[index].big = schedule[index].small * 2;
  if (field === "small" || field === "big") schedule[index].ante = getAnteValue(schedule[index].big, schedule[index].ante);
  if (index === currentLevel && field === "minutes") syncCurrentDuration();
  saveSchedule();
  render();
});

els.scheduleList.addEventListener("click", (event) => {
  const button = event.target.closest(".delete-level");
  if (!button || schedule.length === 1) return;

  const row = button.closest(".schedule-row");
  const index = Number(row.dataset.index);
  schedule.splice(index, 1);
  currentLevel = Math.min(currentLevel, schedule.length - 1);
  remainingSeconds = getLevelSeconds(currentLevel);
  saveSchedule();
  render();
});

render();
setInterval(updateAuxiliaryDisplays, 1000);
