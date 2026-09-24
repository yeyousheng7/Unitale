import { createApp } from 'vue'
import App from './App.vue'
import { createI18n, i18nKey } from './i18n'
import './styles/tailwind.css'
import '../ui.css'

const app = createApp(App)
const i18n = createI18n(document.documentElement.lang)
app.provide(i18nKey, i18n)
app.config.globalProperties.$t = i18n.t
app.mount('#app')
