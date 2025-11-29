// Constants
const DEFAULT_DU_VARIANT = 0x00;
const SESSION_ID_MIN = 10000;
const SESSION_ID_RANGE = 990000;
const SESSION_ID_PADDING_LENGTH = 40;
const SESSION_ID_PADDING_CHARS = 'c04b8f7b594cdeedebc2a8029b82943b0a620815';
const MIN_BUFFER_LENGTH = 2;

// Wire3 encoding boundaries
const WIRE3_ONE_BYTE_MAX = 215;
const WIRE3_TWO_BYTE_MAX = 9431;
const WIRE3_TWO_BYTE_OFFSET = 216;
const WIRE3_MARKER_2_BYTES = 252;
const WIRE3_MARKER_3_BYTES = 253;
const WIRE3_MARKER_4_BYTES = 254;
const WIRE3_MARKER_FLOAT64 = 255;

// Default connection options
const DEFAULT_MAX_RETRIES = 10;
const DEFAULT_RETRY_BASE_DELAY = 2000;
const DEFAULT_RETRY_MAX_DELAY = 15000;
const DEFAULT_INITIAL_DELAY_MAX = 1000;
const RETRY_EXPONENTIAL_BASE = 1.5;
const RETRY_JITTER_RANGE = 1000;
const READY_STATE_SYNC_INTERVAL = 100;

const generateSessionId = () => {
    const randomNum = Math.floor(Math.random() * SESSION_ID_RANGE) + SESSION_ID_MIN;
    return randomNum.toString().padEnd(SESSION_ID_PADDING_LENGTH, SESSION_ID_PADDING_CHARS);
};

const createSessionCookie = (sessionId = generateSessionId()) => `sid=${sessionId}`;

const extractSessionFromCookie = (cookieString) => {
    const match = cookieString.match(/sid=([^;]+)/);
    return match ? match[1] : null;
};

const getBrowserCookie = () => {
    if (typeof document !== 'undefined' && document.cookie) {
        return document.cookie;
    }
    return null;
};

// ============================================================================
// Wire3 Integer Encoding/Decoding
// ============================================================================

/**
 * Convert signed integer to unsigned using zigzag encoding.
 * Positive n -> 2n (even), Negative n -> -2n-1 (odd)
 * This ensures negative numbers don't require many bytes.
 */
const signedToUnsigned = (i) => {
    if (i < 0) {
        return -2 * i - 1;
    }
    return 2 * i;
};

/**
 * Convert unsigned integer back to signed (reverse zigzag).
 */
const unsignedToSigned = (i) => {
    if (i % 2 === 1) {
        return -Math.floor((i + 1) / 2);
    }
    return Math.floor(i / 2);
};

/**
 * Encode an unsigned integer using Wire3 format.
 *
 * Wire3 varint format:
 *   0-215:      1 byte  - raw value
 *   216-9431:   2 bytes - [216 + (n-216)/256, (n-216) % 256]
 *   <65536:     3 bytes - [252, high, low] (big-endian)
 *   <16777216:  4 bytes - [253, b2, b1, b0] (big-endian)
 *   <4294967296:5 bytes - [254, b3, b2, b1, b0] (big-endian)
 *   else:       9 bytes - [255, ...float64 LE]
 */
const encodeUnsignedInt = (n) => {
    if (n < 0) {
        throw new Error(`encodeUnsignedInt requires non-negative integer, got ${n}`);
    }

    if (n <= WIRE3_ONE_BYTE_MAX) {
        // 0-215: single byte
        return Buffer.from([n]);
    }

    if (n <= WIRE3_TWO_BYTE_MAX) {
        // 216-9431: two bytes
        const adjusted = n - WIRE3_TWO_BYTE_OFFSET;
        const b0 = WIRE3_TWO_BYTE_OFFSET + Math.floor(adjusted / 256);
        const b1 = adjusted % 256;
        return Buffer.from([b0, b1]);
    }

    if (n < 256 * 256) {
        // <65536: marker 252 + 2 bytes big-endian
        return Buffer.from([
            WIRE3_MARKER_2_BYTES,
            (n >> 8) & 0xFF,
            n & 0xFF
        ]);
    }

    if (n < 256 * 256 * 256) {
        // <16777216: marker 253 + 3 bytes big-endian
        return Buffer.from([
            WIRE3_MARKER_3_BYTES,
            (n >> 16) & 0xFF,
            (n >> 8) & 0xFF,
            n & 0xFF
        ]);
    }

    if (n < 256 * 256 * 256 * 256) {
        // <4294967296: marker 254 + 4 bytes big-endian
        return Buffer.from([
            WIRE3_MARKER_4_BYTES,
            (n >> 24) & 0xFF,
            (n >> 16) & 0xFF,
            (n >> 8) & 0xFF,
            n & 0xFF
        ]);
    }

    // Larger values: marker 255 + float64 little-endian
    const buf = Buffer.alloc(9);
    buf[0] = WIRE3_MARKER_FLOAT64;
    buf.writeDoubleLE(n, 1);
    return buf;
};

