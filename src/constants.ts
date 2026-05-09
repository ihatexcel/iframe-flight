export const PROTOCOL_VERSION = '1.0.0';

export const State = {
  INIT: 'INIT',
  CONNECTING: 'CONNECTING',
  READY: 'READY',
  SENDING: 'SENDING',
  RECEIVING: 'RECEIVING',
  ERROR: 'ERROR',
  CLOSED: 'CLOSED',
} as const;

export type StateValue = (typeof State)[keyof typeof State];

export const ListenMode = {
  FIRST_MESSAGE: 'FIRST_MESSAGE',
  CONTINUOUS: 'CONTINUOUS',
} as const;

export type ListenModeValue = (typeof ListenMode)[keyof typeof ListenMode];

export const MessageType = {
  CHILD_READY: 'CHILD_READY',
  PARENT_ACK: 'PARENT_ACK',
  DATA_TRANSFER: 'DATA_TRANSFER',
  DATA_RECEIVED: 'DATA_RECEIVED',
  PING: 'PING',
  PONG: 'PONG',
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];
