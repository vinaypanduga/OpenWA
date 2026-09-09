import type { SendMediaPayload } from '../services/api';

type MediaMessageType = 'image' | 'video' | 'audio' | 'document';

export interface MessageTesterMediaFile {
  base64: string;
  mimetype: string;
}

/**
 * Builds the flat send-media body used by the Message Tester. Image/video text belongs in the
 * media message's `caption` field; sending it separately would create a second WhatsApp message.
 */
export function buildMessageTesterMediaPayload(
  messageType: MediaMessageType,
  mediaFile: MessageTesterMediaFile | null,
  mediaUrl: string,
  content: string,
): SendMediaPayload {
  const payload: SendMediaPayload = mediaFile
    ? { base64: mediaFile.base64, mimetype: mediaFile.mimetype }
    : { url: mediaUrl.trim() };

  if ((messageType === 'image' || messageType === 'video') && content) {
    payload.caption = content;
  } else if (messageType === 'document' && content) {
    payload.filename = content;
  }

  return payload;
}
