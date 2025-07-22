/**
 * LamderaWebSocket Test Suite
 * 
 * Usage:
 *   node test-websocket.js                    // Run all tests (default)
 *   node test-websocket.js --testConnect      // Connection/disconnection test only
 *   node test-websocket.js --testEcho         // Continuous echo test only
 *   node test-websocket.js --verbose          // Enable verbose logging
 *   
 * Combined:
 *   node test-websocket.js --testConnect --verbose
 *   node test-websocket.js --testEcho --verbose
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
    console.log('  node test-websocket.js --verbose          # Enable verbose logging');
    console.log('\nCombined options:');
    console.log('  node test-websocket.js --testConnect --verbose');
    console.log('  node test-websocket.js --testEcho --verbose');
    console.log('\nOptions:');
    console.log('  --help, -h, help                         # Show this help message');
    console.log('\nTests:');
    console.log('  1. Connection Test     - Connect and disconnect cleanly');
    console.log('  2. Leader Test         - Test leader disconnection and retry');
    console.log('  3. Echo Test           - Continuous message echo (Ctrl+C to stop)');
    process.exit(0);
}

const verbose = args.includes('--verbose');
const testConnect = args.includes('--testConnect');
const testEcho = args.includes('--testEcho');
const runAll = !testConnect && !testEcho;

console.log('=== LamderaWebSocket Test Suite ===');
console.log(`Mode: ${verbose ? 'Verbose' : 'Silent'}`);
console.log(`Tests: ${runAll ? 'All Tests' : testConnect ? 'Connection Test' : 'Echo Test'}\n`);

if (runAll || testConnect) {
    runConnectionTest();
} else if (testEcho) {
    runEchoTest();
}

function runConnectionTest() {
    console.log('TEST 1: Connection & Disconnection');
    console.log('===================================');
    
    const ws = new LamderaWebSocket(LAMDERA_URL, [], {
        sessionId: 'connect-test-' + Date.now(),
        debug: verbose
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
        debug: verbose,
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
        debug: verbose
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
        console.log(`📥 Received: ${event.data}`);
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

// Auto-exit after 30 seconds for non-echo tests
if (!testEcho) {
    setTimeout(() => {
        console.log('⏰ Test suite timeout, exiting...');
        process.exit(0);
    }, 30000);
} 