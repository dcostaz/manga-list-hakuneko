'use strict';

const fs = require('fs').promises;

/** @typedef {import('../../../../types/plugintypedefs').PluginServiceSettings} PluginServiceSettings */
/** @typedef {import('../../../../types/plugintypedefs').PluginAPISettingsLike} PluginAPISettingsLike */

const DEFAULT_LABEL = 'Hakuneko';
const DEFAULT_ICON = 'images/hakuneko-icon.svg';

/**
 * Standalone settings class for the Hakuneko plugin.
 *
 * Holds the per-user configured values (downloadBaseDir, bookmarksPath,
 * chaptermarksPath) injected by the host as flat serviceSettings keys, plus
 * the static UI identity (label, icon). No host SettingsBase dependency.
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

    this.componentName = 'HakunekoSettings';
    /** @type {PluginServiceSettings} */
    this._settings = settings;
  }

  /**
   * Build a settings instance. Values come from serviceSettings (host-injected
   * per-user config). An optional settingsPath pointing at the field-definition
   * JSON is accepted for parity with other plugins but is not required — the
   * definition file carries no values.
   *
   * @param {object} [options]
   * @param {PluginServiceSettings} [options.serviceSettings]
   * @param {PluginServiceSettings} [options.settings]
   * @param {string} [options.settingsPath]
   * @returns {Promise<HakunekoSettings>}
   */
  static async init(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const explicit = opts.serviceSettings && typeof opts.serviceSettings === 'object'
      ? opts.serviceSettings
      : (opts.settings && typeof opts.settings === 'object' ? opts.settings : null);

    /** @type {PluginServiceSettings} */
    let resolved = explicit ? { ...explicit } : {};

    // Optionally validate the field-definition file exists (no values are read from it).
    const settingsPath = typeof opts.settingsPath === 'string' ? opts.settingsPath : '';
    if (settingsPath) {
      const raw = await fs.readFile(settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid Hakuneko settings definition at ${settingsPath}`);
      }
    }

    return new HakunekoSettings({ settings: resolved });
  }

  /**
   * @param {string} key
   * @returns {unknown}
   */
  getSetting(key) {
    return this._settings ? this._settings[key] : undefined;
  }

  /**
   * @returns {PluginServiceSettings}
   */
  toLegacyFormat() {
    return { ...this._settings };
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
