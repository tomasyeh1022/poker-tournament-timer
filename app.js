"use strict";

const MAX_CHIPS = 99999999;
const MAX_LEVELS = 100;
const ANTE_OFF_LABEL = "OFF";
const defaultSchedule = [
  { type: "blind", minutes: 20, small: 25, big: 50, ante: 0 },
  { type: "blind", minutes: 20, small: 50, big: 100, ante: 0 },
  { type: "blind", minutes: 20, small: 100, big: 200, ante: 40 },
  { type: "blind", minutes: 20, small: 200, big: 400, ante: 80 },
  { type: "break", minutes: 10, small: 0, big: 0, ante: 0 },
  { type: "blind", minutes: 20, small: 400, big: 800, ante: 160 },
  { type: "blind", minutes: 20, small: 800, big: 1600, ante: 320 },
  { type: "blind", minutes: 20, small: 1600, big: 3200, ante: 640 },
  { type: "blind", minutes: 20, small: 3200, big: 6400, ante: 1280 },
  { type: "blind", minutes: 20, small: 6400, big: 12800, ante: 2560 },
];

const els = Object.fromEntries([
  "appShell", "levelLabel", "levelCaption", "timeDisplay", "statusText", "smallBlind", "bigBlind", "ante",
  "nextLevelLabel", "nextLevel", "nextAnte", "currentTime", "elapsedTime", "nextBreakTime",
  "tournamentTime", "restLabel", "restNote", "endLabel", "estimatedEndTime", "endNote", "notice",
  "startPauseBtn", "startPauseIcon", "startPauseText", "prevBtn", "nextBtn", "resetBtn",
  "scheduleList", "addLevelBtn", "addBreakBtn", "defaultMinutes", "applyMinutesBtn",
  "quickSmall", "quickBig", "quickAnte", "quickAnteOff", "quickPreview", "quickMessage",
  "anteToggle", "anteAutoBtn", "anteCustomBtn", "autoBigToggle", "soundToggle",
  "toggleSettingsBtn", "closeSettingsBtn", "fullscreenBtn", "exitDisplay", "testSoundBtn", "audioStatus", "toast",
].map((id) => [id, document.getElementById(id)]));

let schedule = loadSchedule();
let currentLevel = 0;
let remainingSeconds = getLevelSeconds(0);
let elapsedSeconds = 0;
let running = false;
let finished = false;
let hasStarted = false;
let tournamentStartAnnounced = false;
let anteEnabled = readStored("pokerAnteEnabled") !== "false";
let anteMode = readStored("pokerAnteMode") === "custom" ? "custom" : "auto";
let quickInitialized = false;
let quickDraftDirty = false;
let quickCustomAnteDraft = "0";
let soundEnabled = els.soundToggle?.checked !== false;
let lastTick = null;
let rafId = null;
let lastPaintedSecond = null;
let settingsClosedBeforeFullscreen = true;
let minuteAnnouncements = new Set();
let finalCountdownAnnounced = new Set();
let levelStartToneTimeout = null;
let audioContext = null;
let selectedVoice = null;
let audioGeneration = 0;
let previewRunning = false;
let toastTimeout = null;
const activeOscillators = new Set();
const activeAudioStops = new Set();
const voiceClips = Object.freeze({
  start: "Let's get started",
  "ten-minutes": "Ten minutes",
  "five-minutes": "Five minutes",
  "three-minutes": "Three minutes",
  "one-minute": "One minute",
  five: "5", four: "4", three: "3", two: "2", one: "1",
});

// Bundled Google Translate English clips also work without a browser speech voice.
const voiceAudio = document.createElement("audio");
voiceAudio.preload = "auto";
voiceAudio.volume = 1;

const levelStartAudio = document.createElement("audio");
levelStartAudio.preload = "auto";
levelStartAudio.src = "assets/seatbelt-ding-dong.mp3?v=20260625-1637";
levelStartAudio.volume = 1;

