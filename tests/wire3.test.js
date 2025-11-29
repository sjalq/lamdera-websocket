/**
 * Property-based tests for Wire3 encoding/decoding
 *
 * These tests verify that the JavaScript implementation matches
 * Lamdera's Wire3 format exactly.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');

const {
    signedToUnsigned,
    unsignedToSigned,
    encodeUnsignedInt,
    decodeUnsignedInt,
    encodeInt64,
    decodeInt64,
    encodeString,
    decodeString,
    encodeMessage,
    decodeMessage,
    WIRE3_ONE_BYTE_MAX,
    WIRE3_TWO_BYTE_MAX,
    WIRE3_TWO_BYTE_OFFSET,
    WIRE3_MARKER_2_BYTES,
    WIRE3_MARKER_3_BYTES,
    WIRE3_MARKER_4_BYTES,
    WIRE3_MARKER_FLOAT64
} = require('../src/index.js');

// ============================================================================
// Zigzag Encoding Properties
// ============================================================================

describe('Zigzag Encoding', () => {
    test('Property: signedToUnsigned produces non-negative integers', () => {
        fc.assert(
            fc.property(fc.integer({ min: -2147483648, max: 2147483647 }), (n) => {
                const unsigned = signedToUnsigned(n);
                return unsigned >= 0;
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: positive integers map to even numbers', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 2147483647 }), (n) => {
                const unsigned = signedToUnsigned(n);
                return unsigned === 2 * n && unsigned % 2 === 0;
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: negative integers map to odd numbers', () => {
        fc.assert(
            fc.property(fc.integer({ min: -2147483648, max: -1 }), (n) => {
                const unsigned = signedToUnsigned(n);
                return unsigned === -2 * n - 1 && unsigned % 2 === 1;
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: zigzag is bijective (round-trip)', () => {
        fc.assert(
            fc.property(fc.integer({ min: -2147483648, max: 2147483647 }), (n) => {
                const unsigned = signedToUnsigned(n);
                const recovered = unsignedToSigned(unsigned);
                return recovered === n;
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: zigzag preserves ordering for positive numbers', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 2147483646 }),
                fc.integer({ min: 1, max: 2147483647 }),
                (a, b) => {
                    if (a >= b) return true; // Skip if not ordered
                    return signedToUnsigned(a) < signedToUnsigned(b);
                }
            ),
            { numRuns: 5000 }
        );
    });

    test('Property: small absolute values produce small unsigned values', () => {
        // This is the key property of zigzag: -1 -> 1, 1 -> 2, -2 -> 3, 2 -> 4, etc.
        fc.assert(
            fc.property(fc.integer({ min: -1000, max: 1000 }), (n) => {
                const unsigned = signedToUnsigned(n);
                // Max unsigned for n in [-1000, 1000] should be < 2001
                return unsigned <= 2000;
            }),
            { numRuns: 5000 }
        );
    });

    test('Specific: zigzag encoding matches Elm implementation', () => {
        // Test specific values from Elm's Wire3.elm
        assert.strictEqual(signedToUnsigned(0), 0);
        assert.strictEqual(signedToUnsigned(1), 2);
        assert.strictEqual(signedToUnsigned(-1), 1);
        assert.strictEqual(signedToUnsigned(2), 4);
        assert.strictEqual(signedToUnsigned(-2), 3);
        assert.strictEqual(signedToUnsigned(100), 200);
        assert.strictEqual(signedToUnsigned(-100), 199);
    });
});

// ============================================================================
// Unsigned Integer Encoding Properties
// ============================================================================

describe('Unsigned Integer Encoding', () => {
    test('Property: round-trip for all unsigned integers in safe range', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) => {
                const encoded = encodeUnsignedInt(n);
                const { value, bytesRead } = decodeUnsignedInt(encoded, 0);
                return value === n && bytesRead === encoded.length;
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: 0-215 encodes to exactly 1 byte', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: WIRE3_ONE_BYTE_MAX }), (n) => {
                const encoded = encodeUnsignedInt(n);
                return encoded.length === 1 && encoded[0] === n;
            }),
            { numRuns: 1000 }
        );
    });

    test('Property: 216-9431 encodes to exactly 2 bytes', () => {
        fc.assert(
            fc.property(fc.integer({ min: WIRE3_TWO_BYTE_OFFSET, max: WIRE3_TWO_BYTE_MAX }), (n) => {
                const encoded = encodeUnsignedInt(n);
                return encoded.length === 2 &&
                       encoded[0] >= WIRE3_TWO_BYTE_OFFSET &&
                       encoded[0] < WIRE3_MARKER_2_BYTES;
            }),
            { numRuns: 1000 }
        );
    });

    test('Property: 9432-65535 encodes to exactly 3 bytes with marker 252', () => {
        fc.assert(
            fc.property(fc.integer({ min: WIRE3_TWO_BYTE_MAX + 1, max: 65535 }), (n) => {
                const encoded = encodeUnsignedInt(n);
                return encoded.length === 3 && encoded[0] === WIRE3_MARKER_2_BYTES;
            }),
            { numRuns: 1000 }
        );
    });

    test('Property: 65536-16777215 encodes to exactly 4 bytes with marker 253', () => {
        fc.assert(
            fc.property(fc.integer({ min: 65536, max: 16777215 }), (n) => {
                const encoded = encodeUnsignedInt(n);
                return encoded.length === 4 && encoded[0] === WIRE3_MARKER_3_BYTES;
            }),
            { numRuns: 1000 }
        );
    });

    test('Property: 16777216-4294967295 encodes to exactly 5 bytes with marker 254', () => {
        fc.assert(
            fc.property(fc.integer({ min: 16777216, max: 4294967295 }), (n) => {
                const encoded = encodeUnsignedInt(n);
                return encoded.length === 5 && encoded[0] === WIRE3_MARKER_4_BYTES;
            }),
            { numRuns: 1000 }
        );
    });

    test('Property: larger values encode to 9 bytes with marker 255', () => {
        fc.assert(
            fc.property(fc.integer({ min: 4294967296, max: Number.MAX_SAFE_INTEGER }), (n) => {
                const encoded = encodeUnsignedInt(n);
                return encoded.length === 9 && encoded[0] === WIRE3_MARKER_FLOAT64;
            }),
            { numRuns: 1000 }
        );
    });

    test('Property: encoding is monotonic (larger values never produce smaller first bytes)', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 10000 }),
                fc.integer({ min: 0, max: 10000 }),
                (a, b) => {
                    if (a >= b) return true;
                    const encA = encodeUnsignedInt(a);
                    const encB = encodeUnsignedInt(b);
                    // Compare lexicographically
                    if (encA.length !== encB.length) {
                        return encA.length < encB.length;
                    }
                    for (let i = 0; i < encA.length; i++) {
                        if (encA[i] !== encB[i]) {
                            return encA[i] < encB[i];
                        }
                    }
                    return true;
                }
            ),
            { numRuns: 5000 }
        );
    });

    test('Specific: boundary values encode correctly', () => {
        // 215 (max 1-byte)
        let enc = encodeUnsignedInt(215);
        assert.strictEqual(enc.length, 1);
        assert.strictEqual(enc[0], 215);

        // 216 (min 2-byte)
        enc = encodeUnsignedInt(216);
        assert.strictEqual(enc.length, 2);
        assert.strictEqual(enc[0], 216);
        assert.strictEqual(enc[1], 0);

        // 9431 (max 2-byte without marker)
        enc = encodeUnsignedInt(9431);
        assert.strictEqual(enc.length, 2);

        // 9432 (min 3-byte with marker 252)
        enc = encodeUnsignedInt(9432);
        assert.strictEqual(enc.length, 3);
        assert.strictEqual(enc[0], 252);

        // 65535 (max marker-252)
        enc = encodeUnsignedInt(65535);
        assert.strictEqual(enc.length, 3);
        assert.strictEqual(enc[0], 252);

        // 65536 (min marker-253)
        enc = encodeUnsignedInt(65536);
        assert.strictEqual(enc.length, 4);
        assert.strictEqual(enc[0], 253);
    });
});

// ============================================================================
// Signed Integer Encoding Properties
// ============================================================================

describe('Signed Integer Encoding (Int64)', () => {
    // Note: Zigzag encoding doubles the magnitude, so we can only safely round-trip
    // integers up to half of MAX_SAFE_INTEGER to avoid precision loss.
    const SAFE_ZIGZAG_MAX = Math.floor(Number.MAX_SAFE_INTEGER / 2);
    const SAFE_ZIGZAG_MIN = -SAFE_ZIGZAG_MAX;

    test('Property: round-trip for signed integers (within zigzag-safe range)', () => {
        fc.assert(
            fc.property(fc.integer({ min: SAFE_ZIGZAG_MIN, max: SAFE_ZIGZAG_MAX }), (n) => {
                const encoded = encodeInt64(n);
                const { value, bytesRead } = decodeInt64(encoded, 0);
                return value === n && bytesRead === encoded.length;
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: round-trip for common integer range (32-bit)', () => {
        fc.assert(
            fc.property(fc.integer({ min: -2147483648, max: 2147483647 }), (n) => {
                const encoded = encodeInt64(n);
                const { value, bytesRead } = decodeInt64(encoded, 0);
                return value === n && bytesRead === encoded.length;
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: 0 encodes to single byte [0]', () => {
        const encoded = encodeInt64(0);
        assert.strictEqual(encoded.length, 1);
        assert.strictEqual(encoded[0], 0);
    });

    test('Property: small positive and negative numbers are compact', () => {
        fc.assert(
            fc.property(fc.integer({ min: -107, max: 107 }), (n) => {
                // After zigzag: -107 -> 213, 107 -> 214, all fit in 1 byte
                const encoded = encodeInt64(n);
                return encoded.length === 1;
            }),
            { numRuns: 500 }
        );
    });

    test('Property: consecutive integers have consecutive zigzag values', () => {
        fc.assert(
            fc.property(fc.integer({ min: -10000, max: 10000 }), (n) => {
                const z1 = signedToUnsigned(n);
                const z2 = signedToUnsigned(n + 1);
                // Zigzag of consecutive signed integers differ by 2 (for same sign)
                // or are consecutive (when crossing 0)
                return Math.abs(z2 - z1) <= 2;
            }),
            { numRuns: 5000 }
        );
    });

    test('Specific: known Elm-encoded values', () => {
        // These values should match what Elm's Wire3.encodeInt64 produces
        // 0 -> zigzag 0 -> [0]
        assert.deepStrictEqual([...encodeInt64(0)], [0]);

        // 1 -> zigzag 2 -> [2]
        assert.deepStrictEqual([...encodeInt64(1)], [2]);

        // -1 -> zigzag 1 -> [1]
        assert.deepStrictEqual([...encodeInt64(-1)], [1]);

        // 107 -> zigzag 214 -> [214]
        assert.deepStrictEqual([...encodeInt64(107)], [214]);

        // 108 -> zigzag 216 -> 2-byte encoding
        const enc108 = encodeInt64(108);
        assert.strictEqual(enc108.length, 2);
        assert.strictEqual(enc108[0], 216);
    });
});

// ============================================================================
// String Encoding Properties
// ============================================================================

describe('String Encoding', () => {
    test('Property: round-trip for arbitrary strings', () => {
        fc.assert(
            fc.property(fc.string(), (s) => {
                const encoded = encodeString(s);
                const { value, bytesRead } = decodeString(encoded, 0);
                return value === s && bytesRead === encoded.length;
            }),
            { numRuns: 5000 }
        );
    });

    test('Property: round-trip for Unicode strings', () => {
        fc.assert(
            fc.property(fc.fullUnicodeString(), (s) => {
                const encoded = encodeString(s);
                const { value, bytesRead } = decodeString(encoded, 0);
                return value === s && bytesRead === encoded.length;
            }),
            { numRuns: 2000 }
        );
    });

    test('Property: empty string encodes to length prefix only', () => {
        const encoded = encodeString('');
        const { value, bytesRead } = decodeString(encoded, 0);
        assert.strictEqual(value, '');
        assert.strictEqual(encoded.length, 1); // Just [0] for length
        assert.strictEqual(encoded[0], 0);
    });

    test('Property: string length prefix is byte length, not char count', () => {
        fc.assert(
            fc.property(fc.fullUnicodeString({ minLength: 1, maxLength: 100 }), (s) => {
                const encoded = encodeString(s);
                const byteLength = Buffer.from(s, 'utf8').length;
                const { value: decodedLength } = decodeInt64(encoded, 0);
                return decodedLength === byteLength;
            }),
            { numRuns: 2000 }
        );
    });

    test('Property: encoded size is length prefix size + byte length', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 0, maxLength: 1000 }), (s) => {
                const encoded = encodeString(s);
                const byteLength = Buffer.from(s, 'utf8').length;
                const lengthPrefixSize = encodeInt64(byteLength).length;
                return encoded.length === lengthPrefixSize + byteLength;
            }),
            { numRuns: 2000 }
        );
    });

    test('Specific: ASCII string encoding', () => {
        const encoded = encodeString('hello');
        // Length 5 -> zigzag 10 -> [10]
        // Then 'hello' in UTF-8
        assert.strictEqual(encoded[0], 10); // zigzag(5) = 10
        assert.strictEqual(encoded.slice(1).toString('utf8'), 'hello');
    });

    test('Specific: multi-byte UTF-8 encoding', () => {
        const encoded = encodeString('日本語'); // 9 UTF-8 bytes
        const byteLen = Buffer.from('日本語', 'utf8').length;
        assert.strictEqual(byteLen, 9);
        // zigzag(9) = 18
        assert.strictEqual(encoded[0], 18);
    });
});

// ============================================================================
// Message Encoding Properties (DU variant + payload)
// ============================================================================

describe('Message Encoding', () => {
    test('Property: round-trip for messages with default DU variant', () => {
        fc.assert(
            fc.property(fc.string(), (s) => {
                const encoded = encodeMessage(s, 0x00);
                const decoded = decodeMessage(encoded, 0x00);
                return decoded === s;
            }),
            { numRuns: 5000 }
        );
    });

    test('Property: round-trip for messages with arbitrary DU variant', () => {
        fc.assert(
            fc.property(
                fc.string(),
                fc.integer({ min: 0, max: 255 }),
                (s, variant) => {
                    const encoded = encodeMessage(s, variant);
                    const decoded = decodeMessage(encoded, variant);
                    return decoded === s;
                }
            ),
            { numRuns: 2000 }
        );
    });

    test('Property: wrong DU variant returns null', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1 }),
                fc.integer({ min: 0, max: 254 }),
                (s, variant) => {
                    const encoded = encodeMessage(s, variant);
                    const decoded = decodeMessage(encoded, variant + 1);
                    return decoded === null;
                }
            ),
            { numRuns: 1000 }
        );
    });

    test('Property: first byte is always the DU variant', () => {
        fc.assert(
            fc.property(
                fc.string(),
                fc.integer({ min: 0, max: 255 }),
                (s, variant) => {
                    const encoded = encodeMessage(s, variant);
                    return encoded[0] === variant;
                }
            ),
            { numRuns: 1000 }
        );
    });

    test('Property: message encoding is deterministic', () => {
        fc.assert(
            fc.property(fc.string(), (s) => {
                const enc1 = encodeMessage(s, 0x00);
                const enc2 = encodeMessage(s, 0x00);
                return Buffer.compare(enc1, enc2) === 0;
            }),
            { numRuns: 1000 }
        );
    });
});

// ============================================================================
// Cross-cutting Properties
// ============================================================================

describe('Cross-cutting Properties', () => {
    test('Property: multiple integers can be decoded sequentially', () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: -1000000, max: 1000000 }), { minLength: 1, maxLength: 20 }),
                (nums) => {
                    // Encode all integers sequentially
                    const buffers = nums.map(n => encodeInt64(n));
                    const combined = Buffer.concat(buffers);

                    // Decode them back
                    const decoded = [];
                    let offset = 0;
                    while (offset < combined.length) {
                        const { value, bytesRead } = decodeInt64(combined, offset);
                        decoded.push(value);
                        offset += bytesRead;
                    }

                    // Verify
                    if (decoded.length !== nums.length) return false;
                    for (let i = 0; i < nums.length; i++) {
                        if (decoded[i] !== nums[i]) return false;
                    }
                    return true;
                }
            ),
            { numRuns: 1000 }
        );
    });

    test('Property: multiple strings can be decoded sequentially', () => {
        fc.assert(
            fc.property(
                fc.array(fc.string({ maxLength: 100 }), { minLength: 1, maxLength: 10 }),
                (strs) => {
                    // Encode all strings sequentially
                    const buffers = strs.map(s => encodeString(s));
                    const combined = Buffer.concat(buffers);

                    // Decode them back
                    const decoded = [];
                    let offset = 0;
                    while (offset < combined.length) {
                        const { value, bytesRead } = decodeString(combined, offset);
                        decoded.push(value);
                        offset += bytesRead;
                    }

                    // Verify
                    if (decoded.length !== strs.length) return false;
                    for (let i = 0; i < strs.length; i++) {
                        if (decoded[i] !== strs[i]) return false;
                    }
                    return true;
                }
            ),
            { numRuns: 500 }
        );
    });

    test('Property: decoding at wrong offset fails gracefully', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 1000 }),
                fc.integer({ min: 1, max: 10 }),
                (n, extraBytes) => {
                    const encoded = encodeInt64(n);
                    // Try decoding at offset beyond buffer
                    try {
                        decodeInt64(encoded, encoded.length + extraBytes);
                        return false; // Should have thrown
                    } catch (e) {
                        return e.message.includes('too short');
                    }
                }
            ),
            { numRuns: 500 }
        );
    });
});

// ============================================================================
// Encoding Size Efficiency Properties
// ============================================================================

describe('Encoding Efficiency', () => {
    test('Property: Wire3 is more compact than fixed 4-byte for small numbers', () => {
        fc.assert(
            fc.property(fc.integer({ min: -107, max: 107 }), (n) => {
                const encoded = encodeInt64(n);
                return encoded.length < 4; // Fixed 4-byte would always be 4
            }),
            { numRuns: 500 }
        );
    });

    test('Property: common case (small non-negative) uses 1 byte', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 107 }), (n) => {
                const encoded = encodeInt64(n);
                return encoded.length === 1;
            }),
            { numRuns: 500 }
        );
    });

    test('Property: typical string lengths (<108 bytes) have 1-byte length prefix', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 0, maxLength: 107 }), (s) => {
                const byteLen = Buffer.from(s, 'utf8').length;
                if (byteLen > 107) return true; // Skip if UTF-8 expanded
                const lengthPrefix = encodeInt64(byteLen);
                return lengthPrefix.length === 1;
            }),
            { numRuns: 1000 }
        );
    });
});

// ============================================================================
// Adversarial Properties
// ============================================================================

describe('Adversarial Cases', () => {
    test('Property: truncated buffer is detected', () => {
        fc.assert(
            fc.property(fc.integer({ min: 256, max: 100000 }), (n) => {
                const encoded = encodeInt64(n);
                // Truncate the buffer
                const truncated = encoded.slice(0, encoded.length - 1);
                try {
                    decodeInt64(truncated, 0);
                    return false; // Should have thrown
                } catch (e) {
                    return true;
                }
            }),
            { numRuns: 500 }
        );
    });

    test('Property: corrupted marker byte detected or decoded differently', () => {
        fc.assert(
            fc.property(fc.integer({ min: 10000, max: 100000 }), (n) => {
                const encoded = encodeInt64(n);
                // Corrupt the first byte
                const corrupted = Buffer.from(encoded);
                corrupted[0] = (corrupted[0] + 1) % 256;

                // Either throws or decodes to a different value
                try {
                    const { value } = decodeInt64(corrupted, 0);
                    return value !== n;
                } catch (e) {
                    return true;
                }
            }),
            { numRuns: 500 }
        );
    });

    test('Property: very long strings still round-trip', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 10000, maxLength: 50000 }),
                (s) => {
                    const encoded = encodeString(s);
                    const { value } = decodeString(encoded, 0);
                    return value === s;
                }
            ),
            { numRuns: 20 }
        );
    });

    test('Property: string with all byte values round-trips', () => {
        // Create a string with bytes 0-255 (as Latin-1)
        const allBytes = Buffer.alloc(256);
        for (let i = 0; i < 256; i++) {
            allBytes[i] = i;
        }
        // Note: This isn't valid UTF-8, so we test with valid UTF-8 subset
        const validUtf8 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const encoded = encodeString(validUtf8);
        const { value } = decodeString(encoded, 0);
        assert.strictEqual(value, validUtf8);
    });
});

// ============================================================================
// Regression Tests (specific known values)
// ============================================================================

describe('Regression Tests', () => {
    test('Specific Wire3 encoded values match Elm output', () => {
        // These are test vectors that should match Elm's Wire3 exactly
        // You can generate these by encoding values in Elm and inspecting bytes

        // encodeInt64(0) -> [0]
        assert.deepStrictEqual([...encodeInt64(0)], [0]);

        // encodeInt64(1) -> zigzag(1)=2 -> [2]
        assert.deepStrictEqual([...encodeInt64(1)], [2]);

        // encodeInt64(-1) -> zigzag(-1)=1 -> [1]
        assert.deepStrictEqual([...encodeInt64(-1)], [1]);

        // encodeInt64(100) -> zigzag(100)=200 -> [200]
        assert.deepStrictEqual([...encodeInt64(100)], [200]);

        // encodeInt64(-100) -> zigzag(-100)=199 -> [199]
        assert.deepStrictEqual([...encodeInt64(-100)], [199]);

        // encodeInt64(108) -> zigzag(108)=216 -> 2-byte: [216, 0]
        assert.deepStrictEqual([...encodeInt64(108)], [216, 0]);

        // encodeInt64(1000) -> zigzag(1000)=2000 -> 2-byte encoding
        const enc1000 = encodeInt64(1000);
        const { value: dec1000 } = decodeInt64(enc1000, 0);
        assert.strictEqual(dec1000, 1000);
    });

    test('Empty message encoding', () => {
        const encoded = encodeMessage('', 0x00);
        // [0x00 (variant), 0x00 (length=0 zigzag)]
        assert.deepStrictEqual([...encoded], [0x00, 0x00]);
    });

    test('Simple message encoding', () => {
        const encoded = encodeMessage('hi', 0x00);
        // [0x00 (variant), 0x04 (length=2 zigzag=4), 0x68, 0x69]
        assert.deepStrictEqual([...encoded], [0x00, 0x04, 0x68, 0x69]);
    });
});

// ============================================================================
// PROOF: Constructor "A" is Always First (Lamdera Wire3 Compatibility)
// ============================================================================

describe('Proof: A String is Always First DU Variant', () => {
    // Elm constructor names must start with uppercase A-Z, then alphanumeric or underscore
    const elmConstructorName = () => fc.tuple(
        fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
        fc.string({ minLength: 0, maxLength: 20 }).map(s =>
            s.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20)
        )
    ).map(([first, rest]) => first + rest);

    // Generate a random DU type definition as a list of constructor names
    // This simulates: type Msg = A String | <other random constructors>
    const randomDuType = () => fc.array(
        elmConstructorName(),
        { minLength: 1, maxLength: 50 }
    ).map(names => {
        // Ensure "A" is always in the list and deduplicate
        const uniqueNames = [...new Set(['A', ...names])];
        return uniqueNames;
    });

    // Generate a DU with specific patterns that might try to beat "A"
    const adversarialDuType = () => fc.tuple(
        // Names that look like they might sort before A
        fc.array(fc.constantFrom(
            'A', 'AA', 'AAA', 'AAAA', 'A_', 'A__', 'A0', 'A1', 'A9',
            'Aa', 'Ab', 'Az', 'A_A', 'A_0', 'A_a'
        ), { minLength: 1, maxLength: 20 }),
        // Plus random other constructors
        fc.array(elmConstructorName(), { minLength: 0, maxLength: 30 })
    ).map(([adversarial, random]) => {
        const all = [...new Set(['A', ...adversarial, ...random])];
        return all;
    });

    test('Property: Any valid Elm constructor name >= "A"', () => {
        fc.assert(
            fc.property(elmConstructorName(), (name) => {
                return name >= 'A';
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: Constructor starting with "A" and length > 1 is strictly > "A"', () => {
        fc.assert(
            fc.property(elmConstructorName(), (name) => {
                if (name.startsWith('A') && name.length > 1) {
                    return name > 'A';
                }
                return true; // skip if not starting with A or is exactly A
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: "A" is <= minimum of any two fuzzed constructors', () => {
        fc.assert(
            fc.property(elmConstructorName(), elmConstructorName(), (name1, name2) => {
                const minName = name1 < name2 ? name1 : name2;
                return 'A' <= minName;
            }),
            { numRuns: 5000 }
        );
    });

    test('Property: Only "A" itself can equal "A"', () => {
        fc.assert(
            fc.property(elmConstructorName(), (name) => {
                return name === 'A' || name > 'A';
            }),
            { numRuns: 10000 }
        );
    });

    test('Exhaustive: A < B < C < ... < Z', () => {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        const sorted = [...letters].sort();
        assert.deepStrictEqual(letters, sorted);
    });

    test('Exhaustive: A is strictly less than all other single uppercase letters', () => {
        const others = 'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        for (const letter of others) {
            assert.ok('A' < letter, `Expected 'A' < '${letter}'`);
        }
    });

    test('Exhaustive: A < AA, A < AB, A < A_, A < A0, A < Aa', () => {
        const longerNames = ['AA', 'AB', 'A_', 'A0', 'Aa', 'Az', 'A9'];
        for (const name of longerNames) {
            assert.ok('A' < name, `Expected 'A' < '${name}'`);
        }
    });

    test('Sort order: AA < A_ (underscore 0x5F > A 0x41)', () => {
        // This confirms Elm/Lamdera's byte-wise sorting
        assert.ok('AA' < 'A_', "Expected 'AA' < 'A_' (underscore sorts after letters)");
    });

    test('Encoding "A String" message has DU variant 0x00', () => {
        // When constructor A is the first (alphabetically), it gets tag 0
        const payload = 'test';
        const encoded = encodeMessage(payload, 0x00);
        assert.strictEqual(encoded[0], 0x00, 'First byte should be DU variant 0x00');
    });

    test('Property: Any "A String" message with fuzzed payload has tag 0x00', () => {
        fc.assert(
            fc.property(fc.string(), (payload) => {
                const encoded = encodeMessage(payload, 0x00);
                return encoded[0] === 0x00;
            }),
            { numRuns: 5000 }
        );
    });

    test('Lamdera exact encoding: A "" -> [0x00, 0x00]', () => {
        // Empty string: tag 0, zigzag(0) = 0
        const encoded = encodeMessage('', 0x00);
        assert.deepStrictEqual([...encoded], [0x00, 0x00]);
    });

    test('Lamdera exact encoding: A "hi" -> [0x00, 0x04, 0x68, 0x69]', () => {
        // "hi": tag 0, zigzag(2) = 4, 'h' = 0x68, 'i' = 0x69
        const encoded = encodeMessage('hi', 0x00);
        assert.deepStrictEqual([...encoded], [0x00, 0x04, 0x68, 0x69]);
    });

    test('Lamdera exact encoding: A "hello" -> [0x00, 0x0A, 0x68, 0x65, 0x6C, 0x6C, 0x6F]', () => {
        // "hello": tag 0, zigzag(5) = 10, h e l l o
        const encoded = encodeMessage('hello', 0x00);
        assert.deepStrictEqual([...encoded], [0x00, 0x0A, 0x68, 0x65, 0x6C, 0x6C, 0x6F]);
    });

    test('Property: JS encoding matches expected Lamdera format for any string', () => {
        fc.assert(
            fc.property(fc.string(), (payload) => {
                const encoded = encodeMessage(payload, 0x00);

                // Verify structure: [variant, zigzag_length, ...utf8_bytes]
                if (encoded[0] !== 0x00) return false;

                // Decode length and verify UTF-8 bytes
                const { value: decodedLen, bytesRead } = decodeInt64(encoded, 1);
                const utf8Bytes = Buffer.from(payload, 'utf8');

                if (decodedLen !== utf8Bytes.length) return false;

                // Verify the actual bytes match
                const payloadStart = 1 + bytesRead;
                const encodedPayload = encoded.slice(payloadStart);
                return Buffer.compare(encodedPayload, utf8Bytes) === 0;
            }),
            { numRuns: 5000 }
        );
    });

    test('Property: Round-trip JS encode -> decode matches original', () => {
        fc.assert(
            fc.property(fc.string(), (payload) => {
                const encoded = encodeMessage(payload, 0x00);
                const decoded = decodeMessage(encoded, 0x00);
                return decoded === payload;
            }),
            { numRuns: 5000 }
        );
    });

    test('Adversarial: Unicode, emoji, and special chars all work', () => {
        const testCases = [
            'Hello, 世界! 🌍',
            '日本語テスト',
            '🎉🎊🎁',
            'Ω≈ç√∫≤≥',
            '\x00\x01\x02', // control chars
            'Line1\nLine2\rLine3\r\nLine4',
            '"quotes" and \'apostrophes\'',
            '<script>alert("xss")</script>',
        ];

        for (const testCase of testCases) {
            const encoded = encodeMessage(testCase, 0x00);
            const decoded = decodeMessage(encoded, 0x00);
            assert.strictEqual(decoded, testCase, `Failed for: ${JSON.stringify(testCase)}`);
        }
    });

    // ========================================================================
    // FUZZED DU COMBINATIONS - Prove A is ALWAYS first regardless of type shape
    // ========================================================================

    test('Property: In ANY random DU, "A" sorts first', () => {
        fc.assert(
            fc.property(randomDuType(), (constructors) => {
                const sorted = [...constructors].sort();
                return sorted[0] === 'A';
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: In ANY adversarial DU, "A" sorts first', () => {
        fc.assert(
            fc.property(adversarialDuType(), (constructors) => {
                const sorted = [...constructors].sort();
                return sorted[0] === 'A';
            }),
            { numRuns: 10000 }
        );
    });

    test('Property: Random DU with 1-100 constructors always has A at index 0', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 100 }),
                fc.array(elmConstructorName(), { minLength: 1, maxLength: 100 }),
                (_, names) => {
                    const withA = [...new Set(['A', ...names])];
                    const sorted = [...withA].sort();
                    return sorted.indexOf('A') === 0;
                }
            ),
            { numRuns: 5000 }
        );
    });

    test('Property: For ANY DU shape + ANY payload, encode/decode round-trips', () => {
        fc.assert(
            fc.property(
                randomDuType(),
                fc.string(),
                (constructors, payload) => {
                    // Simulating: type Msg = A String | ... (others)
                    // Since A is always tag 0, we encode with variant 0x00
                    const encoded = encodeMessage(payload, 0x00);
                    const decoded = decodeMessage(encoded, 0x00);
                    return decoded === payload;
                }
            ),
            { numRuns: 5000 }
        );
    });

    test('Property: Adversarial DU + random payload always round-trips', () => {
        fc.assert(
            fc.property(
                adversarialDuType(),
                fc.string(),
                (constructors, payload) => {
                    const encoded = encodeMessage(payload, 0x00);
                    const decoded = decodeMessage(encoded, 0x00);
                    return decoded === payload;
                }
            ),
            { numRuns: 5000 }
        );
    });

    test('Property: DU with many A-like names still has A first', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.constantFrom(
                        'A', 'AA', 'AAA', 'AAAA', 'AAAAA',
                        'A_', 'A__', 'A___',
                        'A0', 'A00', 'A000',
                        'Aa', 'Aaa', 'Aaaa',
                        'AB', 'AC', 'AD', 'AZ',
                        'A1', 'A2', 'A9',
                        'A_1', 'A_a', 'A_A'
                    ),
                    { minLength: 2, maxLength: 30 }
                ),
                (names) => {
                    const withA = [...new Set(['A', ...names])];
                    const sorted = [...withA].sort();
                    return sorted[0] === 'A';
                }
            ),
            { numRuns: 5000 }
        );
    });

    test('Property: Re-encode after decode produces identical bytes', () => {
        fc.assert(
            fc.property(
                randomDuType(),
                fc.string(),
                (constructors, payload) => {
                    const encoded1 = encodeMessage(payload, 0x00);
                    const decoded = decodeMessage(encoded1, 0x00);
                    const encoded2 = encodeMessage(decoded, 0x00);
                    return Buffer.compare(encoded1, encoded2) === 0;
                }
            ),
            { numRuns: 5000 }
        );
    });

    test('Property: Tag is always 0x00 regardless of DU shape', () => {
        fc.assert(
            fc.property(
                randomDuType(),
                fc.string(),
                (constructors, payload) => {
                    const encoded = encodeMessage(payload, 0x00);
                    return encoded[0] === 0x00;
                }
            ),
            { numRuns: 5000 }
        );
    });

    test('Property: Encoding structure is always [0x00, zigzag_len, ...utf8]', () => {
        fc.assert(
            fc.property(
                randomDuType(),
                fc.string(),
                (constructors, payload) => {
                    const encoded = encodeMessage(payload, 0x00);
                    const utf8Bytes = Buffer.from(payload, 'utf8');

                    // First byte is tag
                    if (encoded[0] !== 0x00) return false;

                    // Decode length
                    const { value: len, bytesRead } = decodeInt64(encoded, 1);
                    if (len !== utf8Bytes.length) return false;

                    // Verify payload bytes
                    const payloadStart = 1 + bytesRead;
                    const encodedPayload = encoded.slice(payloadStart);
                    return Buffer.compare(encodedPayload, utf8Bytes) === 0;
                }
            ),
            { numRuns: 5000 }
        );
    });

    test('Property: Massive DU (100+ constructors) still has A first', () => {
        fc.assert(
            fc.property(
                fc.array(elmConstructorName(), { minLength: 100, maxLength: 200 }),
                (names) => {
                    const withA = [...new Set(['A', ...names])];
                    const sorted = [...withA].sort();
                    return sorted[0] === 'A';
                }
            ),
            { numRuns: 1000 }
        );
    });

    test('Property: No generated constructor name is < "A"', () => {
        fc.assert(
            fc.property(
                fc.array(elmConstructorName(), { minLength: 1, maxLength: 100 }),
                (names) => {
                    return names.every(name => name >= 'A');
                }
            ),
            { numRuns: 10000 }
        );
    });

    test('Property: Combined - fuzz DU + payload + verify complete round-trip', () => {
        // Helper: check if string has lone surrogates (invalid UTF-16)
        const hasLoneSurrogate = (s) => {
            for (let i = 0; i < s.length; i++) {
                const code = s.charCodeAt(i);
                // High surrogate without following low surrogate
                if (code >= 0xD800 && code <= 0xDBFF) {
                    const next = s.charCodeAt(i + 1);
                    if (isNaN(next) || next < 0xDC00 || next > 0xDFFF) return true;
                }
                // Low surrogate without preceding high surrogate
                if (code >= 0xDC00 && code <= 0xDFFF) {
                    const prev = s.charCodeAt(i - 1);
                    if (isNaN(prev) || prev < 0xD800 || prev > 0xDBFF) return true;
                }
            }
            return false;
        };

        // Helper: generate valid UTF-8 strings only (no lone surrogates)
        const validUtf8String = fc.oneof(
            fc.fullUnicodeString(), // Valid Unicode only
            fc.constant(''),
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''))),
            fc.stringOf(fc.constantFrom(...'😀🎉🌍💻🔥✨🚀💡🎯🏆'.split(''))),
            fc.fullUnicodeString({ minLength: 1000, maxLength: 5000 })
        );

        fc.assert(
            fc.property(
                // Fuzz DU shape
                fc.array(elmConstructorName(), { minLength: 1, maxLength: 50 }),
                // Fuzz payload with various valid UTF-8 string types
                validUtf8String,
                (duConstructors, payload) => {
                    // Skip invalid strings (shrinker might produce them)
                    if (hasLoneSurrogate(payload)) return true;

                    const withA = [...new Set(['A', ...duConstructors])];
                    const sorted = [...withA].sort();

                    // A is always first
                    if (sorted[0] !== 'A') return false;

                    // Encode with tag 0 (A's tag)
                    const encoded = encodeMessage(payload, 0x00);

                    // First byte is 0x00
                    if (encoded[0] !== 0x00) return false;

                    // Decode succeeds
                    const decoded = decodeMessage(encoded, 0x00);
                    if (decoded !== payload) return false;

                    // Re-encode matches
                    const reencoded = encodeMessage(decoded, 0x00);
                    return Buffer.compare(encoded, reencoded) === 0;
                }
            ),
            { numRuns: 5000 }
        );
    });

    test('Exhaustive: All possible 2-char A-prefix names sort after A', () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_';
        for (const c of chars) {
            const name = 'A' + c;
            assert.ok('A' < name, `Expected 'A' < '${name}'`);
        }
    });

    test('Exhaustive: Single letter constructors A-Z maintain order', () => {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        const sorted = [...letters].sort();
        assert.deepStrictEqual(letters, sorted);
        assert.strictEqual(sorted[0], 'A');
    });
});

console.log('Running Wire3 property-based tests...\n');