/**
 * Decode an unsigned integer from Wire3 format.
 * Returns { value, bytesRead }.
 */
const decodeUnsignedInt = (buffer, offset = 0) => {
    if (offset >= buffer.length) {
        throw new Error('Buffer too short for Wire3 int decode');
    }

    const b0 = buffer[offset];

    if (b0 <= WIRE3_ONE_BYTE_MAX) {
        // 0-215: single byte
        return { value: b0, bytesRead: 1 };
    }

    if (b0 < WIRE3_MARKER_2_BYTES) {
        // 216-251: two byte encoding
        if (offset + 1 >= buffer.length) {
            throw new Error('Buffer too short for 2-byte Wire3 int');
        }
        const b1 = buffer[offset + 1];
        const value = WIRE3_TWO_BYTE_OFFSET + (b0 - WIRE3_TWO_BYTE_OFFSET) * 256 + b1;
        return { value, bytesRead: 2 };
    }

    if (b0 === WIRE3_MARKER_2_BYTES) {
        // 252: 2 bytes following (big-endian)
        if (offset + 2 >= buffer.length) {
            throw new Error('Buffer too short for marker-252 Wire3 int');
        }
        const value = (buffer[offset + 1] << 8) | buffer[offset + 2];
        return { value, bytesRead: 3 };
    }

    if (b0 === WIRE3_MARKER_3_BYTES) {
        // 253: 3 bytes following (big-endian)
        if (offset + 3 >= buffer.length) {
            throw new Error('Buffer too short for marker-253 Wire3 int');
        }
        const value = (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3];
        return { value, bytesRead: 4 };
    }

    if (b0 === WIRE3_MARKER_4_BYTES) {
        // 254: 4 bytes following (big-endian)
        // Use multiplication to avoid signed 32-bit overflow issues
        if (offset + 4 >= buffer.length) {
            throw new Error('Buffer too short for marker-254 Wire3 int');
        }
        const value = buffer[offset + 1] * 0x1000000 +
                      buffer[offset + 2] * 0x10000 +
                      buffer[offset + 3] * 0x100 +
                      buffer[offset + 4];
        return { value, bytesRead: 5 };
    }

    if (b0 === WIRE3_MARKER_FLOAT64) {
        // 255: float64 following (little-endian)
        if (offset + 8 >= buffer.length) {
            throw new Error('Buffer too short for marker-255 Wire3 float64');
        }
        const value = buffer.readDoubleLE(offset + 1);
        return { value: Math.floor(value), bytesRead: 9 };
    }

    throw new Error(`Invalid Wire3 int marker: ${b0}`);
};

/**
 * Encode a signed integer using Wire3 format (zigzag + unsigned encoding).
 */
const encodeInt64 = (signedValue) => {
    const unsigned = signedToUnsigned(signedValue);
    return encodeUnsignedInt(unsigned);
};

/**
 * Decode a signed integer from Wire3 format.
 * Returns { value, bytesRead }.
 */
const decodeInt64 = (buffer, offset = 0) => {
    const { value: unsigned, bytesRead } = decodeUnsignedInt(buffer, offset);
    return { value: unsignedToSigned(unsigned), bytesRead };
};

// Legacy aliases for compatibility
const encodeVarint = encodeInt64;
const decodeVarint = decodeInt64;

// ============================================================================
// Wire3 String Encoding/Decoding
// ============================================================================

/**
 * Encode a string using Wire3 format: length (as signed int64) + UTF-8 bytes.
 */
