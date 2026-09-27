// Builds every Android launcher icon and splash image from the school logo.
// The logo is scaled by its farthest visible pixel from the centre so the whole crest
// stays inside the adaptive-icon safe circle — nothing is cropped by round, squircle or
// splash-screen masks.
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const logoPath = path.resolve(root, '../public/viste-logo.png')
const res = path.join(root, 'android/app/src/main/res')
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

/** Trim the logo to its artwork and measure the farthest visible pixel from the centre. */
async function loadLogo() {
  const trimmed = await sharp(logoPath)
    .ensureAlpha()
    .trim({ background: '#ffffff', threshold: 12 })
    .png()
    .toBuffer()
  const { data, info } = await sharp(trimmed).raw().toBuffer({ resolveWithObject: true })
  const cx = info.width / 2
  const cy = info.height / 2
  let maxR = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
      if (a < 24 || (r > 240 && g > 240 && b > 240)) continue
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d > maxR) maxR = d
    }
  }
  return { buffer: trimmed, width: info.width, height: info.height, radius: maxR }
}

/** Logo centred on a square canvas so its farthest pixel sits within `radiusFraction` of the canvas size. */
async function logoOnCanvas(logo, size, radiusFraction, background) {
  const scale = (size * radiusFraction) / logo.radius
  const w = Math.max(1, Math.round(logo.width * scale))
  const h = Math.max(1, Math.round(logo.height * scale))
  const resized = await sharp(logo.buffer).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: resized, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) }])
    .png()
}

async function write(img, file) {
  await mkdir(path.dirname(file), { recursive: true })
  await img.toFile(file)
}

async function main() {
  const logo = await loadLogo()
  console.log(`Logo artwork ${logo.width}x${logo.height}, farthest pixel ${logo.radius.toFixed(1)}px from centre`)

  for (const [name, d] of Object.entries(DENSITIES)) {
    const dir = path.join(res, `mipmap-${name}`)
    // Adaptive foreground: 108dp canvas, safe circle is 66dp across (radius 33dp).
    const fg = Math.round(108 * d)
    await write(await logoOnCanvas(logo, fg, 32.5 / 108, TRANSPARENT), path.join(dir, 'ic_launcher_foreground.png'))

    // Legacy icons (Android 7 and older launchers).
    const legacy = Math.round(48 * d)
    const square = await logoOnCanvas(logo, legacy, 0.46, WHITE)
    const radius = Math.round(legacy * 0.18)
    const mask = Buffer.from(
      `<svg width="${legacy}" height="${legacy}"><rect width="${legacy}" height="${legacy}" rx="${radius}" ry="${radius}"/></svg>`,
    )
    await write(
      sharp(await square.toBuffer()).composite([{ input: mask, blend: 'dest-in' }]).png(),
      path.join(dir, 'ic_launcher.png'),
    )
    const circle = Buffer.from(
      `<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`,
    )
    const round = await logoOnCanvas(logo, legacy, 0.46, WHITE)
    await write(
      sharp(await round.toBuffer()).composite([{ input: circle, blend: 'dest-in' }]).png(),
      path.join(dir, 'ic_launcher_round.png'),
    )
  }

  // Splash images for Android 11 and older: logo centred on white at every existing size.
  const dirs = (await readdir(res)).filter((d) => d === 'drawable' || d.startsWith('drawable-land') || d.startsWith('drawable-port'))
  for (const dir of dirs) {
    const file = path.join(res, dir, 'splash.png')
    let meta
    try {
      meta = await sharp(file).metadata()
    } catch {
      continue
    }
    const side = Math.round(Math.min(meta.width, meta.height) * 0.42)
    const mark = await (await logoOnCanvas(logo, side, 0.5, WHITE)).toBuffer()
    await write(
      sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: WHITE } })
        .composite([{ input: mark, left: Math.round((meta.width - side) / 2), top: Math.round((meta.height - side) / 2) }])
        .png(),
      file,
    )
  }

  // Store listing icon (Google Play: 512x512, full square, no transparency).
  await write(await logoOnCanvas(logo, 512, 0.44, WHITE), path.join(root, 'store/play-store-icon-512.png'))
  await write(await logoOnCanvas(logo, 512, 0.5, WHITE), path.join(root, 'www/icon.png'))
  console.log('Icons and splash images written.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
