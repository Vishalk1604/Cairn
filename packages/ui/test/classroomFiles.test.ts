import type { ClassroomFile, DriveFileInfo } from '@cairn/sync'
import { describe, expect, it } from 'vitest'
import { classroomDownload, classroomFilePath, newClassroomFiles, readClassroomFilesState, recentCoursesFirst, safeFileName } from '../src'

const posted = (fileId: string, postedAt: number, course = 'c1'): ClassroomFile => ({
  course: { id: course, name: 'CS301 DBMS' },
  post: { id: `p-${fileId}`, kind: 'material', title: 'Unit 3', postedAt },
  file: { id: fileId, title: `${fileId}.pdf` },
})

const info = (extra: Partial<DriveFileInfo>): DriveFileInfo => ({ id: 'f', name: 'Unit 3 notes.pdf', mimeType: 'application/pdf', size: 1000, canDownload: true, ...extra })

describe('newClassroomFiles', () => {
  it('takes files from the chosen courses only, once each, and none already handled', () => {
    const found = [posted('a', 100), posted('b', 50), posted('a', 120), posted('c', 200), posted('d', 300, 'c2')]
    const fresh = newClassroomFiles(found, { courses: ['c1'], files: { c: { path: 'x/c.pdf', at: 1 } } })
    expect(fresh.map((f) => f.file.id)).toEqual(['a', 'b'])
    expect(newClassroomFiles(found, { courses: [], files: {} })).toEqual([])
    expect(newClassroomFiles(found, { courses: ['c1', 'c2'], files: {} }).map((f) => f.file.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('recentCoursesFirst', () => {
  it('puts the newest classes on top, then by name', () => {
    const courses = [
      { id: 'old', name: 'Maths I', creationTime: '2025-07-01T00:00:00Z' },
      { id: 'new', name: 'DBMS', creationTime: '2026-07-15T00:00:00Z' },
      { id: 'new2', name: 'Compilers', creationTime: '2026-07-15T00:00:00Z' },
      { id: 'none', name: 'Club' },
    ]
    expect(recentCoursesFirst(courses).map((c) => c.id)).toEqual(['new2', 'new', 'old', 'none'])
  })
})

describe('classroomDownload', () => {
  it('downloads ordinary files as they are, adding a lost extension', () => {
    expect(classroomDownload(info({}))).toEqual({ name: 'Unit 3 notes.pdf' })
    expect(classroomDownload(info({ name: 'Lecture 4', mimeType: 'image/png' }))).toEqual({ name: 'Lecture 4.png' })
  })

  it('exports Google Docs and Slides as PDF, and Sheets as Excel', () => {
    expect(classroomDownload(info({ name: 'Lab manual', mimeType: 'application/vnd.google-apps.document', size: undefined }))).toEqual({
      name: 'Lab manual.pdf',
      exportAs: 'application/pdf',
    })
    expect(classroomDownload(info({ name: 'Marks', mimeType: 'application/vnd.google-apps.spreadsheet', size: undefined }))).toMatchObject({ name: 'Marks.xlsx' })
  })

  it('leaves out what cannot or should not be downloaded', () => {
    expect(classroomDownload(info({ canDownload: false }))).toHaveProperty('skip')
    expect(classroomDownload(info({ mimeType: 'application/vnd.google-apps.form' }))).toHaveProperty('skip')
    expect(classroomDownload(info({ size: 500 * 1024 * 1024 }))).toEqual({ skip: 'Larger than 100 MB' })
  })
})

describe('safeFileName', () => {
  it('makes names Windows accepts', () => {
    expect(safeFileName('Unit 1: Intro / Basics?.pdf')).toBe('Unit 1 Intro Basics.pdf')
    expect(safeFileName('CON')).toBe('_CON')
    expect(safeFileName('nul.txt')).toBe('_nul.txt')
    expect(safeFileName('notes. . ')).toBe('notes')
    expect(safeFileName('   ')).toBe('Untitled')
  })

  it('shortens a long name but keeps its extension', () => {
    const long = `${'a'.repeat(200)}.pdf`
    const short = safeFileName(long)
    expect(short.length).toBe(120)
    expect(short.endsWith('.pdf')).toBe(true)
  })

  it('files each course in its own folder', () => {
    expect(classroomFilePath('CS301: DBMS', 'Lab 5.pdf')).toBe('CS301 DBMS/Lab 5.pdf')
  })
})

describe('readClassroomFilesState', () => {
  it('starts empty and survives damage', () => {
    expect(readClassroomFilesState(null)).toEqual({ folder: '', courses: [], files: {} })
    expect(readClassroomFilesState('{oops')).toEqual({ folder: '', courses: [], files: {} })
    expect(readClassroomFilesState('{"folder":"D:\\\\Class","courses":["c1",3]}')).toEqual({ folder: 'D:\\Class', courses: ['c1'], files: {} })
  })
})
