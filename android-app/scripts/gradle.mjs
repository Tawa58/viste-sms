// Runs a Gradle task in android/ and copies the finished APK/AAB to android-app/release/.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const androidDir = path.join(root, 'android')
const task = process.argv[2] ?? 'assembleRelease'
const [command, args] =
  process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/c', 'gradlew.bat', task, '--no-daemon']]
    : ['sh', ['gradlew', task, '--no-daemon']]

const result = spawnSync(command, args, { cwd: androidDir, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

const outputs = [
  path.join(androidDir, 'app/build/outputs/apk/release'),
  path.join(androidDir, 'app/build/outputs/apk/debug'),
  path.join(androidDir, 'app/build/outputs/bundle/release'),
]
const releaseDir = path.join(root, 'release')
mkdirSync(releaseDir, { recursive: true })
for (const dir of outputs) {
  if (!existsSync(dir)) continue
  for (const file of readdirSync(dir)) {
    if (!/\.(apk|aab)$/.test(file)) continue
    copyFileSync(path.join(dir, file), path.join(releaseDir, file))
    console.log(`→ release/${file}`)
  }
}
