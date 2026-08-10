import { fileURLToPath } from 'node:url'
import { snapshotApiPerEntry } from 'tsnapi/vitest'
import { describe } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('exports-snapshot', () => {
  snapshotApiPerEntry(root)
})
