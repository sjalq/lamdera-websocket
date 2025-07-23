// Constants
const DEFAULT_DU_VARIANT = 0x00;
const SESSION_ID_MIN = 10000;
const SESSION_ID_RANGE = 990000;
const SESSION_ID_PADDING_LENGTH = 40;
const SESSION_ID_PADDING_CHARS = 'c04b8f7b594cdeedebc2a8029b82943b0a620815';
const MIN_BUFFER_LENGTH = 2;
const MAX_VARINT_BYTES = 5;

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

const encodeVarint = (value) => {
    const bytes = [];
    while (value >= 0x80) {
        bytes.push((value & 0x7F) | 0x80);
        value >>>= 7;
    }
    bytes.push(value & 0x7F);
    return Buffer.from(bytes);
};

const decodeVarint = (buffer, offset = 0) => {
    let result = 0;
    let shift = 0;
    let bytesRead = 0;
    
    for (let i = offset; i < buffer.length && bytesRead < MAX_VARINT_BYTES; i++, bytesRead++) {
        const byte = buffer[i];
        result |= (byte & 0x7F) << shift;
        
        if ((byte & 0x80) === 0) {
            return { value: result, bytesRead: bytesRead + 1 };
        }
        shift += 7;
    }
    throw new Error('Invalid varint');
};

const encodeMessage = (message, duVariant = DEFAULT_DU_VARIANT) => { 
    const messageBuffer = Buffer.from(message, 'utf8');
    const length = messageBuffer.length;
    const lengthBuffer = encodeVarint(length * 2);
    
    return Buffer.concat([
        Buffer.from([duVariant]),
        lengthBuffer,
        messageBuffer
    ]);
};

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
        const { value: encodedLength, bytesRead } = decodeVarint(buffer, 1);
        const headerLength = 1 + bytesRead;
        const actualMessageLength = buffer.length - headerLength;
        
        // Most messages have length doubled, but some don't
        // Messages with large varint values (like 5208 for 128 bytes) use a different encoding
        // These appear to use a factor of roughly 40.7 instead of 2
        let declaredLength;
        
        // Check if this looks like the weird encoding (varint way larger than actual length)
        if (encodedLength > actualMessageLength * 10) {
            // This is the weird encoding where length ≈ varint / 40.7
            declaredLength = Math.round(encodedLength / 40.6875);
            debugLog('   Using special encoding (÷40.6875)');
        } else if (Math.abs(encodedLength / 2 - actualMessageLength) < 1) {
            // Standard doubled length
            declaredLength = Math.floor(encodedLength / 2);
        } else if (Math.abs(encodedLength - actualMessageLength) < 1) {
            // Raw length (not doubled)
            declaredLength = encodedLength;
        } else {
            // Default to divided by 2
            declaredLength = encodedLength / 2;
        }
        
        debugLog('   Varint value:', encodedLength);
        debugLog('   Declared length (÷2):', declaredLength);
        debugLog('   Varint bytes used:', bytesRead);
        debugLog('   Header length:', headerLength);
        debugLog('   Actual message bytes available:', actualMessageLength);
        
        if (actualMessageLength < declaredLength) {
            debugLog(`   ❌ Not enough message bytes: declared ${declaredLength}, available ${actualMessageLength} (short by ${declaredLength - actualMessageLength})`);
            return null;
        }
        
        const message = buffer.slice(headerLength, headerLength + declaredLength).toString('utf8');
        debugLog('   ✅ Decoded message:', JSON.stringify(message));
        
        return message;
    } catch (e) {
        debugLog('   ❌ Varint decode error:', e.message);
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
    LamderaWebSocket,
    generateSessionId,
    createSessionCookie,
    extractSessionFromCookie,
    getBrowserCookie,
    encodeVarint,
    decodeVarint,
    encodeMessage,
    decodeMessage,
    createTransportMessage,
    parseTransportMessage,
    bufferToHex,
    createLamderaWebSocket
}; 