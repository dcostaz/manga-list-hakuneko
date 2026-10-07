'use strict';

/**
 * Plugin contract version and capability constants.
 *
 * PLUGIN_CONTRACT_VERSION: increment major on any breaking PluginAPILike change.
 * Adding a new capability constant requires a corresponding entry in the host capability
 * contract (`docs/plugins/host-capability-contract.md` §1.2/§2) and a minor-version bump.
 * The host compares MAJOR only (`PluginPackageLoader._validateCompatibility()`), so a minor
 * bump loads in both directions and needs no lockstep re-release across plugin repos.
 */

const PLUGIN_CONTRACT_VERSION = '2.1.0';
const PLUGIN_SETTINGS_CONTRACT_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Capability constants (§5 — must match capabilities[] strings in plugin-package.json)
// ---------------------------------------------------------------------------

const CAPABILITY_TRACKER_SEARCH       = 'tracker.search';
const CAPABILITY_TRACKER_SYNC         = 'tracker.sync';
const CAPABILITY_TRACKER_FILE         = 'tracker.file';
const CAPABILITY_TRACKER_COVER        = 'tracker.cover';
const CAPABILITY_TRACKER_COVER_UPLOAD = 'tracker.cover.upload';

const CAPABILITY_LOCALTRACKER_ENRICH = 'localtracker.enrich';
const CAPABILITY_ADAPTER_IMPORT   = 'adapter.import';
const CAPABILITY_ADAPTER_DISCOVER = 'adapter.discover';

const CAPABILITY_WORKSPACE_LIST     = 'workspace.list';
const CAPABILITY_WORKSPACE_GET      = 'workspace.get';
const CAPABILITY_WORKSPACE_IMPORT   = 'workspace.import';
const CAPABILITY_WORKSPACE_DISCOVER = 'workspace.discover';

const CAPABILITY_PLUGIN_LIVE       = 'plugin.live';
const CAPABILITY_PLUGIN_CARD_BADGE = 'plugin.cardBadge';
const CAPABILITY_PLUGIN_FILTER     = 'plugin.filter';

// ---------------------------------------------------------------------------
// Register vocabulary (docs/plugins/host-capability-contract.md §1.2)
//
// Everything above is the pre-register flat-tag vocabulary. New offers are declared by their
// register name instead. `watch.summary` (method `summarizeEntries`) is the first one here --
// live refresh of per-entry volatile state at render time, for a set of entries the HOST names.
// It supersedes `plugin.cardBadge`/`queryBatch`, which stays declarable until a future major.
//
// Badge display itself is NOT this offer and is not gated on it: per-entry link state is
// host-owned and universal, and a plugin declaring neither is served from its stored state.
// ---------------------------------------------------------------------------

const CAPABILITY_WATCH_SUMMARY = 'watch.summary';

// ---------------------------------------------------------------------------
// FilterNotApplicableError
// Thrown by queryFilter() when no field in the filter spec matches this
// plugin's filterSchema. The host catches this class and treats the filter
// as pass-through (fail-open).
// ---------------------------------------------------------------------------

class FilterNotApplicableError extends Error {
  constructor(message) {
    super(message || 'No filter spec fields match this plugin\'s filterSchema');
    this.name = 'FilterNotApplicableError';
  }
}

module.exports = {
  PLUGIN_CONTRACT_VERSION,
  PLUGIN_SETTINGS_CONTRACT_VERSION,

  CAPABILITY_TRACKER_SEARCH,
  CAPABILITY_TRACKER_SYNC,
  CAPABILITY_TRACKER_FILE,
  CAPABILITY_TRACKER_COVER,
  CAPABILITY_TRACKER_COVER_UPLOAD,

  CAPABILITY_LOCALTRACKER_ENRICH,
  CAPABILITY_ADAPTER_IMPORT,
  CAPABILITY_ADAPTER_DISCOVER,

  CAPABILITY_WORKSPACE_LIST,
  CAPABILITY_WORKSPACE_GET,
  CAPABILITY_WORKSPACE_IMPORT,
  CAPABILITY_WORKSPACE_DISCOVER,

  CAPABILITY_PLUGIN_LIVE,
  CAPABILITY_PLUGIN_CARD_BADGE,
  CAPABILITY_PLUGIN_FILTER,

  CAPABILITY_WATCH_SUMMARY,

  FilterNotApplicableError,
};
