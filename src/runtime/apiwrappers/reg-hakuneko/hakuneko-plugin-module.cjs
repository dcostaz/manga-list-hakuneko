'use strict';
const path = require('path');
const WrapperClass = require(path.join(__dirname, 'hakuneko-adapter.cjs'));
const SettingsClass = require(path.join(__dirname, 'hakuneko-settings.cjs'));

/** @type {import('../../../../types/plugintypedefs').PluginModuleDescriptor} */
const pluginModule = { WrapperClass, SettingsClass };
module.exports = pluginModule;
