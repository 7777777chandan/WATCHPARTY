import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Listen on all interfaces so phones on the same Wi-Fi can open http://<LAN-IP>:5173
  server: { host: true, port: 5173 },
  test: { environment: 'node' },
})
