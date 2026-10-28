# Chimple OpenWA Production API Guide

This document describes the supported APIs for sending WhatsApp messages and reading WhatsApp group
information from an external server or trusted client.

## Production configuration

| Setting               | Production value                       |
| --------------------- | -------------------------------------- |
| Dashboard             | `https://mcp.chimple.net/openwa/`      |
| API base URL          | `https://mcp.chimple.net/openwa/api`   |
| WhatsApp session ID   | `57c032a1-a20d-4849-aa6a-eaeac756883a` |
| Authentication header | `X-API-Key: YOUR_API_KEY`              |
| Request content type  | `application/json; charset=utf-8`      |

Use the URL exactly as shown. Do not copy Markdown link syntax such as `[https://...](https://...)`
into cURL, Postman, or application code.

## Authentication and security

Every request requires an active operator API key:

```http
X-API-Key: YOUR_API_KEY
```

Replace `YOUR_API_KEY` with a newly generated operator key from the dashboard's **API Keys** page.
Restrict the key to session `57c032a1-a20d-4849-aa6a-eaeac756883a` and, when possible, to the public
IPv4 address of the calling server.

Never commit an API key to source control, place it in browser JavaScript, include it in screenshots,
or paste it into documentation. Store it in an environment variable or secret manager. Revoke any
key that has been exposed.

Example environment variables:

```dotenv
OPENWA_BASE_URL=https://mcp.chimple.net/openwa/api
OPENWA_SESSION_ID=57c032a1-a20d-4849-aa6a-eaeac756883a
OPENWA_API_KEY=REPLACE_WITH_A_NEW_OPERATOR_API_KEY
```

Validate the key before integrating:

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/auth/validate' \
  -H 'X-API-Key: YOUR_API_KEY'
```

## WhatsApp identifiers

| Recipient  | Format                           | Example                   |
| ---------- | -------------------------------- | ------------------------- |
| Group      | `<group-number>@g.us`            | `120363406850971874@g.us` |
| Individual | `<country-code-and-number>@c.us` | `919876543210@c.us`       |

Do not include `+`, spaces, or hyphens in individual phone numbers. In JSON, `@` does not need to be
escaped: use `120363406850971874@g.us`, not `120363406850971874\@g.us`.

## 1. Check whether the WhatsApp session is active

Use this endpoint before sending when the caller needs to know whether the WhatsApp session is ready.
The request is read-only and does not enter the message jitter queue.

**Method:** `GET`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a
```

### Required parameters

| Parameter   | Location | Type        | Required | Description                                   |
| ----------- | -------- | ----------- | -------- | --------------------------------------------- |
| `sessionId` | URL path | UUID string | Yes      | Already included in the production URL above. |
| `X-API-Key` | Header   | String      | Yes      | Active API key allowed to access the session. |

### cURL example

```bash
curl 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a' \
  -H 'X-API-Key: YOUR_API_KEY'
```

### Successful response

Status: `200 OK`

```json
{
  "id": "57c032a1-a20d-4849-aa6a-eaeac756883a",
  "name": "api-session",
  "status": "ready",
  "phone": "919876543210",
  "pushName": "Chimple",
  "connectedAt": "2026-10-27T08:40:00.000Z",
  "lastActive": "2026-10-27T08:45:00.000Z",
  "lastError": null,
  "restriction": null,
  "engineLoaded": true
}
```

Treat the session as available for message sending only when `status` is exactly `ready`.
`engineLoaded: true` only means the gateway has an engine process; it can remain true temporarily
while that engine is disconnected or reconnecting.

| `status` value    | Can send? | Meaning                                           |
| ----------------- | --------- | ------------------------------------------------- |
| `ready`           | Yes       | WhatsApp is connected and ready to send/receive.  |
| `initializing`    | No        | The engine is starting. Retry after a delay.      |
| `qr_ready`        | No        | The session must be linked using QR/pairing.      |
| `authenticating`  | No        | Login is being completed. Retry after a delay.    |
| `disconnected`    | No        | WhatsApp is offline or reconnecting.              |
| `action_required` | No        | Human action is required; inspect `lastError`.    |
| `failed`          | No        | The engine failed; inspect `lastError`.           |
| `created`         | No        | The session exists but has not finished starting. |

