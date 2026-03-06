import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { ConfigProvider } from './context/ConfigContext'
import { MessagesProvider } from './hooks/useMessages'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <BrowserRouter>
            <ConfigProvider>
                <MessagesProvider>
                    <App />
                </MessagesProvider>
            </ConfigProvider>
        </BrowserRouter>
    </React.StrictMode>,
)
