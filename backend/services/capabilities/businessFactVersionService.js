'use strict';

const mongoose = require('mongoose');

const BusinessContext = mongoose.model('BusinessContext');

/**
 * @typedef {'customer_intake' | 'customer_fact_confirm' | 'operator_fact_check' | 'setup_call_confirmed'} FactVersionSource
 */

/**
 * Build a snapshot of fact fields stored on each version entry.
 *
 * @param {object} fields
 */
function buildFactFieldsSnapshot(fields) {
  return {
    businessName: fields.businessName ?? null,
    websiteUrl: fields.websiteUrl ?? null,
    services: Array.isArray(fields.services) ? fields.services : [],
    serviceAreas: Array.isArray(fields.serviceAreas) ? fields.serviceAreas : [],
    whoBuysToday: fields.whoBuysToday ?? null,
    orderValueHint: fields.orderValueHint ?? null,
    howBuyersContact: fields.howBuyersContact ?? null,
    contactMethods: fields.contactMethods ?? null,
    intakeFieldSources: fields.intakeFieldSources ?? null,
    businessCountry: fields.businessCountry ?? null,
  };
}

/**
 * Atomically append a fact version, bump latestFactVersion, and apply live field updates.
 *
 * @param {object} filter — Mongo filter (e.g. { businessId, userId })
 * @param {FactVersionSource} source
 * @param {object} liveSet — top-level BusinessContext fields to set
 * @param {object} fieldsSnapshot — version entry fields (plain object)
 * @param {object} [extraSet] — additional top-level fields (timestamps, flags)
 */
async function appendBusinessFactVersion(filter, source, liveSet, fieldsSnapshot, extraSet = {}) {
  const now = new Date();
  const entry = {
    savedAt: now,
    source,
    fields: buildFactFieldsSnapshot(fieldsSnapshot),
  };

  const liveSetStage = { ...liveSet, ...extraSet };
  liveSetStage.factVersions = {
    $concatArrays: [
      { $ifNull: ['$factVersions', []] },
      [
        {
          version: '$latestFactVersion',
          savedAt: now,
          source,
          fields: entry.fields,
        },
      ],
    ],
  };

  const doc = await BusinessContext.findOneAndUpdate(
    filter,
    [
      {
        $set: {
          latestFactVersion: { $add: [{ $ifNull: ['$latestFactVersion', 0] }, 1] },
        },
      },
      { $set: liveSetStage },
    ],
    { new: true, updatePipeline: true }
  );

  return doc;
}

/**
 * @param {import('mongoose').Document} doc
 */
function snapshotFromBusinessContextDoc(doc) {
  return buildFactFieldsSnapshot({
    businessName: doc.businessName,
    websiteUrl: doc.websiteUrl,
    services: doc.services,
    serviceAreas: doc.serviceAreas,
    whoBuysToday: doc.whoBuysToday,
    orderValueHint: doc.orderValueHint,
    howBuyersContact: doc.howBuyersContact,
    contactMethods: doc.contactMethods,
    intakeFieldSources: doc.intakeFieldSources,
    businessCountry: doc.businessCountry,
  });
}

module.exports = {
  appendBusinessFactVersion,
  buildFactFieldsSnapshot,
  snapshotFromBusinessContextDoc,
};
