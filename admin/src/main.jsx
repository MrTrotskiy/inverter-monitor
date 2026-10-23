// The screens: the admin (/, /admin, /admin?day=YYYY-MM-DD), the months (/history), the inverter's settings
// (/settings, changes with the PIN) and the notifications (/bot, changes with the PIN).
import { createRoot } from 'react-dom/client'
import './index.css'
import AdminPage from './pages/admin/index.jsx'
import HistoryPage from './pages/history/index.jsx'
import SettingsPage from './pages/settings/index.jsx'
import BotPage from './pages/bot/index.jsx'
import BankPage from './pages/bank/index.jsx'

const path = window.location.pathname.slice(import.meta.env.BASE_URL.length).replace(/\/+$/, '')
const PAGES = { history: [HistoryPage, 'Инвертор · месяцы'], settings: [SettingsPage, 'Инвертор · настройки'], bot: [BotPage, 'Инвертор · бот'], bank: [BankPage, 'Инвертор · банк'] }
const [Page, title] = PAGES[path] ?? [AdminPage, 'Инвертор']
document.title = title
createRoot(document.getElementById('root')).render(<Page />)
