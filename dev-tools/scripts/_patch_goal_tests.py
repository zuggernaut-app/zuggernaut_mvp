from pathlib import Path

ROOT = Path(r'c:\Users\RK\Desktop\zuggernaut_mvp')

# googleAdsCampaignClient.test.js
p = ROOT / 'backend/tests/googleAdsCampaignClient.test.js'
text = p.read_text(encoding='utf-8')
text = text.replace(
    "const {\n  buildResponsiveSearchAdCreatePayload,\n  buildSearchCampaignCreatePayload,\n  createCampaign,\n  createResponsiveSearchAd,\n} = require('../services/integrations/googleAdsCampaignClient');",
    "const {\n  buildCustomConversionGoalCreatePayload,\n  buildConversionGoalCampaignConfigUpdateOperation,\n  buildResponsiveSearchAdCreatePayload,\n  buildSearchCampaignCreatePayload,\n  createCampaign,\n  createCustomConversionGoal,\n  createResponsiveSearchAd,\n  linkCampaignToCustomConversionGoal,\n} = require('../services/integrations/googleAdsCampaignClient');",
)
append = """

  it('buildCustomConversionGoalCreatePayload requires conversion actions', () => {
    expect(() =>
      buildCustomConversionGoalCreatePayload({
        name: 'Acme — Zuggernaut Conversions',
        conversionActionResourceNames: [],
      })
    ).toThrow('at least one conversion action');

    const payload = buildCustomConversionGoalCreatePayload({
      name: 'Acme — Zuggernaut Conversions',
      conversionActionResourceNames: [
        'customers/1234567890/conversionActions/1001',
        'customers/1234567890/conversionActions/1002',
      ],
    });

    expect(payload).toEqual({
      name: 'Acme — Zuggernaut Conversions',
      conversionActions: [
        'customers/1234567890/conversionActions/1001',
        'customers/1234567890/conversionActions/1002',
      ],
      status: 'ENABLED',
    });
  });

  it('buildConversionGoalCampaignConfigUpdateOperation uses update + updateMask', () => {
    const operation = buildConversionGoalCampaignConfigUpdateOperation({
      customerId: '1234567890',
      campaignResourceName: 'customers/1234567890/campaigns/456',
      customConversionGoalResourceName: 'customers/1234567890/customConversionGoals/99',
    });

    expect(operation).toEqual({
      update: {
        resourceName: 'customers/1234567890/conversionGoalCampaignConfigs/456',
        customConversionGoal: 'customers/1234567890/customConversionGoals/99',
      },
      updateMask: 'custom_conversion_goal',
    });
  });

  it('createCustomConversionGoal posts customConversionGoals:mutate create payload', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { results: [{ resourceName: 'customers/1234567890/customConversionGoals/99' }] },
    });

    await createCustomConversionGoal({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-abc',
      name: 'MioSalon — Zuggernaut Conversions',
      conversionActionResourceNames: ['customers/1234567890/conversionActions/1001'],
    });

    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('/customConversionGoals:mutate');
    expect(body.operations[0].create).toEqual({
      name: 'MioSalon — Zuggernaut Conversions',
      conversionActions: ['customers/1234567890/conversionActions/1001'],
      status: 'ENABLED',
    });
    expect(body.operations[0].update).toBeUndefined();
  });

  it('linkCampaignToCustomConversionGoal posts conversionGoalCampaignConfigs:mutate update payload', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { results: [{ resourceName: 'customers/1234567890/conversionGoalCampaignConfigs/456' }] },
    });

    await linkCampaignToCustomConversionGoal({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-abc',
      campaignResourceName: 'customers/1234567890/campaigns/456',
      customConversionGoalResourceName: 'customers/1234567890/customConversionGoals/99',
    });

    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('/conversionGoalCampaignConfigs:mutate');
    expect(body.operations[0]).toEqual({
      update: {
        resourceName: 'customers/1234567890/conversionGoalCampaignConfigs/456',
        customConversionGoal: 'customers/1234567890/customConversionGoals/99',
      },
      updateMask: 'custom_conversion_goal',
    });
    expect(body.operations[0].create).toBeUndefined();
  });
"""
text = text.replace(
    '    expect(create.ad.responsiveSearchAd.descriptions.length).toBeGreaterThanOrEqual(2);\n  });\n});',
    '    expect(create.ad.responsiveSearchAd.descriptions.length).toBeGreaterThanOrEqual(2);\n  });' + append + '\n});\n',
)
p.write_text(text, encoding='utf-8')

# adsAutoCampaignService.test.js
p = ROOT / 'backend/tests/adsAutoCampaignService.test.js'
text = p.read_text(encoding='utf-8')
text = text.replace(
    """    const links = await IntegrationArtifact.find({
      setupRunId: run._id,
      artifactType: 'ads_conversion_link',
    }).lean();
    expect(links).toHaveLength(1);""",
    """    const customGoal = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_custom_conversion_goal',
    }).lean();
    expect(customGoal?.metadata?.conversionActionResourceNames).toHaveLength(1);

    const goalConfig = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_conversion_goal_campaign_config',
    }).lean();
    expect(goalConfig?.metadata?.customConversionGoalResourceName).toBe(customGoal?.externalId);""",
)
text = text.replace(
    """    expect(result.summary.conversionLinkCount).toBe(2);
    const links = await IntegrationArtifact.find({
      setupRunId: run._id,
      artifactType: 'ads_conversion_link',
    }).lean();
    expect(links).toHaveLength(2);""",
    """    expect(result.summary.conversionLinkCount).toBe(2);
    expect(result.summary.conversionGoalLinked).toBe(true);

    const customGoal = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_custom_conversion_goal',
    }).lean();
    expect(customGoal?.metadata?.conversionActionResourceNames).toHaveLength(2);

    const goalConfig = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_conversion_goal_campaign_config',
    }).lean();
    expect(goalConfig?.metadata?.customConversionGoalResourceName).toBe(customGoal?.externalId);""",
)
p.write_text(text, encoding='utf-8')

# foundation.test.js
p = ROOT / 'backend/tests/foundation.test.js'
text = p.read_text(encoding='utf-8')
text = text.replace(
    "    expect(enums.ARTIFACT_TYPES).toContain('ads_campaign_budget');\n    expect(enums.ARTIFACT_TYPES).toContain('ads_conversion_link');",
    "    expect(enums.ARTIFACT_TYPES).toContain('ads_campaign_budget');\n    expect(enums.ARTIFACT_TYPES).toContain('ads_custom_conversion_goal');\n    expect(enums.ARTIFACT_TYPES).toContain('ads_conversion_goal_campaign_config');",
)
p.write_text(text, encoding='utf-8')

# capabilities.persistence.test.js
p = ROOT / 'backend/tests/capabilities.persistence.test.js'
text = p.read_text(encoding='utf-8')
text = text.replace(
    """    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_conversion_link' })
    ).toBeGreaterThanOrEqual(1);""",
    """    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_custom_conversion_goal' })
    ).toBe(1);
    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: 'ads_conversion_goal_campaign_config',
      })
    ).toBe(1);""",
)
p.write_text(text, encoding='utf-8')

print('updated tests')
