# Lamdera WebSocket

WebSocket library for Lamdera with wire format handling and automatic leader election avoidance. Enables JSON-RPC implementation in Lamdera backends to overcome HTTP limitations using single String messages on 0x00 DU variants for ToFrontend and ToBackend messages.

## Installation

```bash
npm install lamdera-websocket
```

The `ws` package for Node.js is included as a dependency and will be installed automatically.

## Wire Format Compatibility

This library uses Lamdera's **Wire3** format. While Wire3 is not guaranteed in future Lamdera versions, updating this library to support newer wire formats should be relatively trivial due to its modular design.

## Usage

### Basic Usage

```javascript
import { LamderaWebSocket } from 'lamdera-websocket';

const ws = new LamderaWebSocket('ws://localhost:8000/_w', [], {
    debug: true,
    maxRetries: 5,
    initialDelayMax: 2000
});

ws.onopen = () => {
    console.log('Connected to Lamdera');
    ws.send('Hello Lamdera!');
};

ws.onmessage = (event) => {
    console.log('Received:', event.data);
};

ws.onsetup = (info) => {
    console.log('Setup complete:', info.clientId);
};

ws.onleaderdisconnect = (event) => {
    console.log('Disconnected to avoid becoming leader after', event.retryCount, 'retries');
};
```

### Lamdera Backend JSON-RPC Implementation

This library enables JSON-RPC implementation in Lamdera backends to overcome HTTP limitations:

```elm
-- Backend handles JSON-RPC requests via WebSocket
updateFromFrontend browserCookie connectionId msg model =
    case msg of
        A00_WebSocketReceive jsonRpcRequest ->
            let
                response = processJsonRpcRequest jsonRpcRequest
            in
            ( model
            , Lamdera.sendToFrontend connectionId (A00_WebSocketSend response)
            )

processJsonRpcRequest : String -> String
processJsonRpcRequest request =
    -- Parse JSON-RPC request and return JSON-RPC response
    case decodeJsonRpcRequest request of
        Ok { method = "getUserData", params, id } ->
            encodeJsonRpcResponse id (Ok userData)
        
        Err error ->
            encodeJsonRpcError id error
```

### TypeScript Usage

```typescript
import { LamderaWebSocket, LamderaWebSocketOptions } from 'lamdera-websocket';

const options: LamderaWebSocketOptions = {
    debug: true,
    sessionId: 'custom-session-id',
    duVariant: 0x00,
    maxRetries: 10,
    retryBaseDelay: 2000,
    retryMaxDelay: 15000,
    initialDelayMax: 1000
};

const ws = new LamderaWebSocket('wss://my-app.lamdera.app/_w', [], options);
```

### Session Management

```javascript
import { 
    LamderaWebSocket,
    generateSessionId,
    createSessionCookie,
    extractSessionFromCookie,
    getBrowserCookie
} from 'lamdera-websocket';

// Generate custom session
const sessionId = generateSessionId();
const cookie = createSessionCookie(sessionId);

// Extract session from existing cookie
const existingCookie = 'sid=12345; other=value';
const extractedSession = extractSessionFromCookie(existingCookie);

// Create WebSocket with existing cookie
const ws = new LamderaWebSocket('wss://my-app.lamdera.app/_w', [], { 
    cookie: 'sid=existing-session',
    debug: true
});
```

## Lamdera Message Requirements

This library will **ONLY** work correctly if your Lamdera types include lexicographically first WebSocket message variants:

```elm
-- In Types.elm - ToBackend MUST have lexicographically first message
type ToBackend
    = A00_WebSocketReceive String  -- Must be first alphabetically
    | AuthToBackend Auth.Common.ToBackend
    | GetUserToBackend
    -- ... other messages

-- ToFrontend MUST have lexicographically first message  
type ToFrontend
    = A00_WebSocketSend String     -- Must be first alphabetically
    | AuthToFrontend Auth.Common.ToFrontend
    | UserDataToFrontend UserFrontend
    -- ... other messages
```

