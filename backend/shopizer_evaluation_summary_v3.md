# Phase 5 Retrospective Evaluation Report — Version 3 (Shopizer)

> Generated: 2026-10-14T18:26:00.991Z  
> Repository: `shopizer` (e-commerce platform, multi-module Spring Boot)  
> Commits inspected: **54** | Eligible multi-component commits: **13** | Total LOO cases evaluated: **1213**  
> Pruning threshold (context-aware): **0.35**  

---

## 1. Methodology & Experimental Design

- **Leave-One-Out (LOO) Design**: For each eligible commit touching $M \ge 2$ mapped non-Test components, $M$ separate evaluation cases are generated. In each case, exactly 1 component is treated as the changed input, while the remaining $M - 1$ co-changed non-Test components serve as the retrospective target oracle.
- **Controlled Variants**: Evaluates Variant A (Structural-only), Variant B (Structural + History), Structural + Artifact, Variant C (Full Context-Aware), and Baseline (structural 2-hop heuristic).
- **Sensitivity Analysis**: Excludes the oversized commit `052d2ed` (~1,100 components) to verify that results are not distorted by a single massive repository-wide branch merge/update.
- **Two-Level Aggregation**: Cases originating from the same commit are first averaged at the commit level. A macro-average is then computed across independent commits.
- **Leakage Prevention**: Historical co-change features are mined exclusively from commits strictly older than the evaluated commit.

---

## 2. Validity Constraints & Limitations

1. **Static Graph Limitation**: The structural repository graph is static (HEAD snapshot from analysis_output.json). Temporal AST evolution across historical commits is not captured; only historical co-change counts are time-sliced.
2. **Sample Size**: Only **13 commits** satisfy the eligibility criteria. Results are exploratory only.
3. **Oversized Commit Impact**: Commit `052d2ed` accounts for 96% of all LOO cases. The sensitivity analysis below isolates standard changes from this outlier.
4. **Pruning Threshold**: The threshold 0.35 was not tuned on this dataset.
5. **Shopizer-Specific**: Shopizer has 1204 components and 5206 relationships extracted by the static analyzer.

---

## 3. Commit-Level Macro-Average Results (All 13 Commits, 1213 Cases)

Averaged first within commits, then across all 13 independent commits:

| Model | Precision | Recall | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | Test Recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop heuristic) | 0.1288 | 0.1111 | 0.0680 | 0.1492 | 0.1055 | 0.1349 | 0.1110 | 0.1288 | 0.1110 | 0.4671 |
| Variant A: Structural-only (threshold=0.35) | 0.1183 | 0.4271 | 0.0826 | 0.1297 | 0.0338 | 0.1355 | 0.1230 | 0.1158 | 0.1295 | 0.7665 |
| Variant B: Structural + History (threshold=0.35) | 0.1183 | 0.4271 | 0.0826 | 0.1543 | 0.0780 | 0.1477 | 0.1647 | 0.1201 | 0.1683 | 0.7665 |
| Structural + Artifact Context (threshold=0.35) | 0.1183 | 0.4271 | 0.0826 | 0.1329 | 0.0344 | 0.1406 | 0.1281 | 0.1158 | 0.1295 | 0.7665 |
| Variant C: Full Context-Aware (threshold=0.35) | 0.1183 | 0.4271 | 0.0826 | 0.1575 | 0.0787 | 0.1493 | 0.1669 | 0.1201 | 0.1683 | 0.7665 |

---

## 3.1 Sensitivity Analysis (12 Commits, 46 Cases — Excluding Oversized Commit `052d2ed`)

Commit-level macro-averages excluding the single ~1,100-component commit:

| Model | Precision | Recall | F1 | P@3 | R@3 | P@5 | R@5 | P@10 | R@10 | Test Recall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (structural 2-hop heuristic) | 0.0931 | 0.1201 | 0.0733 | 0.1152 | 0.1142 | 0.0997 | 0.1201 | 0.0931 | 0.1201 | 0.5052 |
| Variant A: Structural-only (threshold=0.35) | 0.0588 | 0.4618 | 0.0878 | 0.0712 | 0.0365 | 0.0774 | 0.1330 | 0.0561 | 0.1399 | 0.8212 |
| Variant B: Structural + History (threshold=0.35) | 0.0588 | 0.4618 | 0.0878 | 0.0978 | 0.0844 | 0.0906 | 0.1781 | 0.0608 | 0.1819 | 0.8212 |
| Structural + Artifact Context (threshold=0.35) | 0.0588 | 0.4618 | 0.0878 | 0.0746 | 0.0372 | 0.0830 | 0.1385 | 0.0561 | 0.1399 | 0.8212 |
| Variant C: Full Context-Aware (threshold=0.35) | 0.0588 | 0.4618 | 0.0878 | 0.1013 | 0.0851 | 0.0924 | 0.1806 | 0.0608 | 0.1819 | 0.8212 |

