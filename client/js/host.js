const socket = io();

let state = {
  settings: { answerTime: 20, buzzTime: 30 },
  players: [],
  gameStatus: 'LOBBY',
  currentQuestion: null,
  buzzerList: [],
  themes: [],
  controlPlayerId: null,
  packName: null,
  lanIps: [],
  port: location.port || '3000',
};

let showAnswer = false;
let answerLeft = 0;
let buzzLeft = 0;
let answerInterval = null;
let buzzInterval = null;

const $ = (id) => document.getElementById(id);

socket.emit('register_host');

socket.on('host_registered', () => {
  refreshPacks();
  updateQr();
});

socket.on('game_state', (s) => {
  state = { ...state, ...s };
  if (Array.isArray(s.activeThemes)) state.themes = s.activeThemes;
  render();
});

socket.on('game_state_update', (u) => {
  if (u.gameStatus) state.gameStatus = u.gameStatus;
  else if (u.status) state.gameStatus = u.status;
  if (u.question || u.currentQuestion) {
    state.currentQuestion = u.question || u.currentQuestion;
  }
  if (u.themes || u.activeThemes) state.themes = u.themes || u.activeThemes;
  if (u.players) state.players = u.players;
  if (u.packName) state.packName = u.packName;
  render();
});

socket.on('update_players', (players) => {
  state.players = players;
  renderPlayers();
});

socket.on('player_buzzed_win', (data) => {
  state.gameStatus = 'ANSWERING';
  state.buzzerList = [data];
  clearBuzzCountdown();
  render();
});

socket.on('buzzers_open', (data) => {
  state.gameStatus = 'BUZZ_OPEN';
  startBuzzCountdown(data.duration);
  render();
});

socket.on('buzzers_reopen', () => {
  state.gameStatus = 'BUZZ_OPEN';
  render();
});

socket.on('answer_timer', ({ duration }) => {
  startAnswerCountdown(duration);
});

socket.on('round_end', (data) => {
  state.players = data.players;
  state.themes = data.activeThemes || data.themes || state.themes;
  state.controlPlayerId = data.controlPlayerId;
  state.gameStatus = 'BOARD';
  state.currentQuestion = null;
  state.buzzerList = [];
  clearAnswerCountdown();
  clearBuzzCountdown();
  render();
});

socket.on('game_reset', () => {
  state.gameStatus = 'LOBBY';
  state.players = [];
  state.themes = [];
  state.currentQuestion = null;
  clearAnswerCountdown();
  clearBuzzCountdown();
  render();
});

socket.on('error', (msg) => toast(String(msg)));

