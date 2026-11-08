// @ts-nocheck — Three.js scene port for Kyaani_AI_Infra_Doc virtual-office.
/**
 * A floor built from a company plan.
 *
 * Round robots in walled rooms; waiting patrols the floor; working/problem at the pad.
 * Head tags are compact (name + status); doing text lives in the roster panel.
 */
import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { departmentDashboard, departmentDisplayName } from './floor-dashboard'
import {
  columnCount,
  layoutOfficeRadial,
  STATUS_VIEW,
  type FloorLayout,
  KNOWLEDGE_DEPARTMENT_ID,
} from './floor-plan'
import type { CompanyAgent, CompanyOffice, WorkStatus } from '../types'

const PLATFORM_TOP_Y = 0.58
const DESK_UNIT_SCALE = 1.48
/** Body + head only — desk/chair stay smaller so workers read clearly (not “floating bubbles”). */
const WORKER_BODY_SCALE = 1.78
const BRAIN_SCALE = 1.42
const BRAIN_HUB_LIFT = 0.72
/** Hero brain cut from CEO-GPT reference frame (public/textures/brain-hero.png). */
/** Anatomical brain PNG (CEO-GPT reference) — single sprite, no 3D lamp/halos. */
const BRAIN_HERO_URL = '/textures/brain-hero.png?v=anatomy7'
const DEFAULT_OFFICE_ORIGIN = 'http://127.0.0.1:3001'
/** Warm browser cache so rebuilds do not flash scatter-only while PNG loads. */
let brainHeroPreloaded = false
function preloadBrainHeroImage() {
  if (brainHeroPreloaded || typeof Image === 'undefined') return
  brainHeroPreloaded = true
  const img = new Image()
  img.decoding = 'async'
  img.src = brainAssetUrl(BRAIN_HERO_URL)
}

function officeAssetOrigin(): string {
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="kyaani-office-origin"]')?.getAttribute('content')?.trim()
    if (meta?.startsWith('http')) return meta.replace(/\/+$/, '')
  }
  if (typeof window !== 'undefined') {
    const o = window.location.origin
    if (o && o !== 'null' && o.startsWith('http')) return o.replace(/\/+$/, '')
  }
  return DEFAULT_OFFICE_ORIGIN
}

function brainAssetUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${officeAssetOrigin()}${p}`
}

type LightStream = {
  curve: THREE.QuadraticBezierCurve3
  particles: THREE.Mesh[]
  speeds: number[]
  phase: number
  agentId?: string
}

type BrainScatter = {
  mesh: THREE.Mesh
  dir: THREE.Vector3
  speed: number
  phase: number
}

function accentToHex(accent: string): number {
  const s = accent.replace('#', '')
  return Number.parseInt(s.length === 6 ? s : '888888', 16)
}

function shadeRgb(hex: number, factor: number): number {
  const r = Math.min(255, Math.floor(((hex >> 16) & 255) * factor))
  const g = Math.min(255, Math.floor(((hex >> 8) & 255) * factor))
  const b = Math.min(255, Math.floor((hex & 255) * factor))
  return (r << 16) | (g << 8) | b
}

type SeatRow = {
  agentId: string
  status: WorkStatus
  phase: number
  screenMat: THREE.MeshStandardMaterial
  ringMat: THREE.MeshBasicMaterial
  shirtMats: THREE.MeshStandardMaterial[]
}

type WorkerAnim = {
  agentId: string
  body: THREE.Group
  head: THREE.Mesh
  forearmL: THREE.Mesh
  forearmR: THREE.Mesh
  status: WorkStatus
  phase: number
}

type DeptCardTrack = {
  el: HTMLElement
  agentIds: string[]
}

const STATUS_ORDER: WorkStatus[] = ['working', 'waiting', 'problem', 'idle', 'offline']

function screenEmissiveIntensity(status: WorkStatus): number {
  switch (status) {
    case 'working':
      return 0.44
    case 'waiting':
      return 0.3
    case 'problem':
      return 0.5
    case 'idle':
      return 0.08
    default:
      return 0.05
  }
}

function shirtEmissiveIntensity(status: WorkStatus): number {
  switch (status) {
    case 'working':
      return 0.38
    case 'waiting':
      return 0.28
    case 'problem':
      return 0.45
    case 'idle':
    case 'offline':
      return 0.08
    default:
      return 0.08
  }
}

function applyAgentStatusVisual(
  status: WorkStatus,
  screenMat: THREE.MeshStandardMaterial,
  ringMat: THREE.MeshBasicMaterial,
  shirtMats: THREE.MeshStandardMaterial[],
) {
  const hex = STATUS_VIEW[status].hex
  screenMat.emissive.setHex(hex)
  screenMat.emissiveIntensity = screenEmissiveIntensity(status)
  ringMat.color.setHex(hex)
  for (const shirt of shirtMats) {
    shirt.color.setHex(hex)
    shirt.emissive.setHex(hex)
    shirt.emissiveIntensity = shirtEmissiveIntensity(status)
  }
}

function deptStatusBarHtml(agentIds: string[], plan: CompanyOffice): string {
  const counts: Record<WorkStatus, number> = {
    working: 0,
    waiting: 0,
    problem: 0,
    idle: 0,
    offline: 0,
  }
  const byId = new Map<string, WorkStatus>()
  for (const department of plan.departments) {
    for (const agent of department.agents) byId.set(agent.id, agent.status)
  }
  for (const id of agentIds) {
    const s = byId.get(id)
    if (s) counts[s] += 1
  }
  const segments = STATUS_ORDER.filter((s) => counts[s] > 0)
    .map(
      (s) =>
        `<i data-status="${s}" style="flex:${counts[s]} 1 0" title="${STATUS_VIEW[s].label} ${counts[s]}"></i>`,
    )
    .join('')
  if (!segments) {
    return `<div class="co-dept-plate-status" aria-hidden><i data-status="idle" style="flex:1 1 0"></i></div>`
  }
  return `<div class="co-dept-plate-status" aria-hidden>${segments}</div>`
}

export function planStructureKey(plan: CompanyOffice): string {
  return plan.departments
    .map((d) => `${d.id}:${d.agents.map((a) => a.id).join(',')}`)
    .join('|')
}

export function planLiveKey(plan: CompanyOffice): string {
  return plan.departments
    .map((d) =>
      `${d.id}:${d.agents.map((a) => `${a.id}:${a.status}:${a.doing ?? ''}`).join(',')}`,
    )
    .join('|')
}

export type CompanyFloor = {
  setPlan: (plan: CompanyOffice | null, refit: boolean) => void
  setSelectedDepartment: (departmentId: string | null) => void
  resize: (width: number, height: number) => void
  dispose: () => void
}

type FloorHooks = {
  onSelectAgent: (agentId: string) => void
  onSelectDepartment: (departmentId: string | null) => void
  /** 3D brain click → Knowledge hub in UI (department filter, no auto agent). */
  onSelectBrain: () => void
}

export function createCompanyFloor(
  canvas: HTMLCanvasElement,
  labelHost: HTMLElement,
  hooks: FloorHooks,
): CompanyFloor {
  preloadBrainHeroImage()
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x4a4a52, 1)
  renderer.toneMappingExposure = 1.08
  renderer.shadowMap.enabled = true

  const labelRenderer = new CSS2DRenderer({ element: labelHost })
  labelRenderer.domElement.style.position = 'absolute'
  labelRenderer.domElement.style.inset = '0'
  labelRenderer.domElement.style.pointerEvents = 'none'

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x52525a, 55, 140)
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
  camera.position.set(8, 14, 16)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  /** Video-style: orbit, pan, zoom on the 3D office floor. */
  controls.enableRotate = true
  controls.enablePan = true
  controls.enableZoom = true
  controls.maxPolarAngle = Math.PI / 2.35
  controls.minPolarAngle = Math.PI / 5
  controls.minDistance = 4
  controls.maxDistance = 90
  controls.target.set(0, 0.85, 0)

  scene.add(new THREE.AmbientLight(0xd8e8f4, 0.85))
  scene.add(new THREE.HemisphereLight(0xa8c8e8, 0x1a2430, 0.55))
  const sun = new THREE.DirectionalLight(0xffffff, 1.35)
  sun.position.set(12, 22, 10)
  sun.castShadow = true
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0x88b8d8, 0.45)
  fill.position.set(-8, 14, -6)
  scene.add(fill)

  const world = new THREE.Group()
  scene.add(world)
  const seats: SeatRow[] = []
  const pickableAgents: THREE.Object3D[] = []
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  // Barbell and dumbbell buffers are shared by every avatar. Disposing them on a
  // rebuild would blank the next body that picks them up.
  const keepGeo = new Set<THREE.BufferGeometry>()
  const keepMat = new Set<THREE.Material>()

  let raf = 0
  let running = true
  let userMoved = false
  let lastLayout: FloorLayout | null = null
  let lastPlan: CompanyOffice | null = null
  let lastCols = 0
  let selectedDepartmentId: string | null = null
  const deptCardEls = new Map<string, HTMLElement>()
  const deptCardTrack = new Map<string, DeptCardTrack>()
  const deptLabelObjs: CSS2DObject[] = []
  const lightStreams: LightStream[] = []
  const brainScatter: BrainScatter[] = []
  const workerAnims: WorkerAnim[] = []
  let pickableBrainRoot: THREE.Object3D | null = null
  let brainSelectRing: THREE.Mesh | null = null
  let brainHeroImgEl: HTMLImageElement | null = null
  let brainHeroReady = false
  const brainEmit = new THREE.Vector3(0, 8, 0)
  /** Live-sync / plan refresh flash (emissive only — no hub scale). */
  let brainSyncKick = 0
  let lastActivityPulse = false
  const clock = new THREE.Clock()
  controls.addEventListener('start', () => {
    userMoved = true
  })

  function clearWorld() {
    seats.length = 0
    pickableAgents.length = 0
    lightStreams.length = 0
    brainScatter.length = 0
    workerAnims.length = 0
    pickableBrainRoot = null
    brainHeroImgEl = null
    brainHeroReady = false
    brainSelectRing = null
    brainSyncKick = 0
    deptCardEls.clear()
    deptCardTrack.clear()
    deptLabelObjs.length = 0
    const leftovers: HTMLElement[] = []
    const goneGeo = new Set<THREE.BufferGeometry>()
    const goneMat = new Set<THREE.Material>()
    world.traverse((obj) => {
      const labelled = obj as THREE.Object3D & { element?: HTMLElement }
      if (labelled.element) leftovers.push(labelled.element)
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      if (!keepGeo.has(mesh.geometry) && !goneGeo.has(mesh.geometry)) {
        mesh.geometry.dispose()
        goneGeo.add(mesh.geometry)
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        if (!material || keepMat.has(material) || goneMat.has(material)) continue
        material.dispose()
        goneMat.add(material)
      }
    })
    for (const el of leftovers) el.remove()
    world.clear()
  }

  function mat(color: number, rough = 0.8): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: rough })
  }

  function box(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
    mesh.position.set(x, y, z)
    parent.add(mesh)
    return mesh
  }

  /** One building shell around the whole floor — not walls per desk. */
  function addOfficePerimeter(layoutW: number, layoutD: number) {
    const pad = 4
    const W = layoutW + pad * 2
    const D = layoutD + pad * 2
    const h = 3.6
    const t = 0.28
    const y = h / 2
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xd8e6f2,
      roughness: 0.55,
      metalness: 0.06,
      emissive: 0x4a6888,
      emissiveIntensity: 0.22,
    })
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ color: 0x1c2834, roughness: 0.85 }),
    )
    slab.rotation.x = -Math.PI / 2
    slab.position.y = 0.005
    world.add(slab)

    const wall = (pw: number, ph: number, pd: number, px: number, pz: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), wallMat)
      mesh.position.set(px, y, pz)
      world.add(mesh)
    }
    wall(W, h, t, 0, -D / 2)
    wall(t, h, D, -W / 2, 0)
    wall(t, h, D, W / 2, 0)
    const door = 3.2
    const side = (W - door) / 2
    wall(side, h, t, -(door + side) / 2, D / 2)
    wall(side, h, t, (door + side) / 2, D / 2)

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W, h, D)),
      new THREE.LineBasicMaterial({ color: 0xa8d4f0 }),
    )
    edge.position.y = y
    world.add(edge)
  }

  /** Video-style colored slab — bright top, darker sides. */
  function addDeptPlatform(x: number, z: number, w: number, d: number, accent: string) {
    const topHex = accentToHex(accent)
    const sideHex = shadeRgb(topHex, 0.52)
    const bw = w - 0.15
    const bd = d - 0.15
    const bh = 0.52
    const group = new THREE.Group()
    group.position.set(x, 0, z)

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(bw, bh, bd),
      new THREE.MeshStandardMaterial({ color: sideHex, roughness: 0.55, metalness: 0.06 }),
    )
    body.position.y = bh / 2
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    const top = new THREE.Mesh(
      new THREE.BoxGeometry(bw - 0.06, 0.08, bd - 0.06),
      new THREE.MeshStandardMaterial({ color: topHex, roughness: 0.32, metalness: 0.04 }),
    )
    top.position.y = bh + 0.04
    group.add(top)

    world.add(group)
    return topHex
  }

  function addDeskPlant(x: number, z: number, platformTopHex: number) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.14, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: 0x8a5038, roughness: 0.7 }),
    )
    pot.position.set(x, PLATFORM_TOP_Y + 0.07, z)
    world.add(pot)
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0x3cb85a,
        roughness: 0.65,
        emissive: 0x1a4828,
        emissiveIntensity: 0.15,
      }),
    )
    leaf.position.set(x, PLATFORM_TOP_Y + 0.32, z)
    leaf.scale.set(1, 1.35, 1)
    world.add(leaf)
    void platformTopHex
  }

  function agentMaterial(hex: number, status: WorkStatus): THREE.MeshStandardMaterial {
    let emissiveIntensity = 0.12
    if (status === 'working') emissiveIntensity = 0.38
    else if (status === 'waiting') emissiveIntensity = 0.28
    else if (status === 'problem') emissiveIntensity = 0.45
    else if (status === 'idle' || status === 'offline') emissiveIntensity = 0.08
    return new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.48,
      metalness: 0.06,
      emissive: hex,
      emissiveIntensity,
    })
  }

  /** Desk + chair + status-colored worker facing monitor (local −Z = screen). */
  function addDeskWithAgent(
    x: number,
    z: number,
    yaw: number,
    status: WorkStatus,
    agentId: string,
  ): THREE.MeshStandardMaterial {
    const hex = STATUS_VIEW[status].hex
    const unit = new THREE.Group()
    unit.position.set(x, PLATFORM_TOP_Y, z)
    unit.rotation.y = yaw
    unit.scale.setScalar(DESK_UNIT_SCALE)
    unit.userData = { agentId, kind: 'agent' }

    const chairFabric = mat(0x6a7585, 0.62)
    const chairDark = mat(0x4a5562, 0.55)

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.06, 12), chairDark)
    pedestal.position.set(0, 0.11, 0.24)
    unit.add(pedestal)
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.32), chairFabric)
    seat.position.set(0, 0.24, 0.24)
    unit.add(seat)
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.08), mat(0x8492a0, 0.58))
    backrest.position.set(0, 0.46, 0.38)
    unit.add(backrest)
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), chairDark)
    armL.position.set(-0.2, 0.32, 0.26)
    unit.add(armL)
    const armR = armL.clone()
    armR.position.x = 0.2
    unit.add(armR)

    const workerPivot = new THREE.Group()
    workerPivot.position.set(0, 0.22, 0.24)
    unit.add(workerPivot)

    const body = new THREE.Group()
    body.scale.setScalar(WORKER_BODY_SCALE)
    workerPivot.add(body)

    const shirt = agentMaterial(hex, status)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.24), shirt)
    torso.position.set(0, 0.32, 0.02)
    body.add(torso)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 14), mat(0xe8dcc8, 0.65))
    head.position.set(0, 0.62, 0.02)
    body.add(head)
    const forearmL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.24), shirt)
    forearmL.position.set(-0.2, 0.22, -0.08)
    body.add(forearmL)
    const forearmR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.24), shirt)
    forearmR.position.set(0.2, 0.22, -0.08)
    body.add(forearmR)

    const desktop = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.06, 0.46), mat(0xf4f2eb, 0.42))
    desktop.position.set(0, 0.36, -0.06)
    unit.add(desktop)
    const deskLeg1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.05), mat(0xe0e2e6, 0.5))
    deskLeg1.position.set(-0.34, 0.18, 0.12)
    unit.add(deskLeg1)
    const deskLeg2 = deskLeg1.clone()
    deskLeg2.position.set(0.34, 0.18, 0.12)
    unit.add(deskLeg2)
    const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.11), mat(0x252930, 0.4))
    keyboard.position.set(0, 0.4, -0.02)
    unit.add(keyboard)

    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x0c1018,
      emissive: hex,
      emissiveIntensity: status === 'idle' || status === 'offline' ? 0.07 : 0.75,
      roughness: 0.22,
      metalness: 0.18,
    })
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.025), mat(0xeceff3, 0.35))
    bezel.position.set(0, 0.54, -0.34)
    unit.add(bezel)
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.26, 0.02), screenMat)
    screen.position.set(0, 0.54, -0.355)
    unit.add(screen)
    const monitorNeck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.04), mat(0xc8cdd4, 0.4))
    monitorNeck.position.set(0, 0.42, -0.3)
    unit.add(monitorNeck)
    const monitorFoot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.1), mat(0xd8dce2, 0.4))
    monitorFoot.position.set(0, 0.36, -0.28)
    unit.add(monitorFoot)

    const ringMat = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.34, 28), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.015
    unit.add(ring)

    world.add(unit)
    pickableAgents.push(unit)
    const shirtMats = [shirt]
    workerAnims.push({
      agentId,
      body,
      head,
      forearmL,
      forearmR,
      status,
      phase: hashPhase(agentId),
    })
    seats.push({
      agentId,
      status,
      phase: hashPhase(agentId),
      screenMat,
      ringMat,
      shirtMats: [shirt],
    })
    return screenMat
  }

  function tickWorkers(t: number) {
    for (const w of workerAnims) {
      const ph = w.phase
      let bob = 0
      let lean = 0
      let type = 0
      let sway = 0
      switch (w.status) {
        case 'working':
          bob = Math.sin(t * 3.4 + ph) * 0.022
          lean = Math.sin(t * 2.1 + ph) * 0.05
          type = Math.sin(t * 7 + ph)
          sway = Math.sin(t * 1.6 + ph) * 0.07
          break
        case 'waiting':
          bob = Math.sin(t * 1.1 + ph) * 0.014
          lean = Math.sin(t * 0.65 + ph) * 0.025
          type = Math.sin(t * 1.2 + ph) * 0.15
          sway = Math.sin(t * 0.5 + ph) * 0.12
          break
        case 'problem':
          bob = Math.sin(t * 9 + ph) * 0.028
          lean = Math.sin(t * 11 + ph) * 0.06
          type = Math.sin(t * 14 + ph)
          sway = Math.sin(t * 8 + ph) * 0.1
          break
        case 'offline':
          bob = 0
          lean = 0.06
          break
        default:
          bob = Math.sin(t * 0.85 + ph) * 0.01
          type = Math.sin(t * 0.9 + ph) * 0.08
          sway = Math.sin(t * 0.4 + ph) * 0.04
      }
      w.body.position.y = bob
      w.body.rotation.x = lean
      w.head.rotation.x = -lean * 0.35 + Math.sin(t * 1.7 + ph) * 0.04
      w.head.rotation.y = sway
      w.forearmL.rotation.x = -0.55 + type * 0.42
      w.forearmR.rotation.x = -0.55 + Math.sin(t * 7 + ph + 1.4) * 0.42
    }
  }

  /** One label on the outer rim (away from the brain) — desks stay at room center. */
  function deptSignLayout(roomX: number, roomZ: number, roomW: number, roomD: number) {
    const geomSpan = Math.min(roomW, roomD)
    const signY = PLATFORM_TOP_Y + 0.36 + geomSpan * 0.018
    const len = Math.hypot(roomX, roomZ) || 1
    const ux = roomX / len
    const uz = roomZ / len
    const rim = Math.max(roomW, roomD) * 0.48
    const outward = 0.28 + geomSpan * 0.04
    return {
      signX: roomX + ux * (rim + outward),
      signY,
      signZ: roomZ + uz * (rim + outward),
      /** Uniform label typography — not tied to shallow single-agent tiles. */
      labelSpan: roomW,
    }
  }

  function addDepartmentCard(
    plan: CompanyOffice,
    roomKey: string,
    departmentId: string,
    agents: CompanyAgent[],
    partIndex: number,
    partCount: number,
    roomX: number,
    roomZ: number,
    roomW: number,
    roomD: number,
  ) {
    const dash = departmentDashboard(plan, departmentId)
    if (!dash) return
    const baseName = departmentDisplayName(departmentId, dash.name)
    const name =
      partCount > 1 ? `${baseName} ${partIndex + 1}/${partCount}` : baseName
    const agentIds = agents.map((a) => a.id)

    const el = document.createElement('div')
    el.className = 'co-dept-plate'
    el.dataset.deptId = departmentId
    el.style.setProperty('--co-dept-accent', dash.accent)
    el.innerHTML = `<span class="co-dept-plate-name">${name}</span>${deptStatusBarHtml(agentIds, plan)}`
    el.onclick = (event) => {
      event.stopPropagation()
      const next = selectedDepartmentId === departmentId ? null : departmentId
      hooks.onSelectDepartment(next)
    }
    if (selectedDepartmentId === departmentId) el.classList.add('co-dept-plate--on')
    deptCardEls.set(roomKey, el)
    deptCardTrack.set(roomKey, { el, agentIds })

    const layout = deptSignLayout(roomX, roomZ, roomW, roomD)
    el.style.setProperty('--co-plate-span', String(layout.labelSpan))
    const label = new CSS2DObject(el)
    label.position.set(layout.signX, layout.signY, layout.signZ)
    label.center.set(0.5, 0.5)
    label.userData.platformSpan = layout.labelSpan
    deptLabelObjs.push(label)
    world.add(label)
  }

  function updateDeptLabelScale() {
    const refSpan = 11
    for (const label of deptLabelObjs) {
      const el = label.element as HTMLElement | undefined
      if (!el) continue
      const span = (label.userData.platformSpan as number) || refSpan
      const spanFactor = THREE.MathUtils.clamp(span / refSpan, 0.68, 1.08)
      const d = camera.position.distanceTo(label.position)
      const s = THREE.MathUtils.clamp((7.2 / d) * spanFactor, 0.52 * spanFactor, 0.88 * spanFactor)
      el.style.transform = `scale(${s.toFixed(3)})`
      el.style.transformOrigin = 'center center'
    }
  }

  function syncDeptHighlight() {
    for (const label of deptLabelObjs) {
      const el = label.element as HTMLElement | undefined
      if (!el) continue
      const id = el.dataset.deptId ?? ''
      const on = selectedDepartmentId === id
      const dim = selectedDepartmentId != null && !on
      el.classList.toggle('co-dept-plate--on', on)
      el.classList.toggle('co-dept-plate--dim', dim)
    }
  }

  function markBrainHeroReady(img: HTMLImageElement) {
    brainHeroReady = true
    brainHeroImgEl = img
    img.classList.add('co-brain-hero-3d__img--ready')
  }

  /** Stable anatomical brain (HTML img in CSS2D — no WebGL sprite / orange lamp shell). */
  function addBrainHero(brainRoot: THREE.Group) {
    const el = document.createElement('div')
    el.className = 'co-brain-hero-3d'
    const img = document.createElement('img')
    img.className = 'co-brain-hero-3d__img'
    img.src = brainAssetUrl(BRAIN_HERO_URL)
    img.alt = 'Company brain'
    img.draggable = false
    img.decoding = 'async'
    if (img.complete && img.naturalWidth > 0) markBrainHeroReady(img)
    else {
      img.onload = () => markBrainHeroReady(img)
      img.onerror = () => {
        console.warn('[company-floor] brain-hero.png failed to load — check /textures/brain-hero.png')
      }
    }
    el.appendChild(img)
    el.onclick = (ev) => {
      ev.stopPropagation()
      hooks.onSelectBrain()
    }
    const label = new CSS2DObject(el)
    label.position.set(0, 0.48, 0)
    label.userData = { kind: 'brain' }
    brainRoot.add(label)
  }

  /** Anatomical hero brain (PNG only); click → Knowledge / Qwen. */
  function addCentralBrain(): THREE.Vector3 {
    const hub = new THREE.Group()
    hub.position.set(0, PLATFORM_TOP_Y + BRAIN_HUB_LIFT, 0)
    hub.userData = { kind: 'brain' }

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.05, 48),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    hub.add(shadow)

    const brainRoot = new THREE.Group()
    brainRoot.position.y = 0.28
    brainRoot.userData = { kind: 'brain' }
    hub.add(brainRoot)

    addBrainHero(brainRoot)

    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 12),
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    hit.userData = { kind: 'brain' }
    hit.scale.set(1.35, 1.05, 1.15)
    hit.position.set(0, 0.52, 0)
    brainRoot.add(hit)

    brainSelectRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.08, 0.055, 10, 48),
      new THREE.MeshBasicMaterial({
        color: 0xe8c878,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    )
    brainSelectRing.rotation.x = Math.PI / 2
    brainSelectRing.position.y = 0.14
    brainSelectRing.visible = selectedDepartmentId === KNOWLEDGE_DEPARTMENT_ID
    hub.add(brainSelectRing)

    hub.scale.setScalar(BRAIN_SCALE)
    world.add(hub)
    pickableBrainRoot = hub

    const emitY = PLATFORM_TOP_Y + BRAIN_HUB_LIFT + (0.28 + 1.15) * BRAIN_SCALE
    brainEmit.set(0, emitY, 0)
    return brainEmit.clone()
  }

  /** Radial light shower from the brain — activity indicator (not a white lamp shell). */
  function addBrainScatter(origin: THREE.Vector3) {
    const geo = new THREE.SphereGeometry(0.07, 8, 8)
    keepGeo.add(geo)
    const n = 18
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * Math.PI * 2 * 3.1 + 0.2
      const spread = 0.32 + (i % 8) * 0.06
      const dir = new THREE.Vector3(
        Math.cos(theta) * spread,
        -0.5 - (i % 4) * 0.1,
        Math.sin(theta) * spread,
      ).normalize()
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xff6633 : i % 3 === 1 ? 0xffaa55 : 0xffcc88,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.copy(origin)
      world.add(mesh)
      brainScatter.push({
        mesh,
        dir,
        speed: 0.42 + (i % 6) * 0.06,
        phase: (i / n) * 2.2,
      })
    }
  }

  function syncBrainHighlight() {
    if (brainSelectRing) {
      brainSelectRing.visible = selectedDepartmentId === KNOWLEDGE_DEPARTMENT_ID
    }
  }

  function addBrainLightStreams(
    origin: THREE.Vector3,
    targets: { x: number; z: number; hex: number; phase: number; agentId: string }[],
  ) {
    const particleGeo = new THREE.SphereGeometry(0.085, 8, 8)
    keepGeo.add(particleGeo)
    for (const tgt of targets) {
      const end = new THREE.Vector3(tgt.x, PLATFORM_TOP_Y + 0.52, tgt.z)
      const dist = origin.distanceTo(end)
      const mid = new THREE.Vector3(
        (origin.x + end.x) * 0.5,
        origin.y + Math.max(2.8, dist * 0.32),
        (origin.z + end.z) * 0.5,
      )
      const curve = new THREE.QuadraticBezierCurve3(origin.clone(), mid, end)
      const tubeGeo = new THREE.TubeGeometry(curve, 28, 0.028, 5, false)
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0xffbb66,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      world.add(new THREE.Mesh(tubeGeo, tubeMat))

      const particles: THREE.Mesh[] = []
      const speeds: number[] = []
      const count = 8
      for (let i = 0; i < count; i++) {
        const pMat = new THREE.MeshBasicMaterial({
          color: tgt.hex,
          transparent: true,
          opacity: 0.68,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
        const p = new THREE.Mesh(particleGeo, pMat)
        world.add(p)
        particles.push(p)
        speeds.push(0.38 + i * 0.05)
      }
      lightStreams.push({ curve, particles, speeds, phase: tgt.phase, agentId: tgt.agentId })
    }
  }

  function addOfficeFloor(span: number) {
    const s = span * 1.35
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s),
      new THREE.MeshStandardMaterial({ color: 0x52525c, roughness: 0.88, metalness: 0.03 }),
    )
    slab.rotation.x = -Math.PI / 2
    slab.position.y = -0.01
    slab.receiveShadow = true
    world.add(slab)
  }

  function hitIsBrain(object: THREE.Object3D): boolean {
    let node: THREE.Object3D | null = object
    while (node) {
      if (node.userData?.kind === 'brain') return true
      node = node.parent
    }
    return false
  }

  function onCanvasClick(event: MouseEvent) {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const merged: THREE.Intersection[] = []
    merged.push(...raycaster.intersectObjects(pickableAgents, true))
    if (pickableBrainRoot) merged.push(...raycaster.intersectObject(pickableBrainRoot, true))
    merged.sort((a, b) => a.distance - b.distance)
    if (!merged.length) return
    const top = merged[0]!
    if (hitIsBrain(top.object)) {
      hooks.onSelectBrain()
      return
    }
    let node: THREE.Object3D | null = top.object
    while (node && !node.userData?.agentId) node = node.parent
    const id = node?.userData?.agentId as string | undefined
    if (id) hooks.onSelectAgent(id)
  }

  canvas.addEventListener('click', onCanvasClick)

  function patchPlanTelemetry(plan: CompanyOffice) {
    const byId = new Map<string, WorkStatus>()
    for (const department of plan.departments) {
      for (const agent of department.agents) byId.set(agent.id, agent.status)
    }
    for (const row of seats) {
      const next = byId.get(row.agentId)
      if (!next || next === row.status) continue
      row.status = next
      applyAgentStatusVisual(next, row.screenMat, row.ringMat, row.shirtMats)
    }
    for (const w of workerAnims) {
      const next = byId.get(w.agentId)
      if (next) w.status = next
    }
    for (const { el, agentIds } of deptCardTrack.values()) {
      const bar = el.querySelector('.co-dept-plate-status')
      if (bar) bar.outerHTML = deptStatusBarHtml(agentIds, plan).trim()
    }
    let activity = false
    for (const stream of lightStreams) {
      if (!stream.agentId) continue
      const s = byId.get(stream.agentId)
      if (!s) continue
      const hex = STATUS_VIEW[s].hex
      for (const p of stream.particles) {
        ;(p.material as THREE.MeshBasicMaterial).color.setHex(hex)
      }
      if (s === 'working' || s === 'problem') activity = true
    }
    if (activity !== lastActivityPulse) {
      lastActivityPulse = activity
      brainSyncKick = activity ? 0.28 : 0.08
    }
  }

  function build(plan: CompanyOffice, refit: boolean) {
    const key = planStructureKey(plan)
    if (lastPlan && planStructureKey(lastPlan) === key && seats.length > 0) {
      patchPlanTelemetry(plan)
      lastPlan = plan
      return
    }
    clearWorld()
    const cols = columnCount(plan.departments.length, camera.aspect || 1.6, lastCols)
    lastCols = cols
    lastPlan = plan
    const layout = layoutOfficeRadial(plan)
    const span = Math.max(layout.width, layout.depth, 12)
    addOfficeFloor(span)
    const brainOrigin = addCentralBrain()
    const streamTargets: { x: number; z: number; hex: number; phase: number; agentId: string }[] = []

    for (const room of layout.rooms) {
      const dash = departmentDashboard(plan, room.department.id)
      const accent = dash?.accent ?? '#b8c0c8'
      const topHex = addDeptPlatform(room.x, room.z, room.w, room.d, accent)
      addDeskPlant(room.x + room.w * 0.32, room.z + room.d * 0.28, topHex)
      addDepartmentCard(
        plan,
        room.roomKey,
        room.department.id,
        room.department.agents,
        room.partIndex,
        room.partCount,
        room.x,
        room.z,
        room.w,
        room.d,
      )

      for (const desk of room.desks) {
        const look = desk.agent.status
        addDeskWithAgent(desk.x, desk.z, desk.yaw, look, desk.agent.id)
        const phase = hashPhase(desk.agent.id)
        streamTargets.push({
          x: desk.x,
          z: desk.z,
          hex: STATUS_VIEW[look].hex,
          phase,
          agentId: desk.agent.id,
        })
      }
    }

    addBrainLightStreams(brainOrigin, streamTargets)
    addBrainScatter(brainOrigin)
    brainSyncKick = 0.45

    lastLayout = layout
    syncDeptHighlight()
    syncBrainHighlight()
    scene.fog = new THREE.Fog(0x52525a, span * 2.2, span * 6.5)
    if (refit) {
      userMoved = false
      fit(layout)
    }
  }

  /** Pull the camera back until every room fits the current window. */
  function fit(layout: FloorLayout) {
    const aspect = Math.max(camera.aspect || 1, 0.2)
    const vFov = (camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
    const distV = layout.depth / 2 / Math.tan(vFov / 2)
    const distH = layout.width / 2 / Math.tan(hFov / 2)
    const dist = Math.max(distV, distH, 14) * 0.72
    camera.position.set(dist * 0.85, dist * 0.72, dist * 0.85)
    camera.fov = 40
    camera.updateProjectionMatrix()
    controls.target.set(0, 0.85, 0)
    controls.maxDistance = dist * 3.2
    controls.minDistance = dist * 0.75
    controls.update()
  }

  function frame() {
    if (!running) return
    raf = requestAnimationFrame(frame)
    const t = clock.getElapsedTime()
    tickWorkers(t)
    for (const row of seats) {
      row.screenMat.emissiveIntensity = screenEmissiveIntensity(row.status)
    }

    let activeAgents = 0
    for (const row of seats) {
      if (row.status === 'working' || row.status === 'problem') activeAgents++
    }
    if (activeAgents > 0) {
      brainSyncKick = Math.min(1, brainSyncKick + 0.018 * activeAgents)
    }

    const kick = brainSyncKick
    brainSyncKick = Math.max(0, brainSyncKick - 0.028)

    const pulse = 0.5 + Math.sin(t * 2.6) * 0.35 + kick * 0.55
    if (brainHeroImgEl) {
      const glow = THREE.MathUtils.clamp(0.38 + pulse * 0.22 + kick * 0.35, 0.32, 0.72)
      brainHeroImgEl.style.filter = `drop-shadow(0 10px 28px rgb(255 90 40 / ${glow}))`
    }

    const streamBoost = 1 + kick * 0.45 + activeAgents * 0.05
    for (const stream of lightStreams) {
      for (let i = 0; i < stream.particles.length; i++) {
        const u =
          (t * stream.speeds[i]! * streamBoost + stream.phase + i / Math.max(stream.particles.length, 1)) % 1
        stream.particles[i]!.position.copy(stream.curve.getPoint(u))
        const pMat = stream.particles[i]!.material as THREE.MeshBasicMaterial
        pMat.opacity = streamBoost * (0.22 + (1 - u) * 0.58 + Math.sin(u * Math.PI) * 0.24)
      }
    }

    const scatterStrength = brainHeroReady ? 0.38 : 0.85
    for (const s of brainScatter) {
      const u = (t * s.speed * streamBoost + s.phase) % 1
      const reach = 0.6 + u * 5.2
      s.mesh.position.copy(brainEmit).addScaledVector(s.dir, reach)
      const sm = s.mesh.material as THREE.MeshBasicMaterial
      sm.opacity = scatterStrength * streamBoost * (0.12 + (1 - u) * 0.48)
    }

    controls.update()
    updateDeptLabelScale()
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
  }
  frame()

  return {
    setPlan(plan, refit) {
      if (!plan) {
        lastPlan = null
        lastLayout = null
        lastCols = 0
        clearWorld()
        return
      }
      build(plan, refit)
    },
    setSelectedDepartment(departmentId) {
      selectedDepartmentId = departmentId
      syncDeptHighlight()
      syncBrainHighlight()
    },
    resize(width, height) {
      if (width < 1 || height < 1) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      labelRenderer.setSize(width, height)
      const cols = lastPlan
        ? columnCount(lastPlan.departments.length, camera.aspect || 1.6, lastCols)
        : lastCols
      if (lastPlan && cols !== lastCols) build(lastPlan, true)
    },
    dispose() {
      running = false
      cancelAnimationFrame(raf)
      canvas.removeEventListener('click', onCanvasClick)
      clearWorld()
      controls.dispose()
      renderer.dispose()
    },
  }
}

function hashPhase(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) % 628
  return h / 100
}

