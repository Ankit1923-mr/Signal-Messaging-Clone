/**
 * WebSocket Client
 *
 * Handles connection to Component 3 backend (/ws/messages).
 * Manages message sending, receipt tracking, typing indicators, reconnection.
 *
 * Authentication: Browser automatically sends httpOnly access_token cookie.
 * Protocol: Component 3 envelope format { type, payload }
 */

import {
  WebSocketMessage,
  MessageType,
  ReceiptStatus,
  SendMessagePayload,
  ReceiptPayload,
  TypingPayload,
  MessageReceivedPayload,
  MessageAckPayload,
  ReceiptUpdatePayload,
  ReconnectedPayload,
  PendingMessage,
} from "@/types/protocol";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/messages";
const HEARTBEAT_TIMEOUT = 60000; // Close if no pong in 60s
const RECONNECT_DELAY_MS = [1000, 2000, 5000, 10000]; // Exponential backoff

export type WebSocketEventHandler = (message: WebSocketMessage) => void;

interface WebSocketClientOptions {
  onConnected?: () => void;
  onReconnected?: (pending: PendingMessage[]) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
  onMessage?: WebSocketEventHandler;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private options: WebSocketClientOptions;
  private reconnectAttempt: number = 0;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isIntentionallyClosed: boolean = false;

  constructor(options: WebSocketClientOptions = {}) {
    this.url = WS_URL;
    this.options = options;
  }

  /**
   * Connect to WebSocket server.
   * Browser automatically sends httpOnly access_token cookie.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.isIntentionallyClosed = false;
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.reconnectAttempt = 0;
          this.startHeartbeat();
          this.options.onConnected?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = () => {
          const error = "WebSocket connection error";
          this.options.onError?.(error);
          reject(new Error(error));
        };

        this.ws.onclose = () => {
          this.stopHeartbeat();
          if (!this.isIntentionallyClosed) {
            this.scheduleReconnect();
          }
          this.options.onClose?.();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Disconnect and don't reconnect.
   */
  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();
    this.clearReconnectTimeout();
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
  }

  /**
   * Send message to conversation.
   */
  async sendMessage(
    conversationId: number,
    content: string,
    clientId: string
  ): Promise<void> {
    if (!this.isConnected()) {
      throw new Error("WebSocket not connected");
    }

    if (content.length > 4000) {
      throw new Error("Message exceeds 4000 character limit");
    }

    const payload: SendMessagePayload = {
      conversation_id: conversationId,
      client_id: clientId,
      content,
    };

    const message: WebSocketMessage = {
      type: MessageType.SEND_MESSAGE,
      payload,
    };

    this.ws!.send(JSON.stringify(message));
  }

  /**
   * Send receipt update (delivered/read).
   */
  sendReceipt(messageId: number, status: "delivered" | "read"): void {
    if (!this.isConnected()) return;

    const payload: ReceiptPayload = {
      message_id: messageId,
      status,
    };

    const message: WebSocketMessage = {
      type: MessageType.RECEIPT,
      payload,
    };

    this.ws!.send(JSON.stringify(message));
  }

  /**
   * Send typing indicator.
   */
  sendTyping(conversationId: number, isTyping: boolean): void {
    if (!this.isConnected()) return;

    const payload: TypingPayload = {
      conversation_id: conversationId,
      typing: isTyping,
    };

    const message: WebSocketMessage = {
      type: MessageType.TYPING,
      payload,
    };

    this.ws!.send(JSON.stringify(message));
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ============================================================================
  // PRIVATE
  // ============================================================================

  private handleMessage(data: string): void {
    try {
      const message: WebSocketMessage = JSON.parse(data);

      switch (message.type) {
        case MessageType.PING:
          this.handlePing();
          break;

        case MessageType.CONNECTED:
          // Connection established, no pending messages
          break;

        case MessageType.RECONNECTED:
          // Connection re-established with pending messages
          const payload = message.payload as ReconnectedPayload;
          this.options.onReconnected?.(payload.pending_messages);
          break;

        case MessageType.MESSAGE_ACK:
          this.options.onMessage?.(message);
          break;

        case MessageType.MESSAGE_RECEIVED:
          this.options.onMessage?.(message);
          break;

        case MessageType.RECEIPT_UPDATE:
          this.options.onMessage?.(message);
          break;

        case MessageType.USER_TYPING:
          this.options.onMessage?.(message);
          break;

        case MessageType.ERROR:
          const errorPayload = message.payload as any;
          this.options.onError?.(errorPayload.message || "WebSocket error");
          break;

        default:
          // Forward unknown messages to handler
          this.options.onMessage?.(message);
      }
    } catch (err) {
      this.options.onError?.(`Failed to parse message: ${err}`);
    }
  }

  private handlePing(): void {
    if (!this.isConnected()) return;

    const message: WebSocketMessage = {
      type: MessageType.PONG,
    };

    this.ws!.send(JSON.stringify(message));
    this.resetHeartbeat();
  }

  private startHeartbeat(): void {
    this.resetHeartbeat();
  }

  private resetHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimeout = setTimeout(() => {
      if (this.isConnected()) {
        this.disconnect();
        this.options.onError?.("Heartbeat timeout");
      }
    }, HEARTBEAT_TIMEOUT);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private scheduleReconnect(): void {
    const delay =
      RECONNECT_DELAY_MS[
        Math.min(this.reconnectAttempt, RECONNECT_DELAY_MS.length - 1)
      ];

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect().catch((err) => {
        this.options.onError?.(
          `Reconnect attempt ${this.reconnectAttempt} failed: ${err.message}`
        );
      });
    }, delay);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}

// Singleton instance
let clientInstance: WebSocketClient | null = null;

export function getWebSocketClient(
  options?: WebSocketClientOptions
): WebSocketClient {
  if (!clientInstance) {
    clientInstance = new WebSocketClient(options);
  }
  return clientInstance;
}

export function resetWebSocketClient(): void {
  if (clientInstance) {
    clientInstance.disconnect();
    clientInstance = null;
  }
}
