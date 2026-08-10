import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/sse/server.ts',
    'src/sse/client.ts',
  ],
  dts: true,
  exports: true,
})
