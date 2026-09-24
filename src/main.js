import { createApp } from 'vue'
import { Locale } from 'vant'
import zhTW from 'vant/es/locale/lang/zh-TW'
import App from './App.vue'
import Vant from 'vant'
import 'vant/lib/index.css'
import './assets/base.css'
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'

Locale.use('zh-TW', zhTW)
createApp(App).use(Vant).mount('#app')

if (Capacitor.getPlatform() === 'android') {
  // Light system bars use dark icons against the app's pale background.
  void SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(console.error)
}
