import type { Collection, Document, DocumentDriver } from '../adapters/document.js';
import type { ParsedDsn } from '../dsn.js';
import { importOptional } from './optional.js';

/**
 * Contexts and bubbles share one table, split by partition key, so listing
 * either collection is a `Query` against one partition rather than a full-table
 * `Scan`.
 */
const PARTITION: Record<Collection, string> = {
  contexts: 'CONTEXT',
  bubbles: 'BUBBLE',
};

/** How long to wait for a newly created table to accept reads and writes. */
const ACTIVE_POLL_ATTEMPTS = 60;
const ACTIVE_POLL_INTERVAL_MS = 1000;

type Sender = { send(command: unknown): Promise<Record<string, unknown>> };

function isAwsError(error: unknown, name: string): boolean {
  return (error as { name?: string } | undefined)?.name === name;
}

/**
 * Amazon DynamoDB.
 *
 * The table is created on first connect if it is absent, matching how the
 * file-based backends create their store on first use.
 *
 * Every read is strongly consistent. DynamoDB reads are eventually consistent by
 * default, which would let `getContext` right after `saveContext` return nothing
 * — the store contract (and the conformance suite) requires read-your-writes.
 * The cost is that a read consumes twice the read capacity units.
 */
export async function createDynamoDbDriver(dsn: ParsedDsn): Promise<DocumentDriver> {
  const client = await importOptional<Record<string, unknown>>(
    '@aws-sdk/client-dynamodb',
    'dynamodb',
    '@aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb',
  );
  const lib = await importOptional<Record<string, unknown>>(
    '@aws-sdk/lib-dynamodb',
    'dynamodb',
    '@aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb',
  );

  const DynamoDBClient = client.DynamoDBClient as new (config: unknown) => Sender & {
    destroy?(): void;
  };
  const CreateTableCommand = client.CreateTableCommand as new (input: unknown) => unknown;
  const DescribeTableCommand = client.DescribeTableCommand as new (input: unknown) => unknown;
  const DynamoDBDocumentClient = lib.DynamoDBDocumentClient as {
    from(base: unknown, translateConfig?: unknown): Sender;
  };
  const PutCommand = lib.PutCommand as new (input: unknown) => unknown;
  const GetCommand = lib.GetCommand as new (input: unknown) => unknown;
  const DeleteCommand = lib.DeleteCommand as new (input: unknown) => unknown;
  const QueryCommand = lib.QueryCommand as new (input: unknown) => unknown;

  const TableName = dsn.table!;
  const config: Record<string, unknown> = { region: dsn.region };
  if (dsn.params.endpoint) {
    config.endpoint = dsn.params.endpoint;
  }
  if (dsn.params.accessKeyId && dsn.params.secretAccessKey) {
    config.credentials = {
      accessKeyId: dsn.params.accessKeyId,
      secretAccessKey: dsn.params.secretAccessKey,
      // Temporary credentials from STS or a role need the session token too.
      ...(dsn.params.sessionToken ? { sessionToken: dsn.params.sessionToken } : {}),
    };
  }

  const base = new DynamoDBClient(config);
  const documents = DynamoDBDocumentClient.from(base, {
    marshallOptions: {
      // An unset optional field (`bubbleId`, `description`) is absent, not null.
      removeUndefinedValues: true,
      // Left off deliberately: it would rewrite empty strings and empty lists as
      // NULL, so `tags: []` and empty content would not survive a round trip.
      convertEmptyValues: false,
    },
  });

  /** The table's description, or undefined when it does not exist yet. */
  async function describeTable(): Promise<{ TableStatus?: string } | undefined> {
    try {
      const response = await base.send(new DescribeTableCommand({ TableName }));
      return (response.Table as { TableStatus?: string } | undefined) ?? {};
    } catch (error) {
      if (isAwsError(error, 'ResourceNotFoundException')) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Wait until the table accepts reads and writes.
   *
   * A table that exists is not necessarily usable: while it is `CREATING`, every
   * data-plane call fails with `ResourceNotFoundException`. Anything other than
   * a missing table — bad credentials, wrong endpoint — is raised immediately
   * rather than retried for a minute behind a misleading timeout message.
   */
  async function waitUntilActive(): Promise<void> {
    for (let attempt = 0; attempt < ACTIVE_POLL_ATTEMPTS; attempt += 1) {
      const table = await describeTable();
      if (table?.TableStatus === 'ACTIVE') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, ACTIVE_POLL_INTERVAL_MS));
    }
    throw new Error(`DynamoDB table "${TableName}" did not become ACTIVE in time.`);
  }

  return {
    async connect() {
      if (!(await describeTable())) {
        try {
          await base.send(
            new CreateTableCommand({
              TableName,
              BillingMode: 'PAY_PER_REQUEST',
              AttributeDefinitions: [
                { AttributeName: 'pk', AttributeType: 'S' },
                { AttributeName: 'sk', AttributeType: 'S' },
              ],
              KeySchema: [
                { AttributeName: 'pk', KeyType: 'HASH' },
                { AttributeName: 'sk', KeyType: 'RANGE' },
              ],
            }),
          );
        } catch (error) {
          // Another process created the table between the describe and the
          // create — the outcome we wanted, reported as a conflict.
          if (!isAwsError(error, 'ResourceInUseException')) {
            throw error;
          }
        }
      }
      // Table creation is asynchronous, and a table someone else is creating
      // right now is equally unusable, so always wait rather than only after a
      // create this process issued.
      await waitUntilActive();
    },

    async close() {
      base.destroy?.();
    },

    async ping() {
      await base.send(new DescribeTableCommand({ TableName }));
    },

    async get(collection, id) {
      const result = await documents.send(
        new GetCommand({
          TableName,
          Key: { pk: PARTITION[collection], sk: id },
          ConsistentRead: true,
        }),
      );
      const item = result.Item as Document | undefined;
      if (!item) {
        return undefined;
      }
      const { pk: _pk, sk: _sk, ...rest } = item;
      return { ...rest, id };
    },

    async put(collection, id, document) {
      await documents.send(
        new PutCommand({
          TableName,
          Item: { ...document, pk: PARTITION[collection], sk: id },
        }),
      );
    },

    async remove(collection, id) {
      await documents.send(
        new DeleteCommand({ TableName, Key: { pk: PARTITION[collection], sk: id } }),
      );
    },

    async list(collection) {
      const items: Document[] = [];
      let startKey: unknown;
      do {
        const result = await documents.send(
          new QueryCommand({
            TableName,
            KeyConditionExpression: '#pk = :pk',
            ExpressionAttributeNames: { '#pk': 'pk' },
            ExpressionAttributeValues: { ':pk': PARTITION[collection] },
            ConsistentRead: true,
            ...(startKey ? { ExclusiveStartKey: startKey } : {}),
          }),
        );
        for (const raw of (result.Items ?? []) as Document[]) {
          const { pk: _pk, sk, ...rest } = raw;
          items.push({ ...rest, id: sk as string });
        }
        startKey = result.LastEvaluatedKey;
      } while (startKey);
      return items;
    },
  };
}