---

## 4. Breakdown Across Independent Commits

### Commit `a59820c`: "3.2.7 stuff"

- **Mapped non-Test components (16)**: `com.salesmanager.core.business.repositories.catalog.category.CategoryRepository, com.salesmanager.core.business.repositories.catalog.category.PageableCategoryRepository, com.salesmanager.core.business.repositories.catalog.product.ProductRepository, com.salesmanager.core.business.services.catalog.category.CategoryService, com.salesmanager.core.business.services.catalog.category.CategoryServiceImpl, com.salesmanager.core.business.services.reference.init.InitializationDatabaseImpl, com.salesmanager.core.business.services.reference.loader.ZonesLoader, com.salesmanager.core.business.services.search.SearchServiceImpl, com.salesmanager.shop.model.catalog.category.Category, com.salesmanager.shop.mapper.catalog.ReadableCategoryMapper ... (truncated)`
- **Mapped Test components (3)**: `com.salesmanager.test.shop.common.ServicesTestSupport, com.salesmanager.test.shop.integration.category.CategoryManagementAPIIntegrationTest, com.salesmanager.test.shop.integration.product.ProductManagementAPIIntegrationTest`
- **Generated LOO cases**: 16

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `CategoryRepository` | 1/1 | 3/8 | 3/8 | 3/8 | 0.2609 | 0.2609 | 0.2609 |
| `PageableCategoryRepository` | 1/1 | 3/6 | 3/6 | 3/6 | 0.2857 | 0.2857 | 0.2857 |
| `ProductRepository` | 0/1 | 1/13 | 1/13 | 1/13 | 0.0714 | 0.0714 | 0.0714 |
| `CategoryService` | 2/10 | 6/39 | 6/39 | 6/39 | 0.2222 | 0.2222 | 0.2222 |
| `CategoryServiceImpl` | 2/4 | 7/34 | 7/34 | 7/34 | 0.2857 | 0.2857 | 0.2857 |
| `InitializationDatabaseImpl` | 0/12 | 2/69 | 2/69 | 2/69 | 0.0476 | 0.0476 | 0.0476 |
| `ZonesLoader` | 1/3 | 1/3 | 1/3 | 1/3 | 0.1111 | 0.1111 | 0.1111 |
| `SearchServiceImpl` | 0/1 | 0/17 | 0/17 | 0/17 | 0 | 0 | 0 |
| `ReadableCategoryMapper` | 1/4 | 1/5 | 1/5 | 1/5 | 0.1 | 0.1 | 0.1 |
| `Category` | 0/0 | 0/56 | 0/56 | 0/56 | 0 | 0 | 0 |
| `CategoryApi` | 0/2 | 2/22 | 2/22 | 2/22 | 0.1081 | 0.1081 | 0.1081 |
| `ProductApi` | 1/5 | 6/40 | 6/40 | 6/40 | 0.2182 | 0.2182 | 0.2182 |
| `ProductGroupApi` | 0/2 | 3/29 | 3/29 | 3/29 | 0.1364 | 0.1364 | 0.1364 |
| `ProductRelationshipApi` | 0/2 | 4/28 | 4/28 | 4/28 | 0.186 | 0.186 | 0.186 |
| `ProductApiV2` | 0/4 | 4/25 | 4/25 | 4/25 | 0.2 | 0.2 | 0.2 |
| `CategoryFacadeImpl` | 1/4 | 7/41 | 7/41 | 7/41 | 0.25 | 0.25 | 0.25 |

### Commit `60f0fac`: "end points refactoring"

- **Mapped non-Test components (2)**: `com.salesmanager.shop.store.api.v1.category.CategoryApi, com.salesmanager.shop.store.api.v1.product.ProductApi`
- **Mapped Test components (3)**: `com.salesmanager.test.shop.common.ServicesTestSupport, com.salesmanager.test.shop.integration.category.CategoryManagementAPIIntegrationTest, com.salesmanager.test.shop.integration.product.ProductManagementAPIIntegrationTest`
- **Generated LOO cases**: 2

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `CategoryApi` | 0/2 | 0/22 | 0/22 | 0/22 | 0 | 0 | 0 |
| `ProductApi` | 0/5 | 0/40 | 0/40 | 0/40 | 0 | 0 | 0 |

