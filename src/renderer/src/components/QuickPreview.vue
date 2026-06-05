<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type { QuickPreviewState } from '../file-manager/types'

const props = defineProps<{
  preview: QuickPreviewState
}>()

defineEmits<{
  close: []
}>()

const modelHost = ref<HTMLElement | null>(null)

let stopModelPreview: (() => void) | null = null

const formatBytes = (size: number): string => {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

const frameObject = (object: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls): void => {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z, 1)
  const distance = maxDimension * 2.2

  object.position.sub(center)
  camera.position.set(distance, distance * 0.7, distance)
  camera.near = Math.max(distance / 1000, 0.01)
  camera.far = distance * 1000
  camera.updateProjectionMatrix()
  controls.target.set(0, 0, 0)
  controls.update()
}

const startModelPreview = async (): Promise<void> => {
  stopModelPreview?.()
  stopModelPreview = null

  if (props.preview.kind !== 'model') {
    return
  }

  await nextTick()

  const host = modelHost.value

  if (!host) {
    return
  }

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x111820)

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true

  scene.add(new THREE.HemisphereLight(0xffffff, 0x344050, 2.6))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2)
  keyLight.position.set(3, 4, 5)
  scene.add(keyLight)
  scene.add(new THREE.GridHelper(10, 10, 0x526174, 0x273342))

  const resize = (): void => {
    const rect = host.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  const addObject = (object: THREE.Object3D): void => {
    scene.add(object)
    frameObject(object, camera, controls)
    resize()
  }

  const sourceName = props.preview.entryName.toLowerCase()

  if (sourceName.endsWith('.stl')) {
    const geometry = await new STLLoader().loadAsync(props.preview.sourceUrl)
    geometry.computeVertexNormals()
    addObject(
      new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: 0xb8d7ff,
          metalness: 0.1,
          roughness: 0.45
        })
      )
    )
  } else {
    const gltf = await new GLTFLoader().loadAsync(props.preview.sourceUrl)
    addObject(gltf.scene)
  }

  let animationFrame = 0
  const render = (): void => {
    animationFrame = window.requestAnimationFrame(render)
    controls.update()
    renderer.render(scene, camera)
  }

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)
  resize()
  render()

  stopModelPreview = () => {
    window.cancelAnimationFrame(animationFrame)
    resizeObserver.disconnect()
    controls.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
}

watch(() => props.preview, () => void startModelPreview(), { immediate: true, flush: 'post' })

onBeforeUnmount(() => {
  stopModelPreview?.()
})
</script>

<template>
  <div class="quick-preview-backdrop" @click="$emit('close')">
    <section class="quick-preview" role="dialog" aria-modal="true" :aria-label="`预览 ${preview.entryName}`" @click.stop>
      <header class="quick-preview-header">
        <span class="quick-preview-title" :title="preview.entryName">{{ preview.entryName }}</span>
        <button class="quick-preview-close" type="button" title="关闭预览" @click="$emit('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12" />
            <path d="M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="quick-preview-body">
        <img
          v-if="preview.kind === 'image'"
          class="quick-preview-image"
          :src="preview.sourceUrl"
          :alt="preview.entryName"
          draggable="false"
        />
        <video
          v-else-if="preview.kind === 'video'"
          class="quick-preview-media"
          :src="preview.sourceUrl"
          controls
          autoplay
        ></video>
        <audio v-else-if="preview.kind === 'audio'" class="quick-preview-audio" :src="preview.sourceUrl" controls autoplay></audio>
        <iframe v-else-if="preview.kind === 'pdf'" class="quick-preview-frame" :src="preview.sourceUrl"></iframe>
        <pre v-else-if="preview.kind === 'text' || preview.kind === 'document'" class="quick-preview-text">{{
          preview.text
        }}</pre>
        <div v-else-if="preview.kind === 'spreadsheet'" class="quick-preview-sheets">
          <section v-for="sheet in preview.sheets" :key="sheet.name" class="quick-preview-sheet">
            <h2>{{ sheet.name }}</h2>
            <table>
              <tbody>
                <tr v-for="(row, rowIndex) in sheet.rows" :key="rowIndex">
                  <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
        <div v-else-if="preview.kind === 'archive'" class="quick-preview-archive">
          <div class="quick-preview-count">
            {{ preview.totalEntries }} 个项目<span v-if="preview.entries.length < preview.totalEntries">
              ，显示前 {{ preview.entries.length }} 个</span
            >
          </div>
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>大小</th>
                <th>压缩后</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in preview.entries" :key="entry.name">
                <td>{{ entry.isDirectory ? `${entry.name}` : entry.name }}</td>
                <td>{{ entry.isDirectory ? '-' : formatBytes(entry.uncompressedSize) }}</td>
                <td>{{ entry.isDirectory ? '-' : formatBytes(entry.compressedSize) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else ref="modelHost" class="quick-preview-model"></div>
      </div>
    </section>
  </div>
</template>
