/**
 * Minimal in-process keyed mutex.
 *
 * Calls with the same key run one at a time, in the order they arrived.
 * Calls with different keys run in parallel.
 *
 * Used to serialize allocate() per event so that instant-confirm is
 * deterministic. SAFETY (never over-book) does NOT depend on this lock;
 * it comes from the guarded atomic updates in registrationService.js.
 * The lock assumes a single API process (Render free tier runs one).
 */
const tails = new Map();

async function withLock(key, fn) {
    const prev = tails.get(key) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => {
        release = resolve;
    });
    const tail = prev.then(() => next);
    tails.set(key, tail);

    await prev;
    try {
        return await fn();
    } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
    }
}

module.exports = { withLock };