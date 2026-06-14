# Content from https://developers.google.com/google-ads/api/reference/rpc/v24/overview

## Overview

| ### services | |
| --- | --- |
| `AccountBudgetProposalService` | A service for managing account-level budgets through proposals. A proposal is a request to create a new budget or make changes to an existing one. Mutates: The CREATE operation creates a new proposal. UPDATE operations aren't supported. The REMOVE operation cancels a pending proposal. |
| `AccountLinkService` | This service allows management of links between Google Ads accounts and other accounts. |
| `AdGroupAdLabelService` | Service to manage labels on ad group ads. |
| `AdGroupAdService` | Service to manage ads in an ad group. |
| `AdGroupAssetService` | Service to manage ad group assets. |
| `AdGroupAssetSetService` | Service to manage ad group asset set |
| `AdGroupBidModifierService` | Service to manage ad group bid modifiers. |
| `AdGroupCriterionCustomizerService` | Service to manage ad group criterion customizer |
| `AdGroupCriterionLabelService` | Service to manage labels on ad group criteria. |
| `AdGroupCriterionService` | Service to manage ad group criteria. |
| `AdGroupCustomizerService` | Service to manage ad group customizer |
| `AdGroupLabelService` | Service to manage labels on ad groups. |
| `AdGroupOperation` | A single operation (create, update, remove) on an ad group. |
| `AdParameterService` | Service to manage ad parameters. |
| `AdService` | Service to manage ads. |
| `AssetGenerationService` | Service for generating new assets with generative AI. |
| `AssetGroupAssetService` | Service to manage asset group asset. |
| `AssetGroupListingGroupFilterService` | Service to manage asset group listing group filter. |
| `AssetGroupService` | Service to manage asset group |
| `AssetGroupSignalService` | Service to manage asset group signal. |
| `AssetService` | Service to manage assets. Asset types can be created with AssetService are YoutubeVideoAsset, MediaBundleAsset and ImageAsset. TextAsset should be created with Ad inline. |
| `AssetSetAssetService` | Service to manage asset set asset. |
| `AssetSetService` | Service to manage asset set |
| `AudienceInsightsService` | Audience Insights Service helps users find information about groups of people and how they can be reached with Google Ads. Accessible to allowlisted customers only. |
| `AudienceService` | Service to manage audiences. |
| `AutomaticallyCreatedAssetRemovalService` | Service to remove automatically created assets. |
| `BatchJobService` | Service to manage batch jobs. |
| `BenchmarksService` | BenchmarksService helps users compare YouTube advertisement data against industry benchmarks. Accessible to allowlisted customers only. |
| `BiddingDataExclusionService` | Service to manage bidding data exclusions. |
| `BiddingSeasonalityAdjustmentService` | Service to manage bidding seasonality adjustments. |
| `BiddingStrategyService` | Service to manage bidding strategies. |
| `BillingSetupService` | A service for designating the business entity responsible for accrued costs. A billing setup is associated with a payments account. Billing-related activity for all billing setups associated with a particular payments account will appear on a single invoice generated monthly. Mutates: The CREATE operation creates a new proposal. UPDATE operations aren't supported. The REMOVE operation cancels a pending proposal. |
| `BrandSuggestionService` | This service will suggest brands based on a prefix. |
| `CampaignAssetService` | Service to manage campaign assets. |
| `CampaignAssetSetService` | Service to manage campaign asset set |
| `CampaignBidModifierService` | Service to manage campaign bid modifiers. |
| `CampaignBudgetService` | Service to manage campaign budgets. |
| `CampaignConversionGoalService` | Service to manage campaign conversion goal. |
| `CampaignCriterionService` | Service to manage campaign criteria. |
| `CampaignCustomizerService` | Service to manage campaign customizer |
| `CampaignDraftService` | Service to manage campaign drafts. |
| `CampaignGoalConfigService` | Service to manage campaign goal configs. |
| `CampaignGroupService` | Service to manage campaign groups. |
| `CampaignLabelService` | Service to manage labels on campaigns. |
| `CampaignLifecycleGoalService` | Service to configure campaign lifecycle goals. |
| `CampaignService` | Service to manage campaigns. |
| `CampaignSharedSetService` | Service to manage campaign shared sets. |
| `ContentCreatorInsightsService` | Content Creator Insights Service helps users find information about YouTube Creators and their content and how these creators and their audiences can be reached with Google Ads. Accessible to allowlisted customers only. |
| `ConversionActionService` | Service to manage conversion actions. |
| `ConversionAdjustmentUploadService` | Service to upload conversion adjustments. |
| `ConversionCustomVariableService` | Service to manage conversion custom variables. |
| `ConversionGoalCampaignConfigService` | Service to manage conversion goal campaign config. |
| `ConversionUploadService` | Service to upload conversions. |
| `ConversionValueRuleService` | Service to manage conversion value rules. |
| `ConversionValueRuleSetService` | Service to manage conversion value rule sets. |
| `CustomAudienceService` | Service to manage custom audiences. |
| `CustomConversionGoalService` | Service to manage custom conversion goal. |
| `CustomInterestService` | Service to manage custom interests. |
| `CustomerAssetService` | Service to manage customer assets. |
| `CustomerAssetSetService` | Service to manage customer asset set |
| `CustomerClientLinkService` | Service to manage customer client links. |
| `CustomerConversionGoalService` | Service to manage customer conversion goal. |
| `CustomerCustomizerService` | Service to manage customer customizer |
| `CustomerLabelService` | Service to manage labels on Google Ads customers. This service is commonly used by manager accounts to apply their own labels to their client accounts. The label entity must exist under the manager account. |
| `CustomerLifecycleGoalService` | Service to configure customer lifecycle goals. |
| `CustomerManagerLinkService` | Service to manage customer-manager links. |
| `CustomerNegativeCriterionService` | Service to manage customer negative criteria. |
| `CustomerService` | Service to manage customers. |
| `CustomerSkAdNetworkConversionValueSchemaService` | Service to manage CustomerSkAdNetworkConversionValueSchema. |
| `CustomerUserAccessInvitationService` | This service manages the access invitation extended to users for a given customer. |
| `CustomerUserAccessService` | This service manages the permissions of a user on a given customer. |
| `CustomizerAttributeService` | Service to manage customizer attribute |
| `DataLinkService` | This service allows management of data links between a Google Ads customer and another data entity. |
| `ExperimentArmService` | Service to manage experiment arms. |
| `ExperimentService` | Service to manage experiments. |
| `GeoTargetConstantService` | Service to fetch geo target constants. |
| `GoalService` | Service to manage goals. |
| `GoogleAdsFieldService` | Service to fetch Google Ads API fields. |
| `GoogleAdsService` | Service to fetch data and metrics across resources. |
| `IdentityVerificationService` | A service for managing Identity Verification Service. |
| `IncentiveService` | Service to support incentive related operations. |
| `InvoiceService` | A service to fetch invoices issued for a billing setup during a given month. |
| `KeywordPlanAdGroupKeywordService` | Service to manage Keyword Plan ad group keywords. KeywordPlanAdGroup is required to add ad group keywords. Positive and negative keywords are supported. A maximum of 10,000 positive keywords are allowed per keyword plan. A maximum of 1,000 negative keywords are allower per keyword plan. This includes campaign negative keywords and ad group negative keywords. |
| `KeywordPlanAdGroupService` | Service to manage Keyword Plan ad groups. |
| `KeywordPlanCampaignKeywordService` | Service to manage Keyword Plan campaign keywords. KeywordPlanCampaign is required to add the campaign keywords. Only negative keywords are supported. A maximum of 1000 negative keywords are allowed per plan. This includes both campaign negative keywords and ad group negative keywords. |
| `KeywordPlanCampaignService` | Service to manage Keyword Plan campaigns. |
| `KeywordPlanIdeaService` | Service to generate keyword ideas. |
| `KeywordPlanService` | Service to manage keyword plans. |
| `KeywordThemeConstantService` | Service to fetch Smart Campaign keyword themes. |
| `LabelService` | Service to manage labels. |
| `LocalServicesLeadService` | This service allows management of LocalServicesLead resources. |
| `OfflineUserDataJobService` | Service to manage offline user data jobs. |
| `PaymentsAccountService` | Service to provide payments accounts that can be used to set up consolidated billing. |
| `ProductLinkInvitationService` | This service allows management of product link invitations from Google Ads accounts to other accounts. |
| `ProductLinkService` | This service allows management of links between a Google Ads customer and another product. |
| `ReachPlanService` | Reach Plan Service gives users information about audience size that can be reached through advertisement on YouTube. In particular, GenerateReachForecast provides estimated number of people of specified demographics that can be reached by an ad in a given market by a campaign of certain duration with a defined budget. |
| `RecommendationService` | Service to manage recommendations. |
| `RecommendationSubscriptionService` | Service to manage recommendation subscriptions. |
| `RemarketingActionService` | Service to manage remarketing actions. |
| `ReservationService` | Service for reservation related operations. This service is not publicly available. |
| `ShareablePreviewService` | Service to generate Shareable Previews. |
| `SharedCriterionService` | Service to manage shared criteria. |
| `SharedSetService` | Service to manage shared sets. |
| `SmartCampaignSettingService` | Service to manage Smart campaign settings. |
| `SmartCampaignSuggestService` | Service to get suggestions for Smart Campaigns. |
| `ThirdPartyAppAnalyticsLinkService` | This service allows management of links between Google Ads and third party app analytics. |
| `TravelAssetSuggestionService` | Service to retrieve Travel asset suggestions. |
| `UserDataService` | Service to manage user data uploads. Any uploads made to a Customer Match list through this service will be eligible for matching as per the customer matching process. See https://support.google.com/google-ads/answer/7474263. However, the uploads made through this service will not be visible under the 'Segment members' section for the Customer Match List in the Google Ads UI. |
| `UserListCustomerTypeService` | Service to manage user list customer types. |
| `UserListService` | Service to manage user lists. |
| `YouTubeVideoUploadService` | Service to manage YouTube video uploads. |
| `BookCampaignsOperation` | Request message for the BookCampaigns action. Request including this operation can have a latency of up to 30 seconds. This feature is not publicly available. |
| `BookCampaignsOperation.Campaign` | A single campaign to book. |
| `BookCampaignsResult` | Response message for the BookCampaigns action. Note that if the response contains errors, the action response will not be returned, but a quote may still be returned in the ErrorDetails.reservation_error_details field. |
| `GenerateShareablePreviewsOperation` | Operation to generate shareable previews. |
| `GenerateShareablePreviewsResult` | Result of the GenerateShareablePreviews action. |
| `QuoteCampaignsOperation` | Request message for the QuoteCampaigns action. Request including this operation can have a latency of up to 30 seconds. This feature is not publicly available. |
| `QuoteCampaignsOperation.Campaign` | A campaign for which the quote is requested. |
| `QuoteCampaignsResult` | The response of the QuoteCampaigns action, when the action is successful. Note that if the response contains errors, the action response will not be returned, but a quote may still be returned in the ErrorDetails.reservation_error_details field. |
| `ShareablePreview` | A shareable preview with its identifier. |
| `ShareablePreviewResult` | Message to hold a shareable preview result. |
| `UiPreviewResult` | Message to hold a UI preview result. |
| `YouTubeLivePreviewResult` | Message to hold a YouTube live preview result. |
| `ActivityCityInfo` | The city where the travel activity is available. |
| `ActivityCountryInfo` | The country where the travel activity is available. |
| `ActivityIdInfo` | Advertiser-specific activity ID. |
| `ActivityRatingInfo` | Rating of the activity as a number 1 to 5, where 5 is the best. |
| `ActivityStateInfo` | The state where the travel activity is available. |
| `AdAppDeepLinkAsset` | An app deep link used inside an ad. |
| `AdAssetPolicySummary` | Contains policy information for an asset inside an ad. |
| `AdCallToActionAsset` | A call to action asset used inside an ad. |
| `AdDemandGenCarouselCardAsset` | A Demand Gen carousel card asset used inside an ad. |
| `AdImageAsset` | An image asset used inside an ad. |
| `AdMediaBundleAsset` | A media bundle asset used inside an ad. |
| `AdScheduleInfo` | Represents an AdSchedule criterion. AdSchedule is specified as the day of the week and a time interval within which ads will be shown. No more than six AdSchedules can be added for the same day. |
| `AdTextAsset` | A text asset used inside an ad. |
| `AdVideoAsset` | A video asset used inside an ad. |
| `AdVideoAssetInfo` | Contains info fields for AdVideoAssets. |
| `AdVideoAssetInventoryPreferences` | YouTube Video Asset inventory preferences. |
| `AdVideoAssetLinkFeatureControl` | YouTube Video Asset feature controls. |
| `AdditionalApplicationInfo` | Additional information about the application/tool issuing the request. This field is only used by `https://developers.google.com/google-ads/api/reference/rpc/v24/ContentCreatorInsightsService`, `https://developers.google.com/google-ads/api/reference/rpc/v24/AudienceInsightsService`, and `https://developers.google.com/google-ads/api/reference/rpc/v24/ReachPlanService` APIs. |
| `AddressInfo` | Address for proximity criterion. |
| `AgeDimension` | Dimension specifying users by their age. |
| `AgeRangeInfo` | An age range criterion. |
| `AgeSegment` | Contiguous age range. |
| `AppAdInfo` | An app ad. |
| `AppDeepLinkAsset` | An app deep link asset |
| `AppEngagementAdInfo` | App engagement ads allow you to write text encouraging a specific action in the app, like checking in, making a purchase, or booking a flight. They allow you to send users to a specific part of your app where they can find what they're looking for easier and faster. |
| `AppPaymentModelInfo` | An app payment model criterion. |
| `AppPreRegistrationAdInfo` | App pre-registration ads link to your app or game listing on Google Play, and can run on Google Play, on YouTube (in-stream only), and within other apps and mobile websites on the Display Network. It will help capture people's interest in your app or game and generate an early install base for your app or game before a launch. |
| `AssetDisapproved` | Details related to AssetLinkPrimaryStatusReasonPB.ASSET_DISAPPROVED |
| `AssetInteractionTarget` | An AssetInteractionTarget segment. |
| `AssetLinkPrimaryStatusDetails` | Provides the detail of a PrimaryStatus. Each asset link has a PrimaryStatus value (e.g. NOT_ELIGIBLE, meaning not serving), and list of corroborating PrimaryStatusReasons (e.g. [ASSET_DISAPPROVED]). Each reason may have some additional details annotated with it. For instance, when the reason is ASSET_DISAPPROVED, the details field will contain additional information about the offline evaluation errors which led to the asset being disapproved. |
| `AssetUsage` | Contains the usage information of the asset. |
| `AudienceDimension` | Positive dimension specifying user's audience. |
| `AudienceExclusionDimension` | Negative dimension specifying users to exclude from the audience. |
| `AudienceInfo` | An audience criterion. |
| `AudienceInsightsAttribute` | An audience attribute that can be used to request insights about the audience. Valid inputs for these fields are available from `https://developers.google.com/google-ads/api/reference/rpc/v24/AudienceInsightsService/ListAudienceInsightsAttributes`. |
| `AudienceInsightsAttributeMetadata` | An audience attribute, with metadata about it, returned in response to a search. |
| `AudienceInsightsAttributeMetadataGroup` | A group of audience attributes with metadata, returned in response to a search. |
| `AudienceInsightsCategory` | A Product and Service category. |
| `AudienceInsightsEntity` | A Knowledge Graph entity, represented by its machine id. |
| `AudienceInsightsLineup` | A YouTube Lineup. |
| `AudienceSegment` | Positive audience segment. |
| `AudienceSegmentDimension` | Dimension specifying users by their membership in other audience segments. |
| `BasicUserListInfo` | User list targeting as a collection of conversions or remarketing actions. |
| `BookOnGoogleAsset` | A Book on Google asset. Used to redirect user to book through Google. Book on Google will change the redirect url to book directly through Google. |
| `BrandInfo` | Represents a Brand Criterion used for targeting based on commercial knowledge graph. |
| `BrandListInfo` | A Brand List Criterion is used to specify a list of brands. The list is represented as a SharedSet id type BRAND_HINT. A criterion of this type can be either targeted or excluded. |
| `BudgetCampaignAssociationStatus` | A BudgetCampaignAssociationStatus segment. |
| `BudgetSimulationPoint` | Projected metrics for a specific budget amount. |
| `BudgetSimulationPointList` | A container for simulation points for simulations of type BUDGET. |
| `BusinessMessageAsset` | A business message asset. |
| `BusinessMessageCallToActionInfo` | Display information that encourages the user to take action. |
| `BusinessProfileBusinessNameFilter` | Business Profile location group business name filter. |
| `BusinessProfileLocation` | Business Profile location data synced from the linked Business Profile account. |
| `BusinessProfileLocationGroup` | Information about a Business Profile dynamic location group. Only applicable if the sync level AssetSet's type is LOCATION_SYNC and sync source is Business Profile. |
| `BusinessProfileLocationSet` | Data used to configure a location set populated from Google Business Profile locations. Different types of filters are AND'ed together, if they are specified. |
| `CallAsset` | A Call asset. |
| `CallFeedItem` | Represents a Call extension. |
| `CallToActionAsset` | A call to action asset. |
| `CalloutAsset` | A Callout asset. |
| `CalloutFeedItem` | Represents a callout extension. |
| `CampaignGoalSettings` | Campaign Goal settings. |
| `CampaignGoalSettings.CampaignRetentionGoalSettings` | Retention campaign goal settings. |
| `CampaignReservationQuote` | The campaign reservation quote. |
| `CampaignThirdPartyBrandLiftIntegrationPartner` | Container for third party Brand Lift integration data for Campaign. |
| `CampaignThirdPartyBrandSafetyIntegrationPartner` | Container for third party brand safety integration data for Campaign. |
| `CampaignThirdPartyIntegrationPartners` | Container for Campaign level third party integration partners. |
| `CampaignThirdPartyReachIntegrationPartner` | Container for third party reach integration data for Campaign. |
| `CampaignThirdPartyViewabilityIntegrationPartner` | Container for third party viewability integration data for Campaign. |
| `CarrierInfo` | Represents a Carrier Criterion. |
| `ChainFilter` | One chain level filter on location in a feed item set. The filtering logic among all the fields is AND. |
| `ChainLocationGroup` | Represents information about a Chain dynamic location group. Only applicable if the sync level AssetSet's type is LOCATION_SYNC and sync source is chain. |
| `ChainSet` | Data used to configure a location set populated with the specified chains. |
| `ClickLocation` | Location criteria associated with a click. |
| `CombinedAudienceInfo` | A combined audience criterion. |
| `Commission` | Commission is an automatic bidding strategy in which the advertiser pays a certain portion of the conversion value. |
| `ConceptGroup` | The concept group for the keyword concept. |
| `Consent` | Consent |
| `ContentLabelInfo` | Content Label for category exclusion. |
| `CpcBidSimulationPoint` | Projected metrics for a specific CPC bid amount. |
| `CpcBidSimulationPointList` | A container for simulation points for simulations of type CPC_BID. |
| `CpvBidSimulationPoint` | Projected metrics for a specific CPV bid amount. |
| `CpvBidSimulationPointList` | A container for simulation points for simulations of type CPV_BID. |
| `CriterionCategoryAvailability` | Information of category availability, per advertising channel. |
| `CriterionCategoryChannelAvailability` | Information of advertising channel type and subtypes a category is available in. |
| `CriterionCategoryLocaleAvailability` | Information about which locales a category is available in. |
| `CrmBasedUserListInfo` | UserList of CRM users provided by the advertiser. |
| `CustomAffinityInfo` | A custom affinity criterion. A criterion of this type is only targetable. |
| `CustomAudienceInfo` | A custom audience criterion. |
| `CustomAudienceSegment` | Custom audience segment. |
| `CustomIntentInfo` | A custom intent criterion. A criterion of this type is only targetable. |
| `CustomParameter` | A mapping that can be used by custom parameter tags in a `tracking_url_template`, `final_urls`, or `mobile_final_urls`. |
| `CustomerLifecycleOptimizationValueSettings` | Lifecycle goal optimization value settings. |
| `CustomerMatchUserListMetadata` | Metadata for customer match user list. |
| `CustomerThirdPartyBrandLiftIntegrationPartner` | Container for third party Brand Lift integration data for Customer. |
| `CustomerThirdPartyBrandSafetyIntegrationPartner` | Container for third party brand safety integration data for Customer. |
| `CustomerThirdPartyIntegrationPartners` | Container for Customer level third party integration partners. |
| `CustomerThirdPartyReachIntegrationPartner` | Container for third party reach integration data for Customer. |
| `CustomerThirdPartyViewabilityIntegrationPartner` | Container for third party viewability integration data for Customer. |
| `CustomizerValue` | A customizer value that is referenced in customizer linkage entities like CustomerCustomizer, CampaignCustomizer, etc. |
| `DateRange` | A date range. |
| `DemandGenCarouselAdInfo` | A Demand Gen carousel ad. |
| `DemandGenCarouselCardAsset` | A Demand Gen Carousel Card asset. |
| `DemandGenMultiAssetAdInfo` | A Demand Gen multi asset ad. |
| `DemandGenProductAdInfo` | A Demand Gen product ad. |
| `DemandGenVideoResponsiveAdInfo` | A Demand Gen video responsive ad. |
| `DetailedDemographicSegment` | Detailed demographic segment. |
| `DeviceInfo` | A device criterion. |
| `DisplayUploadAdInfo` | A generic type of display ad. The exact ad format is controlled by the `display_upload_product_type` field, which determines what kinds of data need to be included with the ad. |
| `DynamicBusinessProfileLocationGroupFilter` | Represents a filter on Business Profile locations in an asset set. If multiple filters are provided, they are AND'ed together. |
| `DynamicCustomAsset` | A dynamic custom asset. |
| `DynamicEducationAsset` | A Dynamic Education asset. |
| `DynamicFlightsAsset` | A dynamic flights asset. |
| `DynamicHotelsAndRentalsAsset` | A dynamic hotels and rentals asset. |
| `DynamicJobsAsset` | A dynamic jobs asset. |
| `DynamicLocalAsset` | A dynamic local asset. |
| `DynamicRealEstateAsset` | A dynamic real estate asset. |
| `DynamicTravelAsset` | A dynamic travel asset. |
| `EnhancedCpc` | An automated bidding strategy that raises bids for clicks that seem more likely to lead to a conversion and lowers them for clicks where they seem less likely. This bidding strategy is deprecated and cannot be created anymore. Use ManualCpc with enhanced_cpc_enabled set to true for equivalent functionality. |
| `EventAttribute` | Advertiser defined events and their attributes. All the values in the nested fields are required. |
| `EventItemAttribute` | Event Item attributes of the Customer Match. |
| `ExclusionSegment` | An audience segment to be excluded from an audience. |
| `ExpandedDynamicSearchAdInfo` | An expanded dynamic search ad. |
| `ExpandedTextAdInfo` | An expanded text ad. Expanded text ads are deprecated. |
| `ExtendedDemographicInfo` | Represents an extended demographic criterion. |