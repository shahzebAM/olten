import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import Privacy from './Privacy.tsx'
import './index.css'

const currentPath = window.location.pathname;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {currentPath === '/privacy' ? <Privacy /> : <App />}
  </React.StrictMode>,
)