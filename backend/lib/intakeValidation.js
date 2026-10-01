'use strict';

const {
  isValidEmail,
  isValidPhone,
  validateOptionalHttpUrl,
  normalizeStringList,
  MAX_SINGLE_LINE_FIELD,
} = require('./validation');

const INTAKE_FIELDS = [
  'businessName',
  'phone',
  'email',
  'primaryOffer',
  'whoBuysToday',
  'serviceArea',
  'orderValueHint',
  'howBuyersContact',
  'websiteUrl',
];

const ALWAYS_CUSTOMER_SOURCE_KEYS = Object.freeze(['phone', 'email', 'websiteUrl']);

const OPTIONAL_CUSTOMER_SOURCE_KEYS = Object.freeze([
  { bodyKey: 'businessName', sourceKey: 'businessName' },
  { bodyKey: 'primaryOffer', sourceKey: 'services' },
  { bodyKey: 'whoBuysToday', sourceKey: 'whoBuysToday' },
  { bodyKey: 'serviceArea', sourceKey: 'serviceAreas' },
  { bodyKey: 'orderValueHint', sourceKey: 'orderValueHint' },
  { bodyKey: 'howBuyersContact', sourceKey: 'howBuyersContact' },
]);

/**
 * @param {object} body
 * @returns {{ ok: true, value: object } | { ok: false, message: string }}
 */
function validateIntakeBody(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'Request body must be a JSON object' };
  }

  const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const primaryOffer = typeof body.primaryOffer === 'string' ? body.primaryOffer.trim() : '';
  const whoBuysToday = typeof body.whoBuysToday === 'string' ? body.whoBuysToday.trim() : '';
  const serviceArea = typeof body.serviceArea === 'string' ? body.serviceArea.trim() : '';
  const orderValueHint = typeof body.orderValueHint === 'string' ? body.orderValueHint.trim() : '';
  const howBuyersContact =
    typeof body.howBuyersContact === 'string' ? body.howBuyersContact.trim() : '';

  if (!phone || !isValidPhone(phone)) {
    return { ok: false, message: 'A valid phone number is required' };
  }
  if (!email || !isValidEmail(email)) {
    return { ok: false, message: 'A valid email address is required' };
  }

  const urlCheck = validateOptionalHttpUrl(
    typeof body.websiteUrl === 'string' ? body.websiteUrl : ''
  );
  if (!urlCheck.ok) {
    return { ok: false, message: urlCheck.message };
  }

  if (businessName && businessName.length > MAX_SINGLE_LINE_FIELD) {
    return { ok: false, message: 'businessName is too long' };
  }

  const services = primaryOffer ? normalizeStringList([primaryOffer], 'services') : { ok: true, value: [] };
  if (!services.ok) {
    return { ok: false, message: services.message };
  }
  const serviceAreas = serviceArea ? normalizeStringList([serviceArea], 'serviceAreas') : { ok: true, value: [] };
  if (!serviceAreas.ok) {
    return { ok: false, message: serviceAreas.message };
  }

  const intakeFieldSources = {};
  for (const key of ALWAYS_CUSTOMER_SOURCE_KEYS) {
    if (key === 'websiteUrl' && !urlCheck.value) continue;
    intakeFieldSources[key] = 'customer';
  }

  const optionalValues = {
    businessName,
    primaryOffer,
    whoBuysToday,
    serviceArea,
    orderValueHint,
    howBuyersContact,
  };
  for (const { bodyKey, sourceKey } of OPTIONAL_CUSTOMER_SOURCE_KEYS) {
    const value = optionalValues[bodyKey];
    if (typeof value === 'string' && value.trim()) {
      intakeFieldSources[sourceKey] = 'customer';
    }
  }

  return {
    ok: true,
    value: {
      websiteUrl: urlCheck.value,
      businessName: businessName || undefined,
      services: services.value,
      serviceAreas: serviceAreas.value,
      whoBuysToday: whoBuysToday || undefined,
      orderValueHint: orderValueHint || undefined,
      howBuyersContact: howBuyersContact || undefined,
      contactMethods: {
        emails: [email],
        phones: [phone],
      },
      intakeFieldSources,
    },
  };
}

module.exports = {
  INTAKE_FIELDS,
  validateIntakeBody,
};
