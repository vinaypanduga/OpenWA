import { BadRequestException } from '@nestjs/common';

type VisualMediaKind = 'image' | 'video';

/** Reject a known response type that cannot be sent through the selected media endpoint. */
export function assertMediaKind(mimetype: string, expected: VisualMediaKind): void {
  const actual = mimetype.split(';', 1)[0].trim().toLowerCase();
  // Some otherwise valid file hosts omit Content-Type. Preserve the established fallback for those;
  // this guard targets positively wrong responses such as text/html and video/mp4 on send-image.
  if (!actual || actual === 'application/octet-stream' || actual.startsWith(`${expected}/`)) return;

  const suggestion = expected === 'image' && actual.startsWith('video/') ? ' Select the Video message type.' : '';
  throw new BadRequestException(
    `Cannot send this URL as an ${expected}: it returned '${actual}', not '${expected}/*'. ` +
      `Provide a direct ${expected} URL.${suggestion}`,
  );
}