### Commit `a158815`: "end points refactoring"

- **Mapped non-Test components (2)**: `com.salesmanager.shop.store.api.v1.category.CategoryApi, com.salesmanager.shop.store.api.v1.product.ProductApi`
- **Mapped Test components (3)**: `com.salesmanager.test.shop.common.ServicesTestSupport, com.salesmanager.test.shop.integration.category.CategoryManagementAPIIntegrationTest, com.salesmanager.test.shop.integration.product.ProductManagementAPIIntegrationTest`
- **Generated LOO cases**: 2

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `CategoryApi` | 0/2 | 0/22 | 0/22 | 0/22 | 0 | 0 | 0 |
| `ProductApi` | 0/5 | 0/40 | 0/40 | 0/40 | 0 | 0 | 0 |

### Commit `81b0ade`: "category by friendly url"

- **Mapped non-Test components (6)**: `com.salesmanager.core.business.repositories.catalog.category.CategoryRepository, com.salesmanager.core.business.services.catalog.category.CategoryService, com.salesmanager.core.business.services.catalog.category.CategoryServiceImpl, com.salesmanager.shop.store.api.v1.product.ProductApi, com.salesmanager.shop.store.api.v2.product.ProductApiV2, com.salesmanager.shop.store.facade.category.CategoryFacadeImpl`
- **Mapped Test components (2)**: `com.salesmanager.test.shop.common.ServicesTestSupport, com.salesmanager.test.shop.integration.category.CategoryManagementAPIIntegrationTest`
- **Generated LOO cases**: 6

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `CategoryRepository` | 1/1 | 2/8 | 2/8 | 2/8 | 0.3077 | 0.3077 | 0.3077 |
| `CategoryService` | 2/10 | 4/39 | 4/39 | 4/39 | 0.1818 | 0.1818 | 0.1818 |
| `CategoryServiceImpl` | 1/4 | 4/34 | 4/34 | 4/34 | 0.2051 | 0.2051 | 0.2051 |
| `ProductApi` | 1/5 | 4/40 | 4/40 | 4/40 | 0.1778 | 0.1778 | 0.1778 |
| `ProductApiV2` | 0/4 | 2/25 | 2/25 | 2/25 | 0.1333 | 0.1333 | 0.1333 |
| `CategoryFacadeImpl` | 1/4 | 4/41 | 4/41 | 4/41 | 0.1739 | 0.1739 | 0.1739 |

### Commit `3f237ee`: "category by friendly url"

- **Mapped non-Test components (6)**: `com.salesmanager.core.business.repositories.catalog.category.CategoryRepository, com.salesmanager.core.business.services.catalog.category.CategoryService, com.salesmanager.core.business.services.catalog.category.CategoryServiceImpl, com.salesmanager.shop.store.api.v1.product.ProductApi, com.salesmanager.shop.store.api.v2.product.ProductApiV2, com.salesmanager.shop.store.facade.category.CategoryFacadeImpl`
- **Mapped Test components (2)**: `com.salesmanager.test.shop.common.ServicesTestSupport, com.salesmanager.test.shop.integration.category.CategoryManagementAPIIntegrationTest`
- **Generated LOO cases**: 6

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `CategoryRepository` | 1/1 | 2/8 | 2/8 | 2/8 | 0.3077 | 0.3077 | 0.3077 |
| `CategoryService` | 2/10 | 4/39 | 4/39 | 4/39 | 0.1818 | 0.1818 | 0.1818 |
| `CategoryServiceImpl` | 1/4 | 4/34 | 4/34 | 4/34 | 0.2051 | 0.2051 | 0.2051 |
| `ProductApi` | 1/5 | 4/40 | 4/40 | 4/40 | 0.1778 | 0.1778 | 0.1778 |
| `ProductApiV2` | 0/4 | 2/25 | 2/25 | 2/25 | 0.1333 | 0.1333 | 0.1333 |
| `CategoryFacadeImpl` | 1/4 | 4/41 | 4/41 | 4/41 | 0.1739 | 0.1739 | 0.1739 |

### Commit `a2316b7`: "Category by friendly url decomplexified"

