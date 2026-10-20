import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from '@/App.vue';
import { bindEventBus } from '@/core/eventBindings.js';

import '@/style.css';

const app = createApp(App);
app.use(createPinia());
bindEventBus();
app.mount('#app');
