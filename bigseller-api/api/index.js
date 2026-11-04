/**
 * BigSeller API client — ทางเข้าเดียวของทั้งไลบรารี
 *
 *   import { searchOrders } from './api/index.js';        // ใช้ตรง ๆ
 *   import { get, post }    from './api/index.js';        // ยิง endpoint ที่ยังไม่มี wrapper
 *   import api              from './api/index.js';        // api.searchOrders(...)
 *
 * โครงสร้าง → ./README.md
 * endpoint แต่ละตัวมี README ของตัวเอง → ./endpoints/README.md
 */

// ------------------------------------------------------------------ แกนกลาง
export { BigSellerError, KINDS } from './core/errors.js';
export { get, post, postForm, request, sleep, getLastOkAt } from './core/http.js';
export { BASE_URL, DELAY_MS, CHUNK_SIZE, RETRIES, ENV_PATH, cookieNames, parseCookieNames, validateCookie }
                                           from './core/config.js';
export { getCookie, setCookie, onCookieChange } from './core/cookie-jar.js';

// ------------------------------------------------------------------ endpoint
export { searchOrders, searchOrdersBatch } from './endpoints/search-orders/index.js';
export { getStatusCount }                  from './endpoints/order-status-count/index.js';
export { getFilterList }                   from './endpoints/filter-list/index.js';
export { getLogisticsServices }            from './endpoints/logistics-services/index.js';
export { getSearchConfigs }                from './endpoints/search-config/index.js';
export { getSyncCheck }                    from './endpoints/sync-check/index.js';
export { getTiktokFailReason }             from './endpoints/tiktok-fail-reason/index.js';
export { listProducts, listProductsAll, listProductsWithStock }
                                           from './endpoints/list-products/index.js';
export { listStock, listStockAll }         from './endpoints/product-stock/index.js';
export { listManifests, listManifestsAll, findManifests }
                                           from './endpoints/manifests/index.js';
export { getManifestDetail, listManifestTrackings }
                                           from './endpoints/manifest-detail/index.js';
export { listWavePackages, listWavePackagesAll }
                                           from './endpoints/wave-packages/index.js';
export { getWavePackageCounts }            from './endpoints/wave-package-count/index.js';
export { listWaveWarehouses }              from './endpoints/wave-warehouses/index.js';
export { getWaveSidebarCount }             from './endpoints/wave-sidebar-count/index.js';
export { getOrderLog, listOrderLog, findOrderId, findOrder, parseLogDate, SCAN_PATTERN }
                                           from './endpoints/order-log/index.js';
export { searchReturns, findReturns, pickReturn, buildReturnSearchBody, RETURN_STATUS, IN_WAREHOUSE_STATUS }
                                           from './endpoints/return-in-warehouse/index.js';

// ตัวช่วยสร้าง body ที่ใช้ร่วมกัน — export ไว้เผื่อต้องประกอบ body เองแบบพิเศษ
export { buildSearchBody }  from './endpoints/_shared/search-body.js';
export { buildProductBody } from './endpoints/list-products/index.js';
export { buildStockBody }   from './endpoints/product-stock/index.js';
export { buildManifestBody } from './endpoints/manifests/index.js';
export { buildManifestDetailBody } from './endpoints/manifest-detail/index.js';
export { buildWavePackageBody, buildWaveCountBody,
         VIEWS as WAVE_VIEWS, TIME_TYPES as WAVE_TIME_TYPES, SEARCH_TYPES as WAVE_SEARCH_TYPES }
                             from './endpoints/_shared/wave-body.js';

// ตัวช่วยฝั่ง "หน้า" + SKU — ใช้ตอนเขียน endpoint ใหม่ที่เป็น pageList
export { pickPage, fetchAllPages, MAX_PAGES } from './endpoints/_shared/page.js';
export { skuOf, SKU_FIELDS }                  from './endpoints/_shared/sku.js';

// -------------------------------------------------- รวมเป็นก้อนเดียวไว้ import สั้น ๆ
import { searchOrders, searchOrdersBatch } from './endpoints/search-orders/index.js';
import { getStatusCount }                  from './endpoints/order-status-count/index.js';
import { getFilterList }                   from './endpoints/filter-list/index.js';
import { getLogisticsServices }            from './endpoints/logistics-services/index.js';
import { getSearchConfigs }                from './endpoints/search-config/index.js';
import { getSyncCheck }                    from './endpoints/sync-check/index.js';
import { getTiktokFailReason }             from './endpoints/tiktok-fail-reason/index.js';
import { listProducts, listProductsAll, listProductsWithStock }
                                           from './endpoints/list-products/index.js';
import { listStock, listStockAll }         from './endpoints/product-stock/index.js';
import { listManifests, listManifestsAll, findManifests }
                                           from './endpoints/manifests/index.js';
import { getManifestDetail, listManifestTrackings }
                                           from './endpoints/manifest-detail/index.js';
import { listWavePackages, listWavePackagesAll }
                                           from './endpoints/wave-packages/index.js';
import { getWavePackageCounts }            from './endpoints/wave-package-count/index.js';
import { listWaveWarehouses }              from './endpoints/wave-warehouses/index.js';
import { getWaveSidebarCount }             from './endpoints/wave-sidebar-count/index.js';
import { getOrderLog, listOrderLog, findOrderId, findOrder } from './endpoints/order-log/index.js';
import { searchReturns, findReturns }    from './endpoints/return-in-warehouse/index.js';

export default {
  searchOrders,
  searchOrdersBatch,
  getStatusCount,
  getFilterList,
  getLogisticsServices,
  getSearchConfigs,
  getSyncCheck,
  getTiktokFailReason,
  listProducts,
  listProductsAll,
  listProductsWithStock,
  listStock,
  listStockAll,
  listManifests,
  listManifestsAll,
  findManifests,
  getManifestDetail,
  listManifestTrackings,
  listWavePackages,
  listWavePackagesAll,
  getWavePackageCounts,
  listWaveWarehouses,
  getWaveSidebarCount,
  getOrderLog,
  listOrderLog,
  findOrderId,
  findOrder,
  searchReturns,
  findReturns,
};
