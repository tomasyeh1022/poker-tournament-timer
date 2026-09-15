(function () {
  'use strict';

  const STORAGE_KEY = 'pokerPrizeSettingsV1';
  const MAX_POOL = 999999999;
  const UNITS = ['NT$', '點', '籌碼'];
  const number = value => new Intl.NumberFormat('zh-TW').format(value);
  const emptyConfig = () => ({ pool: null, unit: 'NT$', mode: 'percent', count: 3, values: [null, null, null] });
  const clone = config => ({ ...config, values: config.values.slice() });
  const validPool = pool => Number.isSafeInteger(pool) && pool > 0 && pool <= MAX_POOL;
  const validPercent = value => Number.isFinite(value) && value > 0 && value <= 100 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;

  // Work in basis points so percentages with two decimals share exactly 10,000 units.
  function allocate(pool, percentages) {
    if (!validPool(pool) || !Array.isArray(percentages) || percentages.length < 1 || percentages.length > 6 || !percentages.every(validPercent)) {
      throw new RangeError('Invalid prize allocation');
    }
    const basisPoints = percentages.map(value => Math.round(value * 100));
    if (basisPoints.reduce((sum, value) => sum + value, 0) !== 10000) throw new RangeError('Percentages must total 100');
    const result = basisPoints.map(value => Math.floor(pool * value / 10000));
    const left = pool - result.reduce((sum, value) => sum + value, 0);
    const order = basisPoints.map((value, index) => ({ index, remainder: pool * value % 10000 }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let index = 0; index < left; index += 1) result[order[index].index] += 1;
    return result;
  }

  function toPercent(pool, values) {
    if (!validPool(pool) || !Array.isArray(values) || values.length < 1 || values.length > 6 ||
        !values.every(value => Number.isSafeInteger(value) && value > 0) || values.reduce((sum, value) => sum + value, 0) !== pool) {
      throw new RangeError('Invalid fixed prizes');
    }
    const result = values.map(value => Math.floor(value * 10000 / pool));
    const left = 10000 - result.reduce((sum, value) => sum + value, 0);
    const order = values.map((value, index) => ({ index, remainder: value * 10000 % pool }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let index = 0; index < left; index += 1) result[order[index].index] += 1;
    return result.map(value => value / 100);
  }

  function validate(config, allowEmpty = false) {
    const error = (message, field) => ({ valid: false, message, field });
    if (!config || typeof config !== 'object' || Array.isArray(config) ||
        !UNITS.includes(config.unit) || !['percent', 'amount'].includes(config.mode) ||
        !Number.isInteger(config.count) || config.count < 1 || config.count > 6 ||
        !Array.isArray(config.values) || config.values.length !== config.count ||
        Object.keys(config).some(key => !['pool', 'unit', 'mode', 'count', 'values'].includes(key))) {
      return error('獎勵設定格式不正確，請重新設定。', 'settings');
    }
    if (config.pool === null) {
      if (allowEmpty && config.values.every(value => value === null)) {
        return { valid: true, empty: true, message: '獎池待設定。' };
      }
      return error(config.values.some(value => value !== null)
        ? '已填入名次分配，但總獎池仍空白；請先填入總獎池。'
        : '請填入總獎池與每個名次的分配；若要移除原設定，請按「清空設定」。', 'pool');
    }
    if (!validPool(config.pool)) return error('總獎池請輸入 1～999,999,999 的整數。', 'pool');
    const blankRank = config.values.findIndex(value => value === null);
    if (blankRank >= 0) return error('請填入第 ' + (blankRank + 1) + ' 名的' + (config.mode === 'percent' ? '比例。' : '金額。'), blankRank);
    const invalidRank = config.values.findIndex(value => !Number.isFinite(value) || value <= 0);
    if (invalidRank >= 0) return error('第 ' + (invalidRank + 1) + ' 名請填入大於 0 的有效數字。', invalidRank);
    if (config.mode === 'percent') {
      const invalidPrecision = config.values.findIndex(value => !validPercent(value));
      if (invalidPrecision >= 0) return error('第 ' + (invalidPrecision + 1) + ' 名比例請填 0.01～100，最多兩位小數。', invalidPrecision);
      const sum = config.values.reduce((total, value) => total + Math.round(value * 100), 0);
      if (sum !== 10000) return error('目前合計 ' + number(sum / 100) + '%，請調整為 100%。', 'sum');
      if (allocate(config.pool, config.values).some(value => value === 0)) {
        return error('獎池太小，部分名次分配後為 0；請調整獎池或名次。', 'sum');
      }
    } else {
      const invalidAmount = config.values.findIndex(value => !Number.isSafeInteger(value) || value > MAX_POOL);
      if (invalidAmount >= 0) return error('第 ' + (invalidAmount + 1) + ' 名金額請填入 1～999,999,999 的整數。', invalidAmount);
      const sum = config.values.reduce((total, value) => total + value, 0);
      if (sum !== config.pool) return error('分配合計 ' + number(sum) + '，與獎池相差 ' + number(Math.abs(config.pool - sum)) + '，請調整為一致。', 'sum');
    }
    return { valid: true, message: '分配合計 ' + number(config.pool) + ' ' + config.unit + '，與總獎池一致。' };
  }

  function loadConfig(storage) {
    let raw;
    try { raw = storage.getItem(STORAGE_KEY); }
    catch (error) {
      return { config: emptyConfig(), warning: '無法存取本機儲存空間。獎勵設定只能在這次開啟期間使用，重新整理後可能遺失。' };
    }
    try {
      if (raw === null) return { config: emptyConfig(), warning: '' };
      const parsed = JSON.parse(raw);
      const result = validate(parsed, true);
      if (!result.valid) throw new TypeError('Invalid saved prize settings');
      return { config: clone(parsed), warning: '' };
    } catch (error) {
      return { config: emptyConfig(), warning: '本機獎勵設定格式不正確，請重新設定；目前顯示獎池待設定。' };
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { allocate, toPercent, validate, emptyConfig, loadConfig, STORAGE_KEY };
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const form = $('prizeForm');
  if (!form) return;
  const inputs = () => Array.from(form.querySelectorAll('.reward-input'));
  const modeInputs = () => Array.from(form.querySelectorAll('input[name="mode"]'));
  const saved = (() => {
    try { return loadConfig(window.localStorage); }
    catch (error) {
      return { config: emptyConfig(), warning: '無法存取本機儲存空間。獎勵設定只能在這次開啟期間使用，重新整理後可能遺失。' };
    }
  })();
  let prizeConfig = saved.config;
  let storageWarning = saved.warning;
  let draft = emptyConfig();
  let modeDrafts = {};
  let clearRequested = false;

  const amounts = config => config.mode === 'percent' ? allocate(config.pool, config.values) : config.values.slice();
  function notify(message) {
    if (window.PokerTimer && typeof window.PokerTimer.notify === 'function') window.PokerTimer.notify(message);
    else $('formMessage').textContent = message;
  }

  function renderPrizes() {
    const config = prizeConfig;
    const empty = config.pool === null;
    $('poolNumber').textContent = empty ? '獎池待設定' : number(config.pool);
    $('poolNumber').classList.toggle('empty', empty);
    $('poolNumber').classList.toggle('long', !empty && config.pool >= 1000000);
    $('poolUnit').textContent = empty ? '' : config.unit;
    $('prizes').classList.toggle('dense', !empty && config.count > 3);
    $('prizes').classList.toggle('long-rewards', !empty && amounts(config).some(value => value >= 1000000));
    $('payoutMode').textContent = empty ? '' : config.mode === 'percent' ? '依比例分配' : '固定金額';
    const list = $('payoutList');
    list.replaceChildren();
    if (empty) {
      const row = document.createElement('li');
      row.className = 'empty-payout';
      const title = document.createElement('strong');
      title.textContent = '名次獎勵待設定';
      const note = document.createElement('span');
      note.textContent = '請在「獎勵設定」輸入總獎池與名次分配。';
      row.append(title, note);
      list.append(row);
    } else {
      amounts(config).forEach((amount, index) => {
        const row = document.createElement('li');
        row.className = 'payout-row';
        const placing = document.createElement('div');
        placing.className = 'placing';
        const rank = document.createElement('span');
        rank.className = 'rank-number num';
        rank.textContent = String(index + 1).padStart(2, '0');
        const label = document.createElement('span');
        label.className = 'rank-label';
        label.textContent = ['冠軍', '亞軍', '季軍'][index] || '第 ' + (index + 1) + ' 名';
        placing.append(rank, label);
        const reward = document.createElement('div');
        reward.className = 'reward';
        const value = document.createElement('strong');
        value.className = 'num';
        value.textContent = number(amount);
        const secondary = document.createElement('small');
        secondary.textContent = config.mode === 'percent' ? number(config.values[index]) + '%' : config.unit;
        reward.append(value, secondary);
        row.append(placing, reward);
        list.append(row);
      });
    }
    const foot = $('prizeFoot');
    foot.replaceChildren();
    if (!empty) {
      const title = document.createElement('strong');
      title.textContent = '獎勵 ' + config.count + ' 個名次';
      foot.append(title, document.createElement('br'));
    }
    const storageText = document.createElement('span');
    storageText.textContent = storageWarning || '設定只保存在目前瀏覽器，不會同步其他人或裝置。';
    if (storageWarning) {
      storageText.className = 'storage-warning';
      storageText.setAttribute('role', 'status');
    }
    foot.append(storageText);
  }

  function readNumber(input) {
    if (input.validity && input.validity.badInput) return NaN;
    return input.value.trim() === '' ? null : Number(input.value);
  }

  function readDraft() {
    draft.pool = readNumber($('poolInput'));
    draft.unit = $('unitInput').value;
    draft.values = inputs().map(readNumber);
  }

  function updateForm() {
    readDraft();
    if (clearRequested && (draft.pool !== null || draft.values.some(value => value !== null))) clearRequested = false;
    const result = clearRequested
      ? { valid: true, empty: true, message: '按「確認清空設定」後，會移除目前瀏覽器的獎池與全部名次分配。取消可保留原設定。' }
      : validate(draft);
    $('formMessage').textContent = result.message + (storageWarning ? ' ' + storageWarning : '');
    $('formMessage').className = 'form-message ' + (result.valid ? 'good' : 'error');
    $('applyPrizes').disabled = !result.valid;
    $('applyPrizes').textContent = clearRequested ? '確認清空設定' : '儲存並套用';
    $('poolInput').setAttribute('aria-invalid', String(result.field === 'pool'));
    const awards = result.valid && !result.empty ? amounts(draft) : null;
    inputs().forEach((input, index) => input.setAttribute('aria-invalid', String(result.field === index)));
    form.querySelectorAll('.editor-output').forEach((output, index) => { output.textContent = awards ? number(awards[index]) : '—'; });
  }

  function renderEditor() {
    const editor = $('rewardEditor');
    editor.replaceChildren();
    $('inputHeading').textContent = draft.mode === 'percent' ? '分配比例' : '固定金額';
    $('roundingNote').textContent = draft.mode === 'percent'
      ? '比例須合計 100%。獎勵以整數顯示，尾數依小數餘額大小補足；餘額相同時由較前名次優先，確保合計等於獎池。'
      : '各名次固定金額均須為正整數，合計須等於總獎池。';
    for (let index = 0; index < draft.count; index += 1) {
      const row = document.createElement('div');
      row.className = 'editor-row';
      const rank = document.createElement('span');
      rank.textContent = '第 ' + (index + 1) + ' 名';
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'reward-input';
      input.min = draft.mode === 'percent' ? '0.01' : '1';
      input.max = draft.mode === 'percent' ? '100' : String(MAX_POOL);
      input.step = draft.mode === 'percent' ? '0.01' : '1';
      input.inputMode = draft.mode === 'percent' ? 'decimal' : 'numeric';
      input.value = draft.values[index] ?? '';
      input.setAttribute('aria-label', '第 ' + (index + 1) + ' 名' + (draft.mode === 'percent' ? '比例' : '金額'));
      input.setAttribute('aria-describedby', 'formMessage');
      input.addEventListener('input', updateForm);
      label.append(input);
      if (draft.mode === 'percent') {
        const unit = document.createElement('span');
        unit.textContent = '%';
        label.append(unit);
      }
      const output = document.createElement('span');
      output.className = 'editor-output num';
      row.append(rank, label, output);
      editor.append(row);
    }
    updateForm();
  }

  function fillForm() {
    $('poolInput').value = draft.pool ?? '';
    $('unitInput').value = draft.unit;
    $('countInput').value = String(draft.count);
    modeInputs().forEach(input => { input.checked = input.value === draft.mode; });
    renderEditor();
  }

  $('editPrizes').addEventListener('click', () => {
    draft = clone(prizeConfig);
    modeDrafts = {};
    clearRequested = false;
    fillForm();
    $('prizeDialog').showModal();
  });
  ['closePrizes', 'cancelPrizes'].forEach(id => $(id).addEventListener('click', () => $('prizeDialog').close()));
  $('poolInput').addEventListener('input', updateForm);
  $('unitInput').addEventListener('change', updateForm);
  $('countInput').addEventListener('change', () => {
    readDraft();
    modeDrafts[draft.mode] = draft.values.slice();
    draft.count = Number($('countInput').value);
    for (const mode of Object.keys(modeDrafts)) {
      const previous = modeDrafts[mode];
      modeDrafts[mode] = Array.from({ length: draft.count }, (_, index) => previous[index] ?? null);
    }
    draft.values = modeDrafts[draft.mode].slice();
    renderEditor();
  });
  modeInputs().forEach(input => input.addEventListener('change', () => {
    if (!input.checked || input.value === draft.mode) return;
    readDraft();
    const result = validate(draft);
    const oldMode = draft.mode;
    modeDrafts[oldMode] = draft.values.slice();
    draft.mode = input.value;
    if (modeDrafts[draft.mode]) draft.values = modeDrafts[draft.mode].slice();
    else if (result.valid) draft.values = oldMode === 'percent' ? allocate(draft.pool, draft.values) : toPercent(draft.pool, draft.values);
    else draft.values = Array(draft.count).fill(null);
    renderEditor();
  }));
  $('clearPrizesBtn').addEventListener('click', () => {
    draft = emptyConfig();
    modeDrafts = {};
    clearRequested = true;
    fillForm();
    $('applyPrizes').focus();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    readDraft();
    if (clearRequested && (draft.pool !== null || draft.values.some(value => value !== null))) clearRequested = false;
    if (clearRequested) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        storageWarning = '';
      } catch (error) {
        storageWarning = '本次畫面已清空，但無法移除本機儲存的設定；重新整理後舊設定可能再次出現。';
      }
      prizeConfig = emptyConfig();
      renderPrizes();
      $('prizeDialog').close();
      notify(storageWarning || '已清空本機獎池與名次分配。');
      return;
    }
    const result = validate(draft);
    if (!result.valid) { updateForm(); return; }
    prizeConfig = clone(draft);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prizeConfig));
      storageWarning = '';
    } catch (error) {
      storageWarning = '獎勵已套用，但無法保存至目前瀏覽器；重新整理後可能遺失，請先記下設定。';
    }
    renderPrizes();
    $('prizeDialog').close();
    notify(storageWarning || '獎勵已儲存在目前瀏覽器並套用。');
  });
  renderPrizes();
}());
