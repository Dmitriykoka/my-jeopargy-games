import QRCode from "react-qr-code";

// Внутри рендера:
<div className="text-center">
    <h3>Сканируйте для входа:</h3>
    {/* Генерируем ссылку на текущий IP адрес сервера */}
    <div className="bg-white p-4 inline-block">
        <QRCode value={${window.location.protocol}//${window.location.hostname}:${window.location.port}/player} />
    </div>
</div>