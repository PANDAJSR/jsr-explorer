<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  title: string
  defaultValue?: string
}>()

const emit = defineEmits<{
  cancel: []
  submit: [value: string]
}>()

const input = ref<HTMLInputElement | null>(null)
const value = ref('')

const focusInput = (): void => {
  void nextTick(() => {
    input.value?.focus()
    input.value?.select()
  })
}

watch(
  () => props.defaultValue,
  (defaultValue) => {
    value.value = defaultValue ?? ''
    focusInput()
  },
  { immediate: true }
)

const submit = (): void => {
  const name = value.value.trim()

  if (name) {
    emit('submit', name)
  }
}
</script>

<template>
  <div class="name-dialog-backdrop" @mousedown.self="emit('cancel')">
    <form class="name-dialog" @submit.prevent="submit" @keydown.escape.prevent="emit('cancel')">
      <label class="name-dialog-label" for="name-dialog-input">{{ title }}</label>
      <input
        id="name-dialog-input"
        ref="input"
        v-model="value"
        class="name-dialog-input"
        type="text"
        autocomplete="off"
      />
      <div class="name-dialog-actions">
        <button class="secondary-button" type="button" @click="emit('cancel')">取消</button>
        <button class="primary-button" type="submit" :disabled="!value.trim()">确定</button>
      </div>
    </form>
  </div>
</template>