- **Mapped non-Test components (2)**: `com.salesmanager.shop.store.api.v2.product.ProductApiV2, com.salesmanager.shop.store.facade.category.CategoryFacadeImpl`
- **Mapped Test components (0)**: `(none)`
- **Generated LOO cases**: 2

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `ProductApiV2` | 0/4 | 1/25 | 1/25 | 1/25 | 0.0769 | 0.0769 | 0.0769 |
| `CategoryFacadeImpl` | 0/4 | 1/41 | 1/41 | 1/41 | 0.0476 | 0.0476 | 0.0476 |

### Commit `9f6fc62`: "Category by friendly url decomplexified"

- **Mapped non-Test components (2)**: `com.salesmanager.shop.store.api.v2.product.ProductApiV2, com.salesmanager.shop.store.facade.category.CategoryFacadeImpl`
- **Mapped Test components (0)**: `(none)`
- **Generated LOO cases**: 2

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `ProductApiV2` | 0/4 | 1/25 | 1/25 | 1/25 | 0.0769 | 0.0769 | 0.0769 |
| `CategoryFacadeImpl` | 0/4 | 1/41 | 1/41 | 1/41 | 0.0476 | 0.0476 | 0.0476 |

### Commit `2a0c246`: "ReadableCategory refactor"

- **Mapped non-Test components (2)**: `com.salesmanager.shop.mapper.catalog.ReadableCategoryMapper, com.salesmanager.shop.store.facade.category.CategoryFacadeImpl`
- **Mapped Test components (0)**: `(none)`
- **Generated LOO cases**: 2

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `ReadableCategoryMapper` | 1/4 | 1/5 | 1/5 | 1/5 | 0.3333 | 0.3333 | 0.3333 |
| `CategoryFacadeImpl` | 0/4 | 1/41 | 1/41 | 1/41 | 0.0476 | 0.0476 | 0.0476 |

### Commit `380429c`: "ReadableCategory refactor"

- **Mapped non-Test components (2)**: `com.salesmanager.shop.mapper.catalog.ReadableCategoryMapper, com.salesmanager.shop.store.facade.category.CategoryFacadeImpl`
- **Mapped Test components (0)**: `(none)`
- **Generated LOO cases**: 2

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `ReadableCategoryMapper` | 1/4 | 1/5 | 1/5 | 1/5 | 0.3333 | 0.3333 | 0.3333 |
| `CategoryFacadeImpl` | 0/4 | 1/41 | 1/41 | 1/41 | 0.0476 | 0.0476 | 0.0476 |

### Commit `6b822cb`: "ProductGroup fix"

- **Mapped non-Test components (2)**: `com.salesmanager.shop.model.catalog.category.Category, com.salesmanager.shop.store.api.v1.product.ProductGroupApi`
- **Mapped Test components (0)**: `(none)`
- **Generated LOO cases**: 2

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `Category` | 0/0 | 0/56 | 0/56 | 0/56 | 0 | 0 | 0 |
| `ProductGroupApi` | 0/2 | 0/29 | 0/29 | 0/29 | 0 | 0 | 0 |

### Commit `b66de14`: "ResourceLoader"

- **Mapped non-Test components (2)**: `com.salesmanager.core.business.services.reference.loader.ZonesLoader, com.salesmanager.core.business.services.search.SearchServiceImpl`
- **Mapped Test components (0)**: `(none)`
- **Generated LOO cases**: 2

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `ZonesLoader` | 0/3 | 0/3 | 0/3 | 0/3 | 0 | 0 | 0 |
| `SearchServiceImpl` | 0/1 | 0/17 | 0/17 | 0/17 | 0 | 0 | 0 |

### Commit `22e94f3`: "Category fix"

- **Mapped non-Test components (2)**: `com.salesmanager.core.business.repositories.catalog.category.PageableCategoryRepository, com.salesmanager.shop.store.api.v1.category.CategoryApi`
- **Mapped Test components (1)**: `com.salesmanager.test.shop.integration.category.CategoryManagementAPIIntegrationTest`
- **Generated LOO cases**: 2

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `PageableCategoryRepository` | 0/1 | 0/6 | 0/6 | 0/6 | 0 | 0 | 0 |
| `CategoryApi` | 0/2 | 0/22 | 0/22 | 0/22 | 0 | 0 | 0 |

### Commit `052d2ed`: "3.2.5 - main default branch"

