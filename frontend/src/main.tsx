import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import Privacy from './Privacy.tsx'
import Terms from './terms&conditions.tsx'
import './index.css'

const currentPath = window.location.pathname;

// Determine exactly which single component to show based on the URL
let ComponentToRender = <App />;

if (currentPath === '/privacy') {
  ComponentToRender = <Privacy />;
} else if (currentPath === '/terms') {
  ComponentToRender = <Terms />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {ComponentToRender}
  </React.StrictMode>,
)