<<<<<<< HEAD
import { Client, type StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import type { CursorMessage, ElementMessage } from '../types';

export const API_BASE: string = import.meta.env.VITE_API_URL ?? '';
const WS_URL: string = import.meta.env.VITE_WS_URL ?? `${API_BASE}/ws-whiteboard`;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface SubscriptionEntry {
  destination: string;
  handler: (body: unknown) => void;
  active?: StompSubscription;
}

const MAX_QUEUE = 500;

/**
 * Singleton STOMP-over-SockJS client.
 *  - automatic reconnect (3s) and 10s heartbeats in both directions
 *  - subscriptions are remembered and re-established after every reconnect
 *  - durable messages (CREATE/UPDATE/DELETE) are queued while offline and flushed on reconnect;
 *    ephemeral ones (cursors, DRAGGING) are dropped
 */
class WhiteboardSocket {
  private client: Client | null = null;
  private status: ConnectionStatus = 'disconnected';
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private entries = new Set<SubscriptionEntry>();
  private queue: { destination: string; body: string }[] = [];

  connect(): void {
    if (this.client) return;
    this.setStatus('connecting');
    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL) as unknown as WebSocket,
      reconnectDelay: 3000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      onConnect: () => {
        this.entries.forEach((e) => this.attach(e));
        this.setStatus('connected');
        this.flush();
      },
      onWebSocketClose: () => {
        this.entries.forEach((e) => (e.active = undefined));
        this.setStatus('disconnected');
      },
      onStompError: (frame) => console.error('STOMP error:', frame.headers['message'], frame.body),
    });
    client.activate();
    this.client = client;
  }

  disconnect(): void {
    void this.client?.deactivate();
    this.client = null;
    this.setStatus('disconnected');
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Calls the listener immediately with the current status, then on every change. */
  onStatus(listener: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribe<T>(destination: string, handler: (message: T) => void): () => void {
    const entry: SubscriptionEntry = { destination, handler: handler as (b: unknown) => void };
    this.entries.add(entry);
    if (this.client?.connected) this.attach(entry);
    return () => {
      this.entries.delete(entry);
      try {
        entry.active?.unsubscribe();
      } catch {
        /* connection already gone */
      }
    };
  }

  subscribeElements(boardId: string, handler: (m: ElementMessage) => void): () => void {
    return this.subscribe<ElementMessage>(`/topic/board/${boardId}/elements`, handler);
  }

  subscribeCursors(boardId: string, handler: (m: CursorMessage) => void): () => void {
    return this.subscribe<CursorMessage>(`/topic/board/${boardId}/cursors`, handler);
  }

  publishElement(boardId: string, message: ElementMessage): void {
    this.publish(`/app/board/${boardId}/element`, message, message.action !== 'DRAGGING');
  }

  publishCursor(boardId: string, message: CursorMessage): void {
    this.publish(`/app/board/${boardId}/cursor`, message, false);
  }

  private publish(destination: string, payload: unknown, durable: boolean): void {
    const body = JSON.stringify(payload);
    if (this.client?.connected) {
      this.client.publish({ destination, body, headers: { 'content-type': 'application/json' } });
    } else if (durable) {
      this.queue.push({ destination, body });
      if (this.queue.length > MAX_QUEUE) this.queue.shift();
    }
  }

  private attach(entry: SubscriptionEntry): void {
    if (!this.client) return;
    entry.active = this.client.subscribe(entry.destination, (frame) => {
      try {
        entry.handler(JSON.parse(frame.body));
      } catch (err) {
        console.error('Bad message on', entry.destination, err);
      }
    });
  }

  private flush(): void {
    const pending = this.queue;
    this.queue = [];
    pending.forEach((m) =>
      this.client?.publish({ destination: m.destination, body: m.body, headers: { 'content-type': 'application/json' } }),
    );
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }
}

export const socket = new WhiteboardSocket();
=======
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

export interface CursorPayload {
    userId: string;
    userName: string;
    color: string;
    x: number;
    y: number;
}

export interface ElementPayload {
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    id: string;
    boardId: string;
    type: 'stroke' | 'rect';
    x: number;
    y: number;
    width?: number;
    height?: number;
    strokeColor: string;
    fillColor?: string;
    strokeWidth: number;
    zIndex: number;
    payload?: string; // JSON string of [x, y, x, y, ...] points for strokes
}

class WhiteboardSocketService {
    private client: Client | null = null;

    connect(
        boardId: string,
        onCursorReceived: (cursor: CursorPayload) => void,
        onElementReceived: (element: ElementPayload) => void
    ) {
        this.client = new Client({
            webSocketFactory: () => new SockJS('http://localhost:8081/ws-whiteboard'),
            reconnectDelay: 5000,
        });

        this.client.onConnect = () => {
            console.log('Connected to Spring Boot on port 8081');

            // 1. Subscribe to remote cursors
            this.client?.subscribe(`/topic/room/${boardId}/cursor`, (message) => {
                onCursorReceived(JSON.parse(message.body));
            });

            // 2. Subscribe to canvas updates/drawings
            this.client?.subscribe(`/topic/room/${boardId}/element`, (message) => {
                onElementReceived(JSON.parse(message.body));
            });
        };

        this.client.activate();
    }

    sendCursor(boardId: string, cursor: CursorPayload) {
        if (this.client && this.client.connected) {
            this.client.publish({
                destination: `/app/room/${boardId}/cursor`,
                body: JSON.stringify(cursor),
            });
        }
    }

    sendElement(boardId: string, element: ElementPayload) {
        if (this.client && this.client.connected) {
            this.client.publish({
                destination: `/app/room/${boardId}/element`,
                body: JSON.stringify(element),
            });
        }
    }

    disconnect() {
        if (this.client) {
            this.client.deactivate();
        }
    }
}

export const socketService = new WhiteboardSocketService();
>>>>>>> abdebd9583869536fbbcb39e4385065772fbe0f7