const encodeString = (str) => {
    const strBuffer = Buffer.from(str, 'utf8');
    const lengthBuffer = encodeInt64(strBuffer.length);
    return Buffer.concat([lengthBuffer, strBuffer]);
};

/**
 * Decode a string from Wire3 format.
 * Returns { value, bytesRead }.
 */
const decodeString = (buffer, offset = 0) => {
    const { value: length, bytesRead: lengthBytes } = decodeInt64(buffer, offset);
    const strStart = offset + lengthBytes;
    const strEnd = strStart + length;

    if (strEnd > buffer.length) {
        throw new Error(`Buffer too short for string: need ${length} bytes, have ${buffer.length - strStart}`);
    }

    const value = buffer.slice(strStart, strEnd).toString('utf8');
    return { value, bytesRead: lengthBytes + length };
};

// ============================================================================
// Message Encoding (DU variant + string payload)
// ============================================================================

/**
 * Encode a message with DU variant tag + Wire3 string.
 */
const encodeMessage = (message, duVariant = DEFAULT_DU_VARIANT) => {
    const stringEncoded = encodeString(message);
    return Buffer.concat([
        Buffer.from([duVariant]),
        stringEncoded
    ]);
};

/**
 * Decode a message with DU variant tag + Wire3 string.
 */
const decodeMessage = (buffer, expectedDuVariant = DEFAULT_DU_VARIANT, debugLog = () => {}) => {
    debugLog('🔧 decodeMessage called:');
    debugLog('   Buffer length:', buffer.length);
    debugLog('   Buffer hex:', Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join(' '));
    debugLog('   Expected DuVariant:', expectedDuVariant);

    if (buffer.length < MIN_BUFFER_LENGTH) {
        debugLog('   ❌ Buffer too short');
        return null;
    }

    const actualDuVariant = buffer.readUInt8(0);
    debugLog('   Actual DuVariant:', actualDuVariant);

    if (actualDuVariant !== expectedDuVariant) {
        debugLog('   ❌ DuVariant mismatch');
        return null;
    }

    try {
        const { value: message, bytesRead } = decodeString(buffer, 1);
        debugLog('   ✅ Decoded message:', JSON.stringify(message));
        debugLog('   Total bytes read:', 1 + bytesRead);
        return message;
    } catch (e) {
        debugLog('   ❌ Decode error:', e.message);
        return null;
    }
};

const createTransportMessage = (sessionId, connectionId, message, duVariant = DEFAULT_DU_VARIANT) => {
    const encoded = encodeMessage(message, duVariant);
    return JSON.stringify({
        t: 'ToBackend',
        s: sessionId,
        c: connectionId || sessionId,
        b: encoded.toString('base64')
    });
};

const parseTransportMessage = (data, expectedDuVariant = DEFAULT_DU_VARIANT, debugLog = () => {}) => {
    try {
        const parsed = JSON.parse(data.toString('utf8'));
        
        if (parsed.t === 'e') {
            return {
                type: 'election',
                leaderId: parsed.l,
                data: parsed
            };
        }
        
        if (parsed.b) {
            const binaryData = Buffer.from(parsed.b, 'base64');
            const message = decodeMessage(binaryData, expectedDuVariant, debugLog);
            
            if (message !== null) {
                return {
                    type: 'message',
                    data: message,
                    sessionId: parsed.s,
                    connectionId: parsed.c
                };
            }
        }
        
        return {
            type: 'protocol',
            data: parsed,
            sessionId: parsed.s,
            connectionId: parsed.c
        };
        
    } catch (e) {
        return {
            type: 'error',
            error: e.message,
            rawData: data
        };
    }
};

const bufferToHex = (buffer) => 
    Array.from(buffer)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');

const getWebSocketImpl = async () => {
    if (typeof window !== 'undefined' && window.WebSocket) {
        return window.WebSocket;
    }
    
    try {
        const ws = await import('ws');
        return ws.default || ws;
    } catch (e) {
        throw new Error('WebSocket implementation not available. Install "ws" package for Node.js environments.');
    }
};

