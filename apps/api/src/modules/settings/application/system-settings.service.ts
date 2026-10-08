import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SYSTEM_SETTINGS_REPOSITORY,
  type SystemSettingsRepository,
} from '../domain/system-settings.repository';

/**
 * Typed access to staff-editable runtime settings (`system_settings`). A missing or malformed
 * value falls back to the documented default and is logged, never thrown at a customer.
 */
@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);

  constructor(
    @Inject(SYSTEM_SETTINGS_REPOSITORY) private readonly settings: SystemSettingsRepository,
  ) {}

  async positiveInteger(key: string, fallback: number): Promise<number> {
    const value = await this.settings.find(key);
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }
    if (value !== undefined) {
      this.logger.warn({ event: 'settings.invalid_value', key });
    }
    return fallback;
  }
}
