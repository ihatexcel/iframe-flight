export { ArrowParentEmitter } from './ArrowParentEmitter';
export { ArrowChildReceiver } from './ArrowChildReceiver';
export { BridgeUtils } from './utils';
export { MessageManager } from './MessageManager';
export { MessageBuffer } from './MessageBuffer';
export { State, ListenMode, MessageType, PROTOCOL_VERSION } from './constants';
export type {
  StateValue,
  ListenModeValue,
  MessageTypeValue,
  DataResult,
  AckResult,
  ParentEmitterConfig,
  ChildReceiverConfig,
  SendOptions,
  StateChangeCallback,
  ErrorCallback,
  ReadyCallback,
  DataCallback,
} from './types';

// Re-export Apache Arrow so consumers only need iframe-flight
export {
  tableFromIPC,
  tableToIPC,
  tableFromArrays,
  Table,
  Schema,
  Field,
  RecordBatch,
  RecordBatchReader,
  RecordBatchWriter,
} from 'apache-arrow';
