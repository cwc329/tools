import { parseMetadata } from '@uswriting/exiftool'

// --- Register Service Worker for WASM caching ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
}

// --- Pre-fetch WASM binary (download only, don't initialize Perl yet) ---
const wasmFetchUrl = `${import.meta.env.BASE_URL}zeroperl.wasm`
const wasmPreFetch = fetch(wasmFetchUrl).catch(() => {})

// --- DOM Elements ---
const input = document.getElementById('photo')
const output = document.getElementById('output')
const loadingEl = document.getElementById('loading')
const warningsEl = document.getElementById('warnings')
const debugEl = document.getElementById('debug')
const copyBtn = document.getElementById('copy-btn')

// --- Constants ---
const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const fieldLabels = {
  make: '品牌',
  camera: '相機',
  lens: '鏡頭',
  focalLength: '焦距',
  focalLength35: '等效焦距',
  aperture: '光圈',
  shutter: '快門',
  iso: 'ISO',
  exposureProgram: '拍攝模式',
  meteringMode: '測光模式',
  whiteBalance: '白平衡',
  flash: '閃光燈',
  date: '拍攝月份',
}

// --- Helpers ---

function clean(text) {
  // Instagram hashtag 只允許字母、數字和底線，移除其餘字元
  return String(text).replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '')
}

function getSelectedFields() {
  return new Set(
    [...document.querySelectorAll('#fields input:checked')].map((cb) => cb.value),
  )
}

/**
 * Safely parse JSON from ExifTool output.
 * ExifTool may append warnings after the JSON array, so we extract
 * only the JSON portion (from first '[' to its matching ']').
 */
function safeParseJson(data) {
  const start = data.indexOf('[')
  if (start === -1) throw new Error('No JSON array found in ExifTool output')
  let depth = 0
  for (let i = start; i < data.length; i++) {
    if (data[i] === '[') depth++
    else if (data[i] === ']') depth--
    if (depth === 0) return JSON.parse(data.substring(start, i + 1))
  }
  throw new Error('Unterminated JSON array in ExifTool output')
}

/**
 * Parse a numeric value from ExifTool's human-readable string output.
 * e.g. "50.0 mm" -> 50, "f/1.4" -> 1.4
 */
function parseNum(val) {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const m = val.match(/[\d.]+/)
    return m ? parseFloat(m[0]) : NaN
  }
  return NaN
}

/**
 * Build a field map from ExifTool JSON output (without -n flag).
 * Values are human-readable strings where applicable.
 */
