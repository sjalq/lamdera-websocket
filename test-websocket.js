/**
 * LamderaWebSocket Test Suite
 * 
 * Usage:
 *   node test-websocket.js                    // Run all tests (default)
 *   node test-websocket.js --testConnect      // Connection/disconnection test only
 *   node test-websocket.js --testEcho         // Continuous echo test only
 *   node test-websocket.js --testListen       // Listen-only mode (no sending)
 *   node test-websocket.js -v                 // Moderate verbose (bytes + length + preview)
 *   node test-websocket.js -vvv               // Debug verbose (full debug, 200-char limit)
 *   node test-websocket.js -vvvv              // Super verbose (full debug, complete messages)
 *   
 * Combined:
 *   node test-websocket.js --testConnect -v
 *   node test-websocket.js --testEcho -vvv
 *   node test-websocket.js --testListen -vvvv
 */

const { LamderaWebSocket } = require('./src/index.js');

const LAMDERA_URL = process.env.LAMDERA_URL || 'ws://localhost:8000/_w';

// Parse CLI arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.includes('help')) {
    console.log('LamderaWebSocket Test Suite\n');
    console.log('Usage:');
    console.log('  node test-websocket.js                    # Run all tests (default)');
    console.log('  node test-websocket.js --testConnect      # Connection/disconnection test only');
    console.log('  node test-websocket.js --testEcho         # Continuous echo test only');
    console.log('  node test-websocket.js --testListen       # Listen-only mode (no sending)');
    console.log('  node test-websocket.js -v                 # Moderate verbose (bytes + length + preview)');
    console.log('  node test-websocket.js -vvv               # Debug verbose (full debug, 200-char limit)');
    console.log('  node test-websocket.js -vvvv              # Super verbose (full debug, complete messages)');
    console.log('\nCombined options:');
    console.log('  node test-websocket.js --testConnect -v');
    console.log('  node test-websocket.js --testEcho -vvv');
    console.log('  node test-websocket.js --testListen -vvvv');
    console.log('\nOptions:');
    console.log('  --help, -h, help                         # Show this help message');
    console.log('\nTests:');
    console.log('  1. Connection Test     - Connect and disconnect cleanly');
    console.log('  2. Leader Test         - Test leader disconnection and retry');
    console.log('  3. Echo Test           - Continuous message echo (Ctrl+C to stop)');
    console.log('  4. Listen Test         - Listen-only mode for broadcasts (Ctrl+C to stop)');
    console.log('\nVerbosity Levels:');
    console.log('  (none)                 - Basic output only');
    console.log('  -v                     - Moderate: Show hex bytes, length, and 200-char preview');
    console.log('  -vvv                   - Debug: Full debug with 200-char message limit');
    console.log('  -vvvv                  - Super: Full debug with complete message content');
    process.exit(0);
}

const verbose = args.includes('--verbose') || args.includes('-v') || args.includes('-vvv') || args.includes('-vvvv');
const testConnect = args.includes('--testConnect');
const testEcho = args.includes('--testEcho');
const testListen = args.includes('--testListen');
const runAll = !testConnect && !testEcho && !testListen;

const verboseLevel = args.includes('-vvvv') ? 'super' : args.includes('-vvv') ? 'debug' : args.includes('-v') ? 'moderate' : 'none';

console.log('=== LamderaWebSocket Test Suite ===');
console.log(`Mode: ${verboseLevel === 'super' ? 'Super Verbose (-vvvv)' : verboseLevel === 'debug' ? 'Debug Verbose (-vvv)' : verboseLevel === 'moderate' ? 'Moderate Verbose (-v)' : 'Silent'}`);
console.log(`Tests: ${runAll ? 'All Tests' : testConnect ? 'Connection Test' : testEcho ? 'Echo Test' : 'Listen-only'}\n`);

// Helper function to show bytes as hex
function bytesToHex(str, maxBytes = 16) {
    const bytes = [];
    for (let i = 0; i < Math.min(str.length, maxBytes); i++) {
        bytes.push(str.charCodeAt(i).toString(16).padStart(2, '0'));
    }
    return bytes.join(' ');
}

