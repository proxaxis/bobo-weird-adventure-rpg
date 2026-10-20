import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from '@/App.vue';
import { initAudio } from '@/audio/audioManager.js';
import { bindEventBus } from '@/core/eventBindings.js';

import '@/style.css';

const app = createApp(App);
app.use(createPinia());
bindEventBus();
initAudio();
app.mount('#app');
