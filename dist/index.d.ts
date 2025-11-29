interface LamderaWebSocketOptions {
  debug?: boolean;
  debugMaxChars?: number;
  duVariant?: number;
  maxRetries?: number;
  retryBaseDelay?: number;
  retryMaxDelay?: number;
  initialDelayMax?: number;
  sessionId?: string;
  cookie?: string;
}

interface SetupEvent {
  clientId: string;
  leaderId: string | null;
  isLeader: boolean;
}

interface LeaderDisconnectEvent {
  type: 'leaderdisconnect';
  retryCount: number;
  target: LamderaWebSocket;
}

interface TransportMessage {
  type: 'message' | 'protocol' | 'election' | 'error';
  data?: string | object;
  sessionId?: string;
  connectionId?: string;
  leaderId?: string;
  error?: string;
  rawData?: any;
}

interface MessageEvent {
  data: string;
  type: string;
  target: LamderaWebSocket;
  origin: string;
  lastEventId: string;
  source: null;
  ports: never[];
}

interface CloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

interface ErrorEvent {
  type: string;
  error?: Error;
  target: LamderaWebSocket;
}

interface DecodeResult<T> {
  value: T;
  bytesRead: number;
}

declare class LamderaWebSocket {
  static readonly CONNECTING: 0;
  static readonly OPEN: 1;
  static readonly CLOSING: 2;
  static readonly CLOSED: 3;

  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;

  url: string;
  protocols: string | string[];
  readyState: number;
  bufferedAmount: number;
  extensions: string;
  protocol: string;
  sessionId: string;
  connectionId: string | null;
  clientId: string | null;
  leaderId: string | null;

  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onsetup: ((event: SetupEvent) => void) | null;
  onleaderdisconnect: ((event: LeaderDisconnectEvent) => void) | null;

  constructor(url: string, protocols?: string | string[], options?: LamderaWebSocketOptions);

  send(data: string): void;
  close(code?: number, reason?: string): void;
}

// Session management
declare function generateSessionId(): string;
declare function createSessionCookie(sessionId?: string): string;
declare function extractSessionFromCookie(cookieString: string): string | null;
declare function getBrowserCookie(): string | null;

// Wire3 zigzag encoding
declare function signedToUnsigned(i: number): number;
declare function unsignedToSigned(i: number): number;

// Wire3 unsigned integer encoding/decoding
declare function encodeUnsignedInt(n: number): Buffer;
declare function decodeUnsignedInt(buffer: Buffer, offset?: number): DecodeResult<number>;

// Wire3 signed integer encoding/decoding (with zigzag)
declare function encodeInt64(signedValue: number): Buffer;
declare function decodeInt64(buffer: Buffer, offset?: number): DecodeResult<number>;

// Legacy aliases
declare function encodeVarint(signedValue: number): Buffer;
declare function decodeVarint(buffer: Buffer, offset?: number): DecodeResult<number>;

// Wire3 string encoding/decoding
declare function encodeString(str: string): Buffer;
declare function decodeString(buffer: Buffer, offset?: number): DecodeResult<string>;

// Message encoding (DU variant + payload)
declare function encodeMessage(message: string, duVariant?: number): Buffer;
declare function decodeMessage(buffer: Buffer, expectedDuVariant?: number, debugLog?: (...args: any[]) => void): string | null;

// Transport layer
declare function createTransportMessage(sessionId: string, connectionId: string | null, message: string, duVariant?: number): string;
declare function parseTransportMessage(data: string | Buffer, expectedDuVariant?: number, debugLog?: (...args: any[]) => void): TransportMessage;

// Utilities
declare function bufferToHex(buffer: Buffer): string;
declare function createLamderaWebSocket(url: string, sessionId?: string): Promise<LamderaWebSocket>;

// Wire3 constants
declare const WIRE3_ONE_BYTE_MAX: 215;
declare const WIRE3_TWO_BYTE_MAX: 9431;
declare const WIRE3_TWO_BYTE_OFFSET: 216;
declare const WIRE3_MARKER_2_BYTES: 252;
declare const WIRE3_MARKER_3_BYTES: 253;
declare const WIRE3_MARKER_4_BYTES: 254;
declare const WIRE3_MARKER_FLOAT64: 255;

export {
  // WebSocket client
  LamderaWebSocket,
  createLamderaWebSocket,

  // Session management
  generateSessionId,
  createSessionCookie,
  extractSessionFromCookie,
  getBrowserCookie,

  // Wire3 integer encoding/decoding
  signedToUnsigned,
  unsignedToSigned,
  encodeUnsignedInt,
  decodeUnsignedInt,
  encodeInt64,
  decodeInt64,

  // Legacy aliases
  encodeVarint,
  decodeVarint,

  // Wire3 string encoding/decoding
  encodeString,
  decodeString,

  // Message encoding (DU variant + payload)
  encodeMessage,
  decodeMessage,

  // Transport layer
  createTransportMessage,
  parseTransportMessage,

  // Utilities
  bufferToHex,

  // Constants
  WIRE3_ONE_BYTE_MAX,
  WIRE3_TWO_BYTE_MAX,
  WIRE3_TWO_BYTE_OFFSET,
  WIRE3_MARKER_2_BYTES,
  WIRE3_MARKER_3_BYTES,
  WIRE3_MARKER_4_BYTES,
  WIRE3_MARKER_FLOAT64,

  // Types
  LamderaWebSocketOptions,
  SetupEvent,
  LeaderDisconnectEvent,
  TransportMessage,
  MessageEvent,
  CloseEvent,
  ErrorEvent,
  DecodeResult
};