async function refreshPacks() {
  const packs = await fetch('/api/packs').then((r) => r.json());
  const sel = $('pack-select');
  sel.innerHTML = packs.length
    ? packs.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.questions} вопр.)</option>`).join('')
    : '<option value="">Нет пакетов — создайте в Админе</option>';
}

function updateQr() {
  const host = location.hostname;
  const port = location.port || state.port || '3000';
  const url = `${location.protocol}//${host}:${port}/player`;
  $('join-url').textContent = url;
  if (window.QRCode) {
    QRCode.toCanvas($('qr'), url, { width: 180, margin: 1 }, (err) => {
      if (err) console.error(err);
    });
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render() {
  renderPlayers();
  const onBoard = state.gameStatus !== 'LOBBY' && state.themes?.length > 0;
  $('lobby-panel').hidden = onBoard;
  renderBoard();
  renderOverlay();
}

function renderPlayers() {
  const ul = $('players');
  ul.innerHTML = state.players
    .map((p) => {
      const cls = [
        p.id === state.buzzerList?.[0]?.playerId ? 'active' : '',
        p.id === state.controlPlayerId ? 'control' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<li class="${cls}">
        <span><span class="dot ${p.connected ? 'on' : 'off'}"></span>${escapeHtml(p.name)}${p.blocked ? ' (блок)' : ''}</span>
        <strong>${p.score}</strong>
      </li>`;
    })
    .join('');
  const ctrl = state.players.find((p) => p.id === state.controlPlayerId);
  $('control-hint').textContent = ctrl
    ? `Контроль табло: ${ctrl.name}`
    : 'Контроль табло: ведущий';
}

function renderBoard() {
  const root = $('board-root');
  if (!state.themes?.length || state.gameStatus === 'LOBBY') {
    root.innerHTML = '';
    return;
  }
  const cols = Math.max(state.themes.length, 1);
  root.innerHTML = `<div class="panel" style="margin-top:1rem">
    <h2 style="margin-top:0">Табло${state.packName ? ' — ' + escapeHtml(state.packName) : ''}</h2>
    <div class="board" style="grid-template-columns:repeat(${cols}, minmax(0,1fr))">
      ${state.themes
        .map(
          (theme, ti) => `<div class="theme-col">
          <div class="theme-title">${escapeHtml(theme.name)}</div>
          ${theme.questions
            .map(
              (q, qi) => `<button type="button" class="cell ${q.played ? 'played' : ''}"
                data-ti="${ti}" data-qi="${qi}" ${q.played || state.gameStatus !== 'BOARD' ? 'disabled' : ''}>
                ${q.cost}
              </button>`
            )
            .join('')}
        </div>`
        )
        .join('')}
    </div>
  </div>`;

  root.querySelectorAll('.cell').forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.emit('host_select_question', {
        themeIndex: Number(btn.dataset.ti),
        qIndex: Number(btn.dataset.qi),
      });
    });
  });
}

function renderOverlay() {
  const ov = $('question-overlay');
  const q = state.currentQuestion;
  const show =
    q && ['QUESTION_READING', 'BUZZ_OPEN', 'ANSWERING'].includes(state.gameStatus);
  ov.hidden = !show;
  if (!show) return;

  $('ov-meta').textContent = `Стоимость: ${q.cost}`;
  $('ov-question').textContent = q.q;
  renderMedia($('ov-media'), q);

  const status = $('ov-status');
  const actions = $('ov-actions');
  const answerWrap = $('ov-answer-wrap');
  $('ov-answer').textContent = q.a;
  answerWrap.hidden = state.gameStatus !== 'ANSWERING';

  if (state.gameStatus === 'QUESTION_READING') {
    status.innerHTML = '<span class="muted">Прочитайте вопрос, затем откройте кнопки</span>';
    actions.innerHTML = `
      <button type="button" class="ok" id="btn-open-buzz">Открыть кнопки</button>
      <button type="button" class="secondary" id="btn-skip">Пропустить</button>`;
    $('btn-open-buzz').onclick = () => socket.emit('host_open_buzzers');
    $('btn-skip').onclick = () => socket.emit('host_skip_question');
  } else if (state.gameStatus === 'BUZZ_OPEN') {
    status.innerHTML = `<strong style="font-size:1.6rem;color:var(--gold)">ЖМИТЕ!</strong>
      <div class="muted">Buzz: ${buzzLeft}с</div>`;
    actions.innerHTML = `<button type="button" class="secondary" id="btn-skip">Никто не знает — снять</button>`;
    $('btn-skip').onclick = () => socket.emit('host_skip_question');
  } else if (state.gameStatus === 'ANSWERING') {
    const who = state.buzzerList?.[0]?.name || 'Игрок';
    status.innerHTML = `<strong style="font-size:1.8rem;color:#ff6b6b">${escapeHtml(who)} отвечает</strong>
      <div class="muted">Осталось: ${answerLeft}с</div>`;
    actions.innerHTML = `
      <button type="button" class="ok" id="btn-yes">Верно (+${q.cost})</button>
      <button type="button" class="bad" id="btn-no">Неверно (−${q.cost})</button>`;
    $('btn-yes').onclick = () => socket.emit('host_resolve_answer', { correct: true });
    $('btn-no').onclick = () => socket.emit('host_resolve_answer', { correct: false });
  }
}

function startBuzzCountdown(sec) {
  clearBuzzCountdown();
  buzzLeft = sec;
  buzzInterval = setInterval(() => {
    buzzLeft -= 1;
    if (buzzLeft <= 0) clearBuzzCountdown();
    if (state.gameStatus === 'BUZZ_OPEN') renderOverlay();
  }, 1000);
}

function clearBuzzCountdown() {
  if (buzzInterval) clearInterval(buzzInterval);
  buzzInterval = null;
}

function startAnswerCountdown(sec) {
  clearAnswerCountdown();
  answerLeft = sec;
  answerInterval = setInterval(() => {
    answerLeft -= 1;
    if (answerLeft <= 0) clearAnswerCountdown();
    if (state.gameStatus === 'ANSWERING') renderOverlay();
  }, 1000);
}

function clearAnswerCountdown() {
  if (answerInterval) clearInterval(answerInterval);
  answerInterval = null;
}

$('btn-start').onclick = () => {
  const packId = $('pack-select').value;
  if (!packId) {
    toast('Сначала создайте пакет в Админе');
    return;
  }
  const answerTime = Number($('answer-time').value);
  const buzzTime = Number($('buzz-time').value);
  socket.emit('host_update_settings', { answerTime, buzzTime });
  socket.emit('host_load_pack', { packId, answerTime });
};

$('btn-reset').onclick = () => {
  if (confirm('Сбросить игру и игроков?')) socket.emit('host_reset_game');
};

$('btn-settings').onclick = () => {
  $('set-answer').value = state.settings.answerTime;
  $('set-buzz').value = state.settings.buzzTime;
  $('settings-modal').hidden = false;
};
$('btn-close-settings').onclick = () => {
  $('settings-modal').hidden = true;
};
$('btn-save-settings').onclick = () => {
  socket.emit('host_update_settings', {
    answerTime: Number($('set-answer').value),
    buzzTime: Number($('set-buzz').value),
  });
  $('settings-modal').hidden = true;
  toast('Сохранено', true);
};

$('btn-toggle-answer').onclick = () => {
  showAnswer = !showAnswer;
  $('ov-answer').style.visibility = showAnswer ? 'visible' : 'hidden';
  $('btn-toggle-answer').textContent = showAnswer ? 'Скрыть' : 'Показать';
};

// hide answer text initially when overlay opens
const ansObs = new MutationObserver(() => {
  if (!$('question-overlay').hidden && state.gameStatus === 'ANSWERING') {
    if (!showAnswer) $('ov-answer').style.visibility = 'hidden';
  } else {
    showAnswer = false;
  }
});
ansObs.observe($('question-overlay'), { attributes: true, attributeFilter: ['hidden'] });

fetch('/api/info')
  .then((r) => r.json())
  .then((info) => {
    state.lanIps = info.lanIps || [];
    state.port = info.port;
    updateQr();
  });

refreshPacks();
render();
