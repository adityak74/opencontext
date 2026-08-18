import type { Collection, Document, DocumentDriver } from '../adapters/document.js';
import type { ParsedDsn } from '../dsn.js';
import { importOptional } from './optional.js';

const COLLECTIONS: Record<Collection, string> = {
  contexts: 'oc_contexts',
  bubbles: 'oc_bubbles',
};

interface FirestoreDoc {
  set(data: Document): Promise<unknown>;
  get(): Promise<{ exists: boolean; data(): Document | undefined }>;
  delete(): Promise<unknown>;
}

interface FirestoreCollection {
  doc(id: string): FirestoreDoc;
  get(): Promise<{ docs: { id: string; data(): Document }[] }>;
}

interface FirestoreClient {
  collection(name: string): FirestoreCollection;
  terminate(): Promise<void>;
}

/**
 * Google Cloud Firestore.
 *
 * Credentials come from the ambient Google application-default chain, the same
 * way every other Google client library resolves them, so nothing sensitive
 * needs to live in the connection string.
 */
export async function createFirestoreDriver(dsn: ParsedDsn): Promise<DocumentDriver> {
  const { Firestore } = await importOptional<{
    Firestore: new (config: Record<string, unknown>) => FirestoreClient;
  }>('@google-cloud/firestore', 'firestore', '@google-cloud/firestore');

  const config: Record<string, unknown> = { projectId: dsn.project };
  if (dsn.database && dsn.database !== '(default)') {
    config.databaseId = dsn.database;
  }
  const db = new Firestore(config);

  return {
    async connect() {
      // Firestore connects lazily on first operation; nothing to open here.
    },

    async close() {
      await db.terminate();
    },

    async ping() {
      await db.collection(COLLECTIONS.contexts).get();
    },

    async get(collection, id) {
      const snapshot = await db.collection(COLLECTIONS[collection]).doc(id).get();
      if (!snapshot.exists) {
        return undefined;
      }
      return { ...(snapshot.data() ?? {}), id };
    },

    async put(collection, id, document) {
      await db.collection(COLLECTIONS[collection]).doc(id).set(document);
    },

    async remove(collection, id) {
      await db.collection(COLLECTIONS[collection]).doc(id).delete();
    },

    async list(collection) {
      const snapshot = await db.collection(COLLECTIONS[collection]).get();
      return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    },
  };
}
