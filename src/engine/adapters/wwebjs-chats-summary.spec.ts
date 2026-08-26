import type { Client } from 'whatsapp-web.js';
import { WwebjsChats } from './wwebjs-chats';
import type { WwebjsEngineHost } from './wwebjs-host';
import type { WwebjsMessaging } from './wwebjs-messaging';

describe('WwebjsChats lightweight chat summaries', () => {
  it('projects chat primitives in the page instead of calling Client.getChats()', async () => {
    const rawChats = [
      {
        id: { _serialized: '628111@c.us' },
        formattedTitle: 'Alice',
        unreadCount: 3,
        t: 1_700_000_000,
        lastReceivedKey: { _serialized: 'message-1' },
      },
      {
        id: { $1: '120363@g.us' },
        formattedTitle: 'Family',
        groupMetadata: { deliberately: 'not serialized' },
        lastReceivedKey: { $1: 'message-2' },
      },
      { id: {} },
    ];
    const messages = new Map([
      ['message-1', { type: 'chat', body: 'hello' }],
      ['message-2', { type: 'location', body: 'large map thumbnail must not escape' }],
    ]);
    const getChats = jest.fn();
    const evaluate = jest.fn((projection: () => unknown) => {
      const runtime = globalThis as unknown as { require?: (name: string) => unknown };
      const previousRequire = runtime.require;
      runtime.require = () => ({
        Chat: { getModelsArray: () => rawChats },
        Msg: { get: (id: string) => messages.get(id) },
      });
      try {
        return projection();
      } finally {
        runtime.require = previousRequire;
      }
    });
    const warn = jest.fn();
    const client = { getChats, pupPage: { evaluate } };
    const host = {
      ensureReady: jest.fn(),
      getClient: () => client as unknown as Client,
      isPageTransportError: () => false,
      reportIfPageTransportError: jest.fn(),
      logger: { warn },
    } as unknown as WwebjsEngineHost;

    const chats = new WwebjsChats(host, {} as WwebjsMessaging);

    await expect(chats.getChats()).resolves.toEqual([
      {
        id: '628111@c.us',
        name: 'Alice',
        isGroup: false,
        kind: 'individual',
        unreadCount: 3,
        timestamp: 1_700_000_000,
        lastMessage: 'hello',
      },
      {
        id: '120363@g.us',
        name: 'Family',
        isGroup: true,
        kind: 'group',
        unreadCount: 0,
        timestamp: 0,
        lastMessage: '📍',
      },
    ]);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(getChats).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Skipped 1 chat(s) without a serialized id');
  });
});