function readStored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, value); }
  catch { notify("瀏覽器未允許儲存；本次設定仍可使用，關閉頁面後不會保留。"); }
}
function loadSchedule() {
  try {
    const stored = JSON.parse(readStored("pokerBlindSchedule") || "null");
    if (Array.isArray(stored) && stored.length) return stored.slice(0, MAX_LEVELS).map(normalizeLevel);
  } catch { /* A malformed saved value must not prevent the clock from opening. */ }
  return defaultSchedule.map(normalizeLevel);
}
function saveSchedule() { writeStored("pokerBlindSchedule", JSON.stringify(schedule)); }
function clampNumber(value, min, max, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}
function normalizeLevel(value) {
  const level = value && typeof value === "object" ? value : {};
  const type = level.type === "break" ? "break" : "blind";
  return {
    type,
    minutes: clampNumber(level.minutes, 1, 120, type === "break" ? 10 : 20),
    small: type === "break" ? 0 : clampNumber(level.small, 0, MAX_CHIPS, 0),
    big: type === "break" ? 0 : clampNumber(level.big, 0, MAX_CHIPS, 0),
    ante: type === "break" ? 0 : clampNumber(level.ante, 0, MAX_CHIPS, 0),
  };
}
function getLevelSeconds(index) { return schedule[index].minutes * 60; }
function getLastBlindIndex() {
  for (let index = schedule.length - 1; index >= 0; index -= 1) {
    if (schedule[index].type === "blind") return index;
  }
  return -1;
}
function getAnteValue(big, customAnte = 0) {
  if (!anteEnabled) return 0;
  return anteMode === "custom" ? clampNumber(customAnte, 0, MAX_CHIPS, 0) : clampNumber(big / 5, 0, MAX_CHIPS, 0);
}
function doubleChips(value) { return clampNumber(value * 2, 0, MAX_CHIPS, MAX_CHIPS); }
function formatNumber(number) { return Number(number).toLocaleString("en-US"); }
function formatTime(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
function formatLongTime(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 3600)).padStart(2, "0")}:${String(Math.floor(safe / 60) % 60).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
function setText(element, text) { if (element && element.textContent !== text) element.textContent = text; }

// Playing time excludes breaks; the separate level clock continues during a scheduled break.
function getTournamentSeconds() {
  if (finished) return 0;
  let total = schedule[currentLevel].type === "blind" ? remainingSeconds : 0;
  for (let i = currentLevel + 1; i < schedule.length; i += 1) {
    if (schedule[i].type === "blind") total += getLevelSeconds(i);
  }
  return total;
}
function getScheduledSecondsRemaining() {
  const lastBlindIndex = getLastBlindIndex();
  if (finished || currentLevel > lastBlindIndex) return 0;
  return remainingSeconds + schedule.slice(currentLevel + 1, lastBlindIndex + 1).reduce((total, level) => total + level.minutes * 60, 0);
}
function getNextBreak() {
  const lastBlindIndex = getLastBlindIndex();
  if (finished || currentLevel >= lastBlindIndex) return null;
  if (schedule[currentLevel].type === "break") return { seconds: remainingSeconds, minutes: schedule[currentLevel].minutes, current: true };
  let seconds = remainingSeconds;
  for (let i = currentLevel + 1; i < lastBlindIndex; i += 1) {
    if (schedule[i].type === "break") return { seconds, minutes: schedule[i].minutes, current: false };
    seconds += getLevelSeconds(i);
  }
  return null;
}
function updateAuxiliaryDisplays() {
  const now = new Date();
  setText(els.currentTime, now.toLocaleTimeString("zh-TW", { hour12: false }));
  setText(els.elapsedTime, formatLongTime(elapsedSeconds));
  setText(els.tournamentTime, formatLongTime(getTournamentSeconds()));
  const rest = getNextBreak();
  setText(els.restLabel, rest?.current ? "休息剩餘" : "距離休息");
  setText(els.nextBreakTime, rest ? formatLongTime(rest.seconds) : "—");
  setText(els.restNote, rest ? (rest.current ? "休息不扣整場倒數" : `休息 ${rest.minutes} 分鐘`) : "無後續休息");
  setText(els.endLabel, finished ? "賽事狀態" : running ? "預計結束" : hasStarted ? "恢復後預計結束" : "開始後預計結束");
  if (getLastBlindIndex() < 0) {
    setText(els.endLabel, "待設定");
    setText(els.estimatedEndTime, "—");
    setText(els.endNote, "請新增至少一個盲注級別");
  } else if (finished || !hasStarted) {
    setText(els.estimatedEndTime, finished ? "已結束" : "—");
    setText(els.endNote, finished ? "重設後可開始新賽事" : "開始計時後顯示");
  } else {
    const end = new Date(now.getTime() + getScheduledSecondsRemaining() * 1000);
    setText(els.estimatedEndTime, end.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }));
    const dateNote = end.toDateString() !== now.toDateString() ? `${end.getMonth() + 1}/${end.getDate()}・` : "";
    setText(els.endNote, `${dateNote}${running ? "含排定休息" : "現在恢復時計算・含休息"}`);
  }
}

