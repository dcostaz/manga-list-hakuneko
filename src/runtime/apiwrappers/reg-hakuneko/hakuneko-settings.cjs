'use strict';

const fs = require('fs').promises;

/** @typedef {import('../../../../types/plugintypedefs').PluginServiceSettings} PluginServiceSettings */
/** @typedef {import('../../../../types/plugintypedefs').PluginAPISettingsLike} PluginAPISettingsLike */
/** @typedef {{ getUserSetting: (userId: number, componentName: string, key: string) => { value: unknown } | null, setUserSetting: (userId: number, componentName: string, key: string, value: unknown) => unknown }} UserSettingsServiceLike */

const DEFAULT_LABEL = 'Hakuneko';
const DEFAULT_ICON = 'images/hakuneko-icon.svg';
const COMPONENT_NAME = 'HakunekoSettings';

/**
 * Field schema for the Settings UI. Mirrors hakuneko-plugin-settings.json's
 * field definitions, enriched with the EnhancedSchemaField fields the UI
 * requires (required/isBasic/category/order). Also doubles as the list of
 * keys that get hydrated from / persisted to user_settings.
 * @type {Record<string, import('../../../../../types/services/enhancedschemadefs').EnhancedSchemaField>}
 */
const SCHEMA = {
  downloadBaseDir: {
    type: 'path',
    required: true,
    default: '',
    isBasic: true,
    label: 'Manga base directory',
    description: 'Base directory shared by Hakuneko and manga-list. Folder matching uses {downloadBaseDir}/{mangaTitle}/',
    readOnly: false,
    category: 'general',
    order: 10
  },
  bookmarksPath: {
    type: 'path',
    required: true,
    default: '',
    isBasic: true,
    label: 'Hakuneko bookmarks file',
    description: 'Full path to hakuneko.bookmarks JSON file',
    readOnly: false,
    category: 'general',
    order: 20
  },
  chaptermarksPath: {
    type: 'path',
    required: true,
    default: '',
    isBasic: true,
    label: 'Hakuneko chaptermarks file',
    description: 'Full path to hakuneko.chaptermarks JSON file',
    readOnly: false,
    category: 'general',
    order: 30
  }
};

/**
 * Standalone settings class for the Hakuneko plugin.
 *
 * Holds the per-user configured values (downloadBaseDir, bookmarksPath,
 * chaptermarksPath). Tier 1 defaults come from the host-injected
 * serviceSettings; Tier 2 overrides are hydrated from (and persisted back
 * to) the host's user_settings store (componentName='HakunekoSettings',
 * system user) via `userSettingsService`, since these are machine-level
 * config the user edits live through the Settings UI, not values baked into
 * the plugin package.
 *
 * Implements {@link PluginAPISettingsLike}.
 */
class HakunekoSettings {
  /**
   * @param {object} [params]
   * @param {PluginServiceSettings} [params.settings] - Flat settings record
   */
  constructor(params = {}) {
    const settings = params && typeof params === 'object' && params.settings && typeof params.settings === 'object'
      ? params.settings
      : {};

    this.componentName = COMPONENT_NAME;
    /** @type {PluginServiceSettings} */
    this._settings = settings;
    /** @type {UserSettingsServiceLike | null} */
    this._userSettingsService = null;
    /** @type {number} */
    this._userId = 0;
  }

