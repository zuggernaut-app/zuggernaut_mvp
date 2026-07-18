/**
 * Side-effect import — registers production Mongoose models with the default connection.
 * Dev-only diagnostic models live in `./devDiagnosticModels.js` (loaded by dev-tools).
 * Require this once early in server bootstrap (see `mvp_implementation_plan.md` Phase 1).
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
  AuditReport: require('./AuditReport'),
  CampaignPlan: require('./CampaignPlan'),
};