function renderBoard() {
  const level = schedule[currentLevel];
  const lastBlindIndex = getLastBlindIndex();
  const next = currentLevel < lastBlindIndex ? schedule[currentLevel + 1] : null;
  const isBreak = level.type === "break";
  const number = schedule.slice(0, currentLevel + 1).filter((entry) => entry.type === "blind").length;
  const state = lastBlindIndex < 0 ? "unconfigured" : finished ? "finished" : running ? (isBreak ? "break" : "running") : hasStarted ? "paused" : "ready";
  setText(els.levelLabel, isBreak ? "Break" : `Level ${String(number).padStart(2, "0")}`);
  setText(els.levelCaption, finished ? "賽事已結束" : isBreak ? "休息剩餘時間" : "本級剩餘時間");
  setText(els.timeDisplay, formatTime(remainingSeconds));
  els.timeDisplay.classList.toggle("long-time", Math.ceil(remainingSeconds) >= 6000);
  setText(els.statusText, { unconfigured: "待設定", finished: "已結束", running: "進行中", break: "休息中", paused: "已暫停", ready: "待開始" }[state]);
  if (els.statusText) els.statusText.dataset.state = state;
  els.appShell?.classList.toggle("urgent", !finished && !isBreak && remainingSeconds <= 60);
  setText(els.smallBlind, isBreak ? "—" : formatNumber(level.small));
  setText(els.bigBlind, isBreak ? "—" : formatNumber(level.big));
  setText(els.ante, isBreak ? "—" : anteEnabled ? formatNumber(getAnteValue(level.big, level.ante)) : ANTE_OFF_LABEL);
  els.ante.classList.toggle("is-off", !isBreak && !anteEnabled);
  document.querySelector(".blinds")?.classList.toggle("long-numbers", !isBreak && Math.max(level.small, level.big, getAnteValue(level.big, level.ante)) >= 1000000);
  setText(els.nextLevelLabel, next?.type === "break" ? "Next Break" : "Next Level");
  setText(els.nextLevel, !next || finished ? "—" : next.type === "break" ? `休息 ${next.minutes} 分鐘` : `${formatNumber(next.small)} / ${formatNumber(next.big)}`);
  setText(els.nextAnte, !next || finished ? "最後一級" : next.type === "break" ? "整場倒數暫停" : `Ante ${anteEnabled ? formatNumber(getAnteValue(next.big, next.ante)) : ANTE_OFF_LABEL}`);
  els.nextAnte.classList.toggle("is-off", !finished && next?.type === "blind" && !anteEnabled);
  els.nextLevel?.classList.toggle("long-numbers", next?.type === "blind" && Math.max(next.small, next.big) >= 1000000);
  els.startPauseBtn.classList.toggle("running", running);
  els.startPauseBtn.disabled = finished || getTournamentSeconds() <= 0;
  els.startPauseBtn.setAttribute("aria-label", running ? "暫停計時" : hasStarted ? "繼續計時" : "開始計時");
  setText(els.startPauseIcon, running ? "Ⅱ" : "▶");
  setText(els.startPauseText, finished ? "已結束" : running ? "暫停" : hasStarted ? "繼續" : "開始");
  els.prevBtn.disabled = currentLevel === 0;
  els.nextBtn.disabled = currentLevel >= lastBlindIndex;
  setText(els.notice, lastBlindIndex < 0 ? "請新增至少一個盲注級別" : finished ? "時間到，賽事已結束" : isBreak ? "休息中・整場倒數暫停" : remainingSeconds <= 60 ? "本級最後 1 分鐘" : "");
  updateAuxiliaryDisplays();
}
function renderSchedule() {
  els.scheduleList.innerHTML = "";
  let blindNumber = 0;
  schedule.forEach((level, index) => {
    const isBreak = level.type === "break";
    if (!isBreak) blindNumber += 1;
    const number = isBreak ? "休息" : `第 ${blindNumber} 級`;
    const anteCell = !isBreak && anteEnabled && anteMode === "custom"
      ? `<input class="schedule-ante" type="number" min="0" max="${MAX_CHIPS}" step="1" data-field="ante" aria-label="${number} Ante" value="${level.ante}">`
      : `<output class="schedule-ante${!isBreak && !anteEnabled ? " is-off" : ""}" aria-label="${number} Ante">${isBreak ? "—" : anteEnabled ? formatNumber(getAnteValue(level.big, level.ante)) : ANTE_OFF_LABEL}</output>`;
    const row = document.createElement("div");
    row.className = `schedule-row${index === currentLevel ? " active" : ""}${isBreak ? " break-row" : ""}`;
    row.dataset.index = index;
    row.innerHTML = `
      <span class="level-number">${isBreak ? "—" : blindNumber}</span>
      <span class="type-pill">${isBreak ? "休息" : "盲注"}</span>
      <input type="number" min="1" max="120" step="1" data-field="minutes" aria-label="${number}分鐘" value="${level.minutes}">
      <input type="number" min="0" max="${MAX_CHIPS}" step="1" data-field="small" aria-label="${number}小盲" value="${level.small}" ${isBreak ? "disabled" : ""}>
      <input type="number" min="0" max="${MAX_CHIPS}" step="1" data-field="big" aria-label="${number}大盲" value="${level.big}" ${isBreak ? "disabled" : ""}>
      ${anteCell}
      <button class="delete-level" type="button" aria-label="刪除${number}" ${schedule.length === 1 ? "disabled" : ""}>刪除</button>`;
    els.scheduleList.appendChild(row);
  });
  els.addLevelBtn.disabled = schedule.length >= MAX_LEVELS;
  els.addBreakBtn.disabled = schedule.length >= MAX_LEVELS;
}
function renderSettings() { els.anteToggle.checked = anteEnabled; syncAnteModeButtons(); syncQuickSettings(); renderSchedule(); }
function renderAll() { renderBoard(); renderSettings(); }
function syncScheduleRow(index) {
  const row = els.scheduleList.children[index];
  const level = schedule[index];
  if (!row || !level) return;
  ["minutes", "small", "big"].forEach((field) => {
    row.querySelector(`input[data-field="${field}"]`).value = level[field];
  });
  const output = row.querySelector(".schedule-ante");
  const isBreak = level.type === "break";
  if (!isBreak && anteEnabled && anteMode === "custom") output.value = level.ante;
  else setText(output, isBreak ? "—" : anteEnabled ? formatNumber(getAnteValue(level.big, level.ante)) : ANTE_OFF_LABEL);
  output.classList.toggle("is-off", !isBreak && !anteEnabled);
}
function resetLevelAnnouncements() { minuteAnnouncements.clear(); finalCountdownAnnounced.clear(); }

