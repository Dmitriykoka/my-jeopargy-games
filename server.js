const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // Разрешаем подключение с разных устройств
});

// --- ХРАНИЛИЩЕ ДАННЫХ (В ПАМЯТИ) ---
// В реальном проде лучше использовать Redis/DB, но для задачи этого достаточно
let gameState = {
    settings: {
        answerTime: 20, // Время на ответ (голосом)
        buzzTime: 20,   // Время на нажатие кнопки
    },
    players: [], // { id, name, score, connected }
    gameStatus: 'LOBBY', // LOBBY, BOARD, QUESTION_READING, BUZZ_OPEN, ANSWERING, FINAL
    currentQuestion: null,
    buzzerList: [], // Очередь нажавших { playerId, time }
    themes: [], // Загруженные вопросы
    buzzOpenedAt: 0, // Таймстемп открытия кнопок
};

const MAX_PLAYERS = 10;

// --- ЗАГРУЗКА EXCEL ---
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'client'))); // Раздача фронтенда
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});
// API для загрузки вопросов
app.post('/api/upload-questions', upload.single('file'), (req, res) => {
    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
        
        // Парсинг: 0-Тема, 1-Вопрос, 2-Ответ
        // Пропускаем заголовки если есть, простая валидация
        const newThemes = {};
        
        data.forEach(row => {
            if (row[0] && row[1] && row[2]) {
                const theme = row[0];
                if (!newThemes[theme]) newThemes[theme] = [];
                newThemes[theme].push({ 
                    q: row[1], 
                    a: row[2], 
                    cost: (newThemes[theme].length + 1) * 100, // Авто-стоимость
                    played: false 
                });
            }
        });

        // Преобразование в массив для игры
        gameState.themes = Object.keys(newThemes).map(key => ({
            name: key,
            questions: newThemes[key]
        }));

        fs.unlinkSync(req.file.path); // Удаляем файл
        res.json({ success: true, count: gameState.themes.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Ошибка обработки файла" });
    }
});

// --- ЛОГИКА SOCKET.IO ---

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Подключение игрока
    socket.on('join_game', ({ name }) => {
        if (gameState.players.length >= MAX_PLAYERS) {
            socket.emit('error', 'Комната переполнена (макс 10)');
            return;
        }
        const existingPlayer = gameState.players.find(p => p.name === name);
        
        if (existingPlayer) {
            // Переподключение (если вылетел)
            existingPlayer.id = socket.id;
            existingPlayer.connected = true;
        } else {
            gameState.players.push({
                id: socket.id,
                name: name,
                score: 0,
                connected: true,
                blocked: false // Если ответил неверно
            });
        }
        
        socket.join('game_room');
        io.emit('update_players', gameState.players);
        socket.emit('game_state', gameState); // Отправить текущее состояние
    });

    // 2. Хост: Новая игра / Сброс
    socket.on('host_reset_game', () => {
        gameState.players = [];
        gameState.buzzerList = [];
        gameState.gameStatus = 'LOBBY';
        io.emit('game_reset');
        io.emit('update_players', []);
    });

    // 3. Хост: Выбор вопроса
    socket.on('host_select_question', ({ themeIndex, qIndex }) => {
        gameState.currentQuestion = gameState.themes[themeIndex].questions[qIndex];
        gameState.currentQuestion.coordinates = { themeIndex, qIndex }; // Чтобы пометить как сыгранный
        gameState.gameStatus = 'QUESTION_READING';
        gameState.buzzerList = [];
        // Сброс блокировок "неверно ответивших" для нового вопроса
        gameState.players.forEach(p => p.blocked = false);
        
        io.emit('game_state_update', { 
            status: 'QUESTION_READING', 
            question: gameState.currentQuestion 
        });
    });

    // 4. Хост: Открыть кнопки (СТАРТ ТАЙМЕРА КНОПОК)
    socket.on('host_open_buzzers', () => {
        gameState.gameStatus = 'BUZZ_OPEN';
        gameState.buzzOpenedAt = Date.now();
        io.emit('buzzers_open', { duration: gameState.settings.buzzTime });
    });

    // 5. ИГРОК: Нажатие кнопки
    socket.on('player_buzz', () => {
        if (gameState.gameStatus !== 'BUZZ_OPEN') return;
        
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player || player.blocked) return;

        // Фиксируем
        const reactionTime = Date.now() - gameState.buzzOpenedAt;
        
        // Добавляем в список (если еще нет)
        if (!gameState.buzzerList.find(b => b.playerId === socket.id)) {
            gameState.buzzerList.push({
                playerId: socket.id,
                name: player.name,
                time: reactionTime
            });
        }

        // Если это ПЕРВЫЙ нажавший -> Останавливаем прием для всех и переходим к ответу
        if (gameState.buzzerList.length === 1) {
            gameState.gameStatus = 'ANSWERING';
            io.emit('player_buzzed_win', { 
                playerId: socket.id, 
                name: player.name,
                time: reactionTime 
            });
        }
    });

    // 6. Хост: Обработка ответа (Верно/Неверно)
    socket.on('host_resolve_answer', ({ correct }) => {
        const currentBuzzer = gameState.buzzerList[0]; // Тот кто отвечает сейчас
        if (!currentBuzzer) return;

        const playerIndex = gameState.players.findIndex(p => p.id === currentBuzzer.playerId);
        const cost = gameState.currentQuestion.cost;

        if (correct) {
            // Верно: Плюс очки, возврат к доске
            gameState.players[playerIndex].score += cost;
            gameState.themes[gameState.currentQuestion.coordinates.themeIndex].questions[gameState.currentQuestion.coordinates.qIndex].played = true;
            gameState.gameStatus = 'BOARD';
            gameState.buzzerList = [];
            io.emit('round_end', { players: gameState.players });
        } else {
            // Неверно: Минус очки, игрока блокируем, открываем кнопки остальным
            gameState.players[playerIndex].score -= cost;
            gameState.players[playerIndex].blocked = true;
            
            // Удаляем этого игрока из списка "нажавших"
            gameState.buzzerList.shift(); 
            
            gameState.gameStatus = 'BUZZ_OPEN'; // Снова даем жать остальным
            io.emit('update_players', gameState.players); // Обновить счет
            io.emit('buzzers_reopen'); // Сигнал клиентам разблокировать кнопки (кроме ошибившегося)
        }
    });

    // 7. Финальный раунд (Текстовые ответы)
    socket.on('player_final_answer', ({ answer, bet }) => {
        // Логика сохранения текстового ответа для финала
        // ... (реализуется аналогично, сохраняя ответы в массив finalAnswers)
    });

    socket.on('disconnect', () => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
            player.connected = false;
            io.emit('update_players', gameState.players);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});