The `A00_` prefix ensures these messages use DU variant 0x00, which this library expects. Without this naming pattern, the library will not function correctly.

## API Reference

### LamderaWebSocket

Drop-in replacement for native WebSocket with Lamdera wire format support and leader election avoidance.

**Constructor:**
- `url`: WebSocket URL
- `protocols`: Optional protocols array
- `options`: Configuration object
  - `debug?: boolean` - Enable debug logging (default: false)
  - `sessionId?: string` - Custom session ID
  - `cookie?: string` - Full cookie string (extracts session ID automatically)
  - `duVariant?: number` - Custom DU variant (default: 0x00)
  - `maxRetries?: number` - Maximum retry attempts when becoming leader (default: 10)
  - `retryBaseDelay?: number` - Base delay in ms for exponential backoff (default: 2000)
  - `retryMaxDelay?: number` - Maximum delay in ms between retries (default: 15000)
  - `initialDelayMax?: number` - Maximum initial delay in ms (default: 1000)

**Methods:**
- `send(data)`: Send message
- `close(code?, reason?)`: Close connection

**Properties:**
- `readyState`: Connection state
- `sessionId`: Current session ID
- `clientId`: Current client ID
- `leaderId`: Current leader ID

**Event Handlers:**
- `onopen`: Connection established
- `onmessage`: Message received
- `onclose`: Connection closed
- `onerror`: Error occurred
- `onsetup`: Initial handshake complete
- `onleaderdisconnect`: Disconnected to avoid leader role

### Utility Functions

- `generateSessionId()`: Generate random session ID
- `createSessionCookie(sessionId?)`: Create session cookie
- `extractSessionFromCookie(cookieString)`: Extract session ID from cookie string
- `getBrowserCookie()`: Get browser's document.cookie (browser only)
- `encodeMessage(message, duVariant?)`: Encode to Lamdera format
- `decodeMessage(buffer, expectedDuVariant?)`: Decode from Lamdera format
- `createTransportMessage(sessionId, connectionId, message, duVariant?)`: Create transport wrapper
- `parseTransportMessage(data, expectedDuVariant?, debugLog?)`: Parse transport message

## Leader Election Avoidance

The library actively tries to **avoid** becoming the leader to prevent disrupting `lamdera live` development sessions. When a client detects it might become the leader (the green dot browser instance that hosts the backend), it will:

1. Automatically disconnect to avoid taking over
2. Generate a new session ID
3. Retry connection with exponential backoff and jitter
4. Give up after `maxRetries` attempts

This ensures the development environment remains stable while allowing multiple WebSocket connections for testing.

## Environment Support

- **Browser**: Uses native WebSocket
- **Node.js**: Uses 'ws' package (included as dependency)

## Wire Format

Handles Lamdera's Wire3 binary format transparently:
- Byte 0: DU variant index (must be 0x00)
- Byte 1+: Varint-encoded string length (×2)
- Remaining: UTF-8 message data

## Technical Features

- **Leader Election Avoidance**: Automatically prevents disrupting `lamdera live` sessions¹
- **Retry Logic**: Exponential backoff with jitter for robust reconnection²
- **Session Management**: Automatic session ID generation and cookie handling³
- **Debug Support**: Comprehensive logging for development⁴
- **JSON-RPC Ready**: Enables JSON-RPC implementation in Lamdera backends⁵
- **Cross-Platform**: Works in both browser and Node.js environments⁶

---

¹ Avoids becoming the leader client that would disrupt development sessions  
² Intelligent reconnection with increasing delays and randomization  
³ Handles browser cookies and session persistence automatically  
⁴ Detailed logging available with `debug: true` option  
⁵ Overcomes HTTP limitations by enabling RPC over WebSocket  
⁶ Automatic WebSocket implementation detection and fallback

## License

MIT 