  /**
   * Build a settings instance. Tier-1 values come from serviceSettings
   * (host-injected defaults); Tier-2 per-field overrides are then hydrated
   * from userSettingsService, if provided. An optional settingsPath pointing
   * at the field-definition JSON is accepted for parity with other plugins
   * but is not required — the definition file carries no values.
   *
   * @param {object} [options]
   * @param {PluginServiceSettings} [options.serviceSettings]
   * @param {PluginServiceSettings} [options.settings]
   * @param {string} [options.settingsPath]
   * @param {UserSettingsServiceLike | null} [options.userSettingsService]
   * @param {number} [options.userId]
   * @returns {Promise<HakunekoSettings>}
   */
  static async init(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const explicit = opts.serviceSettings && typeof opts.serviceSettings === 'object'
      ? opts.serviceSettings
      : (opts.settings && typeof opts.settings === 'object' ? opts.settings : null);

    /** @type {PluginServiceSettings} */
    const resolved = explicit ? { ...explicit } : {};

    // Optionally validate the field-definition file exists (no values are read from it).
    const settingsPath = typeof opts.settingsPath === 'string' ? opts.settingsPath : '';
    if (settingsPath) {
      const raw = await fs.readFile(settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid Hakuneko settings definition at ${settingsPath}`);
      }
    }

    const userSettingsService = opts.userSettingsService && typeof opts.userSettingsService.getUserSetting === 'function'
      ? opts.userSettingsService
      : null;
    const userId = typeof opts.userId === 'number' ? opts.userId : 0;

    // Tier 2: overlay any saved per-field overrides on top of Tier-1 defaults.
    if (userSettingsService) {
      for (const key of Object.keys(SCHEMA)) {
        try {
          const pref = userSettingsService.getUserSetting(userId, COMPONENT_NAME, key);
          if (pref && pref.value !== undefined && pref.value !== null) {
            resolved[key] = pref.value;
          }
        } catch {
          // Missing/corrupt override — fall back to the Tier-1 default rather than fail plugin load.
        }
      }
    }

    const instance = new HakunekoSettings({ settings: resolved });
    instance._userSettingsService = userSettingsService;
    instance._userId = userId;
    return instance;
  }

  /**
   * @param {string} key
   * @returns {unknown}
   */
  getSetting(key) {
    return this._settings ? this._settings[key] : undefined;
  }

  /**
   * Update a setting value in-memory. Call save() to persist.
   * @param {string} key
   * @param {unknown} value
   */
  set(key, value) {
    if (!Object.prototype.hasOwnProperty.call(SCHEMA, key)) {
      throw new Error(`Unknown Hakuneko setting key: ${key}`);
    }
    this._settings[key] = value;
  }

  /**
   * Persist the current values to user_settings (one row per schema key,
   * under the system user — see PluginService.SYSTEM_USER_ID).
   * @returns {Promise<void>}
   */
  async save() {
    if (!this._userSettingsService || typeof this._userSettingsService.setUserSetting !== 'function') {
      throw new Error('Hakuneko settings cannot be saved: no user settings service is available.');
    }
    for (const key of Object.keys(SCHEMA)) {
      if (Object.prototype.hasOwnProperty.call(this._settings, key)) {
        this._userSettingsService.setUserSetting(this._userId, this.componentName, key, this._settings[key]);
      }
    }
  }

  /**
   * @returns {PluginServiceSettings}
   */
  toLegacyFormat() {
    return { ...this._settings };
  }

  /**
   * Current values, exposed for SettingsDataProvider._resolveSettings() — it
   * checks `instance.settings` (not `instance._settings`), so without this
   * getter the Settings UI form always renders with empty/default values.
   * @returns {PluginServiceSettings}
   */
  get settings() {
    return { ...this._settings };
  }

  /**
   * Field schema for the Settings UI (SettingsDataProvider._resolveSchema()).
   * @returns {Record<string, import('../../../../../types/services/enhancedschemadefs').EnhancedSchemaField>}
   */
  getSchema() {
    return SCHEMA;
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  _str(value) {
    return typeof value === 'string' ? value : '';
  }

  /** @returns {string} Shared manga base directory. */
  get downloadBaseDir() {
    return this._str(this._settings.downloadBaseDir);
  }

  /** @returns {string} Path to the hakuneko.bookmarks file. */
  get bookmarksPath() {
    return this._str(this._settings.bookmarksPath);
  }

  /** @returns {string} Path to the hakuneko.chaptermarks file. */
  get chaptermarksPath() {
    return this._str(this._settings.chaptermarksPath);
  }

  /** @returns {string} Display label. */
  get label() {
    return this._str(this._settings.label) || DEFAULT_LABEL;
  }

  /** @returns {string} Icon path. */
  get icon() {
    return this._str(this._settings.icon) || DEFAULT_ICON;
  }
}

module.exports = HakunekoSettings;
