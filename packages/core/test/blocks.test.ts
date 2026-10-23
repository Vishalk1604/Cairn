import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_MARKER,
  insertMedia,
  joinBlocks,
  markerLine,
  pruneAttachments,
  referencedAttachmentIds,
  removeMedia,
  splitBody,
  type Attachment,
  type NoteBlock,
} from '../src'
import { NOW } from './helpers'

const photo = (id: string): Attachment => ({ id, kind: 'image', mime: 'image/jpeg', createdAt: NOW })

const text = (t: string): NoteBlock => ({ kind: 'text', text: t })

describe('note blocks', () => {
  it('always gives the caret somewhere to go, even around a lone photo', () => {
    const blocks = splitBody(markerLine('a1'), [photo('a1')])
    expect(blocks).toEqual([text(''), { kind: 'media', id: 'a1', attachment: photo('a1') }, text('')])
  })

  it('shows a photo once even when its marker is in the body twice, and heals the body', () => {
    const body = `one\n${markerLine('a1')}\ntwo\n${markerLine('a1')}\nthree`
    const blocks = splitBody(body, [photo('a1')])
    expect(blocks.filter((b) => b.kind === 'media')).toHaveLength(1)
    expect(joinBlocks(blocks)).toBe(`one\n${markerLine('a1')}\ntwo\nthree`)
  })

  it('drops a second copy of the same photo inserted straight after the first', () => {
    const shot = (id: string, bytes: number): Attachment => ({ ...photo(id), bytes, width: 1080, height: 2400 })
    const body = `one
${markerLine('a1')}
${markerLine('a2')}
two`
    const blocks = splitBody(body, [shot('a1', 5000), shot('a2', 5000)])
    expect(blocks.filter((b) => b.kind === 'media').map((b) => b.kind === 'media' && b.id)).toEqual(['a1'])
    expect(joinBlocks(blocks)).toBe(`one
${markerLine('a1')}
two`)
    // Different pictures, or the same one with writing between, are both kept.
    expect(splitBody(body, [shot('a1', 5000), shot('a2', 5001)]).filter((b) => b.kind === 'media')).toHaveLength(2)
    const apart = `${markerLine('a1')}
look again
${markerLine('a2')}`
    expect(splitBody(apart, [shot('a1', 5000), shot('a2', 5000)]).filter((b) => b.kind === 'media')).toHaveLength(2)
  })

  it('round-trips a body through blocks unchanged', () => {
    const body = `one\ntwo\n${markerLine('a1')}\nthree`
    expect(joinBlocks(splitBody(body, [photo('a1')]))).toBe(body)
  })

  it('keeps a marker whose file this device has not fetched', () => {
    const blocks = splitBody(markerLine('a1'), [])
    expect(blocks[1]).toEqual({ kind: 'media', id: 'a1', attachment: undefined })
    // The writing must survive a device that is only part-way synced.
    expect(joinBlocks(blocks)).toBe(markerLine('a1'))
  })

  it('only treats a whole line as a marker', () => {
    const body = `look ${ATTACHMENT_MARKER}a1 here`
    expect(referencedAttachmentIds(body)).toEqual([])
    expect(splitBody(body, [photo('a1')])).toEqual([text(body)])
  })

  it('splits the run at the caret so nothing typed is eaten', () => {
    const blocks = splitBody('hello world', [])
    const next = insertMedia(blocks, 0, 5, photo('a1'))
    expect(next.map((b) => (b.kind === 'text' ? b.text : b.id))).toEqual(['hello', 'a1', ' world'])
    expect(joinBlocks(next)).toBe(`hello\n${markerLine('a1')}\n world`)
  })

  it('clamps a caret past the end of the run', () => {
    expect(joinBlocks(insertMedia(splitBody('hi', []), 0, 99, photo('a1')))).toBe(`hi\n${markerLine('a1')}`)
  })

  it('rejoins the text either side when a photo is removed', () => {
    const body = `before\n${markerLine('a1')}\nafter`
    expect(joinBlocks(removeMedia(splitBody(body, [photo('a1')]), 'a1'))).toBe('before\nafter')
  })

  it('drops attachments the writing no longer mentions', () => {
    const kept = pruneAttachments(markerLine('a1'), [photo('a1'), photo('gone')])
    expect(kept.map((a) => a.id)).toEqual(['a1'])
  })

  it('returns attachments in the order they appear, not the order given', () => {
    const body = `${markerLine('b')}\n${markerLine('a')}`
    expect(pruneAttachments(body, [photo('a'), photo('b')]).map((a) => a.id)).toEqual(['b', 'a'])
  })
})
