// Runs before every unit test file.
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Removes what a component test rendered, and what it remembered.
afterEach(() => {
  cleanup()
  localStorage.clear()
})
