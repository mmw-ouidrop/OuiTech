<script setup>
// Pictogrammes du menu : traits simples, couleur = texte courant.
defineProps({ name: { type: String, required: true }, size: { type: Number, default: 24 } })
const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  doc: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h7',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z M4 19a2 2 0 012-2h13 M9 7h6',
  machine: 'M4 4h16v16H4z M4 9h16 M4 14h16 M8 6.5h.01 M8 11.5h.01 M8 16.5h.01',
  rack: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M15 15l4 4 M19 15l-4 4',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  close: 'M6 6l12 12 M18 6L6 18',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9',
  wifi: 'M2 9a15 15 0 0120 0 M5 12.5a10 10 0 0114 0 M8.5 16a5 5 0 017 0 M12 19.5h.01',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14z M21 21l-4.5-4.5',
  cloud: 'M7 18a5 5 0 01-.5-9.97A6 6 0 0118 9a4.5 4.5 0 01-.5 9z',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13 7l4 4',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18z M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2 M12 17h.01',
  plus: 'M12 5v14 M5 12h14',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  copy: 'M9 9h11v11H9z M5 15V4h11',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 018 0v3',
  heading: 'M5 5v14 M19 5v14 M5 12h14',
  text: 'M4 6h16 M4 11h16 M4 16h10',
  divider: 'M3 12h18',
  code: 'M9 7l-5 5 5 5 M15 7l5 5-5 5',
  input: 'M3 8h18v8H3z M7 12h4',
  textarea: 'M3 5h18v14H3z M7 9h10 M7 13h10 M7 16h5',
  number: 'M5 9h14 M5 15h14 M10 4L8 20 M16 4l-2 16',
  check: 'M4 4h16v16H4z M8 12l3 3 5-6',
  radio: 'M12 21a9 9 0 100-18 9 9 0 000 18z M12 15a3 3 0 100-6 3 3 0 000 6z',
  select: 'M3 7h18v10H3z M14 11l2 2 2-2',
  multi: 'M4 5h6v6H4z M4 14h6v6H4z M14 7h6 M14 17h6 M5.5 8l1 1 2-2',
  calendar: 'M4 6h16v14H4z M4 11h16 M8 3v4 M16 3v4',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3z M12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  save: 'M5 4h12l3 3v13H5z M8 4v5h8V4 M8 20v-6h8v6',
  import: 'M12 4v11 M7 11l5 5 5-5 M4 20h16',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6'
}
</script>

<template>
  <svg viewBox="0 0 24 24" :width="size" :height="size" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path :d="PATHS[name] || ''" />
  </svg>
</template>
