
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import QRCode from 'react-qr-code';
import axios from 'axios';

// Инициализация сокета
// В режиме разработки предполагаем, что сервер запущен на 3000
const SERVER_URL = `http://${window.location.hostname}:3000`;
const socket = io(SERVER_URL);
const PLAYER_PATH = '/player';
const HOST_PATH = '/host';

// --- ГЛАВНЫЙ КОМПОНЕНТ APP ---
const App = () => {
    // Используем простой роутинг на основе URL
    const [route, setRoute] = useState(window.location.pathname);

    useEffect(() => {
        const handlePopState = () => setRoute(window.location.pathname);
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    // Присваиваем класс для стилей Tailwind
    return (
        <div className="bg-jeopardy-main min-h-screen font-body">
            {route.includes(PLAYER_PATH) ? <PlayerScreen /> : <HostScreen />}
        </div>
    );
};

// --- КОМПОНЕНТ ХОСТА (ВЕДУЩИЙ) ---

const HostScreen = () => {
    const [gameState, setGameState] = useState({
        settings: { answerTime: 20, buzzTime: 20 },
        players: [],
        gameStatus: 'LOBBY',
        currentQuestion: null,
        buzzerList: [],
        themes: [],
        activeThemes: [],
        hostId: null,
    });
    const [selectedQuestion, setSelectedQuestion] = useState(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [hostStatus, setHostStatus] = useState('UNREGISTERED');

    const [error, setError] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [buzzTimer, setBuzzTimer] = useState(0);

    // 1. Инициализация и подписка на сокеты
    useEffect(() => {
        socket.emit('register_host');
        
        socket.on('game_state', (state) => {
            setGameState(state);
            setHostStatus('READY');
        });

        socket.on('game_state_update', (update) => {
            setGameState(prev => ({ ...prev, ...update }));
        });

        
        socket.on('host_registered', () => setHostStatus('REGISTERED'));
        
        socket.on('player_buzzed_win', (data) => {
            setGameState(prev => ({ ...prev, gameStatus: 'ANSWERING', buzzerList: [data] }));
            // Сбросить таймер нажатия
            if (window.buzzInterval) clearInterval(window.buzzInterval);
            setBuzzTimer(0);
        });

        socket.on('round_end', (data) => {
            setGameState(prev => ({ 
                ...prev, 
                players: data.players, 
                activeThemes: data.activeThemes,

                gameStatus: 'BOARD',
                currentQuestion: null,
                buzzerList: [],
            }));
        });
        
        socket.on('error', (msg) => {
            setError(msg);
            setTimeout(() => setError(null), 5000);
        });

        // Таймер для отслеживания времени на нажатие
        socket.on('buzzers_open', (data) => {
            setBuzzTimer(data.duration);
            if (window.buzzInterval) clearInterval(window.buzzInterval);
            
            window.buzzInterval = setInterval(() => {

                setBuzzTimer(prev => {
                    if (prev <= 1) {
                        clearInterval(window.buzzInterval);
                        // Если время истекло и никто не нажал (или все нажавшие неверны)
                        socket.emit('host_resolve_answer', { correct: false, timedOut: true }); 
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        });
        
        return () => {
            socket.off('game_state');
            socket.off('game_state_update');
            socket.off('player_buzzed_win');

            socket.off('round_end');
            socket.off('error');
            socket.off('buzzers_open');
            if (window.buzzInterval) clearInterval(window.buzzInterval);
        };
    }, []);

    // 2. Управление игрой
    const handleNewGame = () => {
        socket.emit('host_reset_game');
    };

    const handleSelectQuestion = (themeIndex, qIndex) => {
        socket.emit('host_select_question', { themeIndex, qIndex });
        setSelectedQuestion(gameState.activeThemes[themeIndex].questions[qIndex]);
    };

    
    const handleOpenBuzzers = () => {
        socket.emit('host_open_buzzers');
    };

    const handleResolveAnswer = (correct) => {
        socket.emit('host_resolve_answer', { correct });
    };

    // 3. Управление файлом настроек
    const handleFileUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        setUploading(true);
        setError(null);


        try {
            // Отправка на бэкенд для парсинга Excel
            const response = await axios.post(`${SERVER_URL}/api/upload-questions`, formData);
            setError(`Успешно загружено ${response.data.themes.length} тем: ${response.data.themes.join(', ')}`);
        } catch (e) {
            setError('Ошибка загрузки файла. Проверьте формат Excel.');
        } finally {
            setUploading(false);
        }
    };

    // 4. Генерация QR-кода
    const joinUrl = useMemo(() => {
        // Устанавливаем URL для подключения игрока
        const hostname = window.location.hostname;
        const port = window.location.port || '80'; // В режиме разработки порт 3000, но для отображения QR лучше указывать порт, на котором будет доступен фронтенд
        return `http://${hostname}:${port}${PLAYER_PATH}`;
    }, []);
    
    // --- РЕНДЕРИНГ ---
    
    if (hostStatus !== 'REGISTERED') {
        return (
            <div className="flex justify-center items-center h-screen text-4xl text-jeopardy-gold">
                Загрузка Хоста...
            </div>

        );
    }
    
    // Текущий победитель нажатия
    const currentBuzzer = gameState.buzzerList[0];
    const questionStatus = gameState.gameStatus;

    return (
        <div className="p-4 md:p-8 space-y-4">
            
            {/* Ошибка/Уведомление */}
            {error && (
                <div className="fixed top-4 right-4 bg-red-700 text-white p-3 rounded-lg shadow-xl z-50 animate-pop-in">
                    {error}
                </div>
            )}

            
            {/* Панель управления и статистика */}
            <div className="flex flex-wrap items-center justify-between p-4 bg-jeopardy-light rounded-xl shadow-lg border-2 border-jeopardy-gold">
                <h1 className="text-2xl font-display font-bold text-jeopardy-gold text-shadow-gold">СВОЯ ИГРА: Хост</h1>
                <div className="space-x-4 flex items-center mt-2 md:mt-0">
                    <button 
                        onClick={() => setIsSettingsOpen(true)}
                        className="btn bg-gray-500 hover:bg-gray-600 text-white"
                    >
                        Настройки
                    </button>
                    <button 

                        onClick={handleNewGame} 
                        disabled={gameState.gameStatus !== 'LOBBY' && gameState.gameStatus !== 'BOARD'}
                        className="btn bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                    >
                        Новая Игра
                    </button>
                </div>
            </div>

            {/* Таблица игроков и QR */}
            <PlayerTable players={gameState.players} joinUrl={joinUrl} currentBuzzer={currentBuzzer} />

            {/* Игровое Табло */}

            <GameBoard 
                themes={gameState.activeThemes} 
                onSelectQuestion={handleSelectQuestion} 
                gameStatus={questionStatus}
                currentQuestion={gameState.currentQuestion}
                currentBuzzer={currentBuzzer}
                onOpenBuzzers={handleOpenBuzzers}
                onResolveAnswer={handleResolveAnswer}
                buzzTimer={buzzTimer}
            />

            {/* Модальное окно настроек */}
            {isSettingsOpen && (
                <SettingsModal 
                    settings={gameState.settings} 

                    onClose={() => setIsSettingsOpen(false)} 
                    onUpdateSettings={(s) => socket.emit('host_update_settings', s)}
                    onFileUpload={handleFileUpload}
                    uploading={uploading}
                />
            )}
        </div>
    );
};

// --- КОМПОНЕНТЫ ХОСТА: ТАБЛО ---

const GameBoard = ({ themes, onSelectQuestion, gameStatus, currentQuestion, currentBuzzer, onOpenBuzzers, onResolveAnswer, buzzTimer }) => {
    

    if (gameStatus === 'LOBBY') {
        return (
            <div className="p-10 bg-jeopardy-light rounded-xl text-center text-white text-2xl border-2 border-jeopardy-gold">
                Нажмите "Новая Игра", чтобы начать и выбрать темы.
            </div>
        );
    }

    // Если вопрос выбран, показываем оверлей
    if (currentQuestion && gameStatus !== 'BOARD') {
        return (
            <QuestionOverlay 
                question={currentQuestion}
                gameStatus={gameStatus}
                currentBuzzer={currentBuzzer}
                buzzTimer={buzzTimer}

                onOpenBuzzers={onOpenBuzzers}
                onResolveAnswer={onResolveAnswer}
            />
        );
    }
    
    // Игровое табло
    return (
        <div className="p-6 bg-jeopardy-light rounded-xl shadow-inner-xl cell-shadow border-4 border-jeopardy-gold">
            <h2 className="text-3xl font-display font-bold text-white mb-4 text-center">Выберите вопрос</h2>
            <div className={`grid gap-2 ${themes.length > 0 ? `grid-cols-${themes.length}` : 'grid-cols-1'}`}>
                {themes.map((theme, tIndex) => (
                    <div key={tIndex} className="flex flex-col gap-2">

                        
                        {/* Заголовок темы */}
                        <div className="bg-jeopardy-gold text-jeopardy-main font-display font-bold text-center flex items-center justify-center h-16 p-1 text-sm md:text-xl uppercase shadow-md rounded-md">
                            {theme.name}
                        </div>

                        {/* Ячейки вопросов */}
                        {theme.questions.map((q, qIndex) => (
                            <button
                                key={qIndex}
                                disabled={q.played}
                                onClick={() => onSelectQuestion(tIndex, qIndex)}
                                className={`
                                    h-20 md:h-24 flex-1 

font-display font-bold text-3xl md:text-5xl tracking-widest transition-all duration-300 rounded-md
                                    ${q.played 
                                        ? 'opacity-30 bg-gray-700 cursor-default'
                                        : 'bg-jeopardy-main text-jeopardy-gold border-2 border-jeopardy-gold hover:bg-jeopardy-light hover:text-white cursor-pointer cell-shadow hover:scale-[1.02] transform active:scale-[0.98]'}
                                `}
                            >
                                {q.cost}
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </div>

    );
};

// --- КОМПОНЕНТЫ ХОСТА: ОВЕРЛЕЙ ВОПРОСА ---

const QuestionOverlay = ({ question, gameStatus, currentBuzzer, buzzTimer, onOpenBuzzers, onResolveAnswer }) => {
    const [showAnswer, setShowAnswer] = useState(false);
    
    // Статус и кнопки для Хоста
    const StatusDisplay = () => {
        switch (gameStatus) {
            case 'QUESTION_READING':
                return (
                    <button 
                        onClick={onOpenBuzzers} 
                        className="btn bg-green-500 hover:bg-green-600 text-white 

text-2xl animate-pulse"
                    >
                        Открыть кнопки (Старт)
                    </button>
                );
            case 'BUZZ_OPEN':
                return (
                    <div className="text-jeopardy-accent text-4xl font-bold font-display animate-pulse flex items-center space-x-4">
                        <span className='text-white'>ЖМИТЕ!</span>
                        <span className="text-5xl border-4 p-2 rounded-full border-jeopardy-accent">{buzzTimer}c</span>
                    </div>
                );
            case 'ANSWERING':
                return (
                    <div className="space-y-4">

                        <p className="text-5xl text-red-500 font-display font-bold animate-bounce">{currentBuzzer.name} отвечает!</p>
                        
                        {/* Ответ и кнопки ведущего */}
                        <div className="bg-white text-gray-900 p-4 rounded-lg shadow-2xl">
                            <h4 className="font-bold text-lg">
                                {showAnswer ? `Ответ: ${question.a}` : 'Ответ скрыт'}
                                <button 
                                    onClick={() => setShowAnswer(prev => !prev)} 
                                    className="ml-4 text-blue-600 underline"
                                >
                                    {showAnswer ? 'Скрыть' : 'Показать ответ'}

                                </button>
                            </h4>
                        </div>

                        <div className="flex justify-center space-x-6">
                            <button onClick={() => onResolveAnswer(true)} className="btn bg-green-700 hover:bg-green-800 text-white text-xl">
                                ✔️ Верно (+{question.cost})
                            </button>
                            <button onClick={() => onResolveAnswer(false)} className="btn bg-red-700 hover:bg-red-800 text-white text-xl">
                                ❌ Неверно (-{question.cost})
                            </button>
                        </div>

                    </div>
                );
            default: return <p className="text-xl">Ожидание...</p>;
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm animate-pop-in">
            <div className="w-[90vw] h-[80vh] border-4 border-jeopardy-gold rounded-xl flex flex-col items-center justify-between p-10 text-center shadow-[0_0_50px_rgba(212,175,55,0.4)] bg-jeopardy-main transition-colors duration-500">
                
                {/* Вопрос */}
                <div className="flex-1 flex items-

center justify-center">
                    <h2 className="text-white font-display text-4xl md:text-6xl font-bold leading-tight uppercase drop-shadow-md">
                        {question.q}
                    </h2>
                </div>

                {/* Управление */}
                <div className="flex flex-col items-center justify-center space-y-4">
                    <StatusDisplay />
                    <p className="text-gray-400 text-lg">Стоимость: {question.cost}</p>
                </div>

            </div>
        </div>
    );
};

// --- КОМПОНЕНТЫ ХОСТА: ТАБЛИЦА ИГРОКОВ И QR ---

const PlayerTable = ({ players, joinUrl, currentBuzzer }) => {
    
    // URL для отображения QR в браузере Хоста
    const qrCodeValue = joinUrl;

    return (
        <div className="flex flex-wrap lg:flex-nowrap gap-4">
            
            {/* Таблица игроков */}
            <div className="w-full lg:w-2/3 bg-jeopardy-light p-4 rounded-xl shadow-lg border-2 border-jeopardy-gold">
                <h3 className="text-xl font-display font-bold text-white mb-3">Игроки ({players.filter(p => p.connected).length}/

{10})</h3>
                <div className="max-h-64 overflow-y-auto">
                    <ul className="space-y-2">
                        {players.map(p => (
                            <li key={p.id} className={`flex justify-between items-center p-2 rounded-lg transition-all duration-200 ${p.id === currentBuzzer?.playerId ? 'bg-red-500 animate-pulse-fast' : p.blocked ? 'bg-gray-700 opacity-60' : 'bg-jeopardy-main'}`}>
                                <div className="flex items-center space-x-2">
                                    <span className={`w-3 h-3 rounded-full ${p.connected ? 'bg-green-500' : 'bg-red-500'}`} title={p.connected ? 'Онлайн' : 'Офлайн'} />
                                    <span className={`font-bold ${p.id === 

currentBuzzer?.playerId ? 'text-white' : 'text-jeopardy-gold'}`}>{p.name}</span>
                                    {p.blocked && <span className="text-xs text-yellow-300">(Блок)</span>}
                                </div>
                                <span className={`text-xl font-mono ${p.score < 0 ? 'text-red-400' : 'text-green-400'}`}>{p.score}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* QR-код для подключения */}
            <div className="w-full lg:w-1/3 p-4 bg-jeopardy-light rounded-xl shadow-lg border-2 border-jeopardy-gold flex flex-col items-center text-center">
                <h3 className="text-xl font-

display font-bold text-white mb-3">Подключение Игроков</h3>
                <div className="p-2 bg-white rounded-md shadow-2xl">
                    <QRCode value={qrCodeValue} size={128} level="H" />
                </div>
                <p className="mt-2 text-sm text-gray-300 break-all">URL: {qrCodeValue}</p>
            </div>
        </div>
    );
};

// --- КОМПОНЕНТЫ ХОСТА: НАСТРОЙКИ ---

const SettingsModal = ({ settings, onClose, onUpdateSettings, onFileUpload, uploading }) => {

    const [localSettings, setLocalSettings] = useState(settings);

    const handleSave = () => {
        onUpdateSettings(localSettings);
        onClose();
    };
    
    const handleChange = (e) => {
        let value = parseInt(e.target.value);
        const name = e.target.name;

        if (name === 'buzzTime') {
            value = Math.max(10, Math.min(60, value));
        } else if (name === 'answerTime') {
            value = Math.max(10, Math.min(90, value));
        }
        
        setLocalSettings(prev => ({ ...prev, 

[name]: value }));
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-800 text-white p-6 rounded-xl w-full max-w-lg shadow-2xl border-2 border-jeopardy-gold">
                <h2 className="text-3xl font-display font-bold mb-4 text-jeopardy-gold">Настройки Игры</h2>

                {/* Настройка времени */}
                <div className="space-y-4 border-b pb-4 mb-4 border-gray-700">
                    <h3 className="text-xl font-bold">Тайминги</h3>
                    <div>

                        <label className="block mb-1">Время на ответ (ведущему, 10-90 сек):</label>
                        <input 
                            type="number" 
                            name="answerTime" 
                            value={localSettings.answerTime} 
                            onChange={handleChange} 
                            min="10" max="90" step="1" 
                            className="w-full p-2 bg-gray-700 rounded text-lg border border-gray-600"
                        />
                    </div>
                    <div>
                        <label className="block mb-1">Время на нажатие кнопки (игрокам, 10-60 сек):</label>

                        <input 
                            type="number" 
                            name="buzzTime" 
                            value={localSettings.buzzTime} 
                            onChange={handleChange} 
                            min="10" max="60" step="1" 
                            className="w-full p-2 bg-gray-700 rounded text-lg border border-gray-600"
                        />
                    </div>
                </div>

                {/* Добавление новых тем */}
                <div className="space-y-4">
                    <h3 className="text-xl font-bold">Импорт Вопросов</h3>
                    <p className="text-sm text-

gray-400">Загрузите Excel/CSV файл. Шаблон: [Тема | Вопрос | Ответ].</p>
                    <input 
                        type="file" 
                        accept=".xlsx, .xls, .csv" 
                        onChange={onFileUpload} 
                        disabled={uploading}
                        className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600"
                    />
                    {uploading && <p className="text-yellow-400">Идет загрузка и парсинг...</p>}
                </div>

                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onClose} 

className="btn bg-gray-600 hover:bg-gray-700 text-white">
                        Отмена
                    </button>
                    <button onClick={handleSave} className="btn bg-green-600 hover:bg-green-700 text-white">
                        Сохранить и Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- КОМПОНЕНТ ИГРОКА (МОБИЛЬНАЯ ВЕРСИЯ) ---

const PlayerScreen = () => {
    const [playerName, setPlayerName] = useState('');

    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [gameStatus, setGameStatus] = useState('WAITING'); // WAITING, ACTIVE, MY_TURN, LOCKED, BLOCKED
    const [buzzerWinner, setBuzzerWinner] = useState(null);
    const [error, setError] = useState(null);

    // 1. Инициализация и подписка на сокеты
    useEffect(() => {
        
        // Обновление состояния игры
        socket.on('game_state_update', (update) => {
            if (update.gameStatus) setGameStatus(update.gameStatus);
        });
        
        socket.on('player_authenticated', 

(data) => {
            setIsAuthenticated(true);
            setPlayerName(data.name);
        });

        // Открытие кнопок
        socket.on('buzzers_open', (data) => {
             // Проверяем, не заблокированы ли мы сервером (если ответили неверно)
            const isBlocked = data.blockedPlayers.includes(socket.id);
            setGameStatus(isBlocked ? 'BLOCKED' : 'ACTIVE');
            setBuzzerWinner(null);
        });
        
        // Кто-то нажал
        socket.on('player_buzzed_win', (data) => {
            setBuzzerWinner(data);

            setGameStatus(data.playerId === socket.id ? 'MY_TURN' : 'LOCKED');
        });

        // Повторное открытие кнопок после неверного ответа
        socket.on('buzzers_reopen', () => {
             // Если мы не в состоянии BLOCKED, снова открываем
             if (gameStatus !== 'BLOCKED') {
                setGameStatus('ACTIVE');
             }
        });
        
        socket.on('round_end', () => setGameStatus('WAITING'));
        socket.on('error', (msg) => setError(msg));
        
        return () => {
            socket.off('game_state_update');

            socket.off('player_authenticated');
            socket.off('buzzers_open');
            socket.off('player_buzzed_win');
            socket.off('round_end');
            socket.off('error');
        };
    }, [gameStatus]); // Перезапускаем только для обновления gameStatus

    // 2. Вход в игру
    const handleLogin = (e) => {
        e.preventDefault();
        if (playerName.trim()) {
            socket.emit('join_game', { name: playerName.trim() });
        }
    };
    
    // 3. Нажатие кнопки
    const handleBuzz = () => {
        if (gameStatus === 'ACTIVE') {

            socket.emit('player_buzz');
            // Оптимистичный UI: сразу показываем, что нажали
            setGameStatus('BUZZED_WAITING'); 
        }
    };

    // 4. Логика стилей
    const getButtonStyles = () => {
        switch (gameStatus) {
            case 'ACTIVE': // Можно жать
                return 'bg-green-600 hover:bg-green-500 border-green-400 shadow-[0_0_30px_rgba(34,197,94,0.6)] animate-pulse-fast';
            case 'MY_TURN': // Я нажал первый
                return 'bg-jeopardy-gold text-black border-white animate-bounce shadow-xl';
            case 'LOCKED': // Нажал другой

                return 'bg-red-800 text-gray-400 border-red-700 cursor-not-allowed';
            case 'BLOCKED': // Я ошибся и заблокирован
                return 'bg-gray-800 text-gray-500 border-gray-700 cursor-not-allowed opacity-50';
            default: // Ожидание
                return 'bg-blue-900 text-blue-300 border-blue-700 cursor-not-allowed';
        }
    };

    // --- РЕНДЕРИНГ ---

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col justify-center items-center h-screen bg-gray-900 p-8">
                <h1 className="text-3xl font-

display font-bold text-jeopardy-gold mb-8">Подключение к Игре</h1>
                <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
                    <input 
                        type="text"
                        placeholder="Ваше имя..."
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        className="w-full p-4 text-xl rounded-lg bg-gray-700 text-white border-2 border-jeopardy-gold focus:border-jeopardy-accent focus:ring-2 focus:ring-jeopardy-accent"
                        required
                    />
                    <button type="submit" className="w-full p-4 bg-green-600 text-white text-xl font-bold rounded-lg hover:bg-green-700 transition-colors">

                        Подключиться
                    </button>
                    {error && <p className="text-red-400 text-center mt-4">{error}</p>}
                </form>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen flex flex-col bg-gray-900 overflow-hidden">
            
            {/* Шапка игрока */}
            <div className="h-16 bg-black flex items-center justify-between px-4 border-b border-gray-700">
                <span className="text-white font-bold text-xl">{playerName}</span>
                <span className="text-sm text-gray-400">Состояние: {gameStatus}</

span>
            </div>

            {/* ОГРОМНАЯ КНОПКА */}
            <div className="flex-1 p-6 flex items-center justify-center">
                <button
                    onClick={handleBuzz}
                    disabled={gameStatus !== 'ACTIVE'}
                    className={`
                        w-full h-full rounded-3xl border-b-8 active:border-b-0 active:translate-y-2 transition-all duration-100
                        flex flex-col items-center justify-center
                        text-4xl md:text-6xl font-black uppercase tracking-widest
                        shadow-2xl
                        ${getButtonStyles()}

                    `}
                >
                    {gameStatus === 'ACTIVE' && <span>ЖМИ!</span>}
                    {gameStatus === 'WAITING' && <span className="text-2xl opacity-50">Ожидание вопроса...</span>}
                    {gameStatus === 'BUZZED_WAITING' && <span className="text-2xl opacity-80">Ожидание подтверждения...</span>}
                    {gameStatus === 'MY_TURN' && <span>ОТВЕЧАЙ!</span>}
                    {gameStatus === 'LOCKED' && <span className="text-xl">Опоздал. {buzzerWinner?.name} отвечает.</span>}
                    {gameStatus === 'BLOCKED' && <span className="text-xl">Вы заблокированы до след. вопроса.</span>}

                </button>
            </div>
        </div>
    );
};

// Глобальные стили Tailwind для кнопок
// Добавление пользовательских стилей, чтобы не засорять компоненты
const customStyles = `
    .btn {
        @apply px-4 py-2 rounded-lg font-bold transition-all duration-200 shadow-md hover:shadow-lg active:scale-[0.98];
    }
    .text-shadow-gold {
        text-shadow: 2px 2px 0px #000, 0 0 10px rgba(212, 175, 55, 0.5);
    }
    .cell-shadow {
        box-shadow: inset 0 0 10px 

rgba(0,0,0,0.5), 0 0 5px rgba(0,0,0,0.5);
    }
    .animate-pop-in {
        animation: popIn 0.3s ease-out forwards;
    }
    @keyframes popIn {
        0% { transform: scale(0.9); opacity: 0; }
        100% { transform: scale(1); opacity: 1; }
    }
`;

// Инъекция стилей и запуск
const AppWrapper = () => (
    <>
        <style dangerouslySetInnerHTML={{ __html: customStyles }} />
        <script src="https://cdn.tailwindcss.com"></script>
        <script dangerouslySetInnerHTML={{ __html: `

            tailwind.config = {
                theme: {
                    extend: {
                        colors: {
                            jeopardy: {
                                main: '#0a0a5e',
                                light: '#1e1e8f',
                                gold: '#d4af37',
                                accent: '#ffcc00',
                            }
                        },
                        fontFamily: {
                           display: ['"Oswald"', 'sans-serif'], // Предполагаем подключение шрифтов через index.html
                           body: ['"Roboto"', 'sans-serif'],
                        },
                        animation: {
                            'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                        },

                    }
                }
            }
        ` }} />
        <App />
    </>
);

export default AppWrapper;