function syncAnteModeButtons() {
  for (const [button, mode] of [[els.anteAutoBtn, "auto"], [els.anteCustomBtn, "custom"]]) {
    button?.setAttribute("aria-pressed", String(anteMode === mode));
    button?.classList.toggle("is-active", anteMode === mode);
  }
}
function readQuickInteger(value, min, max) {
  if (String(value ?? "").trim() === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}
function buildQuickSchedule() {
  const minutes = readQuickInteger(els.defaultMinutes?.value, 1, 120);
  const firstSmall = readQuickInteger(els.quickSmall?.value, 0, Math.floor(MAX_CHIPS / 2));
  const firstAnte = readQuickInteger(quickCustomAnteDraft, 0, MAX_CHIPS);
  const useCustomAnte = anteEnabled && anteMode === "custom";
  if (!schedule.some((level) => level.type === "blind")) return { error: "請先新增至少一個盲注級別。" };
  if (minutes === null) return { error: "盲注時間請填 1～120 的整數分鐘。" };
  if (firstSmall === null) return { error: "第一級小盲請填 0～49,999,999 的整數。" };
  if (useCustomAnte && firstAnte === null) return { error: "第一級自訂 Ante 請填 0～99,999,999 的整數。" };
  let number = 0;
  let nextSmall = firstSmall;
  let nextAnte = firstAnte;
  const levels = [];
  for (const level of schedule) {
    if (level.type === "break") { levels.push({ ...level }); continue; }
    number += 1;
    const big = nextSmall * 2;
    if (!Number.isSafeInteger(big) || big > MAX_CHIPS || nextSmall > MAX_CHIPS || (useCustomAnte && (!Number.isSafeInteger(nextAnte) || nextAnte > MAX_CHIPS))) {
      return { error: `第 ${number} 級翻倍後超過 99,999,999 上限，請降低第一級數值或減少盲注級數；尚未套用任何變更。` };
    }
    // AUTO and OFF only affect the displayed Ante. Keep saved custom values intact.
    levels.push({ ...level, minutes, small: nextSmall, big, ante: useCustomAnte ? nextAnte : level.ante });
    nextSmall *= 2;
    if (useCustomAnte) nextAnte *= 2;
  }
  return { levels };
}
function syncQuickSettings(resetDraft = false) {
  if (!els.quickSmall || !els.quickBig || !els.quickAnte) return;
  const first = schedule.find((level) => level.type === "blind");
  if (!quickInitialized || resetDraft || !quickDraftDirty) {
    const seed = first || defaultSchedule[0];
    els.defaultMinutes.value = String(seed.minutes);
    els.quickSmall.value = String(seed.small);
    quickCustomAnteDraft = String(seed.ante);
    quickInitialized = true;
    quickDraftDirty = false;
  }
  const small = readQuickInteger(els.quickSmall.value, 0, MAX_CHIPS);
  const big = small === null ? null : small * 2;
  els.quickBig.value = big === null ? "" : String(big);
  els.quickBig.readOnly = true;
  els.quickAnte.readOnly = anteMode === "auto" || !anteEnabled;
  els.quickAnte.hidden = !anteEnabled;
  if (els.quickAnteOff) els.quickAnteOff.hidden = anteEnabled;
  els.quickAnte.value = anteMode === "custom" ? quickCustomAnteDraft : big === null ? "" : String(Math.round(big / 5));
  els.applyMinutesBtn.disabled = !first;
  const result = buildQuickSchedule();
  if (result.error) {
    setText(els.quickPreview, result.error);
    return;
  }
  const blinds = result.levels.filter((level) => level.type === "blind");
  const preview = blinds.slice(0, 3).map((level, index) => `${String(index + 1).padStart(2, "0")}  ${formatNumber(level.small)} / ${formatNumber(level.big)} / ${anteEnabled ? formatNumber(getAnteValue(level.big, level.ante)) : ANTE_OFF_LABEL}`);
  setText(els.quickPreview, preview.join("\n"));
}
function updateQuickDraft() {
  quickDraftDirty = true;
  if (anteMode === "custom" && anteEnabled) quickCustomAnteDraft = els.quickAnte.value;
  setText(els.quickMessage, "");
  els.quickMessage?.classList.remove("error");
  syncQuickSettings();
}
function setAnteMode(mode) {
  if (mode === anteMode) return;
  if (anteMode === "custom" && anteEnabled && quickDraftDirty) quickCustomAnteDraft = els.quickAnte.value;
  anteMode = mode;
  writeStored("pokerAnteMode", mode);
  syncAnteModeButtons();
  syncQuickSettings();
  renderBoard();
  renderSchedule();
}
function applyQuickSchedule() {
  if (anteMode === "custom" && anteEnabled) quickCustomAnteDraft = els.quickAnte.value;
  const result = buildQuickSchedule();
  if (result.error) {
    setText(els.quickMessage, result.error);
    els.quickMessage?.classList.add("error");
    return;
  }
  pauseTimer();
  const durationChanged = schedule[currentLevel].type === "blind" && schedule[currentLevel].minutes !== result.levels[currentLevel].minutes;
  schedule = result.levels;
  if (durationChanged) {
    remainingSeconds = getLevelSeconds(currentLevel);
    finished = false;
    resetLevelAnnouncements();
  }
  saveSchedule();
  syncQuickSettings(true);
  renderAll();
  const message = `已套用整張升盲表，休息維持原設定；${durationChanged ? "目前級別時間已重設" : "目前倒數保留"}，計時已暫停。`;
  setText(els.quickMessage, message);
  els.quickMessage?.classList.remove("error");
  notify(message);
}

// Consume every crossed level when a background/sleeping tab resumes, keeping the overrun.
function consumeElapsed(seconds) {
  let pending = Math.max(0, seconds);
  let crossedLevels = 0;
  while (pending > 0 && !finished) {
    const consumed = Math.min(pending, remainingSeconds);
    remainingSeconds -= consumed;
    elapsedSeconds += consumed;
    pending -= consumed;
    if (remainingSeconds > 0) break;
    if (currentLevel >= getLastBlindIndex()) {
      remainingSeconds = 0;
      finished = true;
      running = false;
      lastTick = null;
      break;
    }
    currentLevel += 1;
    remainingSeconds = getLevelSeconds(currentLevel);
    crossedLevels += 1;
    resetLevelAnnouncements();
  }
  return crossedLevels;
}
function accountForElapsed(now = Date.now(), announce = true) {
  if (!running || lastTick === null) return;
  const seconds = Math.max(0, (now - lastTick) / 1000);
  lastTick = now;
  const previousRemaining = remainingSeconds;
  const crossed = consumeElapsed(seconds);
  if (finished) {
    cancelAudio();
    if (announce) playTone();
    renderAll();
  } else if (crossed) {
    cancelAudio();
    renderAll();
    if (announce) queueLevelStartTone();
  } else if (announce) handleVoiceAnnouncements(previousRemaining, seconds);
}
function tick() {
  rafId = null;
  if (!running) return;
  accountForElapsed();
  const displaySecond = Math.ceil(remainingSeconds);
  if (displaySecond !== lastPaintedSecond) { lastPaintedSecond = displaySecond; renderBoard(); }
  if (running) rafId = requestAnimationFrame(tick);
}
function startTimer() {
  if (running || finished || remainingSeconds <= 0 || getTournamentSeconds() <= 0) return;
  cancelAudio();
  running = true;
  hasStarted = true;
  lastTick = Date.now();
  prepareAudio();
  if (currentLevel === 0 && elapsedSeconds === 0 && !tournamentStartAnnounced) {
    tournamentStartAnnounced = true;
    announceVoice("start");
  }
  renderBoard();
  rafId = requestAnimationFrame(tick);
}
function pauseTimer() {
  accountForElapsed(Date.now(), false);
  running = false;
  lastTick = null;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  cancelAudio();
  renderBoard();
}
function changeLevel(index) {
  const previousLevel = currentLevel;
  pauseTimer();
  currentLevel = Math.max(0, Math.min(getLastBlindIndex(), index));
  remainingSeconds = getLevelSeconds(currentLevel);
  finished = false;
  resetLevelAnnouncements();
  renderAll();
  if (currentLevel > previousLevel) queueLevelStartTone(false);
}
function resetTimer() {
  pauseTimer();
  currentLevel = 0;
  remainingSeconds = getLevelSeconds(0);
  elapsedSeconds = 0;
  finished = false;
  hasStarted = false;
  tournamentStartAnnounced = false;
  lastPaintedSecond = null;
  resetLevelAnnouncements();
  renderAll();
}
function notify(message) {
  if (!els.toast) return;
  setText(els.toast, message);
  els.toast.hidden = false;
  els.toast.classList.add("show");
  if (toastTimeout !== null) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { els.toast.classList.remove("show"); els.toast.hidden = true; }, 4500);
}

function getAudioContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  try {
    if (!audioContext) audioContext = new Context();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    return audioContext;
  } catch { return null; }
}
function prepareAudio() {
  if (!soundEnabled) return;
  getAudioContext();
  selectEnglishVoice();
}
function setAudioStatus(message, error = false) {
  setText(els.audioStatus, message);
  els.audioStatus?.classList.toggle("error", error);
}
function setPreviewRunning(value) {
  previewRunning = value;
  setText(els.testSoundBtn, value ? "停止試聽" : "試聽語音與提示音");
  els.testSoundBtn?.setAttribute("aria-pressed", String(value));
}
function synthesizeTone(frequencies, spacing, duration) {
  if (!soundEnabled) return false;
  const audio = getAudioContext();
  if (!audio) return false;
  try {
    const now = audio.currentTime;
    frequencies.forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + index * spacing);
      gain.gain.exponentialRampToValueAtTime(0.18, now + index * spacing + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * spacing + duration);
      oscillator.connect(gain).connect(audio.destination);
      activeOscillators.add(oscillator);
      oscillator.onended = () => { activeOscillators.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now + index * spacing);
      oscillator.stop(now + index * spacing + duration + 0.01);
    });
    return true;
  } catch { return false; }
}
function playTone() {
  if (soundEnabled && !synthesizeTone([440, 660, 880], 0.18, 0.15)) {
    setAudioStatus("結束提示音無法播放，請檢查瀏覽器的音效權限。", true);
  }
}
function playMedia(audio, source, generation, label) {
  if (!soundEnabled || generation !== audioGeneration) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    let watchdog = null;
    const settle = (success) => {
      if (settled) return;
      settled = true;
      if (watchdog !== null) clearTimeout(watchdog);
      audio.onended = null;
      audio.onerror = null;
      audio.onplaying = null;
      activeAudioStops.delete(stop);
      if (!success) { audio.pause(); try { audio.currentTime = 0; } catch {} }
      resolve(success);
    };
    const stop = () => settle(false);
    activeAudioStops.add(stop);
    audio.onended = () => settle(generation === audioGeneration && soundEnabled);
    audio.onerror = () => settle(false);
    audio.onplaying = () => {
      if (generation === audioGeneration && soundEnabled) setAudioStatus(`${previewRunning ? "試聽" : "播放"}：${label}`);
    };
    // Catch a missing/stalled recording as well as a rejected play() promise.
    watchdog = setTimeout(() => settle(false), 15000);
    try {
      audio.pause();
      if (source && audio.getAttribute("src") !== source) audio.src = source;
      audio.currentTime = 0;
      audio.muted = false;
      const playback = audio.play();
      if (playback?.catch) playback.catch(() => settle(false));
    } catch { settle(false); }
  });
}
function selectEnglishVoice() {
  if (!("speechSynthesis" in window)) return;
  try {
    const voices = window.speechSynthesis.getVoices();
    selectedVoice = voices.find((voice) => voice.lang === "en-US" && voice.localService)
      || voices.find((voice) => voice.lang?.startsWith("en")) || null;
  } catch { selectedVoice = null; }
}
function speakFallback(text, generation) {
  if (!soundEnabled || generation !== audioGeneration || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    let watchdog = null;
    const utterance = new SpeechSynthesisUtterance(text);
    const settle = (success) => {
      if (settled) return;
      settled = true;
      if (watchdog !== null) clearTimeout(watchdog);
      activeAudioStops.delete(stop);
      utterance.onend = null;
      utterance.onerror = null;
      if (!success) { try { window.speechSynthesis.cancel(); } catch {} }
      resolve(success);
    };
    const stop = () => settle(false);
    activeAudioStops.add(stop);
    selectEnglishVoice();
    utterance.lang = "en-US";
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = 1.08;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = () => settle(generation === audioGeneration && soundEnabled);
    utterance.onerror = () => settle(false);
    watchdog = setTimeout(() => settle(false), 12000);
    try {
      setAudioStatus(`使用瀏覽器備援語音：${text}`);
      window.speechSynthesis.speak(utterance);
    } catch { settle(false); }
  });
}
async function playVoiceClip(key, generation) {
  const text = voiceClips[key];
  if (!text || !soundEnabled || generation !== audioGeneration) return false;
  const played = await playMedia(voiceAudio, `assets/voice/${key}.wav?v=google-en-us-20260915`, generation, text);
  if (generation !== audioGeneration || !soundEnabled) return false;
  if (played) return true;
  const fallback = await speakFallback(text, generation);
  if (generation !== audioGeneration || !soundEnabled) return false;
  if (!fallback) {
    const message = "英文提示無法播放，請檢查頁面音效權限，並確認試用包包含 assets/voice 音檔。";
    setAudioStatus(message, true);
    notify(message);
  }
  return fallback;
}
function announceVoice(key) {
  if (!soundEnabled) return;
  cancelAudio();
  const generation = audioGeneration;
  void playVoiceClip(key, generation).then((played) => {
    if (played && generation === audioGeneration && soundEnabled) setAudioStatus(`最近提醒：${voiceClips[key]}`);
  });
}
function playLevelStartTone() {
  if (!soundEnabled) return;
  cancelAudio();
  const generation = audioGeneration;
  void playMedia(levelStartAudio, null, generation, "換級提示音").then((played) => {
    if (generation !== audioGeneration || !soundEnabled) return;
    if (played) { setAudioStatus("最近提示：換級提示音"); return; }
    const backup = synthesizeTone([880, 660], 0.28, 0.22);
    setAudioStatus(backup ? "原提示音無法播放，已改用備援提示音。" : "換級提示音無法播放，請檢查頁面音效權限。", !backup);
  });
}
function queueLevelStartTone(requireRunning = true) {
  if (levelStartToneTimeout !== null) clearTimeout(levelStartToneTimeout);
  // The updated level paints before the cue, within its first second.
  levelStartToneTimeout = setTimeout(() => {
    levelStartToneTimeout = null;
    if ((!requireRunning || running) && !finished) playLevelStartTone();
  }, 100);
}
function cancelAudio() {
  audioGeneration += 1;
  if (levelStartToneTimeout !== null) clearTimeout(levelStartToneTimeout);
  levelStartToneTimeout = null;
  activeAudioStops.forEach((stop) => stop());
  activeAudioStops.clear();
  if ("speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch {} }
  for (const audio of [voiceAudio, levelStartAudio]) {
    audio.pause();
    try { audio.currentTime = 0; } catch {}
    audio.muted = false;
  }
  activeOscillators.forEach((oscillator) => { try { oscillator.stop(); } catch {} });
  activeOscillators.clear();
  if (previewRunning) setAudioStatus("試聽已停止。");
  setPreviewRunning(false);
}
async function previewAudio() {
  if (previewRunning) { cancelAudio(); return; }
  if (!soundEnabled) { notify("請先開啟音效，再測試語音與提示音。"); return; }
  if (running) { notify("請先暫停計時，再試聽音效，避免打斷比賽提醒。"); return; }
  cancelAudio();
  prepareAudio();
  const generation = audioGeneration;
  setPreviewRunning(true);
  setAudioStatus("試聽：英文開場 → 1 分鐘 → 5、4、3、2、1 → 換級提示音");
  for (const key of ["start", "one-minute", "five", "four", "three", "two", "one"]) {
    const played = await playVoiceClip(key, generation);
    if (generation !== audioGeneration || !soundEnabled) return;
    if (!played) { setPreviewRunning(false); return; }
  }
  const played = await playMedia(levelStartAudio, null, generation, "換級提示音");
  if (generation !== audioGeneration || !soundEnabled) return;
  setPreviewRunning(false);
  setAudioStatus(played ? "試聽播放結束；若仍未聽到，請檢查分頁靜音及裝置音量。" : "換級提示音無法播放，請檢查頁面音效權限。", !played);
}
function handleVoiceAnnouncements(previousRemaining, elapsed) {
  if (remainingSeconds <= 0) return;
  const reminders = [[600, "ten-minutes"], [300, "five-minutes"], [180, "three-minutes"], [60, "one-minute"]];
  for (const [seconds, clip] of reminders) {
    if (remainingSeconds <= seconds && !minuteAnnouncements.has(seconds)) {
      minuteAnnouncements.add(seconds);
      // Cross the actual threshold: 60.2 -> 59.2 still announces one minute.
      // A long background gap marks reminders as consumed without playing a backlog.
      if (soundEnabled && elapsed <= 3 && previousRemaining > seconds && getLevelSeconds(currentLevel) > seconds) announceVoice(clip);
    }
  }
  const secondsLeft = Math.ceil(remainingSeconds);
  for (let seconds = 5; seconds >= 1; seconds -= 1) {
    if (secondsLeft <= seconds && !finalCountdownAnnounced.has(seconds)) {
      finalCountdownAnnounced.add(seconds);
      if (soundEnabled && elapsed <= 3 && secondsLeft === seconds && Math.ceil(previousRemaining) > seconds) {
        announceVoice(["", "one", "two", "three", "four", "five"][seconds]);
      }
    }
  }
}


function setSettingsOpen(open) {
  els.appShell.classList.toggle("settings-open", open);
  els.appShell.classList.toggle("settings-closed", !open);
  setText(els.toggleSettingsBtn, open ? "收合升盲設定" : "升盲設定");
  els.toggleSettingsBtn.setAttribute("aria-expanded", String(open));
}
function restoreDisplay() {
  els.appShell.classList.remove("fullscreen-display");
  setSettingsOpen(!settingsClosedBeforeFullscreen);
  setText(els.fullscreenBtn, "全螢幕");
}
async function toggleFullscreen() {
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch { restoreDisplay(); }
    return;
  }
  if (els.appShell.classList.contains("fullscreen-display")) { restoreDisplay(); return; }
  settingsClosedBeforeFullscreen = els.appShell.classList.contains("settings-closed");
  setSettingsOpen(false);
  els.appShell.classList.add("fullscreen-display");
  setText(els.fullscreenBtn, "離開全螢幕");
  try {
    if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else notify("已切換展示模式；此瀏覽器不支援原生全螢幕。");
  } catch { notify("已切換展示模式；可按離開展示返回操作畫面。"); }
}