// Helper function to format message output based on verbosity
function formatMessage(data, prefix = '📥 Received') {
    const length = data.length;
    
    if (verboseLevel === 'super') {
        // -vvvv: Full debug with complete messages
        const hexBytes = bytesToHex(data, 5);
        const preview = length > 100 ? data.substring(0, 100) + '...' : data;
        console.log(`${prefix}: Length=${length} chars`);
        console.log(`   First 5 bytes: ${hexBytes}`);
        console.log(`   Preview: "${preview}"`);
        console.log(`   Full data: ${data}`);
    } else if (verboseLevel === 'debug') {
        // -vvv: Full debug but limit messages to 200 chars
        const hexBytes = bytesToHex(data, 5);
        const preview = length > 100 ? data.substring(0, 100) + '...' : data;
        const limitedData = length > 200 ? data.substring(0, 200) + '...' : data;
        console.log(`${prefix}: Length=${length} chars`);
        console.log(`   First 5 bytes: ${hexBytes}`);
        console.log(`   Preview: "${preview}"`);
        console.log(`   Data (200-char limit): ${limitedData}`);
    } else if (verboseLevel === 'moderate') {
        // -v: Moderate verbose with hex bytes and 200-char preview
        const hexBytes = bytesToHex(data, 5);
        const preview = length > 200 ? data.substring(0, 200) + '...' : data;
        console.log(`${prefix}:`);
        console.log(`decoded length: ${length}`);
        console.log(`first bytes: ${hexBytes}`);
        console.log(`string: ${preview}`);
    } else {
        // No flags: Basic output with 100-char preview
        const preview = length > 100 ? data.substring(0, 100) + '...' : data;
        console.log(`${prefix}: "${preview}"`);
    }
}

if (runAll || testConnect) {
    runConnectionTest();
} else if (testEcho) {
    runEchoTest();
} else if (testListen) {
    runListenOnlyTest();
}

function runConnectionTest() {
    console.log('TEST 1: Connection & Disconnection');
    console.log('===================================');
    
    const ws = new LamderaWebSocket(LAMDERA_URL, [], {
        sessionId: 'connect-test-' + Date.now(),
        debug: verboseLevel === 'super' || verboseLevel === 'debug',
        debugMaxChars: verboseLevel === 'debug' ? 200 : 0
    });
    
    ws.onopen = () => {
        console.log('✅ Connection established');
    };
    
    ws.onsetup = ({ clientId }) => {
        console.log('✅ Handshake complete - Client ID:', clientId);
        
        setTimeout(() => {
            console.log('🔄 Testing graceful disconnection...');
            ws.close();
        }, 2000);
    };
    
    ws.onleaderdisconnect = (event) => {
        console.log('🔄 Leader disconnection test - Retry attempt:', event.retryCount);
        console.log('✅ Leader avoidance mechanism working');
        
        setTimeout(() => {
            runLeaderTest();
        }, 1000);
    };
    
    ws.onerror = (error) => {
        console.error('❌ Connection error:', error);
        process.exit(1);
    };
    
    ws.onclose = (event) => {
        console.log('✅ Connection closed cleanly');
        console.log('✅ Connection test passed\n');
        
        setTimeout(() => {
            if (runAll) {
                runLeaderTest();
            } else {
                process.exit(0);
            }
        }, 1000);
    };
}

function runLeaderTest() {
    console.log('TEST 2: Leader Disconnection & Retry');
    console.log('====================================');
    
    const ws = new LamderaWebSocket(LAMDERA_URL, [], {
        sessionId: 'leader-test-' + Date.now(),
        debug: verboseLevel === 'super' || verboseLevel === 'debug',
        debugMaxChars: verboseLevel === 'debug' ? 200 : 0,
        maxRetries: 3,           // Reduced for faster testing
        retryBaseDelay: 1000,    // Faster retries
        retryMaxDelay: 3000
    });
    
    console.log('Configuration: maxRetries =', ws.maxRetries, ', baseDelay =', ws.retryBaseDelay + 'ms');
    
    ws.onopen = () => {
        console.log('✅ Connected for leader test');
    };
    
    ws.onsetup = ({ clientId }) => {
        console.log('✅ Setup complete - Client ID:', clientId);
        console.log('🎯 Waiting for potential leader election...');
    };
    
    ws.onleaderdisconnect = (event) => {
        console.log(`🔄 Leader disconnection - Attempt ${event.retryCount}/${ws.maxRetries}`);
        console.log('✅ Leader avoidance mechanism triggered');
        console.log('✅ Leader test passed\n');
        
        setTimeout(() => {
            if (runAll) {
                runEchoTest();
            } else {
                process.exit(0);
            }
        }, 1000);
    };
    
    ws.onerror = (error) => {
        console.error('❌ Leader test error:', error);
        process.exit(1);
    };
    
    // If no leader election happens, continue to next test after 5 seconds
    setTimeout(() => {
        if (runAll) {
            console.log('⏭️  No leader election detected, proceeding to echo test\n');
            ws.close();
            setTimeout(runEchoTest, 1000);
        } else {
            console.log('⏭️  No leader election detected in test period');
            console.log('✅ Leader test completed (no election triggered)\n');
            ws.close();
            setTimeout(() => process.exit(0), 500);
        }
    }, 5000);
}

