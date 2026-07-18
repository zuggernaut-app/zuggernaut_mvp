'use strict';

/**
 * Dev-only Mongoose models for integration creation diagnostics.
 * Not part of the production SetupRun domain — register via dev-tools bootstrap only.
 */
require('./IntegrationDiagnosticArtifact');
require('./IntegrationDiagnosticRun');

module.exports = {
  IntegrationDiagnosticArtifact: require('./IntegrationDiagnosticArtifact'),
  IntegrationDiagnosticRun: require('./IntegrationDiagnosticRun'),
};
