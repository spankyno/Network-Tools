import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Registro de Service Worker para PWA y modo offline
if ('serviceWorker' in navigator && process.env.NODE_ENV !== 'test') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('NetCheck Service Worker registrado con éxito:', reg.scope);
      })
      .catch((err) => {
        console.warn('Fallo al registrar Service Worker:', err);
      });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
