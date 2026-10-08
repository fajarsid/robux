import { TelegramBotService } from './telegram-bot.service';

describe('TelegramBotService', () => {
  const config = {
    telegram: {
      botToken: '123456:secret-bot-token',
      webhookSecret: 'webhook-secret-value',
      miniAppUrl: 'https://store.example.test/telegram-store',
    },
  } as never;
  const prisma = {
    telegramBotUpdate: { createMany: jest.fn(), deleteMany: jest.fn() },
    telegramIdentity: { upsert: jest.fn() },
  };
  const service = new TelegramBotService(config, prisma as never);

  beforeEach(() => {
    jest.restoreAllMocks();
    prisma.telegramBotUpdate.createMany.mockReset();
    prisma.telegramBotUpdate.deleteMany.mockReset();
    prisma.telegramIdentity.upsert.mockReset();
  });

  it('validates the webhook secret and deduplicates Telegram retries', async () => {
    expect(service.verifyWebhookSecret('wrong')).toBe(false);
    expect(service.verifyWebhookSecret('webhook-secret-value')).toBe(true);
    prisma.telegramBotUpdate.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    const update = {
      update_id: 99,
      message: { text: '/start', chat: { id: 123 }, from: { id: 123 } },
    };
    await service.handleUpdate(update);
    await service.handleUpdate(update);
    expect(prisma.telegramIdentity.upsert).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      chat_id: 123,
      reply_markup: {
        inline_keyboard: [[{ web_app: { url: 'https://store.example.test/telegram-store' } }]],
      },
    });
  });

  it('creates an owner-authorized Mini App deep link for an order notification', () => {
    expect(service.orderUrl('TG-10001')).toBe(
      'https://store.example.test/telegram-store?view=orders&order=TG-10001',
    );
  });
});