Other responses are `401` for a missing/invalid key, `403` when the key cannot access this session,
and `404` when the session UUID does not exist.

## 2. Send a text message

**Method:** `POST`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-text
```

### Required parameters

| Parameter      | Location  | Type        | Required | Description                                                         |
| -------------- | --------- | ----------- | -------- | ------------------------------------------------------------------- |
| `sessionId`    | URL path  | UUID string | Yes      | Already included in the production URL above.                       |
| `X-API-Key`    | Header    | String      | Yes      | Active operator API key.                                            |
| `Content-Type` | Header    | String      | Yes      | Use `application/json; charset=utf-8`.                              |
| `chatId`       | JSON body | String      | Yes      | Target group ID ending in `@g.us`, or individual ending in `@c.us`. |
| `text`         | JSON body | String      | Yes      | Message text, maximum 4,096 characters.                             |

### Optional body parameters

| Parameter         | Type         | Description                                                                       |
| ----------------- | ------------ | --------------------------------------------------------------------------------- |
| `mentions`        | String array | Participant IDs to mention. The text must contain the matching `@<number>` token. |
| `linkPreview`     | Boolean      | Enables or disables URL preview behavior.                                         |
| `quotedMessageId` | String       | Message ID to quote/reply to.                                                     |

### cURL example

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-text' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{
    "chatId": "120363406850971874@g.us",
    "text": "ನಮಸ್ಕಾರ! नमस्ते! Hello!"
  }'
```

The `text` field accepts Unicode, including Kannada, Hindi, English, emoji, and mixed-language text.
Save request bodies and source files as UTF-8 and send JSON directly. Do not URL-encode the message,
send it as form data, or add backslashes before non-ASCII characters. For clients that cannot safely
place multilingual text directly in a shell command, save the following as a UTF-8 `payload.json`:

```json
{
  "chatId": "120363406850971874@g.us",
  "text": "ನಮಸ್ಕಾರ! नमस्ते! Hello! 👋"
}
```

Then send its exact bytes:

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-text' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json; charset=utf-8' \
  --data-binary '@payload.json'
```

### Successful response

Status: `201 Created`

```json
{
  "messageId": "MESSAGE_ID_FROM_WHATSAPP",
  "timestamp": 1792040000
}
```

`201` means the message was accepted by the connected WhatsApp client. It does not itself confirm
delivery or reading by every recipient.

## 3. Send a video message

**Method:** `POST`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-video
```

### Required parameters

| Parameter         | Location  | Type   | Required      | Description                                                                   |
| ----------------- | --------- | ------ | ------------- | ----------------------------------------------------------------------------- |
| `X-API-Key`       | Header    | String | Yes           | Active operator API key.                                                      |
| `Content-Type`    | Header    | String | Yes           | Must be `application/json`.                                                   |
| `chatId`          | JSON body | String | Yes           | Destination group or individual chat ID.                                      |
| `url` or `base64` | JSON body | String | Yes           | Supply exactly one media source. URLs must be reachable by the OpenWA server. |
| `mimetype`        | JSON body | String | With `base64` | Required when media is supplied as Base64, for example `video/mp4`.           |

Optional fields are `caption` (maximum 1,024 characters), `mentions`, and `quotedMessageId`.

### cURL example using a public URL

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-video' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "chatId": "120363406850971874@g.us",
    "url": "https://example.com/video.mp4",
    "caption": "Video update"
  }'
```

Success returns `201 Created` with `messageId` and `timestamp`.

The `caption` field is the text message displayed with the video.

## 4. Send a voice message

**Method:** `POST`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-audio
```

### Required parameters

