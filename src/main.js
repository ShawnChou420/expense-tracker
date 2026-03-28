import { createApp } from 'vue'
import { Locale } from 'vant'
import zhTW from 'vant/es/locale/lang/zh-TW'
import App from './App.vue'
import Vant from 'vant'
import 'vant/lib/index.css'

Locale.use('zh-TW', zhTW)
createApp(App).use(Vant).mount('#app')