function buildFieldMap(exif) {
  const make = exif.Make || ''
  const camera = exif.Model || ''

  // ExifTool decrypts Nikon MakerNote and resolves LensID to human-readable name
  const lens = exif.LensID || exif.LensModel || exif.Lens || ''

  const fl = parseNum(exif.FocalLength)
  const focalLength = !isNaN(fl) ? `${Math.round(fl)}mm` : ''

  const fl35 = parseNum(exif.FocalLengthIn35mmFormat)
  const focalLength35 = !isNaN(fl35) ? `${Math.round(fl35)}mm` : ''

  const fn = parseNum(exif.FNumber)
  const aperture = !isNaN(fn) ? `f${String(fn).replace('.', '_')}` : ''

  let shutter = ''
  if (exif.ExposureTime) {
    const etStr = String(exif.ExposureTime)
    const fracMatch = etStr.match(/^(\d+)\/(\d+)$/)
    if (fracMatch) {
      // Fraction string like "1/125"
      shutter = `${fracMatch[1]}_${fracMatch[2]}s`
    } else {
      const et = parseNum(exif.ExposureTime)
      if (!isNaN(et)) {
        shutter = et >= 1 ? `${et}s` : `1_${Math.round(1 / et)}s`
      }
    }
  }

  const isoVal = exif.ISO
  const iso = isoVal ? `ISO${isoVal}` : ''

  // Without -n, ExposureProgram is a string like "Manual", "Aperture-priority AE"
  const exposureProgram = exif.ExposureProgram ? clean(exif.ExposureProgram) : ''

  // Without -n, MeteringMode is a string like "Center-weighted average"
  const meteringMode = exif.MeteringMode ? clean(exif.MeteringMode) : ''

  // Without -n, WhiteBalance is a string like "Auto" or "Manual"
  let whiteBalance = ''
  if (exif.WhiteBalance) {
    const wb = String(exif.WhiteBalance).toLowerCase()
    if (wb.includes('auto')) whiteBalance = 'AutoWB'
    else if (wb.includes('manual')) whiteBalance = 'ManualWB'
    else whiteBalance = clean(exif.WhiteBalance)
  }

  // Without -n, Flash is a string like "No Flash" or "Fired"
  let flash = ''
  if (exif.Flash) {
    const f = String(exif.Flash).toLowerCase()
    if (f.includes('no flash') || f.includes('did not fire') || f.includes('off')) {
      flash = 'NaturalLight'
    } else {
      flash = 'FlashPhotography'
    }
  }

  let date = ''
  if (exif.DateTimeOriginal) {
    // ExifTool returns date as "2026:02:12 11:00:06"
    const dateStr = String(exif.DateTimeOriginal).replace(
      /^(\d{4}):(\d{2}):(\d{2})/,
      '$1-$2-$3',
    )
    const d = new Date(dateStr)
    if (!isNaN(d.getTime())) {
      date = `${monthNames[d.getMonth()]}${d.getFullYear()}`
    }
  }

  return {
    make,
    camera,
    lens,
    focalLength,
    focalLength35,
    aperture,
    shutter,
    iso,
    exposureProgram,
    meteringMode,
    whiteBalance,
    flash,
    date,
  }
}

// --- State: cache the last parsed field map ---
let lastFieldMap = null

/**
 * Update hashtag output and warnings based on current checkbox selection.
 * Uses the cached fieldMap so no re-parsing is needed.
 */
function updateOutput() {
  if (!lastFieldMap) return

  const selected = getSelectedFields()

  const missing = Object.entries(lastFieldMap)
    .filter(([key, val]) => selected.has(key) && !val)
    .map(([key]) => fieldLabels[key] || key)
  warningsEl.innerHTML = missing.length
    ? `<p class="warn">⚠ 以下欄位在照片中找不到：${missing.join('、')}</p>`
    : ''

  const hashtags = Object.entries(lastFieldMap)
    .filter(([key, val]) => selected.has(key) && val)
    .map(([, val]) => `#${clean(val)}`)
    .join('\n')

  output.value = hashtags
}

// --- Main Logic ---

input.addEventListener('change', async () => {
  const file = input.files[0]
  if (!file) return

  loadingEl.style.display = 'block'
  output.value = ''
  warningsEl.innerHTML = ''
  debugEl.textContent = ''

  try {
    // Single call without -n: get human-readable values including LensID
    const result = await parseMetadata(file, {
      fetch: () => fetch(wasmFetchUrl),
      args: ['-json'],
      transform: safeParseJson,
    })

    if (!result.success) {
      output.value = `Error: ${result.error}`
      return
    }

    const exif = result.data[0]

    // Debug output
    debugEl.textContent = JSON.stringify(exif, null, 2)

    // Cache the field map and update output
    lastFieldMap = buildFieldMap(exif)
    updateOutput()
  } catch (err) {
    output.value = `Error: ${err.message}`
    console.error(err)
  } finally {
    loadingEl.style.display = 'none'
  }
})

// Checkbox changes instantly update hashtags without re-parsing
document.getElementById('fields').addEventListener('change', updateOutput)

const copyToast = document.getElementById('copy-toast')
let toastTimer = null

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(output.value).then(() => {
    copyToast.style.opacity = '1'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { copyToast.style.opacity = '0' }, 1500)
  })
})
