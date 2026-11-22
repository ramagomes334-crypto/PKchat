type WSListener = (data: any) => void;

class PKWebSocketClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<WSListener>();
  private token: string | null = null;
  private reconnectTimer: number | null = null;
  private isClosedManually = false;

  connect(token: string) {
    this.token = token;
    this.isClosedManually = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;
    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      if (this.token) {
        socket.send(JSON.stringify({ type: 'auth', token: this.token }));
      }
    };

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        for (const fn of this.listeners) {
          fn(parsed);
        }
      } catch {
        // Ignore non-JSON frames
      }
    };

    socket.onclose = () => {
      this.ws = null;
      if (!this.isClosedManually && this.token) {
        this.reconnectTimer = window.setTimeout(() => {
          if (this.token) this.connect(this.token);
        }, 2500);
      }
    };
  }

  disconnect() {
    this.isClosedManually = true;
    this.token = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(payload: Record<string, any>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  subscribe(fn: WSListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const wsClient = new PKWebSocketClient();
