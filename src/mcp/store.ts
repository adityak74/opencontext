/**
 * @deprecated The context store now lives in `src/store/`, where it is one of
 * several interchangeable backends rather than a hard-coded JSON file.
 *
 * This module re-exports the new entry points so that anything importing the old
 * path keeps resolving. New code should import from `../store/index.js`.
 */
export { createStore } from '../store/index.js';
export { createStoreManager } from '../store/manager.js';
export type { ContextStoreAdapter } from '../store/types.js';