/**
 * LamderaWebSocket - WebSocket client that automatically disconnects when elected as leader
 * 
 * @param {string} url - WebSocket URL to connect to
 * @param {Array} protocols - WebSocket protocols
 * @param {Object} options - Configuration options
 * @param {boolean} [options.debug=false] - Enable debug logging
 * @param {number} [options.debugMaxChars=0] - Maximum characters to show in debug messages (0 = unlimited)
 * @param {number} [options.duVariant=0x00] - DU variant for message encoding
 * @param {number} [options.maxRetries=10] - Maximum retry attempts when becoming leader
 * @param {number} [options.retryBaseDelay=2000] - Base delay in ms for exponential backoff
 * @param {number} [options.retryMaxDelay=15000] - Maximum delay in ms between retries
 * @param {number} [options.initialDelayMax=1000] - Maximum initial delay in ms to reduce leadership probability
 * @param {string} [options.sessionId] - Custom session ID
 * @param {string} [options.cookie] - Custom cookie string
 */
class LamderaWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url, protocols = [], options = {}) {
        this.url = url;
        this.protocols = protocols;
        
        this.debug = options.debug || false;
        this.debugMaxChars = options.debugMaxChars || 0;
        this.duVariant = options.duVariant || DEFAULT_DU_VARIANT;
        this.maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
        this.retryBaseDelay = options.retryBaseDelay || DEFAULT_RETRY_BASE_DELAY;
        this.retryMaxDelay = options.retryMaxDelay || DEFAULT_RETRY_MAX_DELAY;
        this.initialDelayMax = options.initialDelayMax || DEFAULT_INITIAL_DELAY_MAX;
        
        if (options.cookie) {
            this.sessionId = extractSessionFromCookie(options.cookie) || generateSessionId();
            this.cookie = options.cookie;
        } else if (options.sessionId) {
            this.sessionId = options.sessionId;
            this.cookie = createSessionCookie(this.sessionId);
        } else {
            this.sessionId = generateSessionId();
            this.cookie = createSessionCookie(this.sessionId);
        }
        
        this.connectionId = null;
        this.clientId = null;
        this.leaderId = null;
        this.readyState = LamderaWebSocket.CONNECTING;
        this.bufferedAmount = 0;
        this.extensions = '';
        this.protocol = '';
        
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
        this.onsetup = null;
        this.onleaderdisconnect = null;
        
        this._ws = null;
        this._state = {
            setupCalled: false,
            isReady: false,
            retryCount: 0,
            retryTimeout: null,
            messageQueue: []
        };
        
