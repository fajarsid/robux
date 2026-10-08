export interface SystemSettingsRepository {
  /** Raw JSON value of a runtime setting, or undefined if it is not set. */
  find(key: string): Promise<unknown>;
}

export const SYSTEM_SETTINGS_REPOSITORY = Symbol('SYSTEM_SETTINGS_REPOSITORY');
