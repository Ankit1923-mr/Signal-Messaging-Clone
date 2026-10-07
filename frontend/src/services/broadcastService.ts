/**
 * BroadcastChannel Service
 *
 * Synchronizes UI state across browser tabs:
 * - Selected conversation
 * - Read/unread state
 *
 * Message state syncs via WebSocket to all tabs automatically.
 * BroadcastChannel only syncs pure UI state that doesn't go through the server.
 */

type BroadcastMessage =
  | { type: "conversation-selected"; conversationId: number }
  | { type: "conversation-read"; conversationId: number };

type BroadcastHandler = (message: BroadcastMessage) => void;

class BroadcastChannelService {
  private channel: BroadcastChannel | null = null;
  private handlers: Set<BroadcastHandler> = new Set();

  constructor() {
    // Initialize only if BroadcastChannel is supported
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        this.channel = new BroadcastChannel("signal-messaging");
        this.channel.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (err) {
        // BroadcastChannel may fail in some contexts (private windows)
        console.debug("BroadcastChannel unavailable");
      }
    }
  }

  /**
   * Subscribe to broadcast messages
   */
  subscribe(handler: BroadcastHandler): void {
    this.handlers.add(handler);
  }

  /**
   * Unsubscribe from broadcast messages
   */
  unsubscribe(handler: BroadcastHandler): void {
    this.handlers.delete(handler);
  }

  /**
   * Broadcast conversation selected
   */
  broadcastConversationSelected(conversationId: number): void {
    this.post({
      type: "conversation-selected",
      conversationId,
    });
  }

  /**
   * Broadcast conversation marked as read
   */
  broadcastConversationRead(conversationId: number): void {
    this.post({
      type: "conversation-read",
      conversationId,
    });
  }

  /**
   * Cleanup (for unmount or logout)
   */
  close(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.handlers.clear();
  }

  // ============================================================================
  // PRIVATE
  // ============================================================================

  private post(message: BroadcastMessage): void {
    if (!this.channel) return;

    try {
      this.channel.postMessage(message);
    } catch (err) {
      console.debug("Failed to post message to BroadcastChannel");
    }
  }

  private handleMessage(message: BroadcastMessage): void {
    this.handlers.forEach((handler) => {
      try {
        handler(message);
      } catch (err) {
        console.error("Error in BroadcastChannel handler:", err);
      }
    });
  }
}

// Singleton instance
let serviceInstance: BroadcastChannelService | null = null;

export function getBroadcastService(): BroadcastChannelService {
  if (!serviceInstance) {
    serviceInstance = new BroadcastChannelService();
  }
  return serviceInstance;
}

export function closeBroadcastService(): void {
  if (serviceInstance) {
    serviceInstance.close();
    serviceInstance = null;
  }
}
