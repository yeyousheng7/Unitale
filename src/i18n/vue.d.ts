import 'vue'
import type { I18nContext } from './index'

declare module 'vue' {
  interface ComponentCustomProperties {
    $t: I18nContext['t']
  }
}
