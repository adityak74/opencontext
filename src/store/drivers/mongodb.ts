import type { Collection, Document, DocumentDriver } from '../adapters/document.js';
import type { ParsedDsn } from '../dsn.js';
import { importOptional } from './optional.js';

const COLLECTIONS: Record<Collection, string> = {
  contexts: 'oc_contexts',
  bubbles: 'oc_bubbles',
};

interface MongoCollection {
  findOne(filter: Document): Promise<Document | null>;
  replaceOne(filter: Document, doc: Document, options: Document): Promise<unknown>;
  deleteOne(filter: Document): Promise<unknown>;
  find(filter: Document): { toArray(): Promise<Document[]> };
  createIndex(spec: Document, options?: Document): Promise<unknown>;
}

interface MongoDb {
  collection(name: string): MongoCollection;
  command(command: Document): Promise<unknown>;
}

interface MongoClientLike {
  connect(): Promise<unknown>;
  db(name?: string): MongoDb;
  close(): Promise<void>;
}

/**
 * Rewrite the scheme to one the Node driver accepts.
 *
 * The connection string is handed to the driver verbatim so that every Mongo
 * option keeps working, but the driver accepts only `mongodb://` and
 * `mongodb+srv://` — literally, and case-sensitively. Our DSN parser is more
 * forgiving: it accepts the `mongo://` alias and any casing. Without this,
 * `mongo://host/db` parses fine and then dies inside the driver with
 * "Invalid scheme", which reads like a bug in the user's connection string.
 *
 * `mongodb+srv://` is preserved, because dropping the `+srv` would turn an Atlas
 * SRV lookup into a direct connection to a host that does not answer.
 */
function canonicalConnectionString(raw: string): string {
  return raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, (scheme) =>
    scheme.toLowerCase() === 'mongodb+srv:' ? 'mongodb+srv:' : 'mongodb:',
  );
}

/**
 * MongoDB, including Atlas (`mongodb+srv://`) and Azure Cosmos DB's Mongo API.
 *
 * Documents are keyed by `_id` set to the opencontext id, so a lookup is a
 * primary-key hit rather than a scan.
 *
 * One Mongo-specific limit leaks through: a single BSON document cannot exceed
 * 16 MB, so a context whose content approaches that size cannot be saved here.
 * Every other backend takes it.
 */
export async function createMongoDriver(dsn: ParsedDsn): Promise<DocumentDriver> {
  const { MongoClient } = await importOptional<{
    MongoClient: new (url: string, options?: Document) => MongoClientLike;
  }>('mongodb', 'mongodb');

  // `ignoreUndefined` keeps an absent optional field — bubbleId, description —
  // absent. BSON's default is to encode `undefined` as `null`, which would make
  // this the one backend that answers `null` where the others answer nothing.
  const client = new MongoClient(canonicalConnectionString(dsn.raw), {
    ignoreUndefined: true,
  });
  let db: MongoDb;

  const collection = (name: Collection) => db.collection(COLLECTIONS[name]);

  /** Mongo stores the key as `_id`; the rest of the system calls it `id`. */
  const fromMongo = (doc: Document): Document => {
    const { _id, ...rest } = doc;
    return { ...rest, id: _id as string };
  };

  return {
    async connect() {
      await client.connect();
      db = client.db(dsn.database);
      await collection('contexts').createIndex({ bubbleId: 1 });
      await collection('contexts').createIndex({ createdAt: 1 });
    },

    async close() {
      await client.close();
    },

    async ping() {
      await db.command({ ping: 1 });
    },

    async get(name, id) {
      const found = await collection(name).findOne({ _id: id });
      return found ? fromMongo(found) : undefined;
    },

    async put(name, id, document) {
      const { id: _ignored, ...rest } = document;
      await collection(name).replaceOne({ _id: id }, { _id: id, ...rest }, { upsert: true });
    },

    async remove(name, id) {
      await collection(name).deleteOne({ _id: id });
    },

    async list(name) {
      return (await collection(name).find({}).toArray()).map(fromMongo);
    },
  };
}
