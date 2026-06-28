import React from 'react';
import ReactDOM from 'react-dom/client';
import { OptionsPage } from './components/OptionsPage';

// DOM ready check for defensive programming
function initializeReact() {
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    console.error('Root element not found');
    return;
  }

  const root = ReactDOM.createRoot(rootElement);

  root.render(
    <React.StrictMode>
      <OptionsPage />
    </React.StrictMode>
  );
}

// Ensure DOM is ready before initializing React
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeReact);
} else {
  initializeReact();
}