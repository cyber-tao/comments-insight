/**
 * Handler type definitions
 * Defines function signatures and related types for message handlers
 */

import type { ExtensionErrorPayload } from '@/utils/error-types';
import type { Message, MessageType } from './messages';

export const PORT_CANCEL_MESSAGE_TYPE = 'CANCEL_AI_REQUEST' as const;
export const PORT_ACTIVITY_MESSAGE_TYPE = 'AI_REQUEST_ACTIVITY' as const;

export interface PortActivityMessage {
  type: typeof PORT_ACTIVITY_MESSAGE_TYPE;
  id: string;
}

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

export interface PortCancelMessage {
  type: typeof PORT_CANCEL_MESSAGE_TYPE;
  id: string;
}

export type AIBridgeMessage = PortMessage | PortCancelMessage;

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
    error: ExtensionErrorPayload;
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
