// @page: Админка инвертора
import { Scene, useFrameSize, Drawer } from '@/space'
import { Admin } from '../../lib/admin/Admin.jsx'
import { About } from './About.jsx'

// /admin?day=YYYY-MM-DD opens that day (from /history)
const asked = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('day') : null
const initialDay = /^\d{4}-\d\d-\d\d$/.test(asked ?? '') ? asked : null

export default function Page() {
  const { width, height } = useFrameSize()
  return (
    <Scene mode="app" tone="dark">
      {width ? <Admin w={width} h={height} keys initialDay={initialDay} /> : null}
      <Drawer title="Что здесь и как считается" side="right" w={420}>
        <About />
      </Drawer>
    </Scene>
  )
}