| Parameter         | Location  | Type    | Required          | Description                                                        |
| ----------------- | --------- | ------- | ----------------- | ------------------------------------------------------------------ |
| `X-API-Key`       | Header    | String  | Yes               | Active operator API key.                                           |
| `Content-Type`    | Header    | String  | Yes               | Must be `application/json`.                                        |
| `chatId`          | JSON body | String  | Yes               | Destination group or individual chat ID.                           |
| `url` or `base64` | JSON body | String  | Yes               | Supply exactly one audio source.                                   |
| `mimetype`        | JSON body | String  | With `base64`     | Use `audio/ogg; codecs=opus` for reliable voice-note playback.     |
| `ptt`             | JSON body | Boolean | For voice-note UI | Set to `true` to show the WhatsApp voice-note bubble and waveform. |

### cURL example

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-audio' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "chatId": "120363406850971874@g.us",
    "url": "https://example.com/voice-note.ogg",
    "ptt": true
  }'
```

Success returns `201 Created` with `messageId` and `timestamp`.

WhatsApp voice notes do not support a visible caption. To send a voice note and visible text in one
API request, use the bulk endpoint and place an `audio` item followed by a `text` item for the same
`chatId`. The queue sends them in order with jitter:

```json
{
  "messages": [
    {
      "chatId": "120363406850971874@g.us",
      "type": "audio",
      "content": {
        "audio": {
          "url": "https://example.com/voice-note.ogg",
          "ptt": true
        }
      }
    },
    {
      "chatId": "120363406850971874@g.us",
      "type": "text",
      "content": {
        "text": "Text sent with the voice update"
      }
    }
  ],
  "options": {
    "randomizeDelay": true,
    "minDelayBetweenMessages": 2000,
    "maxDelayBetweenMessages": 10000
  }
}
```

## 5. Send a file or document

**Method:** `POST`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-document
```

### Required parameters

| Parameter         | Location  | Type   | Required      | Description                                               |
| ----------------- | --------- | ------ | ------------- | --------------------------------------------------------- |
| `X-API-Key`       | Header    | String | Yes           | Active operator API key.                                  |
| `Content-Type`    | Header    | String | Yes           | Must be `application/json`.                               |
| `chatId`          | JSON body | String | Yes           | Destination group or individual chat ID.                  |
| `url` or `base64` | JSON body | String | Yes           | Supply exactly one file source.                           |
| `mimetype`        | JSON body | String | With `base64` | File MIME type, for example `application/pdf`.            |
| `filename`        | JSON body | String | Recommended   | Filename displayed in WhatsApp, for example `report.pdf`. |

Use the optional `caption` field to send visible text with the file. Its maximum length is 1,024
characters.

### cURL example

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-document' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "chatId": "120363406850971874@g.us",
    "url": "https://example.com/report.pdf",
    "mimetype": "application/pdf",
    "filename": "report.pdf",
    "caption": "Please read the attached report"
  }'
```

Success returns `201 Created` with `messageId` and `timestamp`.

## 6. Send a poll message

This endpoint sends a native WhatsApp poll to a group or individual chat. It uses the same
per-session FIFO queue as the other send APIs, so simultaneous calls for the same session are sent
one at a time with the configured 2–10 second jitter.

**Method:** `POST`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-poll
```

### Required parameters

| Parameter      | Location  | Type         | Required | Description                                                            |
| -------------- | --------- | ------------ | -------- | ---------------------------------------------------------------------- |
| `X-API-Key`    | Header    | String       | Yes      | Active operator API key.                                               |
| `Content-Type` | Header    | String       | Yes      | Must be `application/json`.                                            |
| `chatId`       | JSON body | String       | Yes      | Target group ending in `@g.us`, or individual ending in `@c.us`.       |
| `name`         | JSON body | String       | Yes      | Poll question/title. Maximum 255 characters.                           |
| `options`      | JSON body | String array | Yes      | Between 2 and 12 choices. Each choice has a maximum of 100 characters. |

### Optional body parameters

