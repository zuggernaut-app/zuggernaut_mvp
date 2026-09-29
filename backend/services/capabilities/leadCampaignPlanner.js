'use strict';

const { parseForwardingCountries } = require('../../constants/leadCampaign');

/**
 * @param {object | null | undefined} bc
 * @returns {boolean}
 */
function callsAllowedForBusiness(bc) {
  const country = String(bc?.businessCountry ?? '').trim().toUpperCase();
  if (!country) return false;
  return parseForwardingCountries().includes(country);
}

/**
 * @param {object | null | undefined} bc
 * @returns {'calls' | 'forms'}
 */
function resolvePrimaryAction(bc) {
  const contact = String(bc?.howBuyersContact ?? '').toLowerCase();
  const goalsPrimary = String(bc?.goals?.primary ?? '').toLowerCase();
  const prefersCalls = /call|phone|tel/.test(contact) || goalsPrimary === 'calls';
  if (prefersCalls && callsAllowedForBusiness(bc)) {
    return 'calls';
  }
  return 'forms';
}

/**
 * @param {object | null | undefined} bc
 * @returns {string | null}
 */
function pickPrimaryOffer(bc) {
  const services = Array.isArray(bc?.services) ? bc.services : [];
  const first = services.map((s) => String(s ?? '').trim()).find(Boolean);
  return first ?? null;
}

/**
 * @param {object | null | undefined} bc
 * @returns {string[]}
 */
function pickPlaces(bc) {
  const areas = Array.isArray(bc?.serviceAreas) ? bc.serviceAreas : [];
  return areas.map((a) => String(a ?? '').trim()).filter(Boolean);
}

/**
 * Pure planner: recommended + optional alternative managed-slot intents.
 *
 * @param {object | null | undefined} bc
 * @returns {{
 *   recommended: { slot: 'recommended', action: 'calls'|'forms', offer: string, places: string[] },
 *   alternative: { slot: 'alternative', action: 'calls'|'forms', offer: string, places: string[] } | null,
 * }}
 */
function planLeadCampaignSlots(bc) {
  const offer = pickPrimaryOffer(bc);
  const places = pickPlaces(bc);
  if (!offer || places.length === 0) {
    return { recommended: null, alternative: null };
  }

  const primaryAction = resolvePrimaryAction(bc);
  const recommended = {
    slot: 'recommended',
    action: primaryAction,
    offer,
    places,
  };

  let alternative = null;
  const secondaryOffer = (Array.isArray(bc?.services) ? bc.services : [])
    .map((s) => String(s ?? '').trim())
    .filter((s) => s && s !== offer)[0];

  if (secondaryOffer) {
    alternative = {
      slot: 'alternative',
      action: primaryAction,
      offer: secondaryOffer,
      places,
    };
  } else if (callsAllowedForBusiness(bc)) {
    const altAction = primaryAction === 'calls' ? 'forms' : 'calls';
    alternative = {
      slot: 'alternative',
      action: altAction,
      offer,
      places,
    };
  }

  return { recommended, alternative };
}

module.exports = {
  callsAllowedForBusiness,
  resolvePrimaryAction,
  planLeadCampaignSlots,
};
