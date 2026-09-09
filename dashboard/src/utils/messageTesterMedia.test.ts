import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessageTesterMediaPayload } from './messageTesterMedia.ts';

test('builds one image payload containing both the uploaded image and its text caption', () => {
  assert.deepEqual(
    buildMessageTesterMediaPayload(
      'image',
      { base64: 'aW1hZ2U=', mimetype: 'image/png' },
      '',
      'Text sent with the image',
    ),
    {
      base64: 'aW1hZ2U=',
      mimetype: 'image/png',
      caption: 'Text sent with the image',
    },
  );
});

test('builds one URL image payload containing the caption', () => {
  assert.deepEqual(buildMessageTesterMediaPayload('image', null, ' https://example.com/photo.jpg ', 'Hello'), {
    url: 'https://example.com/photo.jpg',
    caption: 'Hello',
  });
});

test('does not add captions to audio or filename text to image payloads', () => {
  assert.deepEqual(buildMessageTesterMediaPayload('audio', null, 'https://example.com/audio.ogg', 'ignored'), {
    url: 'https://example.com/audio.ogg',
  });
});
