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