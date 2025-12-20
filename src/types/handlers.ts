/**
 * 处理器类型定义
 * 定义消息处理器的函数签名和相关类型
 */

import type { Message, MessageType } from './messages';

/**
 * 带有关联 ID 的端口消息
 * 用于长连接消息的请求-响应模式
 */
export interface PortMessage {
  /** 消息类型 */
  type: MessageType;
  /** 用于关联请求和响应的唯一标识符 */
  id: string;
  /** 消息载荷 */
  payload?: unknown;
}

/**
 * 端口消息响应
 */
export interface PortMessageResponse {
  /** 关联 ID，与请求中的 id 对应 */
  id: string;
  /** 响应数据 */
  response: unknown;
}

/**
 * 端口消息错误响应
 */
export interface PortMessageErrorResponse {
  /** 关联 ID */
  id: string;
  /** 错误响应 */
  response: {
    error: string;
  };
}

/**
 * 消息处理器函数类型
 * @template T - 消息类型
 * @template R - 返回类型
 */
export type MessageHandler<T extends Message = Message, R = unknown> = (
  message: T,
  sender: chrome.runtime.MessageSender,
) => Promise<R>;

/**
 * 端口消息处理器函数类型
 */
export type PortMessageHandler = (port: chrome.runtime.Port, message: PortMessage) => Promise<void>;

/**
 * 提取结果类型
 */
export interface ExtractionResult {
  tokensUsed: number;
  commentsCount: number;
}

/**
 * Promise 解析器类型
 */
export interface TaskResolver<T = ExtractionResult> {
  resolve: (value: T) => void;
  reject: (reason?: Error) => void;
}
