import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeoPoint, GeofenceSite } from '@/lib/geofence'
import { cn } from '@/lib/utils'

const TILE_SIZE = 256

function project(latitude: number, longitude: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom
  const sinLat = Math.sin((latitude * Math.PI) / 180)
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  }
}

function metersPerPixel(latitude: number, zoom: number) {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom
}

/** Closest zoom that still shows the whole boundary (and the user, when nearby). */
function pickZoom(site: GeofenceSite, span: number, size: { width: number; height: number }) {
  const shortest = Math.min(size.width, size.height)
  for (let zoom = 18; zoom >= 3; zoom -= 1) {
    if ((span / metersPerPixel(site.latitude, zoom)) * 2.4 < shortest) return zoom
  }
  return 3
}

function wrapTile(value: number, zoom: number) {
  const count = 2 ** zoom
  return ((value % count) + count) % count
}

function distanceMeters(a: GeoPoint, b: GeoPoint) {
  const dy = (b.latitude - a.latitude) * 111_320
  const dx = (b.longitude - a.longitude) * 111_320 * Math.cos((a.latitude * Math.PI) / 180)
  return Math.hypot(dx, dy)
}

/** Street map of the school with its boundary circle and a live "You" marker. */
export function VicinityMap({
  site,
  location,
  outside,
  muted,
  className,
}: {
  site: GeofenceSite
  location: GeoPoint | null
  outside: boolean
  muted?: boolean
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 360, height: 288 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return undefined
    const update = () =>
      setSize({
        width: Math.max(1, element.clientWidth),
        height: Math.max(1, element.clientHeight),
      })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => {
    const userDistance = location ? distanceMeters(site, location) : 0
    // Keep the user in view only while they are reasonably close; far away, the school stays centred.
    const span = Math.max(site.radiusMeters, userDistance < 3000 ? userDistance : 0, 30)
    const zoom = pickZoom(site, span, size)
    const centre = project(site.latitude, site.longitude, zoom)
    const left = centre.x - size.width / 2
    const top = centre.y - size.height / 2
    const tiles: { key: string; primary: string; fallback: string; left: number; top: number }[] = []
    for (let x = Math.floor(left / TILE_SIZE); x <= Math.floor((left + size.width) / TILE_SIZE); x += 1) {
      for (let y = Math.floor(top / TILE_SIZE); y <= Math.floor((top + size.height) / TILE_SIZE); y += 1) {
        const tileX = wrapTile(x, zoom)
        tiles.push({
          key: `${zoom}-${tileX}-${y}`,
          primary: `https://tile.openstreetmap.org/${zoom}/${tileX}/${y}.png`,
          fallback: `https://a.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tileX}/${y}.png`,
          left: x * TILE_SIZE - left,
          top: y * TILE_SIZE - top,
        })
      }
    }
    const user = location
      ? (() => {
          const p = project(location.latitude, location.longitude, zoom)
          return { x: p.x - left, y: p.y - top }
        })()
      : null
    return { tiles, radiusPx: site.radiusMeters / metersPerPixel(site.latitude, zoom), user }
  }, [location, site, size])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative isolate h-64 w-full overflow-hidden rounded-xl border border-border bg-muted sm:h-72',
        className,
      )}
    >
      {layout.tiles.map((tile) => (
        <img
          key={tile.key}
          alt=""
          src={tile.primary}
          draggable={false}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
          onError={(event) => {
            const img = event.currentTarget
            if (img.dataset.fallback === '1') return
            img.dataset.fallback = '1'
            img.src = tile.fallback
          }}
        />
      ))}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${size.width} ${size.height}`}
        aria-hidden
      >
        <circle
          cx={size.width / 2}
          cy={size.height / 2}
          r={Math.max(8, layout.radiusPx)}
          className={cn('stroke-success', muted ? 'fill-success/10' : 'fill-success/20')}
          strokeWidth="3"
          strokeDasharray="10 8"
        />
        {layout.user ? (
          <g>
            <circle
              cx={layout.user.x}
              cy={layout.user.y}
              r="16"
              opacity="0.2"
              className={muted ? 'fill-muted-foreground' : outside ? 'fill-destructive' : 'fill-success'}
            />
            <circle
              cx={layout.user.x}
              cy={layout.user.y}
              r="8"
              stroke="#fff"
              strokeWidth="3"
              className={muted ? 'fill-muted-foreground' : outside ? 'fill-destructive' : 'fill-success'}
            />
            <text
              x={layout.user.x + 14}
              y={layout.user.y + 4}
              fontSize="11"
              fontWeight="800"
              fill="#0f172a"
              stroke="#fff"
              strokeWidth="3"
              paintOrder="stroke"
            >
              YOU
            </text>
          </g>
        ) : null}
      </svg>
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-full bg-card/95 px-2.5 py-1 text-[11px] font-semibold shadow-sm ring-1 ring-border">
        <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed border-success" />
        {site.name} ({site.radiusMeters} m)
      </div>
      <p className="pointer-events-none absolute bottom-0 right-0 z-10 rounded-tl bg-card/80 px-1.5 py-0.5 text-[9px] text-muted-foreground">
        © OpenStreetMap contributors
      </p>
    </div>
  )
}
