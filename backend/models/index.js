/**
 * Side-effect import — registers all Mongoose models with the default connection.
 * Require this once early in server bootstrap (see `mvp_implementation_plan.md` Phase 1 / Database Architecture Strategy).
 */
require('./User');
require('./BusinessContext');
require('./ScrapeRun');
require('./SetupRun');
require('./SetupStepExecution');
require('./IntegrationConnection');
require('./IntegrationProvisioningRequest');
require('./ProviderSnapshot');
require('./IntegrationArtifact');
require('./IntegrationDiagnosticArtifact');
require('./IntegrationDiagnosticRun');
require('./AuditReport');
require('./CampaignPlan');

module.exports = {
  User: require('./User'),
  BusinessContext: require('./BusinessContext'),
  ScrapeRun: require('./ScrapeRun'),
  SetupRun: require('./SetupRun'),
  SetupStepExecution: require('./SetupStepExecution'),
  IntegrationConnection: require('./IntegrationConnection'),
  IntegrationProvisioningRequest: require('./IntegrationProvisioningRequest'),
  ProviderSnapshot: require('./ProviderSnapshot'),
  IntegrationArtifact: require('./IntegrationArtifact'),
  IntegrationDiagnosticArtifact: require('./IntegrationDiagnosticArtifact'),
  IntegrationDiagnosticRun: require('./IntegrationDiagnosticRun'),
  AuditReport: require('./AuditReport'),
  CampaignPlan: require('./CampaignPlan'),
};
