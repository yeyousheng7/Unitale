import assert from 'node:assert/strict'
import test from 'node:test'
import { matchLibraryId } from '../src/services/audio/libraryRefs.ts'

test('analysis names resolve to stable library IDs and unknown names are omitted', () => {
  const library = [{ id: 'effect-17', name: 'Door Slam' }, { id: 'effect-42', name: 'Rain' }]
  assert.equal(matchLibraryId(' door slam ', library), 'effect-17')
  assert.equal(matchLibraryId('Door', library), 'effect-17')
  assert.equal(matchLibraryId('Thunder', library), '')
  assert.equal(matchLibraryId(null, library), '')
})
