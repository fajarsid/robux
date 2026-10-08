import { createHmac } from 'node:crypto';
import { TelegramMiniAppAuthService } from './telegram-miniapp-auth.service';

describe('TelegramMiniAppAuthService', () => {
  const token = '123456:bot-secret-value';
  const prisma = {
    telegramIdentity: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const config = { telegram: { botToken: token } } as never;
  const service = new TelegramMiniAppAuthService(config, prisma as never);

  function initData(user: object, at = Math.floor(Date.now() / 1000)) {
    const fields = new URLSearchParams({ auth_date: String(at), query_id: 'q-123', user: JSON.stringify(user) });
    const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
    return fields.toString();
  }

  beforeEach(() => prisma.telegramIdentity.upsert.mockClear());

  it('verifies signed initData and maps stable numeric Telegram identity', async () => {
    await expect(service.authenticate(`tma ${initData({ id: 987654321, username: 'changing_name' })}`))
      .resolves.toEqual({ id: 987654321n, username: 'changing_name' });
    expect(prisma.telegramIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { telegramUserId: 987654321n },
      create: expect.objectContaining({ chatId: 987654321n }),
    }));
  });

  it('rejects forged, stale and structurally invalid initData', async () => {
    const forgedData = new URLSearchParams(initData({ id: 11 }));
    const originalHash = forgedData.get('hash')!;
    forgedData.set('hash', `${originalHash[0] === '0' ? '1' : '0'}${originalHash.slice(1)}`);
    const forged = forgedData.toString();
    await expect(service.authenticate(`tma ${forged}`)).rejects.toThrow(/session tidak valid/);
    await expect(service.authenticate(`tma ${initData({ id: 11 }, Math.floor(Date.now() / 1000) - 90_000)}`)).rejects.toThrow(/session tidak valid/);
    await expect(service.authenticate('tma user=id')).rejects.toThrow(/session tidak valid/);
  });
});