els.startPauseBtn.addEventListener("click", () => { running ? pauseTimer() : startTimer(); });
els.prevBtn.addEventListener("click", () => changeLevel(currentLevel - 1));
els.nextBtn.addEventListener("click", () => changeLevel(currentLevel + 1));
els.resetBtn.addEventListener("click", () => {
  if ((hasStarted || finished) && !window.confirm("要重設本場計時嗎？將回到第 1 級，升盲與獎勵設定會保留。")) return;
  resetTimer();
});
els.addLevelBtn.addEventListener("click", () => {
  if (schedule.length >= MAX_LEVELS) return;
  pauseTimer();
  const last = [...schedule].reverse().find((level) => level.type === "blind") || defaultSchedule[0];
  schedule.push(normalizeLevel({ ...last, small: doubleChips(last.small), big: doubleChips(last.big), ante: doubleChips(last.ante) }));
  saveSchedule();
  renderAll();
});
els.addBreakBtn.addEventListener("click", () => {
  if (schedule.length >= MAX_LEVELS) return;
  pauseTimer();
  schedule.push(normalizeLevel({ type: "break", minutes: 10 }));
  saveSchedule();
  renderAll();
});
els.applyMinutesBtn.addEventListener("click", applyQuickSchedule);
for (const input of [els.defaultMinutes, els.quickSmall, els.quickAnte]) input?.addEventListener("input", updateQuickDraft);
els.anteAutoBtn?.addEventListener("click", () => setAnteMode("auto"));
els.anteCustomBtn?.addEventListener("click", () => setAnteMode("custom"));
els.anteToggle.addEventListener("change", () => {
  anteEnabled = els.anteToggle.checked;
  writeStored("pokerAnteEnabled", String(anteEnabled));
  syncQuickSettings();
  renderBoard();
  renderSchedule();
});
els.soundToggle.addEventListener("change", () => {
  soundEnabled = els.soundToggle.checked;
  if (!soundEnabled) { cancelAudio(); setAudioStatus("音效已關閉。"); }
  else { prepareAudio(); setAudioStatus("音效已開啟，可按試聽確認播放。"); }
});
els.testSoundBtn?.addEventListener("click", previewAudio);
els.toggleSettingsBtn.addEventListener("click", () => setSettingsOpen(els.appShell.classList.contains("settings-closed")));
els.closeSettingsBtn?.addEventListener("click", () => { setSettingsOpen(false); els.toggleSettingsBtn.focus(); });
els.fullscreenBtn.addEventListener("click", toggleFullscreen);
els.exitDisplay?.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) restoreDisplay(); });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.fullscreenElement && els.appShell.classList.contains("fullscreen-display")) restoreDisplay();
  if ((event.code !== "Space" && event.key !== " ") || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  if (document.querySelector("dialog[open]") || event.target?.closest?.('input, select, textarea, button, [contenteditable]:not([contenteditable="false"])')) return;
  event.preventDefault();
  running ? pauseTimer() : startTimer();
});

