# External API Integration

OpenWA already exposes authenticated REST APIs that another server, mobile app, Postman, or a
trusted client can call. For the Chimple deployment, use this base URL:

```text
https://mcp.chimple.net/openwa/api
```

## Authentication

Create an `operator` API key from the dashboard's **API Keys** page. Restrict it to the required
WhatsApp session and, for server-to-server integrations, the caller's public IPv4 address whenever
possible. The plaintext key is shown only when it is created.

Send the key in either of these headers:

```http
X-API-Key: owa_k1_your_key
```

```http
Authorization: Bearer owa_k1_your_key
```

Do not embed an API key in browser JavaScript or a public mobile-app bundle. Those clients should
call their own backend, and that backend should keep the OpenWA key in a secret store.

Validate a key before using it:

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/auth/validate' \
  -H 'X-API-Key: YOUR_API_KEY'
```

## Discover sessions and groups

List the sessions visible to the key:

```bash
curl 'https://mcp.chimple.net/openwa/api/sessions' \
  -H 'X-API-Key: YOUR_API_KEY'
```

Use the session's UUID in every following URL. List all groups with pagination:

```bash
curl 'https://mcp.chimple.net/openwa/api/sessions/SESSION_ID/groups?limit=1000&offset=0' \
  -H 'X-API-Key: YOUR_API_KEY'
```

Read one group's details, including its participants:

```bash
curl 'https://mcp.chimple.net/openwa/api/sessions/SESSION_ID/groups/GROUP_ID' \
  -H 'X-API-Key: YOUR_API_KEY'
```

`GROUP_ID` normally ends with `@g.us`. URL-encode IDs when constructing URLs in application code.

## Send a message

Send text to either an individual (`<phone>@c.us`) or a group (`<id>@g.us`):

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/SESSION_ID/messages/send-text' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "chatId": "120363000000000000@g.us",
    "text": "Hello from the external server"
  }'
```

Send an image by URL:

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/SESSION_ID/messages/send-image' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "chatId": "120363000000000000@g.us",
    "url": "https://example.com/image.jpg",
    "caption": "Monthly update"
  }'
```

Equivalent endpoints exist for `send-video`, `send-audio`, `send-document`, `send-location`,
`send-contact`, `send-poll`, `reply`, `forward`, and message reactions.

## Send a paced batch

The batch endpoint accepts at most 100 messages per request and processes them asynchronously. Use
random pacing rather than issuing concurrent send requests from the calling server.

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/SESSION_ID/messages/send-bulk' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [
      {
        "chatId": "120363000000000001@g.us",
        "type": "text",
        "content": { "text": "Hello group one" }
      },
      {
        "chatId": "120363000000000002@g.us",
        "type": "text",
        "content": { "text": "Hello group two" }
      }
    ],
    "options": {
      "randomizeDelay": true,
      "minDelayBetweenMessages": 2000,
      "maxDelayBetweenMessages": 10000,
      "stopOnError": false
    }
  }'
```

The response contains a `batchId` and `statusUrl`. Poll it until the batch reaches a terminal state:

```bash
curl 'https://mcp.chimple.net/openwa/api/sessions/SESSION_ID/messages/batch/BATCH_ID' \
  -H 'X-API-Key: YOUR_API_KEY'
```

## Server-side JavaScript example

```javascript
const baseUrl = 'https://mcp.chimple.net/openwa/api';
const sessionId = process.env.OPENWA_SESSION_ID;
const apiKey = process.env.OPENWA_API_KEY;

async function openwa(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`OpenWA ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const groups = await openwa(`/sessions/${encodeURIComponent(sessionId)}/groups?limit=1000`);
const details = await openwa(`/sessions/${encodeURIComponent(sessionId)}/groups/${encodeURIComponent(groups[0].id)}`);
const sent = await openwa(`/sessions/${encodeURIComponent(sessionId)}/messages/send-text`, {
  method: 'POST',
  body: JSON.stringify({ chatId: details.id, text: 'Hello from another server' }),
});

console.log(sent);
```

## Browser clients and CORS

Server-to-server requests, Postman, and mobile clients do not require CORS. A browser calling OpenWA
directly requires its exact origin in `CORS_ORIGINS`, for example:

```dotenv
CORS_ORIGINS=https://your-client.example.com
```

Even with CORS enabled, a long-lived operator key should not be shipped to an untrusted browser.
Prefer a backend-for-frontend that authenticates the user and performs only the allowed OpenWA call.

## Errors and retry behavior

- `400`: invalid body, inactive session, or invalid recipient.
- `401`: missing or invalid API key.
- `403`: insufficient role, IP/session restriction, or a WhatsApp permission refusal.
- `404`: session, group, message, or batch not found.
- `409`: WhatsApp engine is not ready; retry after the session becomes ready.
- `429`: rate limited; honor the response's `Retry-After-*` header.
- `503`: WhatsApp did not answer within the request budget; retry with backoff.

For the complete contract, use `openapi.json` or enable Swagger and open `/api/docs`.