- **Mapped non-Test components (1167)**: `com.salesmanager.core.business.exception.ConversionException, com.salesmanager.core.business.exception.ServiceException, com.salesmanager.core.constants.MeasureUnit, com.salesmanager.core.constants.SchemaConstant, com.salesmanager.core.model.catalog.catalog.Catalog, com.salesmanager.core.model.catalog.catalog.CatalogCategoryEntry, com.salesmanager.core.model.catalog.category.Category, com.salesmanager.core.model.catalog.category.CategoryDescription, com.salesmanager.core.model.catalog.marketplace.Catalog, com.salesmanager.core.model.catalog.marketplace.CatalogDescription ... (truncated)`
- **Mapped Test components (37)**: `com.salesmanager.test.business.utils.DataUtilsTest, com.salesmanager.test.catalog.CategoryTest, com.salesmanager.test.catalog.ManufacturerTest, com.salesmanager.test.catalog.ProductNextGenTest, com.salesmanager.test.catalog.ProductTest, com.salesmanager.test.common.AbstractSalesManagerCoreTestCase, com.salesmanager.test.configuration.ConfigurationTest, com.salesmanager.test.content.ContentFolderTest, com.salesmanager.test.content.ContentImagesTest, com.salesmanager.test.content.StaticContentTest, com.salesmanager.test.customer.CustomerTest, com.salesmanager.test.modules.ModulesTest, com.salesmanager.test.order.InvoiceTest, com.salesmanager.test.order.OrderTest, com.salesmanager.test.references.ReferencesTest, com.salesmanager.test.shipping.ShippingDistanceProcessorTest, com.salesmanager.test.shipping.ShippingMethodDecisionTest, com.salesmanager.test.shipping.ShippingQuoteByWeightTest, com.salesmanager.test.shoppingcart.ShoppingCartTest, com.salesmanager.test.utils.ImportIntegrationModule, com.salesmanager.test.utils.SendEmailTest, com.salesmanager.test.utils.UtilsTestCase, com.salesmanager.test.shop.common.ServicesTestSupport, com.salesmanager.test.shop.integration.cart.CartTestBean, com.salesmanager.test.shop.integration.cart.ShoppingCartAPIIntegrationTest, com.salesmanager.test.shop.integration.category.CategoryManagementAPIIntegrationTest, com.salesmanager.test.shop.integration.customer.CustomerRegistrationIntegrationTest, com.salesmanager.test.shop.integration.order.OrderApiIntegrationTest, com.salesmanager.test.shop.integration.product.ProductManagementAPIIntegrationTest, com.salesmanager.test.shop.integration.product.ProductV2ManagementAPIIntegrationTest, com.salesmanager.test.shop.integration.search.SearchApiIntegrationTest, com.salesmanager.test.shop.integration.store.MerchantStoreApiIntegrationTest, com.salesmanager.test.shop.integration.system.ActuatorTest, com.salesmanager.test.shop.integration.system.OptinApiIntegrationTest, com.salesmanager.test.shop.integration.tax.TaxRateIntegrationTest, com.salesmanager.test.shop.integration.user.UserApiIntegrationTest, com.salesmanager.test.shop.util.GeneratePasswordTest`
- **Generated LOO cases**: 1167

| Input Component | Baseline TP/Pred | Var A (Struct) TP/Pred | Var B (Hist) TP/Pred | Var C (Full) TP/Pred | Var A F1 | Var B F1 | Var C F1 |
|---|---|---|---|---|---|---|---|
| `ApplicationSearchConfiguration` | 1/1 | 1/1 | 1/1 | 1/1 | 0.0017 | 0.0017 | 0.0017 |
| `CoreApplicationConfiguration` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `DataConfiguration` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `DroolsBeanFactory` | 0/0 | 3/3 | 3/3 | 3/3 | 0.0051 | 0.0051 | 0.0051 |
| `ModulesConfiguration` | 0/0 | 1/1 | 1/1 | 1/1 | 0.0017 | 0.0017 | 0.0017 |
| `ProcessorsConfiguration` | 1/1 | 1/1 | 1/1 | 1/1 | 0.0017 | 0.0017 | 0.0017 |
| `DbConfig` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `AsynchronousEventsConfiguration` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `DeleteProductAttributeEvent` | 0/0 | 11/11 | 11/11 | 11/11 | 0.0187 | 0.0187 | 0.0187 |
| `DeleteProductEvent` | 0/0 | 10/10 | 10/10 | 10/10 | 0.017 | 0.017 | 0.017 |
| `DeleteProductImageEvent` | 0/0 | 11/11 | 11/11 | 11/11 | 0.0187 | 0.0187 | 0.0187 |
| `DeleteProductVariantEvent` | 0/0 | 11/11 | 11/11 | 11/11 | 0.0187 | 0.0187 | 0.0187 |
| `ProductAttributeEvent` | 0/0 | 10/10 | 10/10 | 10/10 | 0.017 | 0.017 | 0.017 |
| `ProductEvent` | 0/0 | 10/10 | 10/10 | 10/10 | 0.017 | 0.017 | 0.017 |
| `PublishProductAspect` | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |
| `SaveProductAttributeEvent` | 0/0 | 11/11 | 11/11 | 11/11 | 0.0187 | 0.0187 | 0.0187 |
| `SaveProductEvent` | 0/0 | 10/10 | 10/10 | 10/10 | 0.017 | 0.017 | 0.017 |
| `SaveProductImageEvent` | 0/0 | 11/11 | 11/11 | 11/11 | 0.0187 | 0.0187 | 0.0187 |
| `SaveProductVariantEvent` | 0/0 | 11/11 | 11/11 | 11/11 | 0.0187 | 0.0187 | 0.0187 |
| `IndexProductEventListener` | 2/2 | 2/2 | 2/2 | 2/2 | 0.0034 | 0.0034 | 0.0034 |
*... [1147 additional cases omitted from markdown summary for brevity]*

