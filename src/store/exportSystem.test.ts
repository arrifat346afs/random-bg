/**
 * Tests for the background export system: remembered settings, the job queue,
 * and the one-click entry point.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import './testSetup'
import { clearStorage, readStorage, seedStorage } from './testSetup'
import { loadExportPrefs, useUiStore } from './uiStore'
import { useExportJobsStore, type ExportJob } from './exportJobsStore'
import { useRenderStore } from './renderStore'
import { KEYS } from './persistence'
import { quickExport } from '../lib/export-run'
import { svgScaleFor } from '../lib/export'
import { createProject } from '../lib/project'

const ui = () => useUiStore.getState()
const jobs = () => useExportJobsStore.getState()

function makeJob(over: Partial<ExportJob> = {}): ExportJob {
  return {
    id: `job-${Math.random().toString(36).slice(2)}`,
    format: 'png',
    filename: 'export.png',
    progress: 0,
    status: 'rendering',
    message: '',
    bytes: 0,
    blob: null,
    url: null,
    blocked: false,
    ...over,
  }
}

beforeEach(() => {
  clearStorage()
  useUiStore.setState({
    exportFormat: 'png',
    exportScale: 2,
    exportQuality: 0.92,
    exportIncludeBg: false,
    exportFlatten: false,
    exportAdobeCompat: true,
    exportIncludeBlur: true,
    exportSeconds: 4,
    exportBusy: false,
    exportProgress: 0,
    exportStatus: null,
    exportFallback: null,
  })
  useRenderStore.setState({ results: null })
  useExportJobsStore.setState({ jobs: [] })
})

/* ---- remembered settings ------------------------------------------------- */

describe('export prefs persistence', () => {
  test('patchExport writes the settings half to storage', () => {
    ui().patchExport({ exportFormat: 'svg', exportScale: 4, exportIncludeBg: true })
    const saved = JSON.parse(readStorage(KEYS.export) as string)
    expect(saved.exportFormat).toBe('svg')
    expect(saved.exportScale).toBe(4)
    expect(saved.exportIncludeBg).toBe(true)
    // defaults ride along so a fresh load restores the full set
    expect(saved.exportQuality).toBe(0.92)
  })

  test('transient fields are never written', () => {
    ui().patchExport({ exportBusy: true, exportProgress: 60 })
    const raw = readStorage(KEYS.export)
    expect(raw).toBeNull()
    ui().patchExport({ exportFormat: 'jpg' })
    const saved = JSON.parse(readStorage(KEYS.export) as string)
    expect('exportBusy' in saved).toBe(false)
    expect('exportProgress' in saved).toBe(false)
    expect('exportStatus' in saved).toBe(false)
  })

  test('loadExportPrefs rejects corrupt values field by field', () => {
    seedStorage(KEYS.export, {
      exportFormat: 'bogus',
      exportScale: 'wide',
      exportQuality: 99,
      exportIncludeBg: 'yes',
      exportIncludeBlur: false,
      exportSeconds: 99,
    })
    const prefs = loadExportPrefs()
    expect(prefs.exportFormat).toBeUndefined()
    expect(prefs.exportScale).toBeUndefined()
    expect(prefs.exportIncludeBg).toBeUndefined()
    // valid values survive alongside the corrupt ones, clamped into range
    expect(prefs.exportQuality).toBe(1)
    expect(prefs.exportIncludeBlur).toBe(false)
    expect(prefs.exportSeconds).toBe(12)
  })

  test('an empty store loads nothing', () => {
    expect(loadExportPrefs()).toEqual({})
  })
})

/* ---- job queue ----------------------------------------------------------- */

describe('exportJobsStore', () => {
  test('add and update', () => {
    const job = makeJob({ id: 'a' })
    jobs().addJob(job)
    jobs().updateJob('a', { progress: 42 })
    const cur = jobs().jobs.find((j) => j.id === 'a')
    expect(cur?.progress).toBe(42)
    expect(cur?.status).toBe('rendering')
  })

  test('the list is capped so a render spree cannot grow it forever', () => {
    for (let i = 0; i < 8; i++) jobs().addJob(makeJob({ id: `j${i}` }))
    expect(jobs().jobs).toHaveLength(5)
    expect(jobs().jobs[4]?.id).toBe('j7')
  })

  test('remove drops the job', () => {
    jobs().addJob(makeJob({ id: 'a' }))
    jobs().addJob(makeJob({ id: 'b' }))
    jobs().removeJob('a')
    expect(jobs().jobs.map((j) => j.id)).toEqual(['b'])
  })
})

/* ---- one-click entry ----------------------------------------------------- */

describe('quickExport', () => {
  test('null with nothing rendered, and no job filed', () => {
    expect(quickExport()).toBeNull()
    expect(jobs().jobs).toHaveLength(0)
  })
})

/* ---- worker-shared pure helpers ------------------------------------------ */

describe('svgScaleFor', () => {
  test('no bump below the Stock artboard floor', () => {
    const project = createProject()
    const { svgScale, stockWarnings } = svgScaleFor(project, {
      format: 'svg',
      scale: 1,
      quality: 0.92,
      includeBackground: false,
      adobeCompat: false,
    })
    expect(svgScale).toBe(1)
    expect(stockWarnings).toHaveLength(0)
  })

  test('Stock mode raises small canvases to 15.5 MP', () => {
    const project = createProject()
    const { svgScale, stockWarnings } = svgScaleFor(project, {
      format: 'svg',
      scale: 1,
      quality: 0.92,
      includeBackground: false,
      adobeCompat: true,
    })
    const mp = project.canvas.w * svgScale * (project.canvas.h * svgScale)
    // exact equality is hostage to sqrt rounding; within a pixel is the rule
    expect(mp).toBeGreaterThanOrEqual(15_500_000 - 1)
    expect(stockWarnings.length).toBeGreaterThan(0)
  })
})
