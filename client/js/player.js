const socket = io();

let name = '';
let status = 'WAITING'; // WAITING ACTIVE MY_TURN LOCKED BLOCKED BUZZED_WAITING
let score = 0;
let winner = null;

const login = document.getElementById('login');
const game = document.getElementById('game');
const buzz = document.getElementById('buzz');
const pname = document.getElementById('pname');
const pscore = document.getElementById('pscore');
const loginError = document.getElementById('login-error');

document.getElementById('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  name = document.getElementById('name').value.trim();
  if (!name) return;
  socket.emit('join_game', { name });
});

socket.on('player_authenticated', (data) => {
  name = data.name;
  login.hidden = true;
  game.hidden = false;
  pname.textContent = name;
  paint();
});

socket.on('error', (msg) => {
  loginError.textContent = msg;
});

socket.on('game_state', (s) => {
  const me = s.players?.find((p) => p.name === name);
  if (me) {
    score = me.score;
    pscore.textContent = score;
    if (me.blocked && s.gameStatus === 'BUZZ_OPEN') status = 'BLOCKED';
  }
  if (s.gameStatus === 'BOARD' || s.gameStatus === 'LOBBY' || s.gameStatus === 'QUESTION_READING') {
    if (status !== 'BLOCKED') status = 'WAITING';
  }
  if (s.gameStatus === 'ANSWERING' && s.buzzerList?.[0]) {
    winner = s.buzzerList[0];
    status = s.buzzerList[0].playerId === socket.id ? 'MY_TURN' : 'LOCKED';
  }
  paint();
});

socket.on('buzzers_open', (data) => {
  const blocked = (data.blockedPlayers || []).includes(socket.id);
  status = blocked ? 'BLOCKED' : 'ACTIVE';
  winner = null;
  paint();
});

socket.on('buzzers_reopen', (data) => {
  const blocked = (data?.blockedPlayers || []).includes(socket.id);
  status = blocked ? 'BLOCKED' : 'ACTIVE';
  paint();
});

socket.on('player_buzzed_win', (data) => {
  winner = data;
  status = data.playerId === socket.id ? 'MY_TURN' : 'LOCKED';
  paint();
});

socket.on('round_end', (data) => {
  const me = data.players?.find((p) => p.name === name);
  if (me) {
    score = me.score;
    pscore.textContent = score;
  }
  status = 'WAITING';
  winner = null;
  paint();
});

socket.on('game_reset', () => {
  status = 'WAITING';
  score = 0;
  pscore.textContent = '0';
  paint();
});

buzz.addEventListener('click', () => {
  if (status !== 'ACTIVE') return;
  socket.emit('player_buzz');
  status = 'BUZZED_WAITING';
  paint();
});

function paint() {
  buzz.className = 'buzz';
  buzz.disabled = true;
  switch (status) {
    case 'ACTIVE':
      buzz.classList.add('active');
      buzz.disabled = false;
      buzz.textContent = 'ЖМИ!';
      break;
    case 'BUZZED_WAITING':
      buzz.classList.add('wait');
      buzz.textContent = 'Ждём…';
      break;
    case 'MY_TURN':
      buzz.classList.add('mine');
      buzz.textContent = 'ОТВЕЧАЙ!';
      break;
    case 'LOCKED':
      buzz.classList.add('locked');
      buzz.textContent = winner?.name ? `Отвечает ${winner.name}` : 'Опоздали';
      break;
    case 'BLOCKED':
      buzz.classList.add('blocked');
      buzz.textContent = 'Блок до след. вопроса';
      break;
    default:
      buzz.classList.add('wait');
      buzz.textContent = 'Ожидание вопроса…';
  }
}