        const initialDelay = Math.random() * this.initialDelayMax;
        this._debugLog(`⏳ Initial connection delay: ${initialDelay.toFixed(0)}ms to reduce leadership probability`);
        setTimeout(() => this._initWebSocket(), initialDelay);
    }
    
    _debugLog(...args) {
        if (this.debug) {
            const truncatedArgs = args.map(arg => {
                if (typeof arg === 'string' && this.debugMaxChars > 0) {
                    return arg.length > this.debugMaxChars 
                        ? arg.substring(0, this.debugMaxChars) + '...'
                        : arg;
                } else if (typeof arg === 'object' && this.debugMaxChars > 0) {
                    const jsonStr = JSON.stringify(arg);
                    return jsonStr.length > this.debugMaxChars
                        ? jsonStr.substring(0, this.debugMaxChars) + '...'
                        : jsonStr;
                }
                return arg;
            });
            console.log(...truncatedArgs);
        }
    }
    
    _getBoundedDebugLog() {
        return (...args) => {
            if (this.debug) {
                const truncatedArgs = args.map(arg => {
                    if (typeof arg === 'string' && this.debugMaxChars > 0) {
                        return arg.length > this.debugMaxChars 
                            ? arg.substring(0, this.debugMaxChars) + '...'
                            : arg;
                    }
                    return arg;
                });
                console.log(...truncatedArgs);
            }
        };
    }
    
    async _initWebSocket() {
        try {
            const WebSocketImpl = await getWebSocketImpl();
            
            const wsOptions = (typeof window === 'undefined') 
                ? { headers: { 'Cookie': this.cookie } }
                : undefined;
                
            this._ws = new WebSocketImpl(this.url, this.protocols, wsOptions);
            
            this._ws.onopen = (event) => {
                this._debugLog('🔌 Raw WebSocket opened, waiting for Lamdera handshake...');
                this.readyState = LamderaWebSocket.OPEN;
                this._state.isReady = true;
                
                while (this._state.messageQueue.length > 0) {
                    const message = this._state.messageQueue.shift();
                    this._ws.send(message);
                }
            };
            
            this._ws.onmessage = (event) => {
                this._debugLog('📨 Raw message received:', event.data);
                const parsed = parseTransportMessage(event.data, this.duVariant, this._getBoundedDebugLog());
                this._debugLog('🔍 Parsed message:', JSON.stringify(parsed, null, 2));
                
                if (parsed.type === 'protocol') {
                    this._debugLog('🔧 Protocol message received');
                    
                    if (parsed.connectionId) {
                        this._debugLog('   Connection ID in message:', parsed.connectionId);
                        
                        const wasInitialHandshake = !this.connectionId;
                        
                        if (wasInitialHandshake) {
                            this._debugLog('🤝 Initial Lamdera handshake');
                            this.connectionId = parsed.connectionId;
                            this.clientId = parsed.connectionId;
                            
                            if (this._state.retryCount > 0) {
                                this._debugLog('🔄 Reconnected after leader retry, resetting retry count');
                                this._state.retryCount = 0;
                            }
                            
                            this._debugLog('✅ Lamdera connection established, waiting for leader election');
                            if (this.onopen) this.onopen(event);
                            
                            if (this.onsetup && !this._state.setupCalled) {
                                this._state.setupCalled = true;
                                this.onsetup({
                                    clientId: this.clientId,
                                    leaderId: this.leaderId,
                                    isLeader: false
                                });
                            }
                        }
                    } else {
                        this._debugLog('   No connectionId in protocol message');
                    }
                }
                
                if (parsed.type === 'election') {
                    this._debugLog('🗳️ Leader election message received');
                    this._debugLog('   New Leader ID:', parsed.leaderId);
                    this._debugLog('   My Client ID:', this.clientId);
                    
                    if (this._applyLeaderStatusChange(this._evaluateLeaderStatus(parsed.leaderId))) return;
                }
                
                if (parsed.type === 'message' && this.onmessage) {
                    this._debugLog('📥 Application message:', parsed.data);
                    this.onmessage({
                        data: parsed.data,
                        type: 'message',
                        target: this,
                        origin: event.origin || '',
                        lastEventId: '',
                        source: null,
                        ports: []
                    });
                }
                
                if (parsed.type === 'error') {
                    console.log('❌ Message parsing error:', parsed.error);
                }
            };
            
            this._ws.onclose = (event) => {
                this.readyState = LamderaWebSocket.CLOSED;
                if (this.onclose) this.onclose(event);
            };
            
            this._ws.onerror = (event) => {
                if (this.onerror) this.onerror(event);
            };
            
            const syncReadyState = () => {
                if (this._ws) {
                    this.readyState = this._ws.readyState;
                    this.bufferedAmount = this._ws.bufferedAmount || 0;
                }
                if (this.readyState !== LamderaWebSocket.CLOSED) {
                    setTimeout(syncReadyState, READY_STATE_SYNC_INTERVAL);
                }
            };
            syncReadyState();
            
        } catch (error) {
            this.readyState = LamderaWebSocket.CLOSED;
            if (this.onerror) {
                this.onerror({ 
                    type: 'error', 
                    error, 
                    target: this 
                });
            }
        }
    }
    
    _calculateRetryDelay() {
        const exponential = this.retryBaseDelay * Math.pow(RETRY_EXPONENTIAL_BASE, this._state.retryCount - 1);
        const jitter = Math.random() * RETRY_JITTER_RANGE; // 0-1s random
        return Math.min(exponential + jitter, this.retryMaxDelay);
    }
    
    _evaluateLeaderStatus(newLeaderId) {
        if (!newLeaderId || !this.clientId) return null;
        
        return {
            previousLeader: this.leaderId,
            newLeader: newLeaderId,
            iAmLeader: this.clientId === newLeaderId,
            action: this.clientId === newLeaderId ? 'disconnect' : 'continue'
        };
    }
    
    _applyLeaderStatusChange(evaluation) {
        if (!evaluation) return false;
        
        this._debugLog('🗳️ Leader status evaluation:', {
            previous: evaluation.previousLeader,
            new: evaluation.newLeader,
            iAmLeader: evaluation.iAmLeader,
            action: evaluation.action
        });
        
        this.leaderId = evaluation.newLeader;
        
        if (evaluation.action === 'disconnect') {
            console.log('⚠️ Detected leader role, disconnecting...');
            this._handleLeaderDisconnection();
            return true;
        }
        
        return false;
    }
    
    _handleLeaderDisconnection() {
        this._state.retryCount++;
        console.log(`🔄 Leader disconnection attempt ${this._state.retryCount}/${this.maxRetries}`);
        
        this.readyState = LamderaWebSocket.CONNECTING;
        this._disconnectInternal();
        
        if (this._state.retryCount <= this.maxRetries) {
            const retryDelay = this._calculateRetryDelay();
            console.log(`⏳ Retrying connection in ${(retryDelay/1000).toFixed(1)}s with new session...`);
            this._state.retryTimeout = setTimeout(() => {
                this.sessionId = generateSessionId();
                this.cookie = createSessionCookie(this.sessionId);
                this._debugLog(`🆕 New session ID: ${this.sessionId}`);
                this._state.setupCalled = false;
                this._initWebSocket();
            }, retryDelay);
        } else {
            console.log(`🚫 Max retries (${this.maxRetries}) exceeded, giving up`);
            this.readyState = LamderaWebSocket.CLOSED;
            if (this.onleaderdisconnect) {
                this.onleaderdisconnect({
                    type: 'leaderdisconnect',
                    retryCount: this._state.retryCount,
                    target: this
                });
            }
        }
    }
    
    _disconnectInternal() {
        if (this._state.retryTimeout) {
            clearTimeout(this._state.retryTimeout);
            this._state.retryTimeout = null;
        }
        
        if (this._ws) {
            this._ws.onopen = null;
            this._ws.onmessage = null;
            this._ws.onclose = null;
            this._ws.onerror = null;
            this._ws.close();
            this._ws = null;
        }
        
        this._state.isReady = false;
        this._state.messageQueue = [];
        this.connectionId = null;
        this.clientId = null;
        this.leaderId = null;
    }
    
    send(data) {
        if (this._state.retryCount > 0 && this._state.retryCount <= this.maxRetries) {
            this._debugLog('🚫 Blocking send - retrying connection due to leader role');
            return;
        }
        
        if (this.readyState === LamderaWebSocket.CONNECTING) {
            const transportMessage = createTransportMessage(this.sessionId, this.connectionId, data, this.duVariant);
            this._debugLog('📤 Queuing message while connecting:', data);
            this._state.messageQueue.push(transportMessage);
            return;
        }
        
        if (this.readyState !== LamderaWebSocket.OPEN) {
            throw new Error(`WebSocket is not open: readyState ${this.readyState}`);
        }
        
        const transportMessage = createTransportMessage(this.sessionId, this.connectionId, data, this.duVariant);
        this._debugLog('📤 Sending message:', data);
        this._debugLog('   Transport format:', transportMessage);
        this._ws.send(transportMessage);
    }
    
    close(code, reason) {
        if (this._state.retryTimeout) {
            clearTimeout(this._state.retryTimeout);
            this._state.retryTimeout = null;
        }
        
        this.readyState = LamderaWebSocket.CLOSING;
        if (this._ws) {
            this._ws.close(code, reason);
        } else {
            this.readyState = LamderaWebSocket.CLOSED;
        }
    }
    
    get CONNECTING() { return LamderaWebSocket.CONNECTING; }
    get OPEN() { return LamderaWebSocket.OPEN; }
    get CLOSING() { return LamderaWebSocket.CLOSING; }
    get CLOSED() { return LamderaWebSocket.CLOSED; }
}

const createLamderaWebSocket = async (url, sessionId = generateSessionId()) => {
    return new LamderaWebSocket(url, [], { sessionId });
};

module.exports = {
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

    // Constants (useful for testing)
    WIRE3_ONE_BYTE_MAX,
    WIRE3_TWO_BYTE_MAX,
    WIRE3_TWO_BYTE_OFFSET,
    WIRE3_MARKER_2_BYTES,
    WIRE3_MARKER_3_BYTES,
    WIRE3_MARKER_4_BYTES,
    WIRE3_MARKER_FLOAT64
}; 