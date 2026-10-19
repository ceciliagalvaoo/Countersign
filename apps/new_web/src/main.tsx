import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { AuthProvider } from './contexts/AuthContext.tsx'

console.log('Main: Starting React app...');
console.log('Main: Root element:', document.getElementById('root'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <App />
  </AuthProvider>
)

console.log('Main: React app rendered');