| Parameter              | Type    | Description                                                     |
| ---------------------- | ------- | --------------------------------------------------------------- |
| `allowMultipleAnswers` | Boolean | `false` by default. Set to `true` to allow multiple selections. |
| `quotedMessageId`      | String  | Message ID to quote when sending the poll.                      |

### cURL example: single-choice poll

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-poll' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "chatId": "120363406850971874@g.us",
    "name": "Which day should we conduct the meeting?",
    "options": ["Monday", "Tuesday", "Wednesday"],
    "allowMultipleAnswers": false
  }'
```

For a poll where participants can choose more than one answer, send
`"allowMultipleAnswers": true`.

Success returns `201 Created` with `messageId` and `timestamp`. The poll send is included in message
analytics as an outgoing message of type `poll`.

## 7. Get all groups

**Method:** `GET`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/groups
```

### Parameters

| Parameter   | Location | Type    | Required | Description                                                  |
| ----------- | -------- | ------- | -------- | ------------------------------------------------------------ |
| `X-API-Key` | Header   | String  | Yes      | Active operator API key.                                     |
| `limit`     | Query    | Integer | No       | Number of groups to return, from 1 to 1,000. Default: 1,000. |
| `offset`    | Query    | Integer | No       | Number of groups to skip. Default: 0.                        |

### cURL example

```bash
curl 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/groups?limit=1000&offset=0' \
  -H 'X-API-Key: YOUR_API_KEY'
```

### Successful response

Status: `200 OK`

```json
[
  {
    "id": "120363406850971874@g.us",
    "name": "Example group",
    "linkedParentJID": null
  }
]
```

If more than 1,000 groups exist, request the next page with `offset=1000`, then `offset=2000`, until
the response contains fewer than `limit` records.

## 8. Get group data by group ID

**Method:** `GET`

**Production URL pattern:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/groups/GROUP_ID
```

### Required parameters

| Parameter   | Location | Type   | Required | Description                                                             |
| ----------- | -------- | ------ | -------- | ----------------------------------------------------------------------- |
| `X-API-Key` | Header   | String | Yes      | Active operator API key.                                                |
| `groupId`   | URL path | String | Yes      | WhatsApp group ID ending in `@g.us`. URL-encode it in application code. |

### cURL example

```bash
curl 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/groups/120363406850971874%40g.us' \
  -H 'X-API-Key: YOUR_API_KEY'
```

The response includes the group ID, name, description, owner, participants, creation time, and group
settings when WhatsApp makes those fields available.

## 9. Get group data from an invite link

This endpoint previews information exposed by an invite without joining the group.

**Method:** `GET`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/groups/join-info
```

### Required parameters

| Parameter   | Location | Type   | Required | Description                                                            |
| ----------- | -------- | ------ | -------- | ---------------------------------------------------------------------- |
| `X-API-Key` | Header   | String | Yes      | Active operator API key.                                               |
| `code`      | Query    | String | Yes      | Complete `https://chat.whatsapp.com/...` link or the bare invite code. |

### cURL example

Use `--data-urlencode` so the complete invite link is encoded correctly:

```bash
curl --get 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/groups/join-info' \
  -H 'X-API-Key: YOUR_API_KEY' \
  --data-urlencode 'code=https://chat.whatsapp.com/INVITE_CODE'
```

The successful response includes at least `id` and `name`. It may also include `description`,
`owner`, `createdAt`, and `participantCount` when WhatsApp discloses them.

## 10. Get analytics for multiple groups

**Method:** `POST`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/stats/groups
```

### Required parameters

| Parameter      | Location  | Type         | Required | Description                                                      |
| -------------- | --------- | ------------ | -------- | ---------------------------------------------------------------- |
| `X-API-Key`    | Header    | String       | Yes      | Active operator API key allowed to access the session.           |
| `Content-Type` | Header    | String       | Yes      | Must be `application/json`.                                      |
| `groupIds`     | JSON body | String array | Yes      | 1–200 unique WhatsApp group IDs ending in `@g.us`.               |
| `days`         | JSON body | Integer      | Yes      | Rolling analytics window from 1–90 days, ending at request time. |

### cURL example

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/stats/groups' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "groupIds": [
      "120363406850971874@g.us",
      "120363000000000002@g.us"
    ],
    "days": 7
  }'
```

