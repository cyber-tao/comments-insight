/**
 * Handler type definitions
 * Defines function signatures and related types for message handlers
 */

import type { Message, MessageType } from './messages';

/**
 * Port message with correlation ID
 * Used for request-response pattern over long-lived connections
 */
export interface PortMessage {
  /** Message type */
  type: MessageType;
  /** Unique identifier for correlating requests and responses */
  id: string;
  /** Message payload */
  payload?: unknown;
}

/**
 * Port message response
 */
export interface PortMessageResponse {
  /** Correlation ID matching the request */
  id: string;
  /** Response data */
  response: unknown;
}

/**
 * Port message error response
 */
export interface PortMessageErrorResponse {
  /** Correlation ID */
  id: string;
  /** Error response */
  response: {
    error: string;
  };
}

/**
 * Message handler function type
 * @template T - Message type
 * @template R - Return type
 */
export type MessageHandler<T extends Message = Message, R = unknown> = (
  message: T,
  sender: chrome.runtime.MessageSender,
) => Promise<R>;

/**
 * Port message handler function type
 */
export type PortMessageHandler = (port: chrome.runtime.Port, message: PortMessage) => Promise<void>;

/**
 * Extraction result type
 */
export interface ExtractionResult {
  tokensUsed: number;
  commentsCount: number;
}

/**
 * Promise resolver type for async task completion
 */
export interface TaskResolver<T = ExtractionResult> {
  resolve: (value: T) => void;
  reject: (reason?: Error) => void;
}