function runEchoTest() {
    console.log('TEST 3: Continuous Echo Test');
    console.log('=============================');
    console.log('Press Ctrl+C to stop\n');
    
    const ws = new LamderaWebSocket(LAMDERA_URL, [], {
        sessionId: 'echo-test-' + Date.now(),
        debug: verboseLevel === 'super' || verboseLevel === 'debug',
        debugMaxChars: verboseLevel === 'debug' ? 200 : 0
    });
    
    let messageCount = 0;
    let echoInterval;
    
    ws.onopen = () => {
        console.log('✅ Connected for echo test');
    };
    
    ws.onsetup = ({ clientId }) => {
        console.log('✅ Setup complete - Client ID:', clientId);
        console.log('🔄 Starting continuous echo test...\n');
        
        echoInterval = setInterval(() => {
            const message = `echo-test-${messageCount++}`;
            console.log(`📤 Sending: ${message}`);
            ws.send(message);
        }, 2000);
    };
    
    ws.onmessage = (event) => {
        const data = event.data;
        formatMessage(data, '📥 Received');
    };
    
    ws.onleaderdisconnect = (event) => {
        console.log(`🔄 Leader disconnection during echo test - Attempt ${event.retryCount}`);
        if (echoInterval) clearInterval(echoInterval);
        
        setTimeout(() => {
            console.log('✅ Echo test completed (leader disconnection)');
            process.exit(0);
        }, 1000);
    };
    
    ws.onerror = (error) => {
        console.error('❌ Echo test error:', error);
        if (echoInterval) clearInterval(echoInterval);
        process.exit(1);
    };
    
    ws.onclose = () => {
        console.log('🔴 Echo test connection closed');
        if (echoInterval) clearInterval(echoInterval);
    };
    
    // Graceful shutdown on Ctrl+C
    const cleanup = () => {
        console.log('\n👋 Stopping echo test...');
        if (echoInterval) clearInterval(echoInterval);
        if (ws.readyState === ws.constructor.OPEN) {
            ws.close();
        }
        console.log('✅ Echo test completed');
        process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

function runListenOnlyTest() {
    console.log('TEST 4: Listen-Only Mode');
    console.log('========================');
    console.log('Press Ctrl+C to stop\n');

    const ws = new LamderaWebSocket(LAMDERA_URL, [], {
        sessionId: 'listen-only-' + Date.now(),
        debug: verboseLevel === 'super' || verboseLevel === 'debug',
        debugMaxChars: verboseLevel === 'debug' ? 200 : 0,
        listenOnly: true // Explicitly set listenOnly to true
    });

    ws.onopen = () => {
        console.log('✅ Connected in listen-only mode');
    };

    ws.onsetup = ({ clientId }) => {
        console.log('✅ Setup complete - Client ID:', clientId);
        console.log('🔄 Listening for messages...\n');
    };

    ws.onmessage = (event) => {
        const data = event.data;
        formatMessage(data, '📥 Received (listen-only)');
    };

    ws.onleaderdisconnect = (event) => {
        console.log(`🔄 Leader disconnection during listen-only test - Attempt ${event.retryCount}`);
        // No need to clearInterval here, as it's a one-shot test
        setTimeout(() => {
            console.log('✅ Listen-only test completed (leader disconnection)');
            process.exit(0);
        }, 1000);
    };

    ws.onerror = (error) => {
        console.error('❌ Listen-only test error:', error);
        process.exit(1);
    };

    ws.onclose = () => {
        console.log('🔴 Listen-only connection closed');
    };

    // Graceful shutdown on Ctrl+C
    const cleanup = () => {
        console.log('\n👋 Stopping listen-only test...');
        if (ws.readyState === ws.constructor.OPEN) {
            ws.close();
        }
        console.log('✅ Listen-only test completed');
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

// Auto-exit after 30 seconds for non-echo tests
if (!testEcho && !testListen) {
    setTimeout(() => {
        console.log('⏰ Test suite timeout, exiting...');
        process.exit(0);
    }, 30000);
} 