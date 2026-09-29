'use strict';

const { isLlmEnabled, completeJson, LlmClientError } = require('../ai/llmClient');

/**
 * @param {object} input
 */
async function generateFiveAnswersFromScrape(input) {
  if (!isLlmEnabled()) {
    if (process.env.NODE_ENV === 'test') {
      return input.suggested ?? {};
    }
    return {};
  }

  try {
    const result = await completeJson({
      system:
        'Return strict JSON with optional keys: services, serviceAreas, whoBuysToday, orderValueHint, howBuyersContact. Never invent phone numbers or emails.',
      user: JSON.stringify({
        businessName: input.businessName ?? null,
        websiteUrl: input.websiteUrl ?? null,
        scrapeSignals: input.suggested ?? {},
      }),
    });
    return result && typeof result === 'object' ? result : {};
  } catch (err) {
    if (err instanceof LlmClientError) {
      return {};
    }
    throw err;
  }
}

/**
 * @param {object} input
 */
async function generateCampaignSlotContent(input) {
  if (!isLlmEnabled()) {
    if (process.env.NODE_ENV === 'test') {
      return {
        landingPageUrl: input.websiteUrl ?? null,
        proofLine: null,
        headlines: input.fallbackHeadlines ?? [],
        descriptions: input.fallbackDescriptions ?? [],
      };
    }
    return null;
  }

  try {
    const result = await completeJson({
      system:
        'Return strict JSON: landingPageUrl, proofLine, proofSourceUrl, headlines[], descriptions[]. Use only provided facts. No phone/email in copy.',
      user: JSON.stringify({
        slot: input.slot,
        businessName: input.businessName,
        offer: input.offer,
        action: input.action,
        places: input.places,
        websiteUrl: input.websiteUrl,
        allowedPages: input.allowedPages ?? [],
      }),
    });
    return result && typeof result === 'object' ? result : null;
  } catch {
    return null;
  }
}

module.exports = {
  generateFiveAnswersFromScrape,
  generateCampaignSlotContent,
};
