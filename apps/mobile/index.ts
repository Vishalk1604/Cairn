import { registerRootComponent } from 'expo'
import { registerWidgetTaskHandler } from 'react-native-android-widget'
import './src/platform/auth'
import { App } from './src/App'
import { registerWidgetPushTask } from './src/widget/pushTask'
import { widgetTaskHandler } from './src/widget/widget'

registerRootComponent(App)
// The home-screen widget and the push that redraws it run without the app's screens, so both are set up here.
registerWidgetTaskHandler(widgetTaskHandler)
registerWidgetPushTask()
