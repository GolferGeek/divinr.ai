import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
export interface ActivityEvent {
  id?: string;
  hook_event_type: string;
  message?: string;
  context: {
    userId?: string;
    agentSlug?: string;
    conversationId?: string;
    [key: string]: unknown;
  };
  data?: Record<string, unknown>;
  timestamp?: string;
  created_at?: string;
}

export const useActivityStore = defineStore('activity', () => {
  const events = ref<ActivityEvent[]>([]);
  const connected = ref(false);
  const panelOpen = ref(false);
  let eventSource: EventSource | null = null;

  const recentEvents = computed(() => events.value.slice(-200));

  function connect() {
    if (eventSource) return;

    // SSE connects to the observability endpoint (not /markets)
    const isElectron = typeof window !== 'undefined' && (window as Record<string, unknown>).electronAPI;
    const apiBase = isElectron
      ? (localStorage.getItem('divinr_api_url') || 'http://localhost:6100')
      : '/api';
    const url = `${apiBase}/observability/stream`;

    eventSource = new EventSource(url);
    connected.value = true;

    eventSource.onmessage = (e) => {
      try {
        const event: ActivityEvent = JSON.parse(e.data);
        if (event.hook_event_type === 'connected') return;
        events.value.push(event);
        // Keep buffer at 500 max
        if (events.value.length > 500) {
          events.value = events.value.slice(-300);
        }
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => {
      connected.value = false;
      disconnect();
      // Reconnect after 5 seconds
      setTimeout(() => connect(), 5000);
    };
  }

  function disconnect() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    connected.value = false;
  }

  function toggle() {
    panelOpen.value = !panelOpen.value;
    if (panelOpen.value && !eventSource) {
      connect();
    }
  }

  function clear() {
    events.value = [];
  }

  return { events, recentEvents, connected, panelOpen, connect, disconnect, toggle, clear };
});
