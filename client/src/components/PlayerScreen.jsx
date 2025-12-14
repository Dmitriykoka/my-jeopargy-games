import { useEffect, useState } from 'react';
import { socket } from '../socket';

export default function PlayerScreen() {
  const [status, setStatus] = useState('WAITING'); // WAITING, ACTIVE, BLOCKED
  const [playerName, setPlayerName] = useState('');
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    // Слушаем команды от сервера
    socket.on('buzzers_open', () => setStatus('ACTIVE'));
    socket.on('player_buzzed_win', (data) => {
        if (data.playerId === socket.id) setStatus('MY_TURN');
        else setStatus('LOCKED');
    });
    socket.on('buzzers_reopen', () => {
        // Если мы не заблокированы сервером (не ошибались ранее)
        if (status !== 'BLOCKED_BY_SERVER') setStatus('ACTIVE');
    });
    
    return () => socket.off(); // Cleanup
  }, [status]);

  const handleBuzz = () => {
    if (status === 'ACTIVE') {
      socket.emit('player_buzz');
      // Оптимистичный UI: сразу показываем, что нажали, пока ждем подтверждения
      setStatus('BUZZED_WAITING'); 
    }
  };

  const handleLogin = () => {
      socket.emit('join_game', { name: playerName });
      setJoined(true);
  }

  if (!joined) {
      return (
          <div className="p-10">
              <input className="border p-2" onChange={e => setPlayerName(e.target.value)} placeholder="Ваше имя" />
              <button className="bg-blue-500 text-white p-2 ml-2" onClick={handleLogin}>Подключиться</button>
          </div>
      )
  }

  // Огромная кнопка
  return (
    <div className={h-screen flex items-center justify-center ${status === 'ACTIVE' ? 'bg-green-500' : 'bg-gray-800'}}>
      <button 
        className="w-full h-full text-4xl font-bold text-white uppercase"
        onClick={handleBuzz}
        disabled={status !== 'ACTIVE'}
      >
        {status === 'ACTIVE' ? 'ОТВЕТИТЬ!' : 
         status === 'MY_TURN' ? 'ВАШ ОТВЕТ!' : 
         'ЖДИТЕ...'}
      </button>
    </div>
  );
}