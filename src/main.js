import { createApp } from 'vue'
import App from './App.vue'
import Vant from 'vant'
import 'vant/lib/index.css'
import './assets/base.css'
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { installBackNavigation } from './services/backNavigation.js'
import { i18n } from './i18n/index.js'

// i18n 初始化時會同步設定 Vant 語系與 <html lang>
const app = createApp(App).use(i18n).use(Vant)
// 返回鍵先關彈窗、回首頁，最後才離開 App
installBackNavigation(app)
app.mount('#app')

if (Capacitor.getPlatform() === 'android') {
  // Light system bars use dark icons against the app's pale background.
  void SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(console.error)
}