els.scheduleList.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-field]");
  const row = input?.closest(".schedule-row");
  if (!row) return;
  const index = Number(row.dataset.index);
  const field = input.dataset.field;
  if (!schedule[index] || !["minutes", "small", "big", "ante"].includes(field)) return;
  if (field === "ante" && (!anteEnabled || anteMode !== "custom" || schedule[index].type === "break")) return;
  const value = input.value;
  pauseTimer();
  const max = field === "minutes" ? 120 : field === "small" && els.autoBigToggle.checked ? Math.floor(MAX_CHIPS / 2) : MAX_CHIPS;
  schedule[index][field] = clampNumber(value, field === "minutes" ? 1 : 0, max, schedule[index][field]);
  if (field === "small" && els.autoBigToggle.checked) schedule[index].big = doubleChips(schedule[index].small);
  if (index === currentLevel && field === "minutes") {
    remainingSeconds = getLevelSeconds(currentLevel);
    finished = false;
    resetLevelAnnouncements();
  }
  saveSchedule();
  // Keep the next cell and its focus intact when a value is committed on blur or Tab.
  syncScheduleRow(index);
  syncQuickSettings();
  renderBoard();
});
els.scheduleList.addEventListener("click", (event) => {
  const button = event.target.closest(".delete-level");
  if (!button || schedule.length === 1) return;
  const index = Number(button.closest(".schedule-row").dataset.index);
  if (!schedule[index]) return;
  pauseTimer();
  schedule.splice(index, 1);
  if (index < currentLevel) currentLevel -= 1;
  else if (index === currentLevel) {
    currentLevel = Math.min(currentLevel, schedule.length - 1);
    remainingSeconds = getLevelSeconds(currentLevel);
    finished = false;
    resetLevelAnnouncements();
  }
  const lastBlindIndex = Math.max(0, getLastBlindIndex());
  if (currentLevel > lastBlindIndex) {
    currentLevel = lastBlindIndex;
    remainingSeconds = getLevelSeconds(currentLevel);
    finished = false;
    resetLevelAnnouncements();
  }
  saveSchedule();
  renderAll();
});

if ("speechSynthesis" in window) window.speechSynthesis.addEventListener?.("voiceschanged", selectEnglishVoice);
window.addEventListener("beforeunload", (event) => {
  if (!hasStarted || finished) return;
  event.preventDefault();
  event.returnValue = "";
});
window.PokerTimer = Object.freeze({ notify });
renderAll();
setInterval(updateAuxiliaryDisplays, 1000);
