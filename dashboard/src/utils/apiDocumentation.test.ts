import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  collectApiOperations,
  collectIntegrationOperations,
  curlForOperation,
  exampleFromSchema,
  resolveApiRequest,
  type OpenApiDocument,
} from './apiDocumentation.ts';

const document: OpenApiDocument = {
  security: [{ 'X-API-Key': [] }],
  paths: {
    '/api/sessions/{sessionId}/messages': {
      post: {
        operationId: 'send',
        summary: 'Send',
        tags: ['messages'],
        parameters: [
          { name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'dryRun', in: 'query', schema: { type: 'boolean', default: false } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SendDto' } } },
        },
        responses: { '201': { description: 'Sent' } },
      },
    },
  },
  components: {
    schemas: {
      SendDto: {
        type: 'object',
        properties: { chatId: { type: 'string', example: '123@g.us' }, text: { type: 'string' } },
      },
    },
  },
};

test('collects operations and resolves referenced request examples', () => {
  const [operation] = collectApiOperations(document);
  assert.equal(operation?.tag, 'messages');
  assert.deepEqual(operation?.authSchemes, ['X-API-Key']);
  assert.deepEqual(exampleFromSchema(operation?.requestBody?.schema, document), { chatId: '123@g.us', text: '' });
});

test('uses the first explicit OpenAPI request example for an editable request body', () => {
  const exampleDocument: OpenApiDocument = {
    paths: {
      '/api/example': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object' },
                examples: {
                  readyToRun: { summary: 'Ready', value: { chatId: '123@g.us', text: 'Hello' } },
                },
              },
            },
          },
        },
      },
    },
  };

  assert.deepEqual(collectApiOperations(exampleDocument)[0]?.requestBody?.example, {
    chatId: '123@g.us',
    text: 'Hello',
  });
});

test('builds a prefix-safe request URL with encoded parameters', () => {
  const [operation] = collectApiOperations(document);
  assert.ok(operation);
  const request = resolveApiRequest('/openwa/api', operation, {
    'path:sessionId': 'session one',
    'query:dryRun': 'true',
  });
  assert.equal(request.url, '/openwa/api/sessions/session%20one/messages?dryRun=true');
});

test('refuses missing required path values', () => {
  const [operation] = collectApiOperations(document);
  assert.ok(operation);
  assert.throws(() => resolveApiRequest('/api', operation, {}), /sessionId is required/);
});

test('curl output uses a placeholder instead of exposing the signed-in key', () => {
  const [operation] = collectApiOperations(document);
  assert.ok(operation);
  const curl = curlForOperation('/openwa/api', operation, { 'path:sessionId': 's1' }, '{"text":"hello"}');
  assert.match(curl, /X-API-Key: YOUR_API_KEY/);
  assert.match(curl, /\/openwa\/api\/sessions\/s1\/messages/);
});

test('the committed OpenAPI contract is fully consumable by the dashboard', () => {
  const fullDocument = JSON.parse(
    readFileSync(new URL('../../../openapi.json', import.meta.url), 'utf8'),
  ) as OpenApiDocument;
  const operations = collectApiOperations(fullDocument);

  assert.ok(operations.length >= 199);
  for (const operation of operations) {
    if (operation.requestBody) exampleFromSchema(operation.requestBody.schema, fullDocument);
    assert.match(operation.path, /^\/api\//);
  }
});

test('the integration page exposes only the requested APIs in product order', () => {
  const fullDocument = JSON.parse(
    readFileSync(new URL('../../../openapi.json', import.meta.url), 'utf8'),
  ) as OpenApiDocument;

  assert.deepEqual(
    collectIntegrationOperations(fullDocument).map(operation => operation.summary),
    [
      'Check whether session is active',
      'Send text message',
      'Send video message',
      'Send voice message',
      'Send file/document',
      'Send poll message',
      'Get group data by group ID',
      'Get all groups',
      'Get group data by invite link',
      'Get analytics for multiple groups',
      'Send messages to multiple groups with jitter',
    ],
  );
});
