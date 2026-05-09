export type { StateValue, ListenModeValue, MessageTypeValue } from './constants';
import type { StateValue, ListenModeValue } from './constants';

export interface BridgeMessage {
  type: string;
  protocolVersion: string;
  messageId: string;
  timestamp: number;
  source: string;
  correlationId: string | null;
  priority?: number;
  ttl?: number | null;
  compressed?: boolean;
  [key: string]: unknown;
}

export interface DataTransferMessage extends BridgeMessage {
  format: 'arrow-zerocopy' | 'arrow-copy' | 'json';
  data?: unknown;
  sharedBuffer?: SharedArrayBuffer;
  offset?: number;
  length?: number;
  schema?: string | null;
}

export interface DataReceivedMessage extends BridgeMessage {
  success: boolean;
  format?: string;
  rows?: number;
  cols?: number;
  processingTime?: number;
  isZeroCopy?: boolean;
  error?: string;
}

export interface ArrowTable {
  numRows: number;
  numCols: number;
}

export interface DataResult {
  format: string;
  rows: number;
  cols: number;
  size: number;
  isZeroCopy: boolean;
  messageId: string;
  timestamp: number;
  correlationId: string | null;
  processingTime?: number;
  schema?: string | null;
  table?: ArrowTable;
  data?: unknown;
}

export interface AckResult {
  success: boolean;
  format?: string;
  rows?: number;
  cols?: number;
  processingTime?: number;
  isZeroCopy?: boolean;
}

export interface ParentEmitterConfig {
  handshakeTimeout?: number;
  ackTimeout?: number;
  retryAttempts?: number;
  sourceId?: string;
  allowedOrigins?: string[];
  compression?: boolean;
}

export interface ChildReceiverConfig {
  listenMode?: ListenModeValue;
  listenDelay?: number;
  sourceId?: string;
  allowedOrigins?: string[];
  compression?: boolean;
}

export interface SendOptions {
  format?: 'auto' | 'arrow-zerocopy' | 'arrow-copy' | 'json';
  correlationId?: string;
  priority?: number;
  ttl?: number;
  schema?: string;
  compress?: boolean;
  messageId?: string;
  compressed?: boolean;
}

export type StateChangeCallback = (newState: StateValue, oldState: StateValue) => void;
export type ErrorCallback = (error: Error) => void;
export type ReadyCallback = () => void;
export type DataCallback = (result: DataResult) => void;

export interface PendingAck {
  resolve: (value: AckResult) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

declare global {
  interface Window {
    Arrow?: {
      tableFromIPC: (buffer: Uint8Array) => ArrowTable;
    };
  }
}
