import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx'; // Импортируем наш основной компонент App

// 1. Находим корневой элемент в index.html (div с id="root")
// 2. Создаем "корень" React-приложения
// 3. Рендерим главный компонент <App />
ReactDOM.createRoot(document.getElementById('root')).render(
  // React.StrictMode помогает найти потенциальные проблемы в приложении
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
