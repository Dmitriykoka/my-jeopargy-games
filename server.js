/**
 * «Совя игра» — Express + Socket.io
 * Ведущий / игроки (LAN) / админ пакетов
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data', 'packs');
const MEDIA_DIR = process.env.MEDIA_DIR
  ? path.resolve(process.env.MEDIA_DIR)
  : path.join(ROOT, 'media');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

[DATA_DIR, MEDIA_DIR, UPLOADS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const MAX_PLAYERS = 10;
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use('/media', express.static(MEDIA_DIR));
app.use(express.static(path.join(ROOT, 'client')));

// --- Helpers ---

function getLanIps() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

function packPath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function listPacks() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      return {
        id: raw.id,
        name: raw.name,
        updatedAt: raw.updatedAt,
        categories: (raw.categories || []).length,
        questions: (raw.categories || []).reduce(
          (n, c) => n + (c.questions || []).length,
          0
        ),
      };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function readPack(id) {
  const p = packPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writePack(pack) {
  pack.updatedAt = new Date().toISOString();
  fs.writeFileSync(packPath(pack.id), JSON.stringify(pack, null, 2), 'utf8');
  return pack;
}

function normalizeMediaType(v) {
  const t = String(v || '').toLowerCase().trim();
  if (['image', 'img', 'картинка', 'изображение'].includes(t)) return 'image';
  if (['audio', 'music', 'звук', 'музыка'].includes(t)) return 'audio';
  if (['video', 'видео'].includes(t)) return 'video';
  return t || null;
}

function parseExcelRows(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

  const categoriesMap = new Map();

  for (const row of rows) {
    const keys = Object.keys(row).reduce((acc, k) => {
      acc[String(k).trim().toLowerCase()] = row[k];
      return acc;
    }, {});

    const category =
      keys.category ||
      keys.категория ||
      keys.тема ||
      keys.theme ||
      keys['pack/category'] ||
      '';
    const question =
      keys.question || keys.вопрос || keys.q || keys.text || '';
    const answer = keys.answer || keys.ответ || keys.a || '';
    let value = keys.value || keys.стоимость || keys.cost || keys.цена || '';
    const media = String(keys.media || keys.медиа || keys.file || '').trim();
    const mediaType = normalizeMediaType(
      keys.media_type || keys['media type'] || keys.тип_медиа || keys.тип
    );

    if (!category || !question || !answer) continue;

    if (!categoriesMap.has(String(category))) {
      categoriesMap.set(String(category), []);
    }
    const list = categoriesMap.get(String(category));
    const cost =
      Number(value) > 0 ? Number(value) : (list.length + 1) * 100;

    list.push({
      id: randomUUID(),
      cost,
      question: String(question).trim(),
      answer: String(answer).trim(),
      media: media || null,
      mediaType: media ? mediaType || guessMediaType(media) : null,
    });
  }

  return Array.from(categoriesMap.entries()).map(([name, questions]) => ({
    id: randomUUID(),
    name,
    questions,
  }));
}

function guessMediaType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext))
    return 'image';
  if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) return 'audio';
  if (['.mp4', '.webm', '.ogv', '.mov'].includes(ext)) return 'video';
  return 'image';
}

function packToThemes(pack) {
  return (pack.categories || []).map((cat, themeIndex) => ({
    id: cat.id || `t-${themeIndex}`,
    name: cat.name,
    questions: (cat.questions || []).map((q, qIndex) => ({
      id: q.id || `q-${themeIndex}-${qIndex}`,
      cost: Number(q.cost) || (qIndex + 1) * 100,
      q: q.question,
      a: q.answer,
      media: q.media || null,
      mediaType: q.mediaType || (q.media ? guessMediaType(q.media) : null),
      played: false,
    })),
  }));
}

function publicGameState() {
  return {
    settings: gameState.settings,
    players: gameState.players,
    gameStatus: gameState.gameStatus,
    currentQuestion: gameState.currentQuestion
      ? {
          ...gameState.currentQuestion,
          // ответ только хосту — отдельным событием; игрокам не светим
        }
      : null,
    buzzerList: gameState.buzzerList,
    themes: gameState.themes,
    activeThemes: gameState.themes,
    controlPlayerId: gameState.controlPlayerId,
    packId: gameState.packId,
    packName: gameState.packName,
    hostConnected: Boolean(gameState.hostId),
    lanIps: getLanIps(),
    port: PORT,
  };
}

function emitState() {
  io.emit('game_state', publicGameState());
}

function clearAnswerTimer() {
  if (gameState.answerTimer) {
    clearTimeout(gameState.answerTimer);
    gameState.answerTimer = null;
  }
}

function clearBuzzTimer() {
  if (gameState.buzzTimer) {
    clearTimeout(gameState.buzzTimer);
    gameState.buzzTimer = null;
  }
}

// --- Game state ---

let gameState = {
  settings: {
    answerTime: 20,
    buzzTime: 30,
  },
  players: [],
  gameStatus: 'LOBBY', // LOBBY | BOARD | QUESTION_READING | BUZZ_OPEN | ANSWERING
  currentQuestion: null,
  buzzerList: [],
  themes: [],
  buzzOpenedAt: 0,
  hostId: null,
  controlPlayerId: null,
  packId: null,
  packName: null,
  answerTimer: null,
  buzzTimer: null,
};

const upload = multer({ dest: UPLOADS_DIR });

// --- HTTP API ---

app.get('/api/info', (_req, res) => {
  res.json({
    lanIps: getLanIps(),
    port: PORT,
    mediaDir: MEDIA_DIR,
    playerPath: '/player',
    hostPath: '/host',
    adminPath: '/admin',
  });
});

app.get('/api/qr', async (req, res) => {
  try {
    const QRCode = require('qrcode');
    const text = String(req.query.url || '').trim();
    if (!text || text.length > 512) {
      return res.status(400).json({ error: 'url required' });
    }
    const png = await QRCode.toBuffer(text, {
      type: 'png',
      width: 180,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'QR error' });
  }
});

app.get('/api/packs', (_req, res) => {
  res.json(listPacks());
});

app.get('/api/packs/:id', (req, res) => {
  const pack = readPack(req.params.id);
  if (!pack) return res.status(404).json({ error: 'Пакет не найден' });
  res.json(pack);
});

app.post('/api/packs', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Сначала укажите название пакета' });
  }
  const pack = {
    id: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    categories: [],
  };
  writePack(pack);
  res.status(201).json(pack);
});

app.put('/api/packs/:id', (req, res) => {
  const existing = readPack(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Пакет не найден' });

  const name = String(req.body.name || existing.name).trim();
  if (!name) return res.status(400).json({ error: 'Название пакета обязательно' });

  existing.name = name;
  if (Array.isArray(req.body.categories)) {
    existing.categories = req.body.categories;
  }
  writePack(existing);
  res.json(existing);
});

app.delete('/api/packs/:id', (req, res) => {
  const p = packPath(req.params.id);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Пакет не найден' });
  fs.unlinkSync(p);
  res.json({ success: true });
});

app.post('/api/packs/:id/import', upload.single('file'), (req, res) => {
  try {
    const pack = readPack(req.params.id);
    if (!pack) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Сначала создайте пакет и укажите имя' });
    }
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const categories = parseExcelRows(req.file.path);
    fs.unlinkSync(req.file.path);

    if (!categories.length) {
      return res.status(400).json({
        error:
          'Не удалось прочитать вопросы. Нужны столбцы: category, value, question, answer',
      });
    }

    const mode = req.body.mode === 'replace' ? 'replace' : 'append';
    if (mode === 'replace') {
      pack.categories = categories;
    } else {
      // merge by category name
      for (const cat of categories) {
        const found = pack.categories.find(
          (c) => c.name.toLowerCase() === cat.name.toLowerCase()
        );
        if (found) {
          found.questions.push(...cat.questions);
        } else {
          pack.categories.push(cat);
        }
      }
    }

    writePack(pack);
    res.json({
      success: true,
      pack,
      themes: pack.categories.map((c) => c.name),
      count: pack.categories.length,
    });
  } catch (e) {
    console.error(e);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Ошибка обработки Excel' });
  }
});

// Совместимость со старым эндпоинтом: требует packId в form-data
app.post('/api/upload-questions', upload.single('file'), (req, res) => {
  try {
    const packId = req.body.packId;
    if (!packId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: 'Сначала создайте пакет (packId) и укажите его имя',
      });
    }
    req.params = { id: packId };
    // reuse import handler logic via redirect-style call
    const pack = readPack(packId);
    if (!pack) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Пакет не найден' });
    }
    const categories = parseExcelRows(req.file.path);
    fs.unlinkSync(req.file.path);
    pack.categories = categories;
    writePack(pack);
    res.json({
      success: true,
      count: categories.length,
      themes: categories.map((c) => c.name),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка обработки файла' });
  }
});

app.get('/api/template.xlsx', (_req, res) => {
  const rows = [
    {
      pack_name: 'Демо-пакет',
      category: 'История',
      value: 100,
      question: 'В каком году основан Санкт-Петербург?',
      answer: '1703',
      media: '',
      media_type: '',
    },
    {
      pack_name: 'Демо-пакет',
      category: 'История',
      value: 200,
      question: 'Кто написал «Войну и мир»?',
      answer: 'Лев Толстой',
      media: 'tolstoy.jpg',
      media_type: 'image',
    },
    {
      pack_name: 'Демо-пакет',
      category: 'Музыка',
      value: 100,
      question: 'Угадайте мелодию',
      answer: 'Гимн',
      media: 'anthem.mp3',
      media_type: 'audio',
    },
  ];
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(wb, ws, 'questions');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="svoyak-template.xlsx"'
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.send(buf);
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'client', 'index.html'));
});
app.get('/host', (_req, res) => {
  res.sendFile(path.join(ROOT, 'client', 'host.html'));
});
app.get('/player', (_req, res) => {
  res.sendFile(path.join(ROOT, 'client', 'player.html'));
});
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(ROOT, 'client', 'admin.html'));
});

// --- Socket.io ---

io.on('connection', (socket) => {
  console.log('connected', socket.id);

  socket.on('register_host', () => {
    gameState.hostId = socket.id;
    socket.join('hosts');
    socket.emit('host_registered', { ok: true });
    socket.emit('game_state', publicGameState());
  });

  socket.on('host_update_settings', (settings) => {
    if (settings && typeof settings === 'object') {
      const answerTime = Number(settings.answerTime);
      const buzzTime = Number(settings.buzzTime);
      if (answerTime >= 5 && answerTime <= 120) {
        gameState.settings.answerTime = answerTime;
      }
      if (buzzTime >= 5 && buzzTime <= 120) {
        gameState.settings.buzzTime = buzzTime;
      }
      emitState();
    }
  });

  socket.on('host_load_pack', ({ packId, answerTime }) => {
    const pack = readPack(packId);
    if (!pack) {
      socket.emit('error', 'Пакет не найден');
      return;
    }
    if (answerTime != null) {
      const t = Number(answerTime);
      if (t >= 5 && t <= 120) gameState.settings.answerTime = t;
    }
    gameState.packId = pack.id;
    gameState.packName = pack.name;
    gameState.themes = packToThemes(pack);
    gameState.gameStatus = 'BOARD';
    gameState.currentQuestion = null;
    gameState.buzzerList = [];
    gameState.controlPlayerId = null;
    gameState.players.forEach((p) => {
      p.blocked = false;
    });
    clearAnswerTimer();
    clearBuzzTimer();
    emitState();
    io.emit('game_state_update', {
      status: 'BOARD',
      gameStatus: 'BOARD',
      themes: gameState.themes,
      activeThemes: gameState.themes,
      packName: pack.name,
    });
  });

  socket.on('join_game', ({ name }) => {
    const trimmed = String(name || '').trim().slice(0, 24);
    if (!trimmed) {
      socket.emit('error', 'Введите имя');
      return;
    }
    if (gameState.players.filter((p) => p.connected).length >= MAX_PLAYERS) {
      const existing = gameState.players.find((p) => p.name === trimmed);
      if (!existing) {
        socket.emit('error', 'Комната переполнена (макс 10)');
        return;
      }
    }

    const existingPlayer = gameState.players.find((p) => p.name === trimmed);
    if (existingPlayer) {
      existingPlayer.id = socket.id;
      existingPlayer.connected = true;
    } else {
      gameState.players.push({
        id: socket.id,
        name: trimmed,
        score: 0,
        connected: true,
        blocked: false,
      });
    }

    socket.join('players');
    socket.emit('player_authenticated', { name: trimmed, playerId: socket.id });
    socket.emit('game_state', publicGameState());
    io.emit('update_players', gameState.players);
    emitState();
  });

  socket.on('host_reset_game', () => {
    clearAnswerTimer();
    clearBuzzTimer();
    gameState.players = [];
    gameState.buzzerList = [];
    gameState.gameStatus = 'LOBBY';
    gameState.currentQuestion = null;
    gameState.themes = [];
    gameState.controlPlayerId = null;
    gameState.packId = null;
    gameState.packName = null;
    io.emit('game_reset');
    io.emit('update_players', []);
    emitState();
  });

  socket.on('host_select_question', ({ themeIndex, qIndex }) => {
    const theme = gameState.themes[themeIndex];
    if (!theme) return;
    const question = theme.questions[qIndex];
    if (!question || question.played) return;

    clearAnswerTimer();
    clearBuzzTimer();
    gameState.currentQuestion = {
      ...question,
      coordinates: { themeIndex, qIndex },
    };
    gameState.gameStatus = 'QUESTION_READING';
    gameState.buzzerList = [];
    gameState.players.forEach((p) => {
      p.blocked = false;
    });

    io.emit('game_state_update', {
      status: 'QUESTION_READING',
      gameStatus: 'QUESTION_READING',
      question: gameState.currentQuestion,
      currentQuestion: gameState.currentQuestion,
      players: gameState.players,
    });
    emitState();
  });

  socket.on('host_open_buzzers', () => {
    if (
      gameState.gameStatus !== 'QUESTION_READING' &&
      gameState.gameStatus !== 'BUZZ_OPEN'
    ) {
      return;
    }
    openBuzzers();
  });

  socket.on('player_buzz', () => {
    if (gameState.gameStatus !== 'BUZZ_OPEN') return;
    const player = gameState.players.find((p) => p.id === socket.id);
    if (!player || player.blocked || !player.connected) return;

    if (gameState.buzzerList.find((b) => b.playerId === socket.id)) return;

    const reactionTime = Date.now() - gameState.buzzOpenedAt;
    gameState.buzzerList.push({
      playerId: socket.id,
      name: player.name,
      time: reactionTime,
    });

    if (gameState.buzzerList.length === 1) {
      clearBuzzTimer();
      gameState.gameStatus = 'ANSWERING';
      const winPayload = {
        playerId: socket.id,
        name: player.name,
        time: reactionTime,
      };
      io.emit('player_buzzed_win', winPayload);
      startAnswerTimer();
      emitState();
    }
  });

  socket.on('host_resolve_answer', ({ correct, timedOut }) => {
    resolveAnswer(Boolean(correct), Boolean(timedOut));
  });

  socket.on('host_skip_question', () => {
    if (!gameState.currentQuestion) return;
    const { themeIndex, qIndex } = gameState.currentQuestion.coordinates;
    gameState.themes[themeIndex].questions[qIndex].played = true;
    finishRoundToBoard();
  });

  socket.on('disconnect', () => {
    if (gameState.hostId === socket.id) {
      gameState.hostId = null;
    }
    const player = gameState.players.find((p) => p.id === socket.id);
    if (player) {
      player.connected = false;
      io.emit('update_players', gameState.players);
      emitState();
    }
  });
});

function openBuzzers() {
  clearBuzzTimer();
  clearAnswerTimer();
  gameState.gameStatus = 'BUZZ_OPEN';
  gameState.buzzOpenedAt = Date.now();
  const blockedPlayers = gameState.players.filter((p) => p.blocked).map((p) => p.id);
  io.emit('buzzers_open', {
    duration: gameState.settings.buzzTime,
    blockedPlayers,
  });
  emitState();

  gameState.buzzTimer = setTimeout(() => {
    if (gameState.gameStatus === 'BUZZ_OPEN') {
      // никто не нажал
      finishRoundToBoard();
    }
  }, gameState.settings.buzzTime * 1000);
}

function startAnswerTimer() {
  clearAnswerTimer();
  const duration = gameState.settings.answerTime;
  io.emit('answer_timer', { duration });
  gameState.answerTimer = setTimeout(() => {
    if (gameState.gameStatus === 'ANSWERING') {
      resolveAnswer(false, true);
    }
  }, duration * 1000);
}

function resolveAnswer(correct, timedOut) {
  clearAnswerTimer();
  const currentBuzzer = gameState.buzzerList[0];
  if (!currentBuzzer) {
    if (timedOut) finishRoundToBoard();
    return;
  }

  const player = gameState.players.find((p) => p.id === currentBuzzer.playerId);
  const cost = gameState.currentQuestion?.cost || 0;

  if (!player || !gameState.currentQuestion) return;

  if (correct) {
    player.score += cost;
    const { themeIndex, qIndex } = gameState.currentQuestion.coordinates;
    gameState.themes[themeIndex].questions[qIndex].played = true;
    gameState.controlPlayerId = player.id;
    finishRoundToBoard();
  } else {
    player.score -= cost;
    player.blocked = true;
    gameState.buzzerList.shift();
    io.emit('update_players', gameState.players);

    const remaining = gameState.players.filter(
      (p) => p.connected && !p.blocked
    );
    if (remaining.length === 0) {
      const { themeIndex, qIndex } = gameState.currentQuestion.coordinates;
      gameState.themes[themeIndex].questions[qIndex].played = true;
      finishRoundToBoard();
    } else {
      openBuzzers();
      io.emit('buzzers_reopen', {
        blockedPlayers: gameState.players.filter((p) => p.blocked).map((p) => p.id),
      });
    }
  }
}

function finishRoundToBoard() {
  clearAnswerTimer();
  clearBuzzTimer();
  gameState.gameStatus = 'BOARD';
  gameState.currentQuestion = null;
  gameState.buzzerList = [];
  gameState.players.forEach((p) => {
    p.blocked = false;
  });
  io.emit('round_end', {
    players: gameState.players,
    activeThemes: gameState.themes,
    themes: gameState.themes,
    controlPlayerId: gameState.controlPlayerId,
  });
  emitState();
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLanIps();
  console.log(`Совя игра на порту ${PORT}`);
  console.log(`Локально: http://localhost:${PORT}/host`);
  ips.forEach((ip) => {
    console.log(`LAN хост:   http://${ip}:${PORT}/host`);
    console.log(`LAN игрок:  http://${ip}:${PORT}/player`);
    console.log(`LAN админ:  http://${ip}:${PORT}/admin`);
  });
  console.log(`Медиа: ${MEDIA_DIR}`);
});
