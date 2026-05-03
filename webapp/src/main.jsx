import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 3200,
        style: {
          background: '#ffffff',
          color: '#172033',
          border: '1px solid #dfe5ef',
          boxShadow: '0 18px 44px rgba(15, 23, 42, 0.14)',
        },
      }}
    />
  </React.StrictMode>,
);