---

## 5. Controlled Ablation Analysis across Variants

| Commit Hash | Input Component | Rank Shifts (B vs A: Hist) | Rank Shifts (C vs B: Art) | Pred Set Changes (Hist) | Pred Set Changes (Art) |
|---|---|---|---|---|---|
| `a59820c` | `CategoryRepository` | 6 | 4 | 0 | 0 |
| `a59820c` | `PageableCategoryRepository` | 0 | 4 | 0 | 0 |
| `a59820c` | `ProductRepository` | 0 | 13 | 0 | 0 |
| `a59820c` | `CategoryService` | 6 | 26 | 0 | 0 |
| `a59820c` | `CategoryServiceImpl` | 21 | 13 | 0 | 0 |
| `a59820c` | `InitializationDatabaseImpl` | 0 | 19 | 0 | 0 |
| `a59820c` | `ZonesLoader` | 0 | 0 | 0 | 0 |
| `a59820c` | `SearchServiceImpl` | 0 | 0 | 0 | 0 |
| `a59820c` | `ReadableCategoryMapper` | 5 | 0 | 0 | 0 |
| `a59820c` | `Category` | 0 | 0 | 0 | 0 |
| `a59820c` | `CategoryApi` | 0 | 0 | 0 | 0 |
| `a59820c` | `ProductApi` | 16 | 0 | 0 | 0 |
| `a59820c` | `ProductGroupApi` | 0 | 0 | 0 | 0 |
| `a59820c` | `ProductRelationshipApi` | 0 | 0 | 0 | 0 |
| `a59820c` | `ProductApiV2` | 5 | 0 | 0 | 0 |
| `a59820c` | `CategoryFacadeImpl` | 20 | 16 | 0 | 0 |
| `60f0fac` | `CategoryApi` | 0 | 0 | 0 | 0 |
| `60f0fac` | `ProductApi` | 16 | 0 | 0 | 0 |
| `a158815` | `CategoryApi` | 0 | 0 | 0 | 0 |
| `a158815` | `ProductApi` | 16 | 0 | 0 | 0 |
| `81b0ade` | `CategoryRepository` | 6 | 4 | 0 | 0 |
| `81b0ade` | `CategoryService` | 6 | 26 | 0 | 0 |
| `81b0ade` | `CategoryServiceImpl` | 21 | 13 | 0 | 0 |
| `81b0ade` | `ProductApi` | 16 | 0 | 0 | 0 |
| `81b0ade` | `ProductApiV2` | 5 | 0 | 0 | 0 |
| `81b0ade` | `CategoryFacadeImpl` | 20 | 16 | 0 | 0 |
| `3f237ee` | `CategoryRepository` | 0 | 7 | 0 | 0 |
| `3f237ee` | `CategoryService` | 0 | 27 | 0 | 0 |
| `3f237ee` | `CategoryServiceImpl` | 0 | 13 | 0 | 0 |
| `3f237ee` | `ProductApi` | 0 | 0 | 0 | 0 |
*... [1183 additional cases omitted from markdown summary]*

---

## 6. Synthesis & Honest Conclusions

These findings are based on **1213 LOO cases from 13 eligible Shopizer commits** and must be treated as preliminary observations only.
