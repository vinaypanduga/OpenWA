import { BadRequestException } from '@nestjs/common';
import { assertMediaKind } from './assert-media-kind';

describe('assertMediaKind', () => {
  it('accepts matching and unknown generic media types', () => {
    expect(() => assertMediaKind('image/png', 'image')).not.toThrow();
    expect(() => assertMediaKind('application/octet-stream', 'image')).not.toThrow();
  });

  it('rejects an HTML sharing page instead of handing it to WhatsApp as an image', () => {
    expect(() => assertMediaKind('text/html; charset=utf-8', 'image')).toThrow(BadRequestException);
  });

  it('tells an image sender to select Video when the URL is an MP4', () => {
    expect(() => assertMediaKind('video/mp4', 'image')).toThrow('Select the Video message type');
  });
});
