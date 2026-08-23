'use strict';

/**
 * Parses Google Ads conversion measurement IDs from tag snippet payloads.
 * @see conversion_action.tag_snippets in Google Ads API.
 */

/**
 * @param {string | null | undefined} eventSnippet
 * @returns {{ conversionId: string, conversionLabel: string } | null}
 */
function parseSendToFromEventSnippet(eventSnippet) {
  if (!eventSnippet || typeof eventSnippet !== 'string') return null;

  const match = eventSnippet.match(/send_to['"]\s*:\s*['"]AW-(\d+)\/([^'"]+)['"]/i);
  if (!match) return null;

  const conversionId = `AW-${match[1]}`;
  const conversionLabel = match[2].trim();
  if (!conversionLabel) return null;

  return { conversionId, conversionLabel };
}

/**
 * @param {Array<{ eventSnippet?: string, globalSiteTag?: string, type?: string, pageFormat?: string }> | null | undefined} tagSnippets
 * @returns {{ conversionId: string, conversionLabel: string, tagSnippets: object[] } | null}
 */
function extractConversionMeasurementFromTagSnippets(tagSnippets) {
  if (!Array.isArray(tagSnippets) || tagSnippets.length === 0) return null;

  for (const snippet of tagSnippets) {
    const parsed = parseSendToFromEventSnippet(snippet?.eventSnippet);
    if (parsed) {
      return {
        ...parsed,
        tagSnippets,
      };
    }
  }

  return null;
}

/**
 * @param {object | null | undefined} action — normalized conversion action row
 * @returns {{ conversionId: string, conversionLabel: string, tagSnippets?: object[] } | null}
 */
function conversionMeasurementFromAction(action) {
  if (!action || typeof action !== 'object') return null;

  if (action.conversionId && action.conversionLabel) {
    return {
      conversionId: String(action.conversionId),
      conversionLabel: String(action.conversionLabel),
      ...(Array.isArray(action.tagSnippets) ? { tagSnippets: action.tagSnippets } : {}),
    };
  }

  return extractConversionMeasurementFromTagSnippets(action.tagSnippets);
}

module.exports = {
  parseSendToFromEventSnippet,
  extractConversionMeasurementFromTagSnippets,
  conversionMeasurementFromAction,
};
