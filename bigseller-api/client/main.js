import { listWavePackagesAll } from '../api/endpoints/wave-packages/index.js';

// แม่นยำ — ส่งได้หลาย SKU
const data = await listWavePackagesAll({ searchType: 'sku', search: ['ถุงดำ 30 X 40'] });



console.log(data.rows.map((item)=>{
    return item.skuVos
}))
// คลุมเครือ — ส่งได้คำเดียว