The response includes:

- `windowStart`, `windowEnd`, and `days`;
- the normalized `groupIds` used by the query;
- combined sent, received, interaction, delivery, read, and reaction counts;
- hourly time-series data for one day, or daily data for longer ranges;
- message-type analytics; and
- per-group message, delivery, read, and reaction analytics.

The result is restricted to the session UUID in the URL. A session-scoped API key cannot use this
endpoint to read analytics from another login's WhatsApp session.

## 11. Send messages to multiple groups with jitter

The bulk API accepts up to 100 messages per request and starts asynchronous processing. Messages for
the same WhatsApp session are processed sequentially, with random pacing between sends.

**Method:** `POST`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-bulk
```

### Required parameters

| Parameter            | Location  | Type   | Required | Description                                       |
| -------------------- | --------- | ------ | -------- | ------------------------------------------------- |
| `X-API-Key`          | Header    | String | Yes      | Active operator API key.                          |
| `Content-Type`       | Header    | String | Yes      | Must be `application/json`.                       |
| `messages`           | JSON body | Array  | Yes      | Between 1 and 100 message objects.                |
| `messages[].chatId`  | JSON body | String | Yes      | Destination group ID.                             |
| `messages[].type`    | JSON body | String | Yes      | `text`, `image`, `video`, `audio`, or `document`. |
| `messages[].content` | JSON body | Object | Yes      | Content matching the selected message type.       |

### Jitter options

| Parameter                 | Type    | Required | Description                                                      |
| ------------------------- | ------- | -------- | ---------------------------------------------------------------- |
| `randomizeDelay`          | Boolean | No       | Enable randomized delay. Use `true`.                             |
| `minDelayBetweenMessages` | Number  | No       | Minimum delay in milliseconds. Use `2000`.                       |
| `maxDelayBetweenMessages` | Number  | No       | Maximum delay in milliseconds. Use `10000`.                      |
| `stopOnError`             | Boolean | No       | `false` continues processing remaining groups after one failure. |

### cURL example

```bash
curl -X POST 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/send-bulk' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [
      {
        "chatId": "120363406850971874@g.us",
        "type": "text",
        "content": {
          "text": "Hello group one"
        }
      },
      {
        "chatId": "120363000000000002@g.us",
        "type": "text",
        "content": {
          "text": "Hello group two"
        }
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

### Accepted response

Status: `202 Accepted`

```json
{
  "batchId": "BATCH_ID",
  "status": "pending",
  "totalMessages": 2,
  "estimatedCompletionTime": "2026-10-15T12:00:00.000Z",
  "statusUrl": "/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/batch/BATCH_ID"
}
```

Check the batch until its status becomes `completed`, `failed`, or `cancelled`:

```bash
curl 'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/messages/batch/BATCH_ID' \
  -H 'X-API-Key: YOUR_API_KEY'
```

## 12. Check multiple numbers on WhatsApp

This read-only endpoint checks up to 100 phone numbers in one HTTP request. The server removes a
leading `+`, checks duplicate numbers once, and preserves first-seen order. WhatsApp lookups run
sequentially with a random 250–500 ms pause so one bulk request does not create an unbounded burst.

**Method:** `POST`

**Production URL:**

```text
https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/contacts/check-bulk
```

### Required parameters

| Parameter      | Location  | Type         | Required | Description                                        |
| -------------- | --------- | ------------ | -------- | -------------------------------------------------- |
| `sessionId`    | URL path  | UUID string  | Yes      | Already included in the production URL above.      |
| `X-API-Key`    | Header    | String       | Yes      | Active API key allowed to access the session.      |
| `Content-Type` | Header    | String       | Yes      | Use `application/json; charset=utf-8`.             |
| `numbers`      | JSON body | String array | Yes      | Between 1 and 100 numbers, including country code. |

Each number must contain 5–15 digits. A single leading `+` is accepted; spaces, hyphens, and other
characters are rejected.

### cURL example

```bash
curl -X POST \
  'https://mcp.chimple.net/openwa/api/sessions/57c032a1-a20d-4849-aa6a-eaeac756883a/contacts/check-bulk' \
  -H 'X-API-Key: YOUR_API_KEY' \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{
    "numbers": [
      "919876543210",
      "919876543211",
      "+919876543212"
    ]
  }'
```

### Successful response

Status: `200 OK`

```json
{
  "total": 3,
  "registered": 1,
  "notRegistered": 1,
  "failed": 1,
  "results": [
    {
      "number": "919876543210",
      "exists": true,
      "whatsappId": "919876543210@c.us",
      "error": null
    },
    {
      "number": "919876543211",
      "exists": false,
      "whatsappId": null,
      "error": null
    },
    {
      "number": "919876543212",
      "exists": null,
      "whatsappId": null,
      "error": "WhatsApp did not answer this number-check query; retry this number later"
    }
  ]
}
```

`exists: false` is a confirmed unregistered number. `exists: null` means WhatsApp did not answer that
lookup, so retry that number later; it must not be treated as unregistered. A disconnected session
returns `409` for the whole request.

## Queue and jitter behavior

All outbound API send endpoints use a server-side FIFO queue for each WhatsApp session. When several
requests arrive together for session `57c032a1-a20d-4849-aa6a-eaeac756883a`, only one WhatsApp send
runs at a time. Following sends start after a random 2–10 second gap. This includes separate API
requests and individual messages inside a bulk request.

Requests using different session IDs have independent queues.

Read-only data APIs do not enter the send queue. Getting all groups, getting group data by ID or
invite link, reading analytics, and reading message history return independently even when outbound
messages for the same session are waiting. The first send starts immediately; only subsequent
back-to-back sends for that session wait for the randomized gap.

## JavaScript example

```javascript
const baseUrl = 'https://mcp.chimple.net/openwa/api';
const sessionId = '57c032a1-a20d-4849-aa6a-eaeac756883a';
const apiKey = process.env.OPENWA_API_KEY;

async function sendText(chatId, text) {
  const response = await fetch(`${baseUrl}/sessions/${sessionId}/messages/send-text`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chatId, text }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenWA ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const result = await sendText('120363406850971874@g.us', 'Hi');
console.log(result);
```

## Common status codes

| Status | Meaning                                                     | Recommended action                                               |
| ------ | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `200`  | Read request succeeded.                                     | Process the returned data.                                       |
| `201`  | Message accepted for sending.                               | Store the returned `messageId`; this is not a delivery receipt.  |
| `202`  | Bulk batch accepted.                                        | Poll the returned `statusUrl`.                                   |
| `400`  | Invalid payload, missing parameter, or session not started. | Correct the request and confirm the session is active.           |
| `401`  | Missing, invalid, expired, or revoked API key.              | Supply a valid operator key.                                     |
| `403`  | Role, IP, or session restriction denied the request.        | Check key permissions and allowed session/IP settings.           |
| `404`  | Group, invite, session, or batch was not found.             | Verify the identifier or invite link.                            |
| `409`  | WhatsApp engine exists but is not ready.                    | Wait briefly for the session to become ready, then retry.        |
| `429`  | Rate limit reached.                                         | Honor the retry header and retry with backoff.                   |
| `503`  | WhatsApp did not answer within the request timeout.         | Retry with exponential backoff; avoid immediate duplicate sends. |

## Browser clients and CORS

Server-to-server requests, Postman, and native mobile clients do not require CORS configuration. A
browser making direct requests requires its exact origin in `CORS_ORIGINS`. Do not expose a
long-lived operator API key in a browser bundle; call OpenWA through your own authenticated backend.

## Interactive documentation

Sign in using the dedicated API/operator dashboard login and open **API Documentation**. The page is
available only to that login and provides editable parameters, generated cURL, response details, and
a **Check API** button for these nine supported